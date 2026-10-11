/* Volební mapa Prahy – rozbalení dat vytvořených scripts/build_data.py.
   - Datové soubory obsahují JSON zabalený gzipem a kódovaný base64; rozbalí ho nativní DecompressionStream.
   - Geometrie je kompaktní: kroužek = [x0, y0, dx1, dy1, …] v celých číslech (jednotky 1/q stupně), neuzavřený.
   - Obrysy území a oblastí změn se skládají z hranic okrsků: hrana sdílená dvěma okrsky skupiny se vyruší. */
window.VolbyData = (function () {
  "use strict";

  const supported = typeof DecompressionStream === "function" && typeof Response === "function";

  /** base64(gzip(JSON)) → objekt */
  async function unpack(b64) {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
    return JSON.parse(await new Response(stream).text());
  }

  /** kroužek [x0, y0, dx, dy, …] → body [[x, y], …] v celých číslech */
  function ringPoints(flat) {
    let x = flat[0], y = flat[1];
    const pts = [[x, y]];
    for (let i = 2; i < flat.length; i += 2) {
      x += flat[i];
      y += flat[i + 1];
      pts.push([x, y]);
    }
    return pts;
  }

  /** kompaktní (multi)polygon → GeoJSON geometrie */
  function geometry(g, q) {
    const polys = g.map((rings) => rings.map((r) => {
      const pts = ringPoints(r).map(([x, y]) => [x / q, y / q]);
      pts.push(pts[0]);
      return pts;
    }));
    return polys.length === 1 ? { type: "Polygon", coordinates: polys[0] } : { type: "MultiPolygon", coordinates: polys };
  }

  /** Obrys skupiny (multi)polygonů jako MultiLineString: hrany, které ve skupině nesdílí dva polygony, pospojované do čar. */
  function outline(gs, q) {
    const edges = new Map();
    for (const g of gs) for (const rings of g) for (const r of rings) {
      const pts = ringPoints(r);
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length];
        const ka = a[0] * 1e8 + a[1], kb = b[0] * 1e8 + b[1];
        const key = ka < kb ? ka + "_" + kb : kb + "_" + ka;
        const e = edges.get(key);
        if (e) e.n++;
        else edges.set(key, { n: 1, a, b, ka, kb });
      }
    }
    const adj = new Map();
    const add = (k, e) => { const l = adj.get(k); if (l) l.push(e); else adj.set(k, [e]); };
    const free = [];
    for (const e of edges.values()) {
      if (e.n !== 1) continue;
      free.push(e);
      add(e.ka, e);
      add(e.kb, e);
    }
    const used = new Set();
    const lines = [];
    for (const e0 of free) {
      if (used.has(e0)) continue;
      used.add(e0);
      const line = [e0.a, e0.b];
      let k = e0.kb;
      for (;;) {
        const next = (adj.get(k) || []).find((e) => !used.has(e));
        if (!next) break;
        used.add(next);
        const fwd = next.ka === k;
        line.push(fwd ? next.b : next.a);
        k = fwd ? next.kb : next.ka;
      }
      lines.push(line.map(([x, y]) => [x / q, y / q]));
    }
    return { type: "MultiLineString", coordinates: lines };
  }

  /** Přehled (praha.js): obrysy MČ → GeoJSON FeatureCollection pro výběr na mapě. */
  function prepareOverview(V2) {
    V2.obrysy_mc = {
      type: "FeatureCollection",
      features: V2.obrysy_mc.map((m) => ({ type: "Feature", properties: { kod: m.kod, nazev: m.nazev }, geometry: geometry(m.g, V2.q) })),
    };
    return V2;
  }

  /** Data území: okrsky → GeoJSON (R.geo), obrys území (R.obrys) a obrysy oblastí změn (z.obrys). */
  function prepareRegion(R) {
    const q = R.q;
    const gOf = {};
    R.geo = {
      type: "FeatureCollection",
      features: R.okrsky.map(({ g, ...props }) => {
        gOf[props.cislo] = g;
        return { type: "Feature", properties: props, geometry: geometry(g, q) };
      }),
    };
    R.obrys = outline(Object.values(gOf), q);
    const cache = new Map(); // stejné oblasti se opakují ve více volbách
    for (const e of R.volby) for (const z of e.oblasti || []) {
      const key = z.okrsky_dnes.join(",");
      if (!cache.has(key)) cache.set(key, outline(z.okrsky_dnes.map((n) => gOf[n]).filter(Boolean), q));
      z.obrys = cache.get(key);
    }
    delete R.okrsky;
    return R;
  }

  return { supported, unpack, prepareOverview, prepareRegion };
})();
