"""Sestaví data webu (mapa voleb pro celou Prahu po městských částech).

Výstupy (web/data/):
  praha.js            – přehled: seznam MČ, obrysy MČ, metadata voleb, zvolení poslanci a zastupitelé HMP
  oblast/<kod>.js     – jedna MČ: hranice okrsků 2026, výsledky PS / ZHMP / ZMČ po okrscích a oblastech změn
  oblast/praha.js     – celá Praha: hranice všech okrsků, výsledky PS a ZHMP
Soubory jsou JS (praha.js: window.VOLBY_V2_PACKED = "…", oblasti: window.VOLBY_V2_REGION("…")), aby web
fungoval i otevřený z disku (file://). Obsah je JSON zabalený gzipem a kódovaný base64 – prohlížeč ho rozbalí
nativním DecompressionStream (web/js/data.js), takže je malý i na hostingu bez komprese.

Geometrie je kompaktní: souřadnice jsou celá čísla v jednotkách 1/Q stupně (~1 m), každý kroužek je
[x0, y0, dx1, dy1, …] bez opakovaného posledního bodu. Obrysy MČ a oblastí změn se neukládají – prohlížeč je
složí z hranic okrsků (hrany sdílené dvěma okrsky skupiny se vyruší); sdílené hranice mají díky
coverage_simplify totožné vrcholy.

Oblasti změn: pokud se okrsky po daných volbách změnily, výsledky tehdejších okrsků se sečtou a zobrazí
na sloučeném území dnešních okrsků (viz scripts/analyze_praha.py).

Použití:  python scripts/download.py && python scripts/build_data.py
"""
import base64
import gzip
import json
import os
import sys
from collections import Counter, defaultdict

import shapely
from pyproj import Transformer
from shapely.ops import polylabel, transform, unary_union

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import analyze_praha as A  # noqa: E402
import common as B  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
C = os.path.join(ROOT, ".cache")
WEB = os.path.join(ROOT, "web", "data")
OUT = os.path.join(ROOT, "data")
PRAHA = "554782"
T = Transformer.from_crs("EPSG:5514", "EPSG:4326", always_xy=True)

PS = {
    "ps2017": dict(rok=2017, datum="2017-10-20/21", data="ps2017/PS2017data20171021_csv", reg="ps2017/PS2017reg20171021_csv",
                   cis="ps2017/PS2017ciselniky20170905_csv/cvs.csv", enc="cp1250", sep=";"),
    "ps2021": dict(rok=2021, datum="2021-10-08/09", data="ps2021/PS2021_data_20211010_csv/csv_od",
                   reg="ps2021/PS2021reg20211010_csv/csv_od", cis="ps2021/PS2021ciselniky20211006_csv/csv_od/cvs.csv",
                   enc="utf-8", sep=","),
    "ps2025": dict(rok=2025, datum="2025-10-03/04", data="ps2025/PS2025data20251005_csv/csv_od",
                   reg="ps2025/PS2025reg20251005_csv/csv_od", cis="ps2025/PS2025ciselniky20251005_csv/csv_od/cvs.csv",
                   enc="utf-8", sep=","),
}
KV = {
    "kv2018": dict(rok=2018, datum="2018-10-05/06", den="20181005", soud="20181130",
                   data="kv2018/KV2018_data_20230224_csv/csv_od", reg="kv2018/KV2018_reg_20230224_csv/csv_od",
                   cis="kv2018/KV2018_cisel_20230224_csv/csv_od/cvs.csv"),
    "kv2022": dict(rok=2022, datum="2022-09-23/24", den="20220923", soud="20221115",
                   data="kv2022/KV2022_data_20260328_csv/csv_od", reg="kv2022/KV2022reg20260328_csv/csv_od",
                   cis="kv2022/KV2022ciselniky20260328_csv/csv_od/cvs.csv"),
    # finální data zveřejněná den po volbách (první verze bez sloupce DATUMVOLEB, viz kv_results)
    "kv2026": dict(rok=2026, datum="2026-10-09/10", den="20261009", soud=None,
                   data="kv2026/KV2026_data_20261011_csv/csv_od", reg="kv2026/KV2026reg20261011_csv/csv_od",
                   cis="kv2026/KV2026ciselniky20261011_csv/csv_od/cvs.csv"),
}
ORDER = ["ps2017", "kv2018", "ps2021", "kv2022", "ps2025", "kv2026"]


