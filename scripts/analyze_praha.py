"""Analýza změn volebních okrsků v Praze 2017–2026 a návrh „oblastí změn“ pro mapu celé Prahy.

Princip:
  * Základní geometrie = vrstva ČSÚ pro KV 2026 (stav 8. 9. 2026), plná přesnost.
  * Pro každé volby X se okrsek z vrstvy 2026 považuje za STABILNÍ, pokud měl v den voleb prokazatelně
    stejné hranice jako dnes:
      - existoval ve výsledcích X se stejným číslem v téže MČ, a
      - jeho záznam v RÚIAN (platiod ve vrstvě 2025) je starší než den voleb, nebo
      - změna záznamu proběhla mezi vrstvami 2022 a 2024 a obě (stejně zjednodušené) vrstvy mají shodnou
        hranici (IoU >= 0,97) a verze z vrstvy 2022 platila už v den voleb, nebo
      - MČ má v X i dnes jediný okrsek (okrsek = celé území MČ).
    Okrsky změněné mezi 1. 7. 2025 a 8. 9. 2026 se poznají porovnáním geometrie 2025 a 2026.
  * Ostatní okrsky 2026 jsou ZMĚNĚNÉ. V rámci MČ se seskupí do souvislých oblastí. Tehdejší okrsky, které
    nemají stabilní protějšek, se k oblastem přiřadí podle polohy ve vrstvě, kde jejich tehdejší verze platila
    (2025 plná přesnost, 2024 a 2022 generalizované). Když to nejde, oblasti v MČ se sloučí do jedné.
  * V mapě se pak každá oblast zobrazí jako jeden útvar se součtem výsledků přiřazených tehdejších okrsků.

Výstup: data/analyza_okrsku.json (souhrn + oblasti pro každé volby).
"""
import csv
import datetime
import json
import os
from collections import Counter, defaultdict

import shapefile
from pyproj import Transformer
from shapely.geometry import shape
from shapely.ops import transform, unary_union
from shapely.strtree import STRtree

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
C = os.path.join(ROOT, ".cache")
OUT = os.path.join(ROOT, "data")
PRAHA = "554782"
LAYER_DATES = {"2022": "2022-10-04", "2024": "2024-05-21", "2025": "2025-07-01"}

ELECTIONS = {  # id: (první den voleb, soubor, kódování, oddělovač, DATUMVOLEB řádného termínu u KV)
    "ps2017": ("2017-10-20", "ps2017/PS2017data20171021_csv/pst4.csv", "cp1250", ";", None),
    "kv2018": ("2018-10-05", "kv2018/KV2018_data_20230224_csv/csv_od/kvt3.csv", "utf-8", ",", "20181005"),
    "ps2021": ("2021-10-08", "ps2021/PS2021_data_20211010_csv/csv_od/pst4.csv", "utf-8", ",", None),
    "kv2022": ("2022-09-23", "kv2022/KV2022_data_20260328_csv/csv_od/kvt3.csv", "utf-8", ",", "20220923"),
    "ps2025": ("2025-10-03", "ps2025/PS2025data20251005_csv/csv_od/pst4.csv", "utf-8", ",", None),
}


def rd(path, enc="utf-8", sep=","):
    with open(os.path.join(C, path), encoding=enc, newline="") as f:
        return list(csv.DictReader(f, delimiter=sep))


def load_results():
    res = {}
    for eid, (_, path, enc, sep, datum) in ELECTIONS.items():
        out = {}
        for r in rd(path, enc, sep):
            if r["OKRES"] != "1100":
                continue
            if "TYPZASTUP" in r and (r["TYPZASTUP"] != "1" or r["DATUMVOLEB"] != datum):
                continue
            out[(r["OBEC"], int(r["OKRSEK"]))] = int(r["VOL_SEZNAM"])
        res[eid] = out
    return res


def iso(v):
    if isinstance(v, (datetime.date, datetime.datetime)):
        return v.strftime("%Y-%m-%d")
    s = str(v or "")
    return f"{s[:4]}-{s[4:6]}-{s[6:8]}" if len(s) >= 8 else None


