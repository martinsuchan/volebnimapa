"""Vyrobí TESTOVACÍ data ve formátu živých XML ČSÚ pro KV 2026 (do test/mock-live/).

Slouží jen k ověření živého režimu před volbami (živý režim je teď vypnutý, viz README). Hlasy jsou
smyšlené: vychází z výsledků okrsků Prahy 6 z KV 2022 přemapovaných na kandidátky roku 2026 podle členských
stran. Zdrojem jsou data webu (web/data/oblast/500178.js), takže je nejdřív potřeba scripts/build_data.py.

Použití:
  python scripts/make_mock_live.py --davek 4      # zveřejněny dávky 1–4 z 6 (průběžný stav)
  python scripts/make_mock_live.py --davek 6      # vše sečteno
  python -m http.server 8765          (spustit v kořeni projektu, ne ve složce web/)
  -> http://127.0.0.1:8765/web/index.html?livebase=../test/mock-live#mc=500178&volby=kv2026-zmc
"""
import argparse
import base64
import gzip
import json
import os
import random
import re
from xml.sax.saxutils import quoteattr

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "test", "mock-live")
NS = "http://www.volby.cz/kv/"
TOTAL_BATCHES = 6


def load():
    """Volby Prahy 6 z dat webu (JSON → gzip → base64); každý okrsek dostane záznam své jednotky."""
    with open(os.path.join(ROOT, "web", "data", "oblast", "500178.js"), encoding="utf-8") as f:
        b64 = re.search(r'"([A-Za-z0-9+/=]{100,})"', f.read()).group(1)
    region = json.loads(gzip.decompress(base64.b64decode(b64)))
    out = {}
    for e in region["volby"]:
        e["okrsky"] = {}
        for o in region["okrsky"]:
            c = str(o["cislo"])
            u = e["jednotky"].get(e["okrsek_jednotka"].get(c, c))
            if u:
                e["okrsky"][c] = u
        out[e["id"]] = e
    return out


def mapping(src, dst):
    """Kandidátka 2026 -> seznam kandidátek 2022 se společnou stranou."""
    m = {}
    for p in dst["strany"]:
        m[p["id"]] = [q["id"] for q in src["strany"] if set(q["tagy"]) & set(p["tagy"])]
    return m


def fake_precinct(src_rec, mp, rnd, seats):
    s = {}
    for pid, olds in mp.items():
        base = sum(src_rec["s"].get(o, 0) for o in olds)
        if not olds:
            base = src_rec["h"] * rnd.uniform(0.005, 0.03)
        s[pid] = max(0, int(base * rnd.uniform(0.8, 1.2)))
    h = sum(s.values())
    o = round(h / seats * 1.02)
    return {"z": src_rec["z"], "v": o + 2, "o": o, "listky": round(h / seats), "h": h, "s": s}


def okrsek_xml(cis_obec, cislo, kodzastup, oznac, poradi, rec):
    hl = "".join(f'<HLASY_OKRSEK POR_STR_HLAS_LIST="{k}" HLASY="{v}"/>' for k, v in rec["s"].items() if v)
    return (f'<OKRSEK CIS_OBEC="{cis_obec}" CIS_OKRSEK="{cislo}" KODZASTUP="{kodzastup}" CIS_OBVODU="1" '
            f'OZNAC_TYPU="{oznac}" PORADI_ZPRAC="{poradi}" DATUM_CAS_ZPRAC="2026-10-10T14:{10 + poradi % 50:02d}:00" OPAKOVANE="0">'
            f'<UCAST_OKRSEK ZAPSANI_VOLICI="{rec["z"]}" VYDANE_OBALKY="{rec["v"]}" VOLICSKE_PRUKAZY="0" '
            f'ODEVZDANE_OBALKY="{rec["o"]}" PLATNE_LISTKY="{rec["listky"]}" PLATNE_HLASY="{rec["h"]}"/>{hl}</OKRSEK>\n')