def rd(path, enc="utf-8", sep=","):
    return B.rd(os.path.join(C, path), enc, sep)


def jdump(obj):
    return json.dumps(obj, ensure_ascii=False, separators=(",", ":"))


def pack(obj):
    """JSON → gzip → base64 (rozbalí web/js/data.js)."""
    return base64.b64encode(gzip.compress(jdump(obj).encode("utf-8"), 9, mtime=0)).decode("ascii")


Q = 100000  # souřadnice v jednotkách 1/Q stupně (1e-5° ≈ 0,7–1,1 m)


def enc_geom(g):
    """(Multi)Polygon → [[kroužek, …], …]; kroužek = [x0, y0, dx1, dy1, …] v celých číslech, neuzavřený."""
    out = []
    for p in getattr(g, "geoms", [g]):
        rings = []
        for i, r in enumerate([p.exterior, *p.interiors]):
            pts = []
            for x, y in r.coords:
                q = (round(x * Q), round(y * Q))
                if not pts or pts[-1] != q:
                    pts.append(q)
            if len(pts) > 1 and pts[-1] == pts[0]:
                pts.pop()
            if len(pts) < 3:
                if i == 0:
                    break  # vnější kroužek zanikl → celý polygon vynechat
                continue
            flat = [pts[0][0], pts[0][1]]
            for (ax, ay), (bx, by) in zip(pts, pts[1:]):
                flat += [bx - ax, by - ay]
            rings.append(flat)
        if rings:
            out.append(rings)
    return out


# ============================================================================ geometrie

def build_geometry():
    """Okrsky 2026 v Praze: {číslo: {...}} + obrysy MČ. Zjednodušení se zachováním společných hranic."""
    L = A.load_layers()
    L26 = L["2026"]
    keys = sorted(L26, key=lambda k: k[1])
    simp = shapely.coverage_simplify([L26[k]["geom"] for k in keys], tolerance=1.5)
    prec = {}
    for k, g in zip(keys, simp):
        big = max(getattr(g, "geoms", [g]), key=lambda x: x.area)
        lab = T.transform(*polylabel(big, tolerance=1.0).coords[0])
        prec[k[1]] = {"mc": k[0], "mc_nazev": L26[k]["mc"], "kod": L26[k]["kod"], "pob": L26[k]["pob"],
                      "jtsk": g, "geom": shapely.set_precision(transform(T.transform, g), 1e-6),
                      "stitek": [round(lab[0], 5), round(lab[1], 5)]}
    mcs = defaultdict(list)
    for n, p in prec.items():
        mcs[p["mc"]].append(n)
    return L, prec, mcs


def outline(jtsk_geoms, tol=0.0):
    u = unary_union(jtsk_geoms).buffer(0.5).buffer(-0.5)
    if tol:
        u = u.simplify(tol)
    return shapely.set_precision(transform(T.transform, u), 1e-6)


# ============================================================================ výsledky

