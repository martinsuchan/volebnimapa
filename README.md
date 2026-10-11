# Volební mapa Prahy

Statická webová stránka s mapou volebních okrsků **všech 57 městských částí Prahy** a **celé Prahy**. Nad podkladovou
mapou (Leaflet + dlaždice ČÚZK) jsou poloprůhledně vykreslené hranice okrsků obarvené podle podílu hlasů vybrané
kandidátky.

Podkladové mapy jsou ze služeb ČÚZK (Základní topografická mapa a ortofoto). Jsou zdarma, bez API klíče,
licence CC BY 4.0 (uvádí se „© ČÚZK“). Dlaždice OpenStreetMap se záměrně nepoužívají: servery OSM
blokují požadavky bez hlavičky Referer (stránka otevřená z disku) a nejsou určené pro větší provoz.

Obsažené volby:

| Volby | Datum |
|---|---|
| Poslanecká sněmovna 2017, 2021, 2025 | 20.–21. 10. 2017, 8.–9. 10. 2021, 3.–4. 10. 2025 |
| Zastupitelstvo hl. m. Prahy 2018, 2022, 2026 | 5.–6. 10. 2018, 23.–24. 9. 2022, 9.–10. 10. 2026 |
| Zastupitelstva všech 57 MČ 2018, 2022, 2026 | dtto |

KV 2026 je z finálních otevřených dat ČSÚ zveřejněných 11. 10. 2026 (`KV2026_data_20261011_csv`, registry
`KV2026reg20261011_csv`). Živé napojení z doby sčítání je vypnuté, viz níže.

## Spuštění a nasazení

**Celá webová stránka je ve složce `web/`.** Na hosting (FTP, Azure Static Web Apps, GitHub Pages…) stačí
zkopírovat obsah této složky (~2,7 MB), nic jiného web nepotřebuje:

```
web/
  index.html
  css/app.css
  js/app.js, js/boot.js, js/data.js, js/live.js (živé výsledky, teď se nenačítá)
  data/praha.js, data/oblast/*.js
```

Lokálně stačí otevřít `web/index.html` v prohlížeči (funguje i z disku), nebo přes server:

```
python -m http.server 8000 --directory web
# http://localhost:8000/
```

Mimo složku `web/` jsou jen pracovní věci: `scripts/` (stažení a zpracování dat), `data/` (analýza změn okrsků),
`test/` (testovací data živého režimu) a `.cache/` (stažené zdroje, ~1,2 GB).

## Ovládání

- **Území**: při první návštěvě si člověk vybere MČ na mapě nebo ze seznamu. Volba se zapamatuje a jde kdykoli
  změnit přepínačem „Území“ nebo tlačítkem „Mapa MČ“ v hlavičce. Při změně MČ zůstanou zachované volby i strana.
  Pro „Celou Prahu“ jsou k dispozici Sněmovna a zastupitelstvo hl. m. Prahy, pro MČ navíc zastupitelstvo dané MČ.
- **Typ voleb / Rok / Kandidující strana**: strany jsou seřazené podle zisku ve zvoleném území.
  Při změně roku nebo typu voleb mapa zůstane na „stejné“ straně (dohledá kandidátku se stejnou členskou stranou).
- **Zobrazit: Podíl hlasů / Změnu oproti…**: mapa změny v procentních bodech proti jiným volbám.
- **Škála barev**: společná pro stranu v čase (výchozí, mapy různých let jsou přímo srovnatelné), podle této volby,
  nebo pevná 0–50 %.
- **Najetí na okrsek**: název okrsku, účast a výsledky stran nad 5 % s pruhovým grafem.
- **Klik na okrsek**: detail okrsku a vývoj podpory strany v daném okrsku napříč volbami.
- **Rozdělení mandátů** (zastupitelstvo MČ; u celé Prahy ZHMP): půlkruh s kuličkou za každý mandát v barvě strany.
  Po najetí myší se ukáže zvolený kandidát, počet jeho hlasů, pořadí na kandidátce a u koalic navrhující strana;
  šipka ↑ = zvolen(a) díky preferenčním hlasům (z pozice za počtem mandátů kandidátky). Zdroj: registr kandidátů
  ČSÚ `kvrk`.
