"""Stáhne zdrojová data (ČSÚ / volby.gov.cz) do složky .cache/.

Použití:  python scripts/download.py
Pak:      python scripts/build_data.py
"""
import os
import sys
import urllib.request
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, ".cache")
B = "https://volby.gov.cz/opendata"

SOURCES = {
    # Poslanecká sněmovna – okrsková data, registry kandidátních listin, číselníky
    "ps2017": [f"{B}/ps2017/PS2017data20171021_csv.zip", f"{B}/ps2017/PS2017reg20171021_csv.zip",
               f"{B}/ps2017/PS2017ciselniky20170905_csv.zip"],
    "ps2021": [f"{B}/ps2021/PS2021_data_20211010_csv.zip", f"{B}/ps2021/PS2021reg20211010_csv.zip",
               f"{B}/ps2021/PS2021ciselniky20211006_csv.zip"],
    "ps2025": [f"{B}/ps2025/PS2025data20251005_csv.zip", f"{B}/ps2025/PS2025reg20251005_csv.zip",
               f"{B}/ps2025/PS2025ciselniky20251005_csv.zip"],
    # Komunální volby (ZHMP i ZMČ jsou ve stejném balíku, rozlišené TYPZASTUP / KODZASTUP)
    "kv2018": [f"{B}/kv2018/KV2018_data_20230224_csv.zip", f"{B}/kv2018/KV2018_reg_20230224_csv.zip",
               f"{B}/kv2018/KV2018_cisel_20230224_csv.zip"],
    "kv2022": [f"{B}/kv2022/KV2022_data_20260328_csv.zip", f"{B}/kv2022/KV2022reg20260328_csv.zip",
               f"{B}/kv2022/KV2022ciselniky20260328_csv.zip"],
    "kv2026": [f"{B}/kv2026/KV2026_data_20261011_csv.zip", f"{B}/kv2026/KV2026reg20261011_csv.zip",
               f"{B}/kv2026/KV2026ciselniky20261011_csv.zip"],
    # Hranice volebních okrsků (ČSÚ, plná přesnost, S-JTSK) – platné pro ZO 2026
    "geo": [
        "https://geodata.csu.gov.cz/as/data/distribuce/Hosted/Volebn%C3%AD_okrsky_ZO2026/FeatureServer/0/geojson.zip",
        "https://geodata.csu.gov.cz/as/data/distribuce/Hosted/Volebni_okrsky_2025_gdb/FeatureServer/0/geojson.zip",
        f"{B}/kv2022/geo/vol_okrsky_2022g100.zip",
        f"{B}/kz2024/geo/vol_okrsky_2024g100.zip",
    ],
}
GEO_NAMES = ["okrsky_zo2026.zip", "okrsky_ps2025.zip", "okrsky_2022g100.zip", "okrsky_2024g100.zip"]


def fetch(url, dest):
    if os.path.exists(dest) and os.path.getsize(dest) > 0:
        print("  (cache)", os.path.basename(dest))
        return
    print("  stahuji", url)
    req = urllib.request.Request(url, headers={"User-Agent": "volebni-mapa/1.0"})
    with urllib.request.urlopen(req, timeout=300) as r, open(dest + ".part", "wb") as f:
        while chunk := r.read(1 << 20):
            f.write(chunk)
    os.replace(dest + ".part", dest)


def main():
    for key, urls in SOURCES.items():
        d = os.path.join(CACHE, key)
        os.makedirs(d, exist_ok=True)
        print(key)
        for i, url in enumerate(urls):
            name = GEO_NAMES[i] if key == "geo" else os.path.basename(url)
            dest = os.path.join(d, name)
            fetch(url, dest)
            with zipfile.ZipFile(dest) as z:
                z.extractall(os.path.join(d, name[:-4]))
    print("hotovo ->", CACHE)


if __name__ == "__main__":
    sys.exit(main())