def ps_results(eid):
    c = PS[eid]
    t4 = [r for r in rd(f"{c['data']}/pst4.csv", c["enc"], c["sep"]) if r["OKRES"] == "1100"]
    t4p_all = rd(f"{c['data']}/pst4p.csv", c["enc"], c["sep"])
    nat = Counter()
    for r in t4p_all:
        nat[r["KSTRANA"]] += int(r["POC_HLASU"])
    rec = {}
    for r in t4:
        rec[int(r["OKRSEK"])] = {"mc": r["OBEC"], "z": int(r["VOL_SEZNAM"]), "v": int(r["VYD_OBALKY"]),
                                 "o": int(r["ODEVZ_OBAL"]), "h": int(r["PL_HL_CELK"]), "s": {}}
    for r in t4p_all:
        if r["OKRES"] == "1100" and int(r["POC_HLASU"]):
            rec[int(r["OKRSEK"])]["s"][r["KSTRANA"]] = int(r["POC_HLASU"])
    for n, p in rec.items():
        assert sum(p["s"].values()) == p["h"], f"{eid} okrsek {n}"
    # kandidátky + zvolení (celostátně)
    cvs = B.party_short_names(os.path.join(C, c["cis"]), c["enc"], c["sep"])
    rows = [r for r in rd(f"{c['reg']}/psrk.csv", c["enc"], c["sep"]) if r["MANDAT"] == "A"]
    assert len(rows) == 200
    seats = Counter(r["KSTRANA"] for r in rows)
    nat_total = sum(nat.values())
    parties = {}
    for r in rd(f"{c['reg']}/psrkl.csv", c["enc"], c["sep"]):
        k = r["KSTRANA"]
        if nat.get(k, 0) == 0:
            continue
        members = B.members_of(r["SLOZENI"]) or [int(r["VSTRANA"])]
        parties[k] = {"id": k, "cislo": int(k), "zkratka": r["ZKRATKAK8"] or r["ZKRATKAK30"], "nazev": r["NAZEVCELK"],
                      "slozeni": members, "tagy": B.party_tags(members, r["NAZEVCELK"]),
                      "barva": B.party_color(members, r["NAZEVCELK"]), "celek_proc": B.pct(nat[k], nat_total),
                      "mandaty": seats.get(k, 0)}
    kraj_seats = Counter((r["VOLKRAJ"], r["KSTRANA"]) for r in rows)
    zvoleni = []
    for r in rows:
        x = B.elected_entry(r, parties[r["KSTRANA"]], cvs, kraj_seats[(r["VOLKRAJ"], r["KSTRANA"])])
        x["k"] = int(r["VOLKRAJ"])
        if r.get("POCPROC") and float(r["POCPROC"]) > 0:
            x["p"] = float(r["POCPROC"])
        zvoleni.append(x)
    zvoleni.sort(key=lambda x: (-seats[x["s"]], x["s"], x["k"], x["c"]))
    meta = {"id": eid, "typ": "ps", "rok": c["rok"], "datum": c["datum"], "nazev": f"Poslanecká sněmovna {c['rok']}",
            "celek_nazev": "ČR", "zdroj": f"https://volby.gov.cz/opendata/{eid}/"}
    return meta, rec, parties, {"celkem": 200}, zvoleni