def load_layers():
    to_jtsk = Transformer.from_crs("EPSG:4326", "EPSG:5514", always_xy=True)
    L = {}
    d = json.load(open(os.path.join(C, "geo/okrsky_zo2026/Volebni_okrsky_ZO2026_20260908_20260908.geojson"), encoding="utf-8"))
    L["2026"] = {(p["kod_mco"], int(p["cislo"])): {"kod": int(p["kod"]), "mc": p["naz_mco"], "pob": p.get("pobyosl21"),
                                                   "geom": shape(f["geometry"]).buffer(0)}
                 for f in d["features"] if str((p := f["properties"]).get("kod_obec")) == PRAHA}
    d = json.load(open(os.path.join(C, "geo/okrsky_ps2025/vol_okrsky_2025_20250701.geojson"), encoding="utf-8"))
    L["2025"] = {(p["kod_mco"], int(p["cislo"])): {
        "kod": int(p["kod"]), "geom": shape(f["geometry"]).buffer(0),
        "platiod": datetime.datetime.fromtimestamp(p["platiod"] / 1000, datetime.timezone.utc).strftime("%Y-%m-%d")}
        for f in d["features"] if str((p := f["properties"]).get("kod_obec")) == PRAHA}
    for y, path in (("2022", "okrsky_2022g100/vol_okrsky_2022g100"), ("2024", "okrsky_2024g100/vol_okrsky_2024g100")):
        sf = shapefile.Reader(os.path.join(C, "geo", path), encoding="cp1250")
        fields = [f[0].upper() for f in sf.fields[1:]]
        L[y] = {}
        for sr in sf.iterShapeRecords():
            r = dict(zip(fields, sr.record))
            if str(r["OBEC"]) != PRAHA:
                continue
            L[y][(str(r["MOMC"]), int(r["CISLO"]))] = {"kod": int(r["KOD"]), "platiod": iso(r["PLATIOD"]),
                                                       "geom": shape(sr.shape.__geo_interface__).buffer(0)}
    return L


def iou(a, b):
    u = a.union(b).area
    return a.intersection(b).area / u if u else 0


def components(keys, geoms):
    """Souvislé skupiny okrsků (dotýkající se hranicí)."""
    keys = list(keys)
    parent = {k: k for k in keys}

    def find(k):
        while parent[k] != k:
            parent[k] = parent[parent[k]]
            k = parent[k]
        return k
    for i, a in enumerate(keys):
        ga = geoms[a].buffer(2)
        for b in keys[i + 1:]:
            if ga.intersects(geoms[b]):
                parent[find(a)] = find(b)
    groups = defaultdict(list)
    for k in keys:
        groups[find(k)].append(k)
    return [sorted(g) for g in groups.values()]