- Stav mapy je v URL (`#mc=500178&volby=kv2026-zmc&strana=4&okrsek=6034`), takže jde odkaz přímo sdílet.
- Export výsledků aktuálních voleb po okrscích do CSV. Šířku pravého panelu lze měnit tažením jeho okraje.

## Data

Vše je ze zdrojů Českého statistického úřadu a je staticky uložené. Data se načítají po MČ:

| Soubor | Obsah | Velikost |
|---|---|---|
| `web/data/praha.js` | seznam a obrysy MČ, metadata voleb, zvolení poslanci a zastupitelé HMP, souhrn ověření okrsků | 50 kB |
| `web/data/oblast/<kód MČ>.js` | hranice okrsků MČ + výsledky PS, ZHMP a ZMČ po okrscích | 11–125 kB |
| `web/data/oblast/praha.js` | celá Praha: všech 1 120 okrsků, PS a ZHMP | 711 kB |
| `data/analyza_okrsku.json` | analýza změn okrsků a „oblasti změn“ pro každé volby (web ho nenačítá) | |

Návštěvník stáhne jen přehled a zvolenou MČ (typicky do 150 kB).

**Formát:** každý datový soubor je JSON zabalený **gzipem a kódovaný base64** uvnitř `.js`
(`window.VOLBY_V2_PACKED = "…"`, resp. `window.VOLBY_V2_REGION("…")`). Prohlížeč ho rozbalí nativním
`DecompressionStream` ([web/js/data.js](web/js/data.js)). Je tedy malý i na hostingu, který sám nekomprimuje,
a funguje i z disku (file://). Podporují ho všechny současné prohlížeče (Chrome/Edge 80+, Firefox 113+, Safari 16.4+).
Souřadnice jsou celá čísla v jednotkách 0,00001° (~1 m), uložená jako rozdíly od předchozího bodu. Obrysy MČ a
oblastí změn se neukládají. Prohlížeč je složí z hranic okrsků: hrana sdílená dvěma okrsky téže skupiny se vyruší.

Zdroje:

- výsledky: <https://volby.gov.cz/opendata/opendata.htm> – PS 2017/2021/2025 (`pst4`, `pst4p`, `psrkl`, `psrk`),
  KV 2018/2022/2026 (`kvt3`, `kvhl`, `kvros`, `kvrk`, `kvrzcoco`; ZHMP = `KODZASTUP 554782`), číselníky stran `cvs`,
- hranice okrsků: ČSÚ, *Volební okrsky pro volby do zastupitelstev obcí 2026* (geodata.csu.gov.cz, účelový prvek RÚIAN),
  přepočteno z S-JTSK (EPSG:5514) do WGS84, zjednodušeno s tolerancí 1,5 m se zachováním společných hranic;
  pro analýzu změn také vrstvy 2022, 2024 (generalizované) a 2025.

**Komunální volby:** volič má tolik hlasů, kolik se volí zastupitelů; procento = hlasy kandidátky / všechny platné
hlasy v okrsku, stejně jako to počítá ČSÚ. Procenta jsou useknutá na 2 desetinná místa jako u ČSÚ.

**Barvy:** podle zvyklostí z grafů průzkumů (Wikipedia „party color“): Piráti černá, ODS modrá `#034EA2`,
SPOLU tmavě modrá, ANO tmavě fialová, STAN purpurová, TOP 09 vínová, KDU-ČSL žlutá, SPD šedomodrá,
KSČM a Stačilo! červená, ČSSD oranžová, Zelení zelená, Motoristé světle modrá, Praha sobě žlutá.
Koalice mají barvu vedoucí strany. Pro každou stranu se kreslí jednobarevná škála (světlá → barva strany).

### Přegenerování dat

```
pip install shapely pyproj pyshp
python scripts/download.py        # stáhne zdroje do .cache/ (hlavně hranice okrsků za celou ČR)
python scripts/analyze_praha.py   # volitelné: analýza změn okrsků -> data/analyza_okrsku.json
python scripts/build_data.py      # -> web/data/
```

`scripts/common.py` obsahuje společné funkce (barvy a propojení stran, zkratky, zvolení kandidáti).

**Kontroly při sestavení:**
- součet hlasů v každém okrsku se rovná počtu platných hlasů,
- součty ZHMP odpovídají oficiálním `HLASY_STR`,
- součty kandidátek všech zastupitelstev MČ 2018, 2022 a 2026 odpovídají oficiálním výsledkům (0 rozdílů),
- celá Praha se rovná součtu všech MČ,
- počty mandátů odpovídají registru zvolených,
- celostátní výsledky PS sedí s volby.gov.cz (např. ANO 2025 = 1 940 507 hlasů, 34,51 %).

**Zvláštnosti dat:**
- KV 2018 obsahuje i pozdější záznamy. Výsledky se berou z řádného termínu. Mandáty v Praze 4 a 8 se berou podle stavu
  po rozhodnutí soudu (30. 11. 2018). Nové volby v Praze-Nedvězí 2019 se nezapočítávají.
- Praha 9 volila zastupitelstvo MČ v roce 2018 ve třech volebních obvodech. Kandidátky stejné strany jsou sloučené.
- První verze dat KV 2026 (11. 10. 2026) nemá sloupec `DATUMVOLEB`; obsahuje jen řádný termín.

## Změny okrsků a „oblasti změn“

Všechny volby se kreslí na **dnešních hranicích okrsků** (vrstva ČSÚ pro KV 2026). Okrsek se zobrazí samostatně jen tam,
kde měl v daných volbách **prokazatelně stejné hranice** jako dnes. Rozhodují tato kritéria:
- datum platnosti záznamu v RÚIAN je starší než volby,
- změna mezi vrstvami 2022 a 2024 nastala bez posunu hranice,
- MČ má jediný okrsek.

Kde se okrsky překreslily, dotčené dnešní okrsky se sloučí do **oblasti změn**. Ta má čárkovaný obrys a nemá vnitřní
hranice. Výsledky v ní jsou součtem tehdejších okrsků z téhož území. Tehdejší okrsky se k oblastem přiřazují podle
překryvu s historickými vrstvami ČSÚ 2022, 2024 a 2025. Pokud to nejde spolehlivě, nebo pokud poměr voličů k
obyvatelům nedává smysl, sloučí se změny za celou MČ.

| Volby | Okrsky beze změny hranic (z 1 120) | Podíl voličů | Oblastí změn |
|---|---|---|---|
| PS 2017 | 886 | 78 % | 32 |
| KV 2018 | 931 | 82 % | 30 |
| PS 2021 | 957 | 84 % | 26 |
| KV 2022 | 984 | 87 % | 21 |
| PS 2025 | 1 115 | 99,6 % | 2 |
| KV 2026 | 1 120 | 100 % | 0 |

Největší překreslení:

| MČ | Kdy | Rozsah |
|---|---|---|
| Praha 2 | 2025 | celá MČ, 45 → 41 okrsků |
| Praha 9 | 2023 | 40 okrsků |
| Praha 7 | 2025 | 15 okrsků |
| Praha 13 | 2018 | 20 okrsků |
| Praha 3, 10, 12, 18, Čakovice, Praha 22 | – | menší změny |

V těchto MČ jsou starší volby méně podrobné, například Praha 2 je v letech 2017–2022 jedna oblast. Naopak třeba
Praha 6 měla ve všech volbách 2017–2026 stejných 104 okrsků; jediná oblast změn je okrsek 6068 (Ruzyně) do roku 2022.

## Živé výsledky (vypnuto po sečtení KV 2026)

Během sčítání KV 2026 mapa četla průběžné výsledky přímo z otevřených dat ČSÚ (XML). Server posílá
`Access-Control-Allow-Origin: *`, takže stačil prohlížeč bez vlastního backendu. Po sečtení je napojení vypnuté:

- `web/js/live.js` se nenačítá (zakomentovaný `<script>` v `web/index.html`),
- volání v `web/js/app.js` jsou zakomentovaná (hledejte „ŽIVÉ VÝSLEDKY“ / „vypnuto“),
- v `scripts/build_data.py` je zakomentovaný `kv2026_registry` a větve pro volby s `"live"`; KV 2026 se sestavuje
  z finálních dat jako ostatní komunální volby.

**Pro příští volby:** odkomentovat uvedená místa, upravit adresy (`appdata/<volby>/<datum>/odata`) a cesty k registru.

| Co | URL (KV 2026) | Aktualizace |
|---|---|---|
| poslední dávka okrsků | `https://volby.gov.cz/appdata/kv2026/20261009/odata/okrsky/vysledky_okrsky.xml` | ~5 min |
| dávka č. N (přírůstková) | `…/odata/okrsky/vysledky_okrsky_NNNNN.xml` | ~5 min |
| souhrn zastupitelstva | `…/odata/zastup/vysledky_obec_<KODZASTUP>.xml` (např. 500178 Praha 6, 554782 hl. m. Praha) | 60 s |

Dokumentace: <https://volby.gov.cz/opendata/kv2026/KV2026_XML.htm>.

Jak to mapa zpracovávala (`js/live.js`):
- Každou minutu zjistila číslo poslední dávky a dotáhla chybějící dávky v pořadí vzniku. Po chybě to zkusila znovu
  za 15 s, protože server ČSÚ pod zátěží občas zahodí spojení.
- Vybrala okrsky zvoleného území se správným `KODZASTUP`. U opakovaně poslaných okrsků (opravy) ponechala verzi
  s nejvyšším `PORADI_ZPRAC`.
- Neexistující dávka vrací HTTP 404 *bez* CORS hlavičky, proto se čísla dávek neodhadují a vždy se vychází ze souboru
  s poslední dávkou.
- **Odhad mandátů během sčítání:** dokud ČSÚ mandáty nerozdělí, box mandátů ukazoval odhad z průběžných hlasů celého
  zastupitelstva podle § 45 zákona č. 491/2001 Sb.: hranice 5 % z celkového počtu platných hlasů vyděleného počtem
  mandátů a vynásobeného počtem kandidátů strany; při méně než 2 postupujících stranách se hranice snižuje po 1 %.
  Hlasy se dělí čísly 1, 2, 3 … nejvýš do počtu kandidátů (d'Hondt). Při rovném podílu rozhoduje vyšší počet hlasů
  strany, pak los. Funkce `LiveFeed.rozdelMandaty` dává pro výsledky KV 2018 a 2022 ve všech 13 041 obcích a obvodech
  ČR stejné mandáty jako ČSÚ (kromě 55 případů rozhodnutých losem, které označí jako nerozhodnuté). Počet kandidátů
  je počet platných kandidatur (`KANDIDATU_POCET` z feedu ČSÚ).

Server ČSÚ odmítá prohlížeče s user-agentem „HeadlessChrome“ (stránka „Access Blocked“ bez CORS). Automatické
testy proti živému zdroji proto musí nastavit běžný user-agent.

### Test živého režimu (po odkomentování)

```
python scripts/make_mock_live.py --davek 4   # testovací (smyšlená) data ve formátu ČSÚ pro Prahu 6: 4 ze 6 dávek
python -m http.server 8000                   # v kořeni projektu (ne ve web/), aby byla dostupná i složka test/
# http://localhost:8000/web/index.html?livebase=../test/mock-live#mc=500178&volby=kv2026-zmc
python scripts/make_mock_live.py --davek 6   # další dávky, pak „obnovit teď“
```

Testovací data obsahují i okrsky jiných obcí (musí se ignorovat) a opravu okrsku v pozdější dávce.