def kv_results(eid):
    """Výsledky ZHMP i ZMČ (všechny MČ) z jednoho balíku KV."""
    c = KV[eid]

    def rows(path):
        # první verze dat po volbách (KV 2026) nemá sloupec DATUMVOLEB – obsahuje jen řádný termín
        out = [r for r in rd(path) if r["OKRES"] == "1100"]
        for r in out:
            r.setdefault("DATUMVOLEB", c["den"])
        return out

    t3 = [r for r in rows(f"{c['data']}/kvt3.csv") if r["DATUMVOLEB"] == c["den"]]
    hl = [r for r in rows(f"{c['data']}/kvhl.csv") if r["DATUMVOLEB"] == c["den"]]
    ros_all = rows(f"{c['reg']}/kvros.csv")
    rk_all = [r for r in rows(f"{c['reg']}/kvrk.csv") if r["MANDAT"] == "A"]
    cvs = B.party_short_names(os.path.join(C, c["cis"]))

    def reg_date(rows, kod):
        """Registr: stav po případném rozhodnutí soudu (pozdější termín), jinak řádný termín."""
        dates = {r["DATUMVOLEB"] for r in rows if r["KODZASTUP"] == kod}
        return c["soud"] if c["soud"] in dates else c["den"]

    out = {}
    for typ, label in (("1", "zhmp"), ("2", "zmc")):
        rec = {}
        obvod = {}
        for r in t3:
            if r["TYPZASTUP"] != typ:
                continue
            n = int(r["OKRSEK"])
            rec[n] = {"mc": r["OBEC"], "kod": r["KODZASTUP"], "z": int(r["VOL_SEZNAM"]), "v": int(r["VYD_OBALKY"]),
                      "o": int(r["ODEVZ_OBAL"]), "h": int(r["PL_HL_CELK"]), "s": {}}
            obvod[n] = r["COBVODU"]
        # kandidátky po zastupitelstvech; u více obvodů (Praha 9 v r. 2018) se sloučí podle strany (VSTRANA)
        lists = defaultdict(dict)  # kod -> (obvod, por) -> party id
        parties = defaultdict(dict)  # kod -> id -> party
        for kod in sorted({r["kod"] for r in rec.values()}):
            d = reg_date(ros_all, kod)
            rows = [r for r in ros_all if r["KODZASTUP"] == kod and r["DATUMVOLEB"] == d]
            multi = len({r["COBVODU"] for r in rows}) > 1
            for r in rows:
                pid = f"v{r['VSTRANA']}" if multi else r["POR_STR_HL"]
                lists[kod][(r["COBVODU"], r["POR_STR_HL"])] = pid
                if pid in parties[kod]:
                    parties[kod][pid]["mandaty"] += int(r["MAND_STR"] or 0)
                    continue
                members = B.members_of(r["SLOZENI"])
                parties[kod][pid] = {
                    "id": pid, "cislo": int(r["POR_STR_HL"]), "zkratka": B.kv_short(r, members), "nazev": r["NAZEVCELK"],
                    "slozeni": members, "tagy": B.party_tags(members, r["NAZEVCELK"]),
                    "barva": B.party_color(members, r["NAZEVCELK"]),
                    "celek_proc": float(r["PROCHLSTR"]) if r["PROCHLSTR"] and not multi else None,
                    "mandaty": int(r["MAND_STR"] or 0)}
        for r in hl:
            if r["TYPZASTUP"] != typ or not int(r["POC_HLASU"]):
                continue
            n = int(r["OKRSEK"])
            pid = lists[rec[n]["kod"]][(obvod[n], r["POR_STR_HL"])]
            rec[n]["s"][pid] = rec[n]["s"].get(pid, 0) + int(r["POC_HLASU"])
        for n, p in rec.items():
            assert sum(p["s"].values()) == p["h"], f"{eid} {label} okrsek {n}"
        # zvolení
        zvoleni = defaultdict(list)
        for kod in parties:
            d = reg_date(rk_all, kod)
            rows = [r for r in rk_all if r["KODZASTUP"] == kod and r["DATUMVOLEB"] == d]
            seats = Counter(lists[kod][(r["COBVODU"], r["POR_STR_HL"])] for r in rows)
            for pid, p in parties[kod].items():
                assert seats.get(pid, 0) == p["mandaty"], f"{eid} {kod} {p['zkratka']}: mandáty nesedí"
            seats_list = Counter((r["COBVODU"], r["POR_STR_HL"]) for r in rows)
            for r in rows:
                pid = lists[kod][(r["COBVODU"], r["POR_STR_HL"])]
                r2 = dict(r, KSTRANA=pid)
                zvoleni[kod].append(B.elected_entry(r2, parties[kod][pid], cvs, seats_list[(r["COBVODU"], r["POR_STR_HL"])]))
            zvoleni[kod].sort(key=lambda x: (-seats[x["s"]], x["s"], x["c"]))
        out[label] = (rec, parties, zvoleni)
    return out


