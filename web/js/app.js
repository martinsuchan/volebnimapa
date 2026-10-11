/* Volební mapa Prahy – hlavní logika. Spouští ji js/boot.js po načtení dat zvolené oblasti
   (městská část nebo celá Praha): window.startApp(window.VOLBY_V2, data oblasti). */
window.startApp = function (V2, R) {
  "use strict";

  const IS_ALL = R.kod === "praha";
  const REGION = IS_ALL ? "Praha" : R.nazev; // krátký název území (sloupec tabulky apod.)
  const IN_REGION = IS_ALL ? "v celé Praze" : `v MČ ${R.nazev}`;
  // Každý dnešní okrsek dostane záznam své jednotky: okrsek, nebo „oblast změn“ se součtem tehdejších okrsků.
  for (const e of R.volby) {
    e.okrsky = {};
    for (const f of R.geo.features) {
      const c = String(f.properties.cislo);
      const uid = e.okrsek_jednotka[c] || c;
      if (e.jednotky[uid]) e.okrsky[c] = e.jednotky[uid];
    }
    if (V2.zvoleni[e.id]) e.zvoleni = V2.zvoleni[e.id];
    if (V2.mandaty[e.id]) e.mandaty = { celkem: V2.mandaty[e.id] };
  }
  const D = { volby: R.volby, vytvoreno: V2.vytvoreno };
  const GEO = R.geo;
  GEO.praha6 = { type: "Feature", properties: {}, geometry: R.obrys }; // obrys zvoleného území
  const ELECTIONS = D.volby;
  const EL = Object.fromEntries(ELECTIONS.map((e) => [e.id, e]));
  const PRECINCTS = GEO.features.map((f) => f.properties.cislo);
  const PRECINCT_SET = new Set(PRECINCTS);
  /** Oblast změněných okrsků, do které okrsek c v daných volbách patří (jinak null). */
  const zoneOf = (e, c) => {
    const uid = e && e.okrsek_jednotka ? e.okrsek_jednotka[String(c)] : null;
    return uid ? e.oblasti.find((z) => z.id === uid) || null : null;
  };
  const unitOf = (e, c) => (e && e.okrsek_jednotka && e.okrsek_jednotka[String(c)]) || String(c);
  /** Seznam čísel okrsků zkrácený na rozsahy: 9001–9003, 9005. */
  function fmtList(ns) {
    const a = [...ns].map(Number).sort((x, y) => x - y);
    const out = [];
    for (let i = 0; i < a.length; i++) {
      let j = i;
      while (j + 1 < a.length && a[j + 1] === a[j] + 1) j++;
      out.push(j > i ? `${a[i]}–${a[j]}` : String(a[i]));
      i = j;
    }
    return out.join(", ") || "–";
  }
  const czPlural = (n, one, few, many) => (n === 1 ? one : n >= 2 && n <= 4 ? few : many);

  const TYPE_LABEL = {
    ps: "Poslanecká sněmovna",
    zhmp: "Zastupitelstvo hl. m. Prahy",
    zmc: IS_ALL ? "Zastupitelstvo MČ" : `Zastupitelstvo MČ ${R.nazev}`,
  };
  const TYPE_SHORT = { ps: "PS", zhmp: "ZHMP", zmc: "ZMČ" };
  const TYPES = ["ps", "zhmp", "zmc"].filter((t) => ELECTIONS.some((e) => e.typ === t));

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  // ------------------------------------------------------------------ čísla
  /** Useknutí na d desetinných míst (stejně jako ČSÚ), formát s desetinnou čárkou. */
  function trunc(x, d) {
    const m = 10 ** d;
    return (x >= 0 ? Math.floor(x * m + 1e-9) : Math.ceil(x * m - 1e-9)) / m;
  }
  function fmtPct(x, d = 2, sign = false) {
    if (x == null || isNaN(x)) return "–";
    const v = trunc(x, d);
    const s = v.toFixed(d).replace(".", ",").replace("-", "−");
    return (sign && v > 0 ? "+" : "") + s;
  }
  const nf = new Intl.NumberFormat("cs-CZ");
  const fmtInt = (n) => (n == null ? "–" : nf.format(n));
  function fmtDate(d) {
    // "2021-10-08/09" -> "8.–9. 10. 2021"
    const m = /^(\d{4})-(\d{2})-(\d{2})\/(\d{2})$/.exec(d || "");
    if (!m) return d || "";
    return `${+m[3]}.–${+m[4]}. ${+m[2]}. ${m[1]}`;
  }
  function fmtTime(s) {
    if (!s) return "–";
    const d = new Date(s);
    return isNaN(d) ? s : d.toLocaleString("cs-CZ", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  }

  // ------------------------------------------------------------------ barvy (OKLab)
  function hexToRgb(h) {
    h = h.replace("#", "");
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  }
  const toLin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const toGam = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
  function rgbToOklab([r, g, b]) {
    [r, g, b] = [r, g, b].map(toLin);
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    return [
      0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
      1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
      0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
    ];
  }
  function oklabToHex([L, a, b]) {
    const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
    const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
    const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
    const rgb = [
      4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
      -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
      -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
    ];
    return "#" + rgb.map((c) => Math.round(Math.min(1, Math.max(0, toGam(c))) * 255).toString(16).padStart(2, "0")).join("");
  }
  const mixLab = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
  // Stránka má vždy světlý vzhled (tmavý režim systému se záměrně ignoruje).
  const isDark = () => false;

  /** Sekvenční škála jedné barvy strany: světlá -> barva strany (u světlých barev ještě tmavší konec). */
  function makeRamp(hex) {
    const dark = isDark();
    let c = rgbToOklab(hexToRgb(hex));
    const base = rgbToOklab(hexToRgb(dark ? "#2c2c29" : "#f3f2ee"));
    if (dark && c[0] < 0.62) {
      // v tmavém režimu se kotva škály obrací – tmavé barvy (Piráti, ANO…) zesvětlíme
      const k = 0.78 / Math.max(c[0], 0.01);
      c = [0.78, c[1] * Math.min(k, 1.25), c[2] * Math.min(k, 1.25)];
      if (Math.hypot(c[1], c[2]) < 0.02) c = [0.9, 0, 0];
    }
    const stops = [[0, base], [1, c]];
    if (!dark && c[0] > 0.72) {
      // žluté a jiné světlé barvy: druhá polovina škály pokračuje do tmavšího odstínu
      stops[1] = [0.6, c];
      stops.push([1, [c[0] * 0.58, c[1] * 0.9, c[2] * 0.9]]);
    }
    return (t) => {
      t = Math.min(1, Math.max(0, t));
      for (let i = 1; i < stops.length; i++) {
        if (t <= stops[i][0]) {
          const [t0, c0] = stops[i - 1];
          const [t1, c1] = stops[i];
          return oklabToHex(mixLab(c0, c1, (t - t0) / (t1 - t0)));
        }
      }
      return oklabToHex(stops[stops.length - 1][1]);
    };
  }
  /** Divergentní škála: pokles červená – šedý střed – nárůst modrá. */
  function makeDiverging() {
    const dark = isDark();
    const neg = rgbToOklab(hexToRgb(dark ? "#ff6b61" : "#b3261e"));
    const pos = rgbToOklab(hexToRgb(dark ? "#6ea8ff" : "#1f5fa8"));
    const mid = rgbToOklab(hexToRgb(dark ? "#383835" : "#f0efec"));
    return (t) => { // t v intervalu -1..1
      t = Math.min(1, Math.max(-1, t));
      return oklabToHex(t < 0 ? mixLab(mid, neg, -t) : mixLab(mid, pos, t));
    };
  }
  const lightnessOf = (hex) => rgbToOklab(hexToRgb(hex))[0];

  // ------------------------------------------------------------------ práce s daty
  const hasData = (e) => e && Object.keys(e.okrsky || {}).length > 0;
  const partyById = (e, id) => e.strany.find((p) => p.id === String(id));
  function sortedParties(e) {
    return e.strany.slice().sort((a, b) => b.hlasy - a.hlasy || a.cislo - b.cislo);
  }
  function pctIn(e, pid, c) {
    const r = e.okrsky[String(c)];
    if (!r || !r.h) return null;
    return ((r.s[pid] || 0) / r.h) * 100;
  }
  function sumPct(e, lists, c) {
    const r = e.okrsky[String(c)];
    if (!r || !r.h) return null;
    return lists.reduce((acc, p) => acc + (r.s[p.id] || 0), 0) / r.h * 100;
  }
  const intersects = (a, b) => a.some((x) => b.includes(x));
  function relatedLists(target, party) {
    if (!party) return [];
    if (party.tagy.length) return target.strany.filter((q) => intersects(q.tagy, party.tagy));
    return target.strany.filter((q) => q.nazev === party.nazev);
  }
  // Vedoucí strana kandidátky = první člen v tomto pořadí (stejné jako pořadí barev ve scripts/common.py).
  // Praha sobě (1180) je vedoucí i v koalici se Zelenými, SPOLU vede ODS (53), KLID vede TOP 09 (721).
  const LEAD_ORDER = ["1180", "720", "53", "721", "166", "768", "1", "1114", "1298", "47", "7", "759", "5", "1178", "1245", "1227", "714"];
  function leadOf(tags) {
    return LEAD_ORDER.find((t) => tags.includes(t)) || tags[0] || null;
  }
  /**
   * Nejpodobnější kandidátka v jiných volbách k „kotvě“ (straně, kterou uživatel vybral).
   * Pořadí kritérií: stejné složení > stejná vedoucí strana > obsahuje vedoucí stranu kotvy
   * > počet společných stran > podobná velikost koalice > víc hlasů.
   */
  function bestMatch(target, anchor) {
    if (!anchor) return null;
    const lead = leadOf(anchor.tagy);
    const key = (q) => [
      q.tagy.length === anchor.tagy.length && q.tagy.every((t) => anchor.tagy.includes(t)) ? 1 : 0,
      lead && leadOf(q.tagy) === lead ? 1 : 0,
      lead && q.tagy.includes(lead) ? 1 : 0,
      q.tagy.filter((t) => anchor.tagy.includes(t)).length,
      -Math.abs(q.tagy.length - anchor.tagy.length),
      q.hlasy,
    ];
    const c = relatedLists(target, anchor).map((q) => ({ q, k: key(q) }))
      .sort((a, b) => { for (let i = 0; i < a.k.length; i++) if (a.k[i] !== b.k[i]) return b.k[i] - a.k[i]; return 0; });
    return c.length ? c[0].q : null;
  }
  function recomputeTotals(e) {
    const ok = Object.values(e.okrsky);
    const tot = ok.reduce((a, r) => a + r.h, 0);
    for (const p of e.strany) {
      p.hlasy = ok.reduce((a, r) => a + (r.s[p.id] || 0), 0);
      p.proc = tot ? trunc((p.hlasy / tot) * 100, 2) : 0;
    }
    const zap = ok.reduce((a, r) => a + r.z, 0);
    const vyd = ok.reduce((a, r) => a + r.v, 0);
    e.souhrn = ok.length ? {
      okrsku: ok.length, zapsani: zap, vydane_obalky: vyd,
      odevzdane_obalky: ok.reduce((a, r) => a + r.o, 0), platne_hlasy: tot,
      ucast_proc: zap ? trunc((vyd / zap) * 100, 2) : 0,
    } : null;
  }
  function electionLabel(e, short = false) {
    return short ? `${TYPE_SHORT[e.typ]} ${e.rok}` : e.nazev;
  }

  // ------------------------------------------------------------------ stav
  const latestOf = (typ) => ELECTIONS.filter((e) => e.typ === typ).sort((a, b) => b.rok - a.rok)[0]?.id;
  const state = {
    eid: latestOf("zmc") || latestOf("zhmp"), // výchozí: poslední komunální volby (u celé Prahy ZHMP)
    pid: null,
    anchor: null, // strana zvolená uživatelem – podle ní se dohledává kandidátka při změně roku/typu
    mode: "podil",
    cmp: null,
    scale: "shared",
    okrsek: null,
    opacity: 0.72,
    labels: true,
    seatScope: "cr", // u Sněmovny: "cr" = celá sněmovna, "praha" = poslanci zvolení v kraji Praha
  };
  const live = {}; // eid -> LiveFeed

  function readHash() {
    const h = new URLSearchParams(location.hash.slice(1));
    const v = h.get("volby");
    if (v && EL[v]) state.eid = v;
    else if (v && /^kv\d{4}-zmc$/.test(v) && EL[v.replace("-zmc", "-zhmp")]) state.eid = v.replace("-zmc", "-zhmp"); // celá Praha nemá ZMČ
    if (h.get("strana")) state.pid = h.get("strana");
    if (h.get("rezim") === "zmena") state.mode = "zmena";
    if (h.get("srovnat") && EL[h.get("srovnat")]) state.cmp = h.get("srovnat");
    if (["shared", "local", "fixed"].includes(h.get("skala"))) state.scale = h.get("skala");
    if (h.get("okrsek") && PRECINCT_SET.has(+h.get("okrsek"))) state.okrsek = +h.get("okrsek");
  }
  function writeHash() {
    const h = new URLSearchParams();
    h.set("mc", R.kod);
    h.set("volby", state.eid);
    if (state.pid) h.set("strana", state.pid);
    if (state.mode === "zmena") { h.set("rezim", "zmena"); if (state.cmp) h.set("srovnat", state.cmp); }
    if (state.scale !== "shared") h.set("skala", state.scale);
    if (state.okrsek) h.set("okrsek", state.okrsek);
    history.replaceState(null, "", "#" + h.toString());
  }

  const cur = () => EL[state.eid];
  const curParty = () => partyById(cur(), state.pid);

  function ensureParty() {
    const e = cur();
    if (!partyById(e, state.pid)) state.pid = sortedParties(e)[0]?.id || null;
  }
  /** Zapamatuje si aktuální stranu jako výchozí bod pro přepínání mezi volbami. */
  function setAnchor() {
    const p = curParty();
    state.anchor = p ? { tagy: p.tagy.slice(), nazev: p.nazev } : null;
  }

  /** Volby k porovnání (ve kterých existuje související kandidátka), chronologicky. */
  function compareOptions() {
    const e = cur(), p = curParty();
    return ELECTIONS.filter((o) => o !== e && hasData(o))
      .map((o) => ({ o, lists: relatedLists(o, p) }))
      .filter((x) => x.lists.length);
  }
  function ensureCmp() {
    const opts = compareOptions();
    if (state.cmp && opts.some((x) => x.o.id === state.cmp)) return;
    const idx = ELECTIONS.indexOf(cur());
    const earlier = opts.filter((x) => ELECTIONS.indexOf(x.o) < idx);
    const sameType = earlier.filter((x) => x.o.typ === cur().typ);
    const pick = sameType.pop() || earlier.pop() || opts[0];
    state.cmp = pick ? pick.o.id : null;
  }

  // ------------------------------------------------------------------ hodnoty pro mapu
  function valueOf(c) {
    const e = cur(), p = curParty();
    if (!p) return null;
    const v = pctIn(e, p.id, c);
    if (state.mode !== "zmena") return v;
    const cmp = EL[state.cmp];
    if (!cmp || v == null) return null;
    const lists = relatedLists(cmp, p);
    const w = sumPct(cmp, lists, c);
    return w == null ? null : v - w;
  }
  const niceCeil = (x, step) => Math.max(step, Math.ceil((x - 1e-9) / step) * step);

  function scaleMax() {
    const e = cur(), p = curParty();
    if (!p) return 10;
    if (state.mode === "zmena") {
      let m = 0;
      for (const c of PRECINCTS) { const v = valueOf(c); if (v != null) m = Math.max(m, Math.abs(v)); }
      return niceCeil(m, m > 20 ? 10 : 5);
    }
    if (state.scale === "fixed") return 50;
    let m = 0;
    // Společná škála bere jen kandidátky vedené stejnou stranou (stejná barva) – jinak by např.
    // koalice Piráti+STAN z r. 2021 „vybělila“ samostatné STAN.
    const sets = state.scale === "local" ? [[e, [p]]] :
      ELECTIONS.filter(hasData).map((o) => [o, o === e ? [p] : relatedLists(o, p).filter((q) => q.barva === p.barva)]);
    for (const [o, lists] of sets) {
      for (const q of lists) for (const c of PRECINCTS) {
        const v = pctIn(o, q.id, c);
        if (v != null && v > m) m = v;
      }
    }
    if (m === 0) return 10;
    return niceCeil(m, m > 30 ? 10 : 5);
  }

  // ------------------------------------------------------------------ mapa
  const map = L.map("map", { zoomControl: true, preferCanvas: false, minZoom: 11, maxZoom: 19, zoomSnap: 0.25 });
  // Obrys území, zvýraznění pod myší a vybraný okrsek se kreslí do vlastního panelu nad okrsky
  // (bez přeřazování interaktivních polygonů v DOM, které by rozbíjelo kliknutí).
  map.createPane("highlight").style.zIndex = 450;
  map.getPane("highlight").style.pointerEvents = "none";
  const hoverLayer = L.geoJSON(null, { pane: "highlight", interactive: false, style: () => ({ fill: false, weight: 2.5, color: isDark() ? "#ffffff" : "#1d1d1b" }) }).addTo(map);
  const selLayer = L.geoJSON(null, { pane: "highlight", interactive: false, style: () => ({ fill: false, weight: 3.5, color: isDark() ? "#ffffff" : "#1d1d1b", dashArray: null }) }).addTo(map);
  const featureByPrecinct = Object.fromEntries(GEO.features.map((f) => [f.properties.cislo, f]));
  // Podkladové mapy ČÚZK (státní služba, bez klíče, licence CC BY 4.0 – nutno uvést „© ČÚZK“).
  // Dlaždice OSM se nepoužívají: jejich servery blokují stránky otevřené z disku i větší provoz.
  const attrCUZK = '&copy; <a href="https://geoportal.cuzk.gov.cz/">ČÚZK</a>';
  const cuzkUrl = (svc) => `https://ags.cuzk.gov.cz/arcgis1/rest/services/${svc}/MapServer/tile/{z}/{y}/{x}`;
  // Výchozí = základní mapa odbarvená CSS filtrem (filtr se týká jen dlaždic, barvy okrsků zůstávají věrné).
  const baseGray = L.tileLayer(cuzkUrl("ZTM_WM"), { attribution: attrCUZK, maxZoom: 19, className: "tiles-gray", opacity: 0.45 });
  const baseZTM = L.tileLayer(cuzkUrl("ZTM_WM"), { attribution: attrCUZK, maxZoom: 19 });
  const baseOrto = L.tileLayer(cuzkUrl("ORTOFOTO_WM"), { attribution: attrCUZK, maxZoom: 19 });
  baseGray.addTo(map);
  L.control.layers({
    "Šedá mapa (ČÚZK)": baseGray,
    "Základní mapa ČÚZK": baseZTM,
    "Ortofoto ČÚZK": baseOrto,
  }, {}, { position: "topright" }).addTo(map);
  L.control.scale({ imperial: false, position: "bottomright" }).addTo(map);

  let ramp = null, diverging = null, maxV = 10;
  const layerByPrecinct = {};
  const precinctLayer = L.geoJSON(GEO, {
    style: () => ({ weight: 0.8, color: "#ffffff", fillOpacity: 0 }),
    onEachFeature(f, layer) {
      layerByPrecinct[f.properties.cislo] = layer;
      layer.on({
        mouseover: () => {
          hoverLayer.clearLayers();
          const z = zoneOf(cur(), f.properties.cislo); // u oblasti změn zvýraznit celou oblast
          hoverLayer.addData(z ? { type: "Feature", properties: {}, geometry: z.obrys } : f);
        },
        mouseout: () => hoverLayer.clearLayers(),
        click: () => selectPrecinct(f.properties.cislo === state.okrsek ? null : f.properties.cislo),
      });
      layer.bindTooltip(() => tooltipHtml(f.properties.cislo), { sticky: true, className: "okrsek-tip", direction: "top", offset: [0, -8] });
    },
  }).addTo(map);
  const outline = L.geoJSON(GEO.praha6, { pane: "highlight", interactive: false, style: { weight: 2.2, color: "#4a4a46", fill: false, opacity: 0.9 } }).addTo(map);
  // obrysy oblastí změněných okrsků (čárkovaně)
  const zoneLayer = L.geoJSON(null, { pane: "highlight", interactive: false, style: { weight: 1.6, color: "#3d3d3a", dashArray: "5 4", fill: false, opacity: 0.9 } }).addTo(map);
  map.fitBounds(precinctLayer.getBounds(), { padding: [10, 10] });
  map.setMaxBounds(precinctLayer.getBounds().pad(1.2));

  const labelLayer = L.layerGroup();
  const labelMarkers = {};
  for (const f of GEO.features) {
    const [lon, lat] = f.properties.stitek;
    const m = L.marker([lat, lon], {
      interactive: false, keyboard: false,
      icon: L.divIcon({ className: "okrsek-label", html: `<span>${f.properties.cislo}</span>`, iconSize: [0, 0] }),
    });
    labelMarkers[f.properties.cislo] = m;
    labelLayer.addLayer(m);
  }
  function updateLabels() {
    const show = state.labels && map.getZoom() >= 15;
    if (show && !map.hasLayer(labelLayer)) labelLayer.addTo(map);
    if (!show && map.hasLayer(labelLayer)) map.removeLayer(labelLayer);
  }
  map.on("zoomend", updateLabels);

  function fillFor(v) {
    if (v == null) return null;
    if (state.mode === "zmena") return diverging(v / maxV);
    return ramp(v / maxV);
  }
  function styleOne(c) {
    const layer = layerByPrecinct[c];
    const v = valueOf(c);
    const fill = fillFor(v);
    const dark = isDark();
    // okrsky uvnitř oblasti změn nemají vnitřní hranice (oblast se čte jako jeden celek)
    const zoned = !!zoneOf(cur(), c);
    const edge = dark ? "#1a1a19" : "#ffffff";
    labelMarkers[c].setOpacity(zoned ? 0 : 1);
    if (fill == null) {
      layer.setStyle({ fillColor: dark ? "#555" : "#bbb", fillOpacity: 0.08, color: dark ? "#888" : "#8a8a85", weight: 0.8, dashArray: "3 3" });
    } else {
      layer.setStyle({
        fillColor: fill, fillOpacity: state.opacity, dashArray: null,
        color: zoned ? fill : edge, weight: 0.7, opacity: 1,
      });
    }
    const span = labelMarkers[c].getElement()?.querySelector("span");
    if (span) span.classList.toggle("inv", fill != null && state.opacity > 0.45 && lightnessOf(fill) < 0.55);
  }
  function restyle() {
    const p = curParty();
    ramp = makeRamp(p ? p.barva : "#777777");
    diverging = makeDiverging();
    maxV = scaleMax();
    for (const c of PRECINCTS) {
      styleOne(c);
      // otevřený tooltip (myš nad okrskem při změně voleb/strany) přepočítat s novými daty
      if (layerByPrecinct[c].isTooltipOpen()) layerByPrecinct[c].getTooltip().update();
    }
    zoneLayer.clearLayers();
    const zoneSets = [cur()];
    if (state.mode === "zmena" && EL[state.cmp]) zoneSets.push(EL[state.cmp]);
    for (const e of zoneSets) for (const z of e.oblasti || []) zoneLayer.addData({ type: "Feature", properties: {}, geometry: z.obrys });
    selLayer.clearLayers();
    if (state.okrsek) selLayer.addData(featureByPrecinct[state.okrsek]);
    selLayer.setStyle({ color: isDark() ? "#ffffff" : "#1d1d1b" });
    hoverLayer.setStyle({ color: isDark() ? "#ffffff" : "#1d1d1b" });
    renderLegend();
  }
  labelLayer.on("add", () => setTimeout(() => PRECINCTS.forEach(styleOne), 0));

  function tooltipHtml(c) {
    const e = cur(), p = curParty();
    const r = e.okrsky[String(c)];
    const z = zoneOf(e, c);
    const headHtml = z ? `<b>Oblast změněných okrsků</b><div class="muted tip-zone">dnešní okrsky ${fmtList(z.okrsky_dnes)}<br>tehdejší okrsky ${fmtList(z.okrsky_tehdy)} (sečteno)</div>`
      : `<b>Okrsek ${c}</b>`;
    if (!r) return `${headHtml}<br><span class="muted">${e.live ? "zatím nezpracováno" : "bez dat"}</span>`;
    const turnout = r.z ? (r.v / r.z) * 100 : null;
    // strany s alespoň 5 % ve zvoleném území v těchto volbách (+ vždy právě vybraná), seřazené podle zisku v okrsku
    const list = e.strany.filter((q) => q.proc >= 5 || q.id === state.pid)
      .map((q) => ({ q, v: ((r.s[q.id] || 0) / r.h) * 100 }))
      .sort((a, b) => b.v - a.v);
    const top = Math.max(1, ...list.map((x) => x.v));
    const rows = list.map(({ q, v }) => `<tr class="${q.id === state.pid ? "sel" : ""}">
        <td><span class="swatch" style="background:${q.barva}"></span></td>
        <td class="nm">${esc(q.zkratka)}</td>
        <td class="bar"><i style="width:${Math.max(1, Math.round((v / top) * 80))}px;background:${q.barva}"></i></td>
        <td class="num">${fmtPct(v)} %</td></tr>`).join("");
    let diff = "";
    if (p && state.mode === "zmena" && EL[state.cmp]) {
      diff = `<div class="tip-diff">${esc(p.zkratka)}: změna oproti ${electionLabel(EL[state.cmp], true)} <b>${fmtPct(valueOf(c), 2, true)} p. b.</b></div>`;
    }
    return `${headHtml}
      <table class="tip-parties">${rows}</table>${diff}
      <div class="muted">Účast ${fmtPct(turnout)} % · voličů ${fmtInt(r.z)}</div>
      <div class="muted tip-note">strany s ≥ 5 % ${esc(IN_REGION)}</div>`;
  }


  // ------------------------------------------------------------------ legenda
  const legendCtl = L.control({ position: "bottomleft" });
  legendCtl.onAdd = () => {
    const div = L.DomUtil.create("div", "legend");
    div.id = "legend";
    L.DomEvent.disableClickPropagation(div);
    return div;
  };
  legendCtl.addTo(map);
  function renderLegend() {
    const el = $("legend");
    const p = curParty(), e = cur();
    if (!p) { el.innerHTML = ""; return; }
    const steps = 24;
    let grad, ticks, title;
    if (state.mode === "zmena") {
      grad = Array.from({ length: steps + 1 }, (_, i) => diverging(-1 + (2 * i) / steps)).join(",");
      ticks = [`−${maxV}`, "0", `+${maxV}`];
      const cmp = EL[state.cmp];
      const lists = cmp ? relatedLists(cmp, p).map((q) => q.zkratka).join(" + ") : "";
      title = `Změna podílu (p. b.) oproti ${cmp ? electionLabel(cmp, true) : "–"}${lists ? ` (${esc(lists)})` : ""}`;
    } else {
      grad = Array.from({ length: steps + 1 }, (_, i) => ramp(i / steps)).join(",");
      ticks = ["0 %", `${maxV / 2} %`.replace(".", ","), `${maxV} %`];
      const how = { shared: "škála společná pro stranu v čase", local: "škála podle této volby", fixed: "pevná škála" }[state.scale];
      title = `Podíl hlasů – ${esc(p.zkratka)} <span class="muted" style="font-weight:400">(${how})</span>`;
    }
    const noData = e.live && Object.keys(e.okrsky).length < PRECINCTS.length;
    el.innerHTML = `<div class="title"><span class="swatch" style="background:${p.barva}"></span><span>${title}</span></div>
      <div class="ramp" style="background:linear-gradient(90deg,${grad})"></div>
      <div class="ticks">${ticks.map((t) => `<span>${t}</span>`).join("")}</div>
      ${noData || state.mode === "zmena" ? `<div class="nodata"><i></i>${noData ? "okrsek zatím nezpracován" : "bez dat pro srovnání"}</div>` : ""}`;
  }

  // ------------------------------------------------------------------ ovládací prvky
  function renderControls() {
    const e = cur();
    const selType = $("sel-type");
    selType.innerHTML = TYPES.map((t) => `<option value="${t}"${t === e.typ ? " selected" : ""}>${TYPE_LABEL[t]}</option>`).join("");

    const years = ELECTIONS.filter((o) => o.typ === e.typ);
    $("years").innerHTML = years.map((o) => `<button type="button" role="radio" aria-checked="${o === e}" data-eid="${o.id}"
      title="${esc(o.nazev)} – ${fmtDate(o.datum)}${o.live ? " (živé výsledky)" : ""}">${o.live ? '<span class="dot" aria-hidden="true"></span>' : ""}${o.rok}${o.live ? " živě" : ""}</button>`).join("");

    const parties = sortedParties(e);
    const showPct = hasData(e);
    $("sel-party").innerHTML = parties.map((p) => {
      const label = showPct ? `${p.zkratka} — ${fmtPct(p.proc)} %` : `${p.cislo}. ${p.zkratka}`;
      return `<option value="${p.id}"${p.id === state.pid ? " selected" : ""}>${esc(label)}</option>`;
    }).join("");

    $("sel-mode").value = state.mode;
    const opts = compareOptions();
    $("sel-mode").querySelector('option[value="zmena"]').disabled = !opts.length || !hasData(e);
    $("ctl-cmp").hidden = state.mode !== "zmena";
    $("ctl-scale").hidden = state.mode === "zmena";
    $("sel-cmp").innerHTML = opts.map(({ o, lists }) =>
      `<option value="${o.id}"${o.id === state.cmp ? " selected" : ""}>${esc(electionLabel(o, true))} – ${esc(lists.map((q) => q.zkratka).join(" + "))}</option>`).join("");
    $("sel-scale").value = state.scale;
  }

  function switchElection(eid, keepParty = true) {
    const prev = cur(), prevParty = curParty();
    state.eid = eid;
    const e = cur();
    // if (e.live) startLive(e); // živé výsledky (vypnuto)
    if (keepParty && prev !== e) {
      // Dohledává se vždy od strany, kterou uživatel vybral (ne od mezikroku), takže
      // TOP 09 (2022) -> KLID (2018) -> zpět vrátí TOP 09, ne ODS+KDU.
      const anchor = state.anchor || (prevParty && { tagy: prevParty.tagy, nazev: prevParty.nazev });
      const m = bestMatch(e, anchor);
      state.pid = m ? m.id : null;
    }
    ensureParty();
    if (state.mode === "zmena") {
      if (state.cmp === e.id) state.cmp = null;
      ensureCmp();
      if (!state.cmp) state.mode = "podil";
    }
    update();
  }

  $("sel-type").addEventListener("change", (ev) => {
    const t = ev.target.value, e = cur();
    const cands = ELECTIONS.filter((o) => o.typ === t);
    // nejbližší rok; při shodě raději volby s daty
    cands.sort((a, b) => Math.abs(a.rok - e.rok) - Math.abs(b.rok - e.rok) || hasData(b) - hasData(a) || a.rok - b.rok);
    switchElection(cands[0].id);
  });
  $("years").addEventListener("click", (ev) => {
    const b = ev.target.closest("button[data-eid]");
    if (b) switchElection(b.dataset.eid);
  });
  $("years").addEventListener("keydown", (ev) => {
    if (ev.key !== "ArrowLeft" && ev.key !== "ArrowRight") return;
    const list = ELECTIONS.filter((o) => o.typ === cur().typ);
    const i = list.indexOf(cur()) + (ev.key === "ArrowRight" ? 1 : -1);
    if (list[i]) { switchElection(list[i].id); $("years").querySelector(`[data-eid="${list[i].id}"]`)?.focus(); }
    ev.preventDefault();
  });
  $("sel-party").addEventListener("change", (ev) => { state.pid = ev.target.value; setAnchor(); if (state.mode === "zmena") ensureCmp(); update(); });
  $("sel-mode").addEventListener("change", (ev) => {
    state.mode = ev.target.value;
    if (state.mode === "zmena") { ensureCmp(); if (!state.cmp) state.mode = "podil"; }
    update();
  });
  $("sel-cmp").addEventListener("change", (ev) => { state.cmp = ev.target.value; update(); });
  $("sel-scale").addEventListener("change", (ev) => { state.scale = ev.target.value; update(); });
  $("rng-opacity").addEventListener("input", (ev) => { state.opacity = +ev.target.value; PRECINCTS.forEach(styleOne); });
  $("chk-labels").addEventListener("change", (ev) => { state.labels = ev.target.checked; updateLabels(); });

  function selectPrecinct(c) {
    const prev = state.okrsek;
    state.okrsek = c;
    if (prev) styleOne(prev);
    selLayer.clearLayers();
    if (c) selLayer.addData(featureByPrecinct[c]);
    renderPanel();
    writeHash();
    if (c && matchMedia("(max-width: 860px)").matches) $("sec-precinct").scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  // ------------------------------------------------------------------ panel
  function partyRow(p, value, max, opts = {}) {
    const w = max ? Math.max(0.5, (value / max) * 100) : 0;
    return `<button type="button" class="row${opts.active ? " active" : ""}" data-pid="${p.id}"${opts.eid ? ` data-eid="${opts.eid}"` : ""} title="${esc(p.nazev)}">
      <span class="name"><span class="swatch" style="background:${p.barva}"></span><span>${esc(p.zkratka)}</span></span>
      <span class="val">${fmtPct(value)} %</span>
      <span class="bar"><i style="width:${w}%;background:${p.barva}"></i></span>
      ${opts.meta ? `<span class="meta">${opts.meta}</span>` : ""}
    </button>`;
  }

  function renderPanel() {
    const e = cur(), p = curParty();
    const s = e.souhrn;

    // volby
    $("sec-election").innerHTML = `
      <h2>${esc(e.nazev)}</h2>
      <div class="muted small">${fmtDate(e.datum)} · ${esc(REGION)}, ${PRECINCTS.length} ${czPlural(PRECINCTS.length, "okrsek", "okrsky", "okrsků")}${e.oblasti?.length
        ? ` · ${e.oblasti.length} ${czPlural(e.oblasti.length, "oblast", "oblasti", "oblastí")} se změněnými okrsky (čárkovaně)` : ""}</div>
      ${s ? `<div class="kv">
        <div><b>${fmtPct(s.ucast_proc)} %</b><span>volební účast</span></div>
        <div><b>${fmtInt(s.zapsani)}</b><span>voličů v seznamu</span></div>
        <div><b>${fmtInt(s.okrsku)}</b><span>${e.oblasti?.length ? "okrsků a oblastí" : "okrsků s daty"}</span></div>
      </div>` : ""}
      ${e.pozn && e.typ !== "ps" && !e.live ? `<p class="muted small" style="margin:10px 0 0">${esc(e.pozn)}</p>` : ""}`;

    renderSeats();
    $("sec-live").hidden = true; // renderLivePanel(); – živé výsledky (vypnuto)

    // strana
    if (p) {
      const seen = new Set(), vals = [];
      for (const c of PRECINCTS) { // jedna hodnota za jednotku (oblast změn se nepočítá vícekrát)
        const u = unitOf(e, c);
        if (seen.has(u)) continue;
        seen.add(u);
        const v = pctIn(e, p.id, c);
        if (v != null) vals.push([c, v]);
      }
      vals.sort((a, b) => b[1] - a[1]);
      const best = vals[0], worst = vals[vals.length - 1];
      const unitLink = (c) => zoneOf(e, c) ? `oblast <a href="#" data-okrsek="${c}">${fmtList(zoneOf(e, c).okrsky_dnes)}</a>` : `okrsek <a href="#" data-okrsek="${c}">${c}</a>`;
      const liveSum = e.live && live[e.id]?.summary;
      const lp = liveSum ? liveSum.strany.find((x) => x.id === p.id) : null;
      const celek = e.live ? (lp ? lp.proc : null) : p.celek_proc;
      const mand = e.live ? (lp ? lp.mandaty : 0) : p.mandaty;
      const est = null; // e.live && !mand ? seatEstimate(e) : null; – odhad mandátů při sčítání (vypnuto)
      const parts = [];
      if (celek != null && e.typ !== "zmc") parts.push(`${e.celek_nazev}: <b>${fmtPct(celek)} %</b>`);
      if (mand) parts.push(`mandátů: <b>${mand}</b>${e.typ === "zhmp" ? " (celá Praha)" : ""}`);
      else if (est) parts.push(`odhad mandátů: <b>${est.mandaty[p.id] || 0}</b> z ${est.celkem}${e.typ === "zhmp" ? " (celá Praha)" : ""}`);
      parts.push(`hlasů ${esc(IN_REGION)}: <b>${fmtInt(p.hlasy)}</b>`);
      $("sec-party").innerHTML = `
        <div class="party-title"><span class="swatch" style="background:${p.barva}"></span><h2>${esc(p.zkratka)}</h2></div>
        ${p.nazev !== p.zkratka ? `<div class="fullname">${esc(p.nazev)}</div>` : ""}
        <div class="hero"><b>${hasData(e) ? fmtPct(p.proc) + " %" : "–"}</b><span class="muted">${esc(IN_REGION)}</span></div>
        <div class="small muted" style="margin-top:2px">${parts.join(" · ")}</div>
        ${best ? `<div class="small" style="margin-top:8px">Nejvíce: ${unitLink(best[0])} (${fmtPct(best[1], 1)} %) · nejméně: ${unitLink(worst[0])} (${fmtPct(worst[1], 1)} %)</div>` : ""}
        ${lp && lp.zvoleni.length ? `<div class="small" style="margin-top:8px"><b>Zvolení:</b> ${lp.zvoleni.map((z) => esc(z.j)).join(", ")}</div>` : ""}`;
    } else {
      $("sec-party").innerHTML = "";
    }

    renderTrend();
    renderPrecinct();

    // výsledky ve zvoleném území
    const parties = sortedParties(e);
    if (hasData(e)) {
      const max = parties[0]?.proc || 1;
      $("sec-results").innerHTML = `<h3>Výsledky ${esc(IN_REGION)}</h3><div class="rows">${parties.filter((q) => q.hlasy > 0)
        .map((q) => partyRow(q, q.proc, max, { active: q.id === state.pid })).join("")}</div>`;
    } else {
      $("sec-results").innerHTML = `<h3>Kandidující strany</h3><div class="rows">${parties.map((q) =>
        `<button type="button" class="row${q.id === state.pid ? " active" : ""}" data-pid="${q.id}" title="${esc(q.nazev)}">
          <span class="name"><span class="swatch" style="background:${q.barva}"></span><span>${q.cislo}. ${esc(q.zkratka)}</span></span><span class="val"></span></button>`).join("")}</div>`;
    }
  }

  function renderTrend() {
    const e = cur(), p = curParty();
    if (!p) { $("sec-trend").innerHTML = ""; return; }
    const c = state.okrsek;
    const rows = ELECTIONS.filter((o) => hasData(o) || o === e).map((o) => {
      const lists = o === e ? [p] : relatedLists(o, p);
      return { o, lists };
    }).filter((x) => x.lists.length);
    const maxV = Math.max(1, ...rows.flatMap(({ o, lists }) => lists.map((q) => (hasData(o) ? q.proc : 0))));
    let anyZone = false;
    const body = rows.map(({ o, lists }) => {
      const isCur = o === e;
      const listHtml = lists.map((q) => `<span><span class="swatch" style="background:${q.barva}"></span>${esc(q.zkratka)}</span>`).join("");
      const p6 = lists.map((q) => hasData(o) ? `${fmtPct(q.proc)} %<i class="minibar" style="width:${(q.proc / maxV) * 36}px;background:${q.barva}"></i>` : "–").join("<br>");
      const inZone = c && zoneOf(o, c);
      if (inZone) anyZone = true;
      const pc = c ? lists.map((q) => { const v = pctIn(o, q.id, c); return v == null ? "–" : `${fmtPct(v, 1)} %${inZone ? "*" : ""}`; }).join("<br>") : "";
      return `<tr class="${isCur ? "current" : "clickable"}" ${isCur ? "" : `data-eid="${o.id}" data-pid="${lists[0].id}" tabindex="0"`}>
        <td class="el">${esc(electionLabel(o, true))}${o.live ? " ●" : ""}</td>
        <td><div class="lists">${listHtml}</div></td>
        <td class="num">${p6}</td>
        ${c ? `<td class="num">${pc}</td>` : ""}
      </tr>`;
    }).join("");
    const note = rows.some(({ lists, o }) => o !== e && (lists.length > 1 || lists.some((q) => q.tagy.length !== p.tagy.length || q.tagy.some((t) => !p.tagy.includes(t)))));
    $("sec-trend").innerHTML = `<h3>Vývoj v čase – ${esc(p.zkratka)} a související kandidátky</h3>
      <table class="trend"><thead><tr><th>Volby</th><th>Kandidátka</th><th class="num">${esc(REGION)}</th>${c ? `<th class="num">Okrsek ${c}</th>` : ""}</tr></thead>
      <tbody>${body}</tbody></table>
      ${note ? `<p class="muted small" style="margin:8px 0 0">Kandidátky se propojují podle členských stran (koalice obsahující tutéž stranu). Složení koalic se mezi volbami liší – porovnávejte s rozvahou.</p>` : ""}
      ${anyZone ? `<p class="muted small" style="margin:6px 0 0">* okrsek měl v těchto volbách jiné hranice – hodnota je za sloučenou oblast změněných okrsků.</p>` : ""}
      <p class="muted small" style="margin:6px 0 0">Kliknutím na řádek přepnete mapu na dané volby.</p>`;
  }

  function renderPrecinct() {
    const e = cur(), c = state.okrsek;
    if (!c) {
      $("sec-precinct").innerHTML = `<h3>Okrsek</h3><p class="muted small" style="margin:0">Klikněte na okrsek v mapě pro detail a vývoj výsledků v daném okrsku.</p>`;
      return;
    }
    const r = e.okrsky[String(c)];
    const f = GEO.features.find((x) => x.properties.cislo === c).properties;
    let html = `<div style="display:flex;justify-content:space-between;align-items:baseline"><h2>Okrsek ${c}</h2>
      <button type="button" class="linkbtn" id="btn-unselect">zrušit výběr</button></div>
      <div class="muted small">${f.obyv ? `${fmtInt(f.obyv)} obyvatel (2021) · ` : ""}${(f.vymera_m2 / 1e6).toFixed(2).replace(".", ",")} km²${IS_ALL ? ` · ${esc(f.mc_nazev || "")}` : ""}</div>`;
    const zc = zoneOf(e, c);
    if (zc) html += `<p class="small zone-note">V těchto volbách měl okrsek jiné hranice. Výsledky jsou za <b>oblast změněných okrsků</b>
      (dnešní okrsky ${fmtList(zc.okrsky_dnes)}), sečtené z tehdejších okrsků ${fmtList(zc.okrsky_tehdy)}.</p>`;
    if (!r) {
      html += `<p class="muted small">${e.live ? "Okrsek zatím nebyl zpracován." : "Bez dat."}</p>`;
    } else {
      const parties = e.strany.map((q) => [q, ((r.s[q.id] || 0) / r.h) * 100]).filter((x) => x[1] > 0).sort((a, b) => b[1] - a[1]);
      const max = parties[0]?.[1] || 1;
      html += `<div class="kv">
          <div><b>${fmtPct((r.v / r.z) * 100)} %</b><span>účast</span></div>
          <div><b>${fmtInt(r.z)}</b><span>voličů</span></div>
          <div><b>${fmtInt(r.h)}</b><span>platných hlasů${zc ? " (oblast)" : ""}</span></div>
        </div>
        <div class="rows" style="margin-top:10px">${parties.slice(0, 12).map(([q, v]) => partyRow(q, v, max, { active: q.id === state.pid })).join("")}</div>
        ${parties.length > 12 ? `<div class="muted small">+ ${parties.length - 12} dalších s menším ziskem</div>` : ""}`;
    }
    $("sec-precinct").innerHTML = html;
    $("btn-unselect").onclick = () => selectPrecinct(null);
  }

  // ------------------------------------------------------------------ mandáty (půlkruh)
  const KRAJE = ["", "Hlavní město Praha", "Středočeský", "Jihočeský", "Plzeňský", "Karlovarský", "Ústecký",
    "Liberecký", "Královéhradecký", "Pardubický", "Vysočina", "Jihomoravský", "Olomoucký", "Zlínský", "Moravskoslezský"];
  const hemiCache = {};
  /** Rozmístění n křesel do půlkruhu: řady úměrné poloměru, křesla seřazená zleva doprava podle úhlu. */
  function hemicycle(n) {
    if (hemiCache[n]) return hemiCache[n];
    const rows = Math.max(1, Math.round(Math.sqrt(n / 2)));
    const r0 = rows === 1 ? 1 : 0.4;
    const radii = Array.from({ length: rows }, (_, i) => (rows === 1 ? 1 : r0 + ((1 - r0) * i) / (rows - 1)));
    const sumR = radii.reduce((a, b) => a + b, 0);
    const exact = radii.map((r) => (n * r) / sumR);
    const seats = exact.map(Math.floor);
    let rest = n - seats.reduce((a, b) => a + b, 0);
    exact.map((x, i) => [x - Math.floor(x), i]).sort((a, b) => b[0] - a[0] || b[1] - a[1])
      .forEach(([, i]) => { if (rest > 0) { seats[i]++; rest--; } });
    const pts = [];
    let minGap = rows > 1 ? (1 - r0) / (rows - 1) : 0.5;
    radii.forEach((r, i) => {
      const s = seats[i];
      if (s > 1) minGap = Math.min(minGap, (Math.PI * r) / (s - 1));
      for (let k = 0; k < s; k++) {
        const t = s === 1 ? Math.PI / 2 : Math.PI * (1 - k / (s - 1));
        pts.push({ x: r * Math.cos(t), y: -r * Math.sin(t), t, r });
      }
    });
    pts.sort((a, b) => b.t - a.t || b.r - a.r);
    return (hemiCache[n] = { pts, dot: Math.min(0.42 * minGap, 0.09) });
  }

  /** Zvolení kandidáti aktuálních voleb: [{s, j, h, c, p?, k?, n?, skok?}] nebo null (zatím nerozděleno). */
  function electedOf(e) {
    if (e.live) {
      const sum = live[e.id]?.summary;
      if (!sum || !sum.strany.some((s) => s.mandaty > 0)) return null;
      return sum.strany.flatMap((s) => {
        const named = s.zvoleni.map((z) => ({ s: s.id, ...z }));
        while (named.length < s.mandaty) named.push({ s: s.id, j: "(jméno zatím nezveřejněno)", h: null, c: 0 });
        return named;
      });
    }
    const z = e.zvoleni || [];
    return e.typ === "ps" && state.seatScope === "praha" ? z.filter((x) => x.k === 1) : z;
  }

  // --- ŽIVÉ VÝSLEDKY (vypnuto po sečtení KV 2026; pro příští volby odkomentovat a načíst js/live.js v index.html)
  // /**
   // * Průběžný odhad mandátů u živých voleb, dokud ČSÚ mandáty nerozdělí: zákonný výpočet (LiveFeed.rozdelMandaty)
   // * z aktuálních hlasů stran v celém zastupitelstvu. Vrací {…výsledek výpočtu, celkem, zprac, okrsku, proc, zdroj} nebo null.
   // */
  // function seatEstimate(e) {
    // if (!e.live || !e.mandaty?.celkem) return null;
    // const sum = live[e.id]?.summary;
    // if (sum && sum.strany.some((x) => x.mandaty > 0)) return null; // už rozděleno oficiálně
    // const u = sum?.ucast;
    // let strany, zprac, okrsku;
    // if (sum && sum.strany.length && u && +u.OKRSKY_ZPRAC > 0) {
      // strany = sum.strany; // souhrn ČSÚ za celé zastupitelstvo (MČ / celá Praha), včetně počtu kandidátů
      // zprac = +u.OKRSKY_ZPRAC; okrsku = +u.OKRSKY_CELKEM;
    // } else if (e.souhrn && (e.typ === "zmc" || IS_ALL)) {
      // strany = e.strany; // záloha: součet zpracovaných okrsků (území = celé zastupitelstvo; počet kandidátů neznámý)
      // zprac = e.souhrn.okrsku; okrsku = PRECINCTS.length;
    // } else return null;
    // const r = window.LiveFeed.rozdelMandaty(strany.map((x) => ({ id: x.id, hlasy: x.hlasy, kandidatu: x.kandidatu })), e.mandaty.celkem);
    // if (!r) return null;
    // const celkem = strany.reduce((a, x) => a + x.hlasy, 0);
    // // „efektivní“ podíl vůči zákonné hranici (u neúplné kandidátky je hranice úměrně nižší)
    // const eff = (x) => (x.hlasy * 100 * e.mandaty.celkem) / (celkem * Math.min(x.kandidatu > 0 ? x.kandidatu : e.mandaty.celkem, e.mandaty.celkem));
    // const pod = strany.filter((x) => !r.mandaty[x.id] && eff(x) < r.hranice && eff(x) >= r.hranice - 1.5)
      // .map((x) => ({ id: x.id, proc: (x.hlasy / celkem) * 100 })).sort((a, b) => b.proc - a.proc);
    // return { ...r, celkem: e.mandaty.celkem, hlasu: celkem, zprac, okrsku, proc: okrsku ? (zprac / okrsku) * 100 : 0, pod };
  // }

  function renderSeats() {
    const e = cur(), sec = $("sec-seats");
    if (typeof seatTip !== "undefined") { seatTip.hidden = true; delete seatTip.dataset.for; }
    const total = e.mandaty?.celkem;
    // mandáty dávají smysl jen pro orgán, který odpovídá zobrazenému území: zastupitelstvo MČ, nebo ZHMP u celé Prahy
    const relevant = e.typ === "zmc" || (e.typ === "zhmp" && IS_ALL);
    if (!total || !relevant) { sec.innerHTML = ""; return; }
    const est = null; // electedOf(e) ? null : seatEstimate(e); – odhad mandátů při sčítání (vypnuto)
    const elected = est
      ? est.podily.map((q, i) => ({ s: q.id, odhad: i + 1, d: q.delitel, hs: q.hlasy, j: null, h: null, c: 0 }))
      : electedOf(e);
    const isPS = e.typ === "ps";
    const n = est ? total : elected ? elected.length : (live[e.id]?.summary?.voleno || total);
    // pořadí stran: podle počtu mandátů, pak podle celkového výsledku
    const count = {};
    (elected || []).forEach((x) => (count[x.s] = (count[x.s] || 0) + 1));
    const score = (pid) => { const p = partyById(e, pid); return p ? (p.celek_proc ?? p.proc ?? 0) : 0; };
    const order = Object.keys(count).sort((a, b) => count[b] - count[a] || score(b) - score(a));
    const seats = elected ? order.flatMap((pid) => elected.filter((x) => x.s === pid).sort((a, b) => (a.k || 0) - (b.k || 0) || a.c - b.c || (a.d || 0) - (b.d || 0))) : [];
    const { pts, dot } = hemicycle(n);
    const sel = state.pid;
    const circles = pts.map((pt, i) => {
      const x = seats[i];
      const p = x ? partyById(e, x.s) : null;
      const fill = p ? p.barva : "var(--line)";
      const on = p && p.id === sel;
      const ring = on ? ` stroke="var(--ink)" stroke-width="${(dot * 0.38).toFixed(4)}"` : "";
      return `<circle cx="${pt.x.toFixed(4)}" cy="${pt.y.toFixed(4)}" r="${(on ? dot * 0.86 : dot).toFixed(4)}" fill="${fill}"${ring}${x ? ` data-i="${i}"` : ""}/>`;
    }).join("");
    const majority = Math.floor(n / 2) + 1;
    const pragueOnly = isPS && state.seatScope === "praha";
    const legend = order.map((pid) => {
      const p = partyById(e, pid);
      return `<button type="button" class="seat-leg${pid === sel ? " active" : ""}" data-pid="${pid}" title="${esc(p.nazev)}">
        <span class="swatch" style="background:${p.barva}"></span><span class="nm">${esc(p.zkratka)}</span><b>${count[pid]}</b></button>`;
    }).join("");
    const list = order.map((pid) => {
      const p = partyById(e, pid);
      const people = seats.filter((x) => x.s === pid).map((x) =>
        `<li>${esc(x.j)}${x.h != null ? ` <span class="muted">· ${fmtInt(x.h)}</span>` : ""}${x.skok ? ' <span title="zvolen(a) díky preferenčním hlasům">↑</span>' : ""}</li>`).join("");
      return `<div class="seat-group"><div class="party-title"><span class="swatch" style="background:${p.barva}"></span><b>${esc(p.zkratka)}</b><span class="muted">(${count[pid]})</span></div><ol>${people}</ol></div>`;
    }).join("");
    const body = (e.typ === "zhmp" ? "Zastupitelstvo hl. m. Prahy" : e.typ === "zmc" ? TYPE_LABEL.zmc :
      pragueOnly ? "Poslanci zvolení ve volebním kraji Praha" : "Poslanecká sněmovna") +
      (est ? ` · podle ${fmtPct(est.proc, 1)} % sečtených okrsků` : "");
    let estNote = "";
    if (est) {
      const pz = (id) => esc(partyById(e, id)?.zkratka || id);
      const last = est.podily[est.podily.length - 1], next = est.dalsi;
      const lines = [];
      if (last && next) {
        // kolik hlasů by straně „next“ chybělo, aby její podíl předstihl poslední přidělený (při stávajících hlasech ostatních)
        const need = Math.max(1, Math.floor((last.hlasy * next.delitel) / last.delitel) - next.hlasy + 1);
        lines.push(est.los
          ? `O posledním mandátu by teď rozhodl <b>los</b> mezi ${pz(last.id)} a ${pz(next.id)} (stejný podíl i počet hlasů).`
          : `Poslední (${est.podily.length}.) mandát: <b>${pz(last.id)}</b>. Nejblíž dalšímu mandátu: <b>${pz(next.id)}</b> (chybí asi ${fmtInt(need)} hlasů).`);
      }
      if (est.hranice < 5) lines.push(`Hranice je snížena na ${est.hranice} %, protože by jinak postoupily méně než 2 strany.`);
      if (est.pod.length) lines.push(`Těsně pod hranicí: ${est.pod.map((x) => `${pz(x.id)} ${fmtPct(x.proc)} %`).join(", ")}.`);
      if (est.podily.length < total) lines.push(`Kandidátům postupujících stran připadne jen ${est.podily.length} z ${total} mandátů.`);
      estNote = `<div class="seat-est small">
        <p><b>Odhad podle průběžných výsledků:</b> sečteno ${fmtInt(est.zprac)} z ${fmtInt(est.okrsku)} okrsků (${fmtPct(est.proc, 1)} %).
          Mandáty jsou rozděleny jako po sečtení podle § 45 zákona č. 491/2001 Sb.: do rozdělení postupují strany s alespoň 5 % hlasů
          (u kandidátky s méně kandidáty, než je mandátů, úměrně méně), hlasy se dělí čísly 1, 2, 3 … (d'Hondtova metoda)
          a mandáty získají největší podíly. Do sečtení všech okrsků se výsledek může změnit.</p>
        ${lines.map((l) => `<p>${l}</p>`).join("")}
      </div>`;
    }
    sec.innerHTML = `
      <div class="seat-head"><h3>${est ? "Odhad rozdělení mandátů" : "Rozdělení mandátů"}</h3>${est ? `<span class="badge">průběžně</span>` : ""}
        ${isPS ? `<div class="seg seg-sm" role="radiogroup" aria-label="Rozsah">
          <button type="button" role="radio" data-scope="cr" aria-checked="${!pragueOnly}">Celá sněmovna</button>
          <button type="button" role="radio" data-scope="praha" aria-checked="${pragueOnly}">Kraj Praha</button></div>` : ""}
      </div>
      <div class="muted small">${body}</div>
      <svg class="hemi${est ? " est" : ""}" viewBox="-1.08 -1.08 2.16 1.27" role="img" aria-label="Rozdělení ${n} mandátů: ${order.map((pid) => `${esc(partyById(e, pid).zkratka)} ${count[pid]}`).join(", ")}">
        ${circles}
        <text x="0" y="-0.07" class="hemi-n">${n}</text>
        <text x="0" y="0.15" class="hemi-l">${elected && !pragueOnly ? `mandátů · většina ${majority}` : "mandátů"}</text>
      </svg>
      ${elected ? `<div class="seat-legend">${legend}</div>` :
        `<p class="muted small" style="margin:4px 0 0">Mandáty budou rozděleny po sečtení všech okrsků ${e.typ === "zhmp" ? "v celé Praze" : esc(IN_REGION)}.</p>`}
      ${est ? estNote : ""}
      ${elected && !est ? `<details class="seat-list"><summary>Seznam zvolených (${seats.length})</summary>${list}</details>` : ""}
      ${elected && !est ? `<p class="muted small" style="margin:6px 0 0">${isPS
        ? "Po najetí na kuličku se ukáže jméno a počet preferenčních hlasů ve volebním kraji."
        : "Po najetí na kuličku se ukáže jméno a počet hlasů pro kandidáta (u komunálních voleb jsou to všechny hlasy kandidáta včetně hlasů z křížku pro celou kandidátku)."}${seats.some((x) => x.skok) ? " Šipka ↑ = zvolen(a) díky preferenčním hlasům." : ""} Kliknutím vyberete stranu na mapě.</p>` : ""}`;
    sec._seats = seats;
  }

  // tooltip pro kuličky mandátů
  const seatTip = document.createElement("div");
  seatTip.className = "seat-tip";
  seatTip.hidden = true;
  document.body.appendChild(seatTip);
  function showSeatTip(circle) {
    const e = cur();
    const x = $("sec-seats")._seats?.[+circle.dataset.i];
    if (!x) return;
    const p = partyById(e, x.s);
    if (x.odhad) {
      seatTip.innerHTML = `<div class="nm">${x.d}. mandát strany (odhad)</div>
        <div><span class="swatch" style="background:${p.barva}"></span> ${esc(p.zkratka)}</div>
        <div>${x.odhad}. největší podíl: ${fmtInt(x.hs)} hlasů / ${x.d} = <b>${fmtInt(Math.floor(x.hs / x.d))}</b></div>
        <div class="muted">Jména zvolených zveřejní ČSÚ po sečtení (rozhodují i preferenční hlasy).</div>`;
    } else {
      const votes = x.h == null ? "" : e.typ === "ps"
        ? `<div><b>${fmtInt(x.h)}</b> preferenčních hlasů${x.p ? ` (${fmtPct(x.p)} % hlasů strany v kraji)` : ""}</div>`
        : `<div><b>${fmtInt(x.h)}</b> hlasů pro kandidáta</div>`;
      seatTip.innerHTML = `<div class="nm">${esc(x.j)}</div>
        <div><span class="swatch" style="background:${p.barva}"></span> ${esc(p.zkratka)}${x.n ? ` <span class="muted">· navrhl(a): ${esc(x.n)}</span>` : ""}</div>
        ${votes}
        ${x.c ? `<div class="muted">č. ${x.c} na kandidátce${x.k ? ` · kraj ${esc(KRAJE[x.k])}` : ""}</div>` : ""}
        ${x.skok ? `<div>↑ zvolen(a) díky preferenčním hlasům</div>` : ""}`;
    }
    seatTip.hidden = false;
    const r = circle.getBoundingClientRect();
    const w = seatTip.offsetWidth, h = seatTip.offsetHeight;
    let left = r.left + r.width / 2 - w / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
    let top = r.top - h - 8;
    if (top < 8) top = r.bottom + 8;
    seatTip.style.left = `${left + window.scrollX}px`;
    seatTip.style.top = `${top + window.scrollY}px`;
  }
  const canHover = matchMedia("(hover: hover)").matches;
  $("sec-seats").addEventListener("mouseover", (ev) => { const c = ev.target.closest("circle[data-i]"); if (c) showSeatTip(c); });
  $("sec-seats").addEventListener("mouseout", (ev) => { if (ev.target.closest("circle[data-i]")) seatTip.hidden = true; });
  $("sec-seats").addEventListener("click", (ev) => {
    const sc = ev.target.closest("[data-scope]");
    if (sc) { state.seatScope = sc.dataset.scope; renderSeats(); return; }
    const c = ev.target.closest("circle[data-i]");
    if (c && !canHover && seatTip.dataset.for !== c.dataset.i) { showSeatTip(c); seatTip.dataset.for = c.dataset.i; return; } // dotyk: 1. klepnutí = detail
    const x = c ? $("sec-seats")._seats?.[+c.dataset.i] : null;
    const leg = ev.target.closest(".seat-leg[data-pid]");
    const pid = x ? x.s : leg?.dataset.pid;
    if (pid) {
      seatTip.hidden = true; delete seatTip.dataset.for;
      state.pid = pid; setAnchor();
      if (state.mode === "zmena") { ensureCmp(); if (!state.cmp) state.mode = "podil"; }
      update();
    }
  });
  document.addEventListener("scroll", () => { seatTip.hidden = true; delete seatTip.dataset.for; }, true);

  // --- ŽIVÉ VÝSLEDKY (vypnuto po sečtení KV 2026; pro příští volby odkomentovat a načíst js/live.js v index.html)
  // function renderLivePanel() {
    // const e = cur(), sec = $("sec-live");
    // if (!e.live) { sec.hidden = true; sec.innerHTML = ""; return; }
    // sec.hidden = false;
    // const feed = live[e.id];
    // const n = Object.keys(e.okrsky).length;
    // const sum = feed?.summary;
    // const u = sum?.ucast;
    // const custom = new URLSearchParams(location.search).get("livebase");
    // let html = `<div style="display:flex;justify-content:space-between;align-items:center"><span class="badge">Živé výsledky</span>
      // <button type="button" class="linkbtn" id="btn-live-refresh">obnovit teď</button></div>
      // <div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="${PRECINCTS.length}" aria-valuenow="${n}"><i style="width:${(n / PRECINCTS.length) * 100}%"></i></div>
      // <div class="small"><b>${n}</b> z ${PRECINCTS.length} okrsků (${esc(REGION)}) zpracováno${n ? ` · účast ${fmtPct(e.souhrn?.ucast_proc)} %` : ""}</div>`;
    // if (u && e.typ === "zhmp") html += `<div class="small muted">Celá Praha: zpracováno ${fmtInt(+u.OKRSKY_ZPRAC)} z ${fmtInt(+u.OKRSKY_CELKEM)} okrsků (${String(u.OKRSKY_ZPRAC_PROC).replace(".", ",")} %)</div>`;
    // if (sum?.spocteno) html += `<div class="small" style="margin-top:4px"><b>Sečteno – mandáty rozděleny.</b></div>`;
    // if (!n) html += `<p class="small muted" style="margin:8px 0 0">Výsledky zatím nejsou k dispozici. Hlasování probíhá v pátek 9. 10. 2026 (14–22 h) a v sobotu 10. 10. 2026 (8–14 h); ČSÚ začne zveřejňovat výsledky okrsků po uzavření volebních místností. Stránka se sama kontroluje každou minutu.</p>`;
    // if (feed) {
      // html += `<div class="small muted" style="margin-top:6px">Poslední dávka: ${feed.lastBatchInfo ? `č. ${feed.lastBatchInfo.PORADI_DAVKY} (${fmtTime(feed.lastBatchInfo.generovano)})` : "zatím žádná"}
        // · kontrola ${feed.busy ? "probíhá…" : fmtTime(feed.lastCheck)}</div>`;
      // if (feed.error) html += `<div class="small" style="color:var(--live);margin-top:4px">Chyba načítání: ${esc(feed.error)}</div>`;
    // }
    // html += `<div class="small muted" style="margin-top:6px">Zdroj: <a href="${esc(feed?.base || e.live.base)}/zastup/vysledky_obec_${e.live.kodzastup}.xml" target="_blank" rel="noopener">otevřená data ČSÚ</a>${custom ? ` <b>(testovací zdroj: ${esc(custom)})</b>` : ""}</div>`;
    // sec.innerHTML = html;
    // $("btn-live-refresh").onclick = () => feed && (feed.refreshNow(), renderLivePanel());
  // }

  $("panel").addEventListener("click", (ev) => {
    const a = ev.target.closest("[data-okrsek]");
    if (a) { ev.preventDefault(); const c = +a.dataset.okrsek; selectPrecinct(c); map.fitBounds(layerByPrecinct[c].getBounds(), { maxZoom: 16, padding: [40, 40] }); return; }
    const tr = ev.target.closest("tr[data-eid]");
    if (tr) { state.pid = tr.dataset.pid; switchElectionKeepPid(tr.dataset.eid); return; }
    const row = ev.target.closest(".row[data-pid]");
    if (row) { state.pid = row.dataset.pid; setAnchor(); if (state.mode === "zmena") { ensureCmp(); if (!state.cmp) state.mode = "podil"; } update(); }
  });
  $("panel").addEventListener("keydown", (ev) => {
    const tr = ev.target.closest("tr[data-eid]");
    if (tr && (ev.key === "Enter" || ev.key === " ")) { ev.preventDefault(); state.pid = tr.dataset.pid; switchElectionKeepPid(tr.dataset.eid); }
  });
  function switchElectionKeepPid(eid) {
    const pid = state.pid;
    switchElection(eid, false);
    if (partyById(cur(), pid)) { state.pid = pid; update(); }
  }
  $("panel-toggle").addEventListener("click", () => $("panel").scrollIntoView({ behavior: "smooth" }));

  // ------------------------------------------------------------------ šířka panelu (tažení levého okraje)
  const PANEL_DEFAULT = 440, PANEL_MIN = 320;
  const panelMax = () => Math.max(PANEL_MIN, Math.min(900, Math.round(window.innerWidth * 0.7)));
  function setPanelWidth(w, save = true) {
    w = Math.round(Math.min(panelMax(), Math.max(PANEL_MIN, w)));
    document.documentElement.style.setProperty("--panel-w", `${w}px`);
    $("panel-resizer").setAttribute("aria-valuenow", w);
    map.invalidateSize(); // zachová střed mapy
    if (save) { try { localStorage.setItem("panelWidth", String(w)); } catch (e) { /* bez úložiště */ } }
  }
  (() => {
    let saved = null;
    try { saved = +localStorage.getItem("panelWidth") || null; } catch (e) { /* bez úložiště */ }
    const rz = $("panel-resizer");
    rz.setAttribute("aria-valuemin", PANEL_MIN);
    rz.setAttribute("aria-valuemax", panelMax());
    if (saved) setPanelWidth(saved, false);
    let startX = 0, startW = 0;
    const onMove = (ev) => setPanelWidth(startW + (startX - ev.clientX), false);
    const onUp = (ev) => {
      rz.classList.remove("dragging");
      document.body.classList.remove("resizing");
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      setPanelWidth(startW + (startX - ev.clientX));
    };
    rz.addEventListener("pointerdown", (ev) => {
      if (ev.button !== 0) return;
      ev.preventDefault();
      startX = ev.clientX;
      startW = $("panel").offsetWidth;
      rz.classList.add("dragging");
      document.body.classList.add("resizing");
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    });
    rz.addEventListener("dblclick", () => setPanelWidth(PANEL_DEFAULT));
    rz.addEventListener("keydown", (ev) => {
      const step = ev.shiftKey ? 60 : 20;
      if (ev.key === "ArrowLeft") { setPanelWidth($("panel").offsetWidth + step); ev.preventDefault(); }
      if (ev.key === "ArrowRight") { setPanelWidth($("panel").offsetWidth - step); ev.preventDefault(); }
      if (ev.key === "Home" || ev.key === "Enter") { setPanelWidth(PANEL_DEFAULT); ev.preventDefault(); }
    });
    window.addEventListener("resize", () => {
      rz.setAttribute("aria-valuemax", panelMax());
      if ($("panel").offsetWidth > panelMax()) setPanelWidth(panelMax(), false);
    });
  })();

  // ------------------------------------------------------------------ živé výsledky
  // --- ŽIVÉ VÝSLEDKY (vypnuto po sečtení KV 2026; pro příští volby odkomentovat a načíst js/live.js v index.html)
  // function startLive(e) {
    // for (const [id, f] of Object.entries(live)) if (id !== e.id) f.stop();
    // if (!live[e.id]) {
      // live[e.id] = new window.LiveFeed(e, PRECINCT_SET, (feed) => {
        // e.okrsky = feed.okrsky();
        // recomputeTotals(e);
        // if (cur() === e) update(false);
      // });
      // live[e.id].start();
    // } else if (live[e.id].stopped) {
      // live[e.id].start();
    // }
  // }

  // ------------------------------------------------------------------ CSV
  $("btn-csv").addEventListener("click", () => {
    const e = cur();
    const parties = sortedParties(e);
    const head = ["okrsek_nebo_oblast", "volici_v_seznamu", "vydane_obalky", "odevzdane_obalky", "platne_hlasy", "ucast_proc",
      ...parties.flatMap((p) => [`${p.zkratka} – hlasy`, `${p.zkratka} – %`])];
    const lines = [head];
    const done = new Set();
    for (const c of PRECINCTS) {
      const r = e.okrsky[String(c)];
      const uid = unitOf(e, c);
      if (!r || done.has(uid)) continue;
      done.add(uid);
      const z = zoneOf(e, c);
      lines.push([z ? `oblast: dnes ${fmtList(z.okrsky_dnes)}; tehdy ${fmtList(z.okrsky_tehdy)}` : c, r.z, r.v, r.o, r.h, fmtPct((r.v / r.z) * 100),
        ...parties.flatMap((p) => [r.s[p.id] || 0, fmtPct(((r.s[p.id] || 0) / r.h) * 100)])]);
    }
    const csv = "﻿" + lines.map((l) => l.map((v) => /[;"\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v).join(";")).join("\r\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    a.download = `volby_${R.kod}_${e.id}_okrsky.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });

  // ------------------------------------------------------------------ dialog „O datech“
  function renderInfo() {
    const rows = ELECTIONS.map((e) => `<tr><td>${esc(e.nazev)}</td><td>${fmtDate(e.datum)}</td>
      <td>${e.live ? "živě" : `${fmtInt(e.souhrn?.okrsku)}${e.oblasti?.length ? ` (${e.oblasti.length} obl.)` : ""}`}</td>
      <td><a href="${esc(e.zdroj)}" target="_blank" rel="noopener">volby.gov.cz</a></td></tr>`).join("");
    const names = { ps2017: "PS 2017", kv2018: "KV 2018", ps2021: "PS 2021", kv2022: "KV 2022", ps2025: "PS 2025" };
    const ver = Object.entries(V2.overeni).map(([id, v]) => `<tr><td>${names[id] || id}</td>
      <td class="num">${fmtInt(v.stabilnich)} z ${fmtInt(V2.okrsku)}</td><td class="num">${String(v.volici_ve_stabilnich_proc).replace(".", ",")} %</td>
      <td class="num">${v.oblasti}</td></tr>`).join("");
    const here = ELECTIONS.filter((e) => e.oblasti?.length).map((e) => `<li>${esc(electionLabel(e, true))}: ${e.oblasti.map((z) =>
      `dnešní okrsky ${fmtList(z.okrsky_dnes)} ← tehdejší ${fmtList(z.okrsky_tehdy)}`).join("; ")}</li>`).join("");
    $("dlg-body").innerHTML = `
      <p>Mapa zobrazuje podíl hlasů vybrané kandidátky ve volebních okrscích ${IS_ALL ? "celé Prahy" : `městské části ${esc(R.nazev)}`}. Čím vyšší podíl, tím sytější barva.
      Barvy stran odpovídají zvyklostem z grafů volebních průzkumů (Piráti černá, ODS modrá, SPOLU tmavě modrá, ANO tmavě fialová, STAN purpurová, TOP 09 vínová, KDU-ČSL žlutá, SPD šedomodrá…).</p>
      <h3>Změny okrsků v čase – „oblasti změn“</h3>
      <p>Všechny volby se kreslí na dnešních hranicích okrsků (stav pro komunální volby 2026). Okrsek se zobrazí samostatně jen tehdy,
      když měl v daných volbách <b>prokazatelně stejné hranice</b> jako dnes – ověřeno podle data platnosti záznamu v registru RÚIAN,
      historických vrstev ČSÚ (2022, 2024, 2025) a u MČ s jediným okrskem podle shody s územím MČ.</p>
      <p>Kde se okrsky mezi volbami překreslily, mapa sloučí dotčené dnešní okrsky do jedné <b>oblasti změn</b> (čárkovaný obrys, bez vnitřních hranic)
      a zobrazí v ní součet výsledků tehdejších okrsků z téhož území. Výsledky jsou tak v čase srovnatelné, jen s menší podrobností v místech změn.</p>
      <table><thead><tr><th>Volby</th><th>Okrsky beze změny hranic</th><th>Podíl voličů</th><th>Oblastí změn</th></tr></thead><tbody>${ver}</tbody></table>
      <p class="small">Údaje za celou Prahu. Největší změny: Praha 2 (celá MČ, 2025), Praha 9 (2023), Praha 7 (2025), Praha 13 (2018), Praha 3, 10 a 12.</p>
      ${here ? `<p><b>${esc(IS_ALL ? "Celá Praha" : R.nazev)}:</b></p><ul class="small">${here}</ul>` : `<p><b>${esc(R.nazev)}:</b> okrsky měly ve všech volbách stejné hranice jako dnes.</p>`}
      <h3>Zdroje dat</h3>
      <table><thead><tr><th>Volby</th><th>Datum</th><th>Okrsků</th><th>Zdroj</th></tr></thead><tbody>${rows}</tbody></table>
      <p>Výsledky: otevřená data Českého statistického úřadu (okrsková data PST4/PST4P pro sněmovnu, KVT3/KVHL pro komunální volby, registry kandidátních listin a kandidátů).
      U komunálních voleb 2018 se berou výsledky řádného termínu; mandáty v Praze 4 a 8 podle stavu po rozhodnutí soudu (30. 11. 2018).
      Praha 9 volila v roce 2018 zastupitelstvo MČ ve třech volebních obvodech – kandidátky stejné strany jsou sloučené.
      Hranice okrsků: ČSÚ – <i>Volební okrsky pro volby do zastupitelstev obcí 2026</i> (účelový prvek RÚIAN), převedené z S-JTSK do WGS84.
      Podkladová mapa: © ČÚZK. Data jsou uložena staticky ve složce <code>data/</code> (vytvořeno ${esc(D.vytvoreno)}).</p>
      <h3>Jak se počítají procenta</h3>
      <ul>
        <li><b>Sněmovna:</b> hlasy strany / platné hlasy v okrsku.</li>
        <li><b>Komunální volby (ZHMP, ZMČ):</b> volič má tolik hlasů, kolik se volí zastupitelů; procento = hlasy kandidátky / všechny platné hlasy v okrsku (stejně počítá ČSÚ).</li>
        <li>Procenta jsou useknutá (ne zaokrouhlená) na 2 desetinná místa – stejně jako na volby.gov.cz.</li>
        <li><b>Volební účast</b> = vydané obálky / voliči v seznamu.</li>
        <li><b>Škála barev:</b> „společná pro stranu v čase“ má stejné maximum pro všechny volby kandidátek vedených touž stranou, takže se mapy různých let dají přímo porovnat.</li>
        <li><b>Vývoj v čase</b> propojuje kandidátky podle členských stran (číselník stran ČSÚ). Režim „Změna oproti…“ odečítá součet souvisejících kandidátek ve srovnávaných volbách.</li>
      </ul>
      <h3>Komunální volby 2026</h3>
      <p>Výsledky voleb 9.–10. 10. 2026 pocházejí z finálních otevřených dat ČSÚ (volby.gov.cz/opendata/kv2026, zveřejněno 11. 10. 2026) včetně zvolených zastupitelů. Během sčítání mapa četla průběžné výsledky přímo z živých dat ČSÚ; tato část je teď vypnutá (kód zůstává v js/live.js pro příští volby).</p>`;
  }
  $("btn-info").addEventListener("click", () => { renderInfo(); $("dlg-info").showModal(); });


  // ------------------------------------------------------------------ hlavní překreslení
  function update(hash = true) {
    ensureParty();
    if (state.mode === "zmena") { ensureCmp(); if (!state.cmp) state.mode = "podil"; }
    renderControls();
    restyle();
    renderPanel();
    if (hash) writeHash();
  }

  readHash();
  // Strana při startu: z odkazu, jinak „kotva“ předaná při přepnutí MČ (členské strany), jinak Piráti (kód 720).
  {
    const hp = new URLSearchParams(location.hash.slice(1));
    if (!hp.get("strana") || !partyById(cur(), hp.get("strana"))) {
      const kotva = hp.get("kotva");
      const m = kotva ? bestMatch(cur(), { tagy: kotva.split(","), nazev: "" }) : null;
      const pir = cur().strany.find((p) => p.tagy.includes("720"));
      state.pid = (m || pir || {}).id || null;
    }
  }
  // stav pro boot.js (přepnutí MČ zachová volby a stranu)
  window.volbyStav = () => ({ eid: state.eid, tagy: state.anchor?.tagy || [] });
  ensureParty();
  setAnchor();
  // if (cur().live) startLive(cur()); // živé výsledky (vypnuto)
  if (state.mode === "zmena") ensureCmp();
  update();
  updateLabels();
  window.addEventListener("hashchange", () => {
    const mc = new URLSearchParams(location.hash.slice(1)).get("mc");
    if (mc && mc !== R.kod) { location.reload(); return; } // jiná MČ v odkazu -> načíst její data
    readHash(); ensureParty(); setAnchor(); /* if (cur().live) startLive(cur()); – živé výsledky (vypnuto) */ update(false);
  });
};