def dhondt(votes, seats, threshold=0.05):
    """d'Hondtova metoda s 5% uzavírací klauzulí (zjednodušeně, jen pro testovací data)."""
    total = sum(votes.values())
    ok = {k: v for k, v in votes.items() if total and v / total >= threshold}
    quot = sorted(((v / d, k) for k, v in ok.items() for d in range(1, seats + 1)), reverse=True)[:seats]
    res = {}
    for _, k in quot:
        res[k] = res.get(k, 0) + 1
    return res


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--davek", type=int, default=TOTAL_BATCHES, help="kolik dávek je „zveřejněno“ (0–6)")
    args = ap.parse_args()
    E = load()
    rnd = random.Random(2026)
    os.makedirs(os.path.join(OUT, "okrsky"), exist_ok=True)
    os.makedirs(os.path.join(OUT, "zastup"), exist_ok=True)

    conf = [("zhmp", "554782", "OBEC", 65, E["kv2022-zhmp"], E["kv2026-zhmp"]),
            ("zmc", "500178", "MCMO", 45, E["kv2022-zmc"], E["kv2026-zmc"])]
    order = list(E["kv2022-zmc"]["okrsky"].keys())
    rnd.shuffle(order)
    per = -(-len(order) // TOTAL_BATCHES)
    data = {lab: {} for lab, *_ in conf}
    batches = [[] for _ in range(TOTAL_BATCHES)]
    poradi = 0
    for b in range(TOTAL_BATCHES):
        # cizí okrsky (jiná obec, jiná MČ se stejnými čísly neexistují) – musí se ignorovat
        for k in range(3):
            poradi += 1
            fake = {"z": 500, "v": 300, "o": 300, "listky": 300, "h": 9000, "s": {"1": 4000, "4": 5000}}
            batches[b].append(okrsek_xml("500054", 1001 + b * 3 + k, "500054", "MCMO", poradi, fake))
            poradi += 1
            batches[b].append(okrsek_xml("532088", 1 + k, "532088", "OBEC", poradi, fake))
        for c in order[b * per:(b + 1) * per]:
            for lab, kod, oznac, seats, src, dst in conf:
                rec = fake_precinct(src["okrsky"][c], mapping(src, dst), rnd, seats)
                poradi += 1
                data[lab][c] = rec
                batches[b].append(okrsek_xml("500178", c, kod, oznac, poradi, rec))
    # oprava: okrsek z 1. dávky přijde znovu v 5. dávce s jinými čísly (vyšší PORADI_ZPRAC)
    fix_c = order[0]
    for lab, kod, oznac, seats, src, dst in conf:
        rec = dict(data[lab][fix_c])
        rec["s"] = {k: (v * 2 if k == "4" else v) for k, v in rec["s"].items()}
        rec["h"] = sum(rec["s"].values())
        data[lab][fix_c + "_oprava"] = rec
        poradi += 1
        batches[4].append(okrsek_xml("500178", fix_c, kod, oznac, poradi, rec))

    # zapsat dávky; nezveřejněné smazat
    for i in range(1, TOTAL_BATCHES + 1):
        path = os.path.join(OUT, "okrsky", f"vysledky_okrsky_{i:05d}.xml")
        if i <= args.davek:
            done = sum(1 for b in batches[:i] for _ in b)
            with open(path, "w", encoding="utf-8") as f:
                f.write(f'<?xml version="1.0" encoding="UTF-8"?>\n<VYSLEDKY_OKRSKY xmlns="{NS}" DATUM_CAS_GENEROVANI="2026-10-10T14:{i * 5:02d}:00">\n'
                        f'<DAVKA DATUMVOLEB="20261009" PORADI_DAVKY="{i}" OKRSKY_DAVKA="{len(batches[i - 1])}" OKRSKY_CELKEM="16651" OKRSKY_ZPRAC="{done}"/>\n'
                        + "".join(batches[i - 1]) + "</VYSLEDKY_OKRSKY>\n")
        elif os.path.exists(path):
            os.remove(path)
    latest = os.path.join(OUT, "okrsky", "vysledky_okrsky.xml")
    if args.davek:
        with open(os.path.join(OUT, "okrsky", f"vysledky_okrsky_{args.davek:05d}.xml"), encoding="utf-8") as f:
            content = f.read()
    else:
        content = f'<?xml version="1.0" encoding="UTF-8"?>\n<VYSLEDKY_OKRSKY xmlns="{NS}" DATUM_CAS_GENEROVANI="2026-10-10T13:50:00">\n<CHYBA KOD_CHYBY="10"/>\n</VYSLEDKY_OKRSKY>\n'
    with open(latest, "w", encoding="utf-8") as f:
        f.write(content)

    # souhrn za zastupitelstvo (stavový soubor)
    published = order[:min(len(order), args.davek * per)]
    for lab, kod, oznac, seats, src, dst in conf:
        recs = [data[lab][c + "_oprava"] if (c == fix_c and args.davek >= 5) else data[lab][c] for c in published]
        h = sum(r["h"] for r in recs)
        votes = {p["id"]: sum(r["s"].get(p["id"], 0) for r in recs) for p in dst["strany"]}
        done = args.davek >= TOTAL_BATCHES
        mand = dhondt(votes, seats) if done else {}
        strany = ""
        for p in dst["strany"]:
            v = votes[p["id"]]
            m = mand.get(p["id"], 0)
            zast = "".join(f'<ZASTUPITEL PORADOVE_CISLO="{i + 1}" JMENO="Testovací" PRIJMENI="kandidát č. {i + 1}" TITULPRED="" TITULZA="" '
                           f'HLASY="{int(v / seats * (1.3 - i * 0.02))}" HLASY_PROC="0.00"/>' for i in range(m))
            strany += (f'<VOLEBNI_STRANA POR_STR_HLAS_LIST="{p["id"]}" NAZEV_STRANY={quoteattr(p["nazev"])} HLASY="{v}" '
                       f'HLASY_PROC="{(v / h * 100 if h else 0):.2f}" KANDIDATU_POCET="{seats}" ZASTUPITELE_POCET="{m}" '
                       f'ZASTUPITELE_PROC="0.00">{zast}</VOLEBNI_STRANA>\n')
        z = sum(r["z"] for r in recs)
        vyd = sum(r["v"] for r in recs)
        with open(os.path.join(OUT, "zastup", f"vysledky_obec_{kod}.xml"), "w", encoding="utf-8") as f:
            f.write(f'<?xml version="1.0" encoding="utf-8"?>\n<VYSLEDKY_OBEC xmlns="{NS}" DATUM_CAS_GENEROVANI="2026-10-10T15:00:00">\n'
                    f'<OBEC KODZASTUP="{kod}" NAZEVZAST="TEST" OZNAC_TYPU="{oznac}" VOLENO_ZASTUP="{seats}" POCET_OBVODU="1" JE_SPOCTENO="{1 if done else 0}">\n<VYSLEDEK>\n'
                    f'<UCAST OKRSKY_CELKEM="{104 if lab == "zmc" else 1110}" OKRSKY_ZPRAC="{len(recs)}" OKRSKY_ZPRAC_PROC="0.00" ZAPSANI_VOLICI="{z}" '
                    f'VYDANE_OBALKY="{vyd}" UCAST_PROC="0.00" VOLICSKE_PRUKAZY="0" ODEVZDANE_OBALKY="{vyd}" PLATNE_LISTKY="0" PLATNE_HLASY="{h}"/>\n'
                    f'{strany}</VYSLEDEK>\n</OBEC>\n</VYSLEDKY_OBEC>\n')
    print(f"Testovací data: {args.davek}/{TOTAL_BATCHES} dávek, {len(published)} okrsků Prahy 6, oprava okrsku {fix_c} v dávce 5 -> {OUT}")


if __name__ == "__main__":
    main()