# Živé výsledky KV 2026 (vypnuto po sečtení – 2026 je teď řádné volby z finálních dat). Pro příští
# volby: odkomentovat, upravit cesty k registru a v main() vrátit větev s "live".
# def kv2026_registry():
    # ros = [r for r in rd("kv2026/KV2026reg20261002_csv/csv_od/kvros.csv") if r["OKRES"] == "1100"]
    # rz = {r["KODZASTUP"]: int(r["MANDATY"]) for r in rd("kv2026/KV2026reg20261002_csv/csv_od/kvrzcoco.csv")
          # if r["OKRES"] == "1100"}
    # parties = defaultdict(list)
    # for r in ros:
        # members = B.members_of(r["SLOZENI"])
        # parties[r["KODZASTUP"]].append({
            # "id": r["POR_STR_HL"], "cislo": int(r["POR_STR_HL"]), "zkratka": B.kv_short(r, members), "nazev": r["NAZEVCELK"],
            # "slozeni": members, "tagy": B.party_tags(members, r["NAZEVCELK"]), "barva": B.party_color(members, r["NAZEVCELK"]),
            # "hlasy": 0, "proc": 0, "celek_proc": None, "mandaty": 0})
    # for v in parties.values():
        # v.sort(key=lambda p: p["cislo"])
    # return parties, rz


# ============================================================================ sestavení oblasti (MČ / celá Praha)

def units_for(eid, region_prec, rec, zones_all):
    """Jednotky zobrazení: stabilní okrsek = okrsek, změněné území = oblast se součtem tehdejších okrsků."""
    base = eid[:6]
    zones = zones_all.get(base, [])
    units, unit_of, zone_out = {}, {}, []
    zoned = set()
    for i, z in enumerate(zones):
        today = [n for n in z["okrsky_2026"] if n in region_prec]
        if not today:
            continue
        olds = [n for n in z["okrsky_tehdy"] if n in rec]
        zid = f"Z{z['mc']}-{i}"
        agg = {"z": 0, "v": 0, "o": 0, "h": 0, "s": {}}
        for n in olds:
            r = rec[n]
            for k in ("z", "v", "o", "h"):
                agg[k] += r[k]
            for pid, v in r["s"].items():
                agg["s"][pid] = agg["s"].get(pid, 0) + v
        agg["okrsky_tehdy"] = olds
        agg["okrsky_dnes"] = today
        units[zid] = agg
        for n in today:
            unit_of[n] = zid
        zoned.update(today)
        zone_out.append({"id": zid, "okrsky_dnes": today, "okrsky_tehdy": olds})  # obrys složí prohlížeč
    for n in region_prec:
        if n in zoned:
            continue
        if n in rec:
            r = rec[n]
            units[str(n)] = {"z": r["z"], "v": r["v"], "o": r["o"], "h": r["h"], "s": r["s"]}
    return units, unit_of, zone_out


def finish_parties(parties, units):
    tot = sum(u["h"] for u in units.values())
    out = []
    for p in parties:
        q = dict(p)
        q["hlasy"] = sum(u["s"].get(p["id"], 0) for u in units.values())
        q["proc"] = B.pct(q["hlasy"], tot) or 0
        out.append(q)
    out.sort(key=lambda p: (-p["hlasy"], p["cislo"]))
    return out


def summary(units):
    z = sum(u["z"] for u in units.values())
    v = sum(u["v"] for u in units.values())
    return {"okrsku": len(units), "zapsani": z, "vydane_obalky": v,
            "odevzdane_obalky": sum(u["o"] for u in units.values()), "platne_hlasy": sum(u["h"] for u in units.values()),
            "ucast_proc": B.pct(v, z)}


