"""Společné funkce pro zpracování dat ČSÚ: čtení CSV, procenta, barvy a propojení stran, zvolení kandidáti.

Používá scripts/build_data.py.
"""
import csv
import hashlib
import math
import re

NK = {80}  # „nezávislý kandidát“ – nepoužívá se pro propojení stran mezi volbami


def rd(path, enc="utf-8", sep=","):
    with open(path, encoding=enc, newline="") as f:
        return list(csv.DictReader(f, delimiter=sep))


def pct(part, total):
    """Procento na 2 desetinná místa – useknuté (ne zaokrouhlené), stejně jako to dělá ČSÚ."""
    return math.floor(part / total * 10000 + 1e-9) / 100 if total else None


# --------------------------------------------------------------------------- barvy

# Pořadí určuje barvu koalic: rozhoduje první strana ze seznamu, která je členem.
# Barvy dle zvyklostí v grafech průzkumů (Wikipedia „party color“), Piráti černá, ODS modrá.
PARTY_COLORS = [
    (720, "#000000"),   # Česká pirátská strana
    (53, "#034EA2"),    # ODS
    (721, "#993366"),   # TOP 09
    (166, "#CD0F69"),   # STAN
    (768, "#261060"),   # ANO 2011
    (1, "#E8C300"),     # KDU-ČSL (žlutá, mírně ztmavená kvůli čitelnosti na mapě)
    (1114, "#6696AE"),  # SPD
    (1298, "#C4161C"),  # Stačilo!
    (47, "#C10506"),    # KSČM
    (7, "#ED5700"),     # ČSSD / SOCDEM
    (759, "#F39200"),   # ČSSD – Česká suverenita sociální demokracie
    (5, "#00AD43"),     # Strana zelených
    (1178, "#009EE3"),  # Motoristé sobě
    (1245, "#0033FF"),  # PŘÍSAHA
    (1227, "#2738CD"),  # Trikolora
    (714, "#009682"),   # Svobodní
]
COLOR_SPOLU = "#37349D"
COLOR_PRAHA_SOBE = "#F3C405"
FALLBACK = ["#8C564B", "#7F7F7F", "#BCBD22", "#17BECF", "#9467BD", "#E377C2",
            "#8C6D31", "#637939", "#843C39", "#5254A3", "#6B6ECF", "#B5CF6B"]
RE_SOBE = re.compile(r"^PRAHA( 6)? SOBĚ", re.I)
RE_SPOLU = re.compile(r"\bSPOLU\b", re.I)


def members_of(slozeni):
    return [int(x) for x in re.split(r"[,\s]+", slozeni or "") if x.strip().isdigit()]


def party_color(members, name):
    if RE_SPOLU.search(name):
        return COLOR_SPOLU
    if RE_SOBE.search(name):
        return COLOR_PRAHA_SOBE
    for code, col in PARTY_COLORS:
        if code in members:
            return col
    h = int(hashlib.md5(name.encode("utf-8")).hexdigest(), 16)
    return FALLBACK[h % len(FALLBACK)]


def party_tags(members, name):
    """Štítky pro propojení stejné strany napříč volbami (kódy stran z číselníku CVS)."""
    tags = sorted({str(m) for m in members if m not in NK})
    if RE_SOBE.search(name):
        tags = sorted(set(tags) | {"1180"})  # Praha sobě (v r. 2018 kandidovala jako SNK)
    return tags


def kv_short(r, members):
    """Samostatná strana -> krátká zkratka (ODS, ANO…), koalice/sdružení -> název do 30 znaků."""
    if len(members) == 1 and members[0] not in NK and r["ZKRATKAO8"]:
        return r["ZKRATKAO8"]
    return r["ZKRATKAO30"] or r["ZKRATKAO8"]


# --------------------------------------------------------------------------- zvolení kandidáti

def party_short_names(path, enc="utf-8", sep=","):
    """Číselník stran (cvs.csv): kód strany -> zkratka."""
    return {int(r["VSTRANA"]): (r["ZKRATKAV8"] or r["ZKRATKAV30"] or r["NAZEVCELK"]) for r in rd(path, enc, sep)}


def full_name(r):
    name = " ".join(x for x in (r["TITULPRED"], r["JMENO"], r["PRIJMENI"]) if x)
    return f"{name}, {r['TITULZA']}" if r["TITULZA"] else name


def elected_entry(r, party, cvs, list_seats):
    nom = int(r["NSTRANA"]) if r["NSTRANA"].isdigit() else None
    e = {"s": r["KSTRANA"] if "KSTRANA" in r else r["POR_STR_HL"], "j": full_name(r),
         "h": int(r["POCHLASU"] or 0), "c": int(r["PORCISLO"])}
    # Zvolen(a) z pozice za počtem mandátů kandidátky => posun díky preferenčním hlasům.
    if e["c"] > list_seats:
        e["skok"] = True
    # U koalic a sdružení uvádíme, kdo kandidáta navrhl.
    if len(party["slozeni"]) > 1 or party["slozeni"] == [80]:
        e["n"] = "nezávislý kandidát" if nom in NK else cvs.get(nom, str(nom))
    return e