def compute(verbose=True, res=None, L=None):
    """Spočítá stabilní okrsky a oblasti změn pro všechny volby. Vrací slovník (viz analyza_okrsku.json)."""
    res = res or load_results()
    L = L or load_layers()
    log = print if verbose else (lambda *a, **k: None)
    L26, L25, L24, L22 = L["2026"], L["2025"], L["2024"], L["2022"]
    geoms26 = {k: v["geom"] for k, v in L26.items()}
    mc_name = {k[0]: v["mc"] for k, v in L26.items()}

    changed_25_26 = {k for k, v in L26.items()
                     if k not in L25 or L25[k]["kod"] != v["kod"] or iou(L25[k]["geom"], v["geom"]) < 0.995}
    n26 = Counter(k[0] for k in L26)

    def stable_for(k, date, R, nX):
        if k not in R or k in changed_25_26:
            return False
        if n26[k[0]] == 1 and nX[k[0]] == 1:
            return True  # jediný okrsek MČ = celé území MČ
        v25 = L25[k]
        if v25["platiod"] < date:
            return True
        # změna mezi vrstvami 2022 a 2024: ověřit shodu hranice ve stejně zjednodušených vrstvách
        v22, v24 = L22.get(k), L24.get(k)
        if (v22 and v24 and v24["platiod"] == v25["platiod"] and v22["platiod"] < date
                and LAYER_DATES["2022"] < v25["platiod"] <= LAYER_DATES["2024"]
                and iou(v22["geom"], v24["geom"]) >= 0.97):
            return True
        return False

    def old_geometry(k, date):
        """Hranice tehdejšího okrsku (S-JTSK) z vrstvy, kde jeho tehdejší verze platila."""
        for layer, ld in (("2025", LAYER_DATES["2025"]), ("2024", LAYER_DATES["2024"]), ("2022", LAYER_DATES["2022"])):
            v = L[layer].get(k)
            if v and v["platiod"] < date <= ld:
                return v["geom"], layer
        return None, None

    result = {"metoda": __doc__.strip(), "volby": {}, "mc": {}}
    log(f"Praha: {len(n26)} MČ, {len(L26)} okrsků 2026; změněno 7/2025–9/2026: {len(changed_25_26)}")
    for eid, (date, *_r) in ELECTIONS.items():
        R = res[eid]
        nX = Counter(k[0] for k in R)
        stable = {k for k in L26 if stable_for(k, date, R, nX)}
        changed = set(L26) - stable
        old_un = [k for k in R if k not in stable]
        zones = []
        unresolved_mc = []
        for mc in sorted({k[0] for k in changed} | {k[0] for k in old_un}):
            ch = [k for k in changed if k[0] == mc]
            old = [k for k in old_un if k[0] == mc]
            comps = components(ch, geoms26) if ch else []
            assign = defaultdict(list)
            missing = []
            if len(comps) == 1:
                assign[0] = old
            else:
                unions = [unary_union([geoms26[c] for c in comp]) for comp in comps]
                for k in old:
                    g, _ = old_geometry(k, date)
                    if g is None:
                        missing.append(k)
                        continue
                    ov = [g.intersection(u).area for u in unions]
                    if max(ov) <= 0:
                        missing.append(k)
                        continue
                    assign[ov.index(max(ov))].append(k)

            def implausible():
                # pojistka: poměr voličů k obyvatelům (sčítání 2021) musí dávat smysl
                for i, comp in enumerate(comps):
                    pob = sum(L26[c]["pob"] or 0 for c in comp)
                    vol = sum(R[k] for k in assign.get(i, []))
                    if pob >= 300 and not (0.35 <= vol / pob <= 1.1):
                        return True
                return False
            if missing or any(not assign.get(i) for i in range(len(comps))) or (len(comps) > 1 and implausible()):
                # nelze spolehlivě přiřadit -> jedna oblast za celou MČ
                if len(comps) > 1:
                    unresolved_mc.append(mc_name.get(mc, mc))
                comps = [sorted(ch)]
                assign = {0: old}
            for i, comp in enumerate(comps):
                olds = sorted(assign.get(i, []))
                volici = sum(R[k] for k in olds)
                pob = sum(L26[k]["pob"] or 0 for k in comp)
                zones.append({"mc": mc, "nazev_mc": mc_name.get(mc, mc), "okrsky_2026": [k[1] for k in comp],
                              "okrsky_tehdy": [k[1] for k in olds], "volici_tehdy": volici, "obyvatel_2021": pob,
                              "pomer": round(volici / pob, 2) if pob else None})
        st_v = sum(R[k] for k in stable)
        info = {"datum": date, "okrsku": len(R), "stabilnich": len(stable),
                "volici_ve_stabilnich_proc": round(st_v / sum(R.values()) * 100, 1),
                "oblasti": len(zones), "okrsku_2026_v_oblastech": sum(len(z["okrsky_2026"]) for z in zones),
                "okrsku_tehdy_v_oblastech": sum(len(z["okrsky_tehdy"]) for z in zones),
                "sloucene_mc": unresolved_mc, "zony": zones}
        result["volby"][eid] = info
        log(f"\n== {eid}: stabilních {len(stable)}/{len(L26)} okrsků 2026 ({info['volici_ve_stabilnich_proc']} % voličů), "
              f"oblastí změn {len(zones)} (z {info['okrsku_2026_v_oblastech']} dnešních / {info['okrsku_tehdy_v_oblastech']} tehdejších okrsků)"
              + (f"; sloučeno za celou MČ: {', '.join(unresolved_mc)}" if unresolved_mc else ""))
        for z in sorted(zones, key=lambda z: -len(z["okrsky_2026"])):
            if len(z["okrsky_2026"]) >= 3 or len(z["okrsky_tehdy"]) != len(z["okrsky_2026"]):
                log(f"   {z['nazev_mc']:<20} dnes {len(z['okrsky_2026']):>2} okrsků <- tehdy {len(z['okrsky_tehdy']):>2} "
                      f"| voliči/obyv. {z['pomer']}")
        if not zones:
            log("   (žádné)")
        small = [z for z in zones if len(z["okrsky_2026"]) < 3 and len(z["okrsky_tehdy"]) == len(z["okrsky_2026"])]
        if small:
            log(f"   + {len(small)} malých oblastí (1–2 okrsky, stejný počet): " +
                  ", ".join(f"{z['nazev_mc']} {'/'.join(map(str, z['okrsky_2026']))}" for z in small))
    for mc in sorted(n26):
        result["mc"][mc] = {"nazev": mc_name[mc], "okrsku_2026": n26[mc],
                            **{f"okrsku_{e}": sum(1 for k in res[e] if k[0] == mc) for e in ELECTIONS}}
    result["_stable"] = {eid: None for eid in ELECTIONS}
    return result


def main():
    os.makedirs(OUT, exist_ok=True)
    result = compute()
    result.pop("_stable", None)
    json.dump(result, open(os.path.join(OUT, "analyza_okrsku.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main()