def main():
    os.makedirs(os.path.join(WEB, "oblast"), exist_ok=True)
    os.makedirs(OUT, exist_ok=True)
    print("geometrie…")
    L, prec, mcs = build_geometry()
    print("analýza oblastí změn…")
    an = A.compute(verbose=False, L=L)
    zones_all = {eid: an["volby"][eid]["zony"] for eid in an["volby"]}
    print("výsledky…")
    ps = {eid: ps_results(eid) for eid in PS}
    kv = {eid: kv_results(eid) for eid in KV}
    # reg26, seats26 = kv2026_registry()  # živé výsledky (vypnuto)
    mc_name = {mc: prec[ns[0]]["mc_nazev"] for mc, ns in mcs.items()}

    # ---------------- přehled
    mc_list = []
    mc_outlines = []
    for mc, ns in sorted(mcs.items(), key=lambda x: mc_name[x[0]]):
        ol = outline([prec[n]["jtsk"] for n in ns], tol=8)
        b = ol.bounds
        mc_list.append({"kod": mc, "nazev": mc_name[mc], "okrsku": len(ns),
                        "bounds": [round(b[0], 5), round(b[1], 5), round(b[2], 5), round(b[3], 5)]})
        mc_outlines.append({"kod": mc, "nazev": mc_name[mc], "g": enc_geom(ol)})
    elections_meta = []
    for eid in ORDER:
        if eid in PS:
            m = ps[eid][0]
            elections_meta += [m]
        elif eid in KV:
            c = KV[eid]
            for t in ("zhmp", "zmc"):
                elections_meta.append({"id": f"{eid}-{t}", "typ": t, "rok": c["rok"], "datum": c["datum"],
                                       "zdroj": f"https://volby.gov.cz/opendata/{eid}/"})
        # živé volby (vypnuto):
        # else:
            # for t in ("zhmp", "zmc"):
                # elections_meta.append({"id": f"kv2026-{t}", "typ": t, "rok": 2026, "datum": "2026-10-09/10", "live": True,
                                       # "zdroj": "https://volby.gov.cz/opendata/kv2026/"})
    verification = {eid: {k: an["volby"][eid][k] for k in ("datum", "okrsku", "stabilnich", "volici_ve_stabilnich_proc",
                                                          "oblasti", "okrsku_2026_v_oblastech", "okrsku_tehdy_v_oblastech")}
                    for eid in an["volby"]}
    overview = {
        "vytvoreno": __import__("datetime").date.today().isoformat(),
        "okrsku": len(prec), "mc": mc_list,
        "q": Q,
        "obrysy_mc": mc_outlines,  # zjednodušené obrysy pro výběr MČ na mapě
        "volby": elections_meta,
        "overeni": verification,
        # společné pro všechny oblasti: zvolení poslanci a zastupitelé HMP (+ počty mandátů)
        "zvoleni": {**{eid: ps[eid][4] for eid in PS},
                    **{f"{eid}-zhmp": kv[eid]["zhmp"][2][PRAHA] for eid in KV}},
        "mandaty": {**{eid: 200 for eid in PS},
                    **{f"{eid}-zhmp": sum(p["mandaty"] for p in kv[eid]["zhmp"][1][PRAHA].values()) for eid in KV}},
    }
    with open(os.path.join(WEB, "praha.js"), "w", encoding="utf-8") as f:
        f.write("// Vygenerováno skriptem scripts/build_data.py – neupravovat ručně (JSON → gzip → base64).\n"
                "window.VOLBY_V2_PACKED = \"")
        f.write(pack(overview))
        f.write("\";\n")

    # ---------------- oblasti
    regions = [(mc, mc_name[mc], ns) for mc, ns in mcs.items()] + [("praha", "Celá Praha", list(prec))]
    sizes = []
    for code, name, ns in regions:
        region_prec = {n: prec[n] for n in ns}
        is_all = code == "praha"
        elections = []
        for eid in ORDER:
            if eid in PS:
                meta, rec, parties, mand, _zv = ps[eid]
                units, unit_of, zones = units_for(eid, region_prec, rec, zones_all)
                strany = [p for p in finish_parties(list(parties.values()), units) if p["hlasy"] > 0 or p["mandaty"] > 0]
                elections.append({**meta, "strany": strany, "souhrn": summary(units),
                                  "jednotky": units, "okrsek_jednotka": {str(k): v for k, v in unit_of.items()}, "oblasti": zones})
            elif eid in KV:
                c = KV[eid]
                for t in ("zhmp", "zmc"):
                    if t == "zmc" and is_all:
                        continue
                    rec, parties, zvoleni = kv[eid][t]
                    kod = PRAHA if t == "zhmp" else code
                    units, unit_of, zones = units_for(eid, region_prec, rec, zones_all)
                    strany = finish_parties(list(parties[kod].values()), units)
                    e = {"id": f"{eid}-{t}", "typ": t, "rok": c["rok"], "datum": c["datum"],
                         "nazev": (f"Zastupitelstvo hl. m. Prahy {c['rok']}" if t == "zhmp"
                                   else f"Zastupitelstvo MČ {name} {c['rok']}"),
                         "celek_nazev": "celá Praha" if t == "zhmp" else name,
                         "zdroj": f"https://volby.gov.cz/opendata/{eid}/",
                         "pozn": "U komunálních voleb má volič tolik hlasů, kolik se volí zastupitelů; "
                                 "procento = hlasy strany / všechny platné hlasy v okrsku.",
                         "strany": strany, "souhrn": summary(units),
                         "jednotky": units, "okrsek_jednotka": {str(k): v for k, v in unit_of.items()}, "oblasti": zones}
                    if t == "zmc":
                        e["zvoleni"] = zvoleni.get(kod, [])
                        e["mandaty"] = {"celkem": sum(p["mandaty"] for p in parties[kod].values())}
                    elections.append(e)
            # živé volby (vypnuto):
            # else:
                # for t in ("zhmp", "zmc"):
                    # if t == "zmc" and is_all:
                        # continue
                    # kod = PRAHA if t == "zhmp" else code
                    # elections.append({
                        # "id": f"kv2026-{t}", "typ": t, "rok": 2026, "datum": "2026-10-09/10",
                        # "nazev": (f"Zastupitelstvo hl. m. Prahy 2026" if t == "zhmp" else f"Zastupitelstvo MČ {name} 2026"),
                        # "celek_nazev": "celá Praha" if t == "zhmp" else name,
                        # "zdroj": "https://volby.gov.cz/opendata/kv2026/",
                        # "live": {"datumvoleb": "20261009", "kodzastup": kod,
                                 # "base": "https://volby.gov.cz/appdata/kv2026/20261009/odata"},
                        # "pozn": "Živé výsledky se načítají přímo z otevřených dat ČSÚ (dávky okrsků po 5 minutách).",
                        # "strany": [dict(p) for p in reg26.get(kod, [])], "souhrn": None,
                        # "jednotky": {}, "okrsek_jednotka": {}, "oblasti": [],
                        # "mandaty": {"celkem": seats26.get(kod, 0)}, "zvoleni": []})
        feats = [{"cislo": n, "mc": p["mc"], "mc_nazev": p["mc_nazev"], "kod": p["kod"], "stitek": p["stitek"],
                  "obyv": p["pob"], "vymera_m2": int(round(p["jtsk"].area)), "g": enc_geom(p["geom"])}
                 for n, p in sorted(region_prec.items())]
        region = {"kod": code, "nazev": name, "okrsku": len(ns), "q": Q, "okrsky": feats, "volby": elections}
        path = os.path.join(WEB, "oblast", f"{code}.js")
        with open(path, "w", encoding="utf-8") as f:
            f.write("// Vygenerováno skriptem scripts/build_data.py – neupravovat ručně (JSON → gzip → base64).\n"
                    "window.VOLBY_V2_REGION(\"")
            f.write(pack(region))
            f.write("\");\n")
        sizes.append((os.path.getsize(path), name))
    sizes.sort()
    total = sum(s for s, _ in sizes)
    print(f"praha.js: {os.path.getsize(os.path.join(WEB, 'praha.js')) / 1024:.0f} kB; oblastí {len(sizes)}, "
          f"celkem {total / 1e6:.2f} MB; nejmenší {sizes[0][1]} {sizes[0][0] / 1024:.0f} kB, "
          f"největší: " + ", ".join(f"{n} {s / 1024:.0f} kB" for s, n in sizes[-3:]))


if __name__ == "__main__":
    main()
