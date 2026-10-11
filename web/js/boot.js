/* Volební mapa Prahy – výběr území (MČ / celá Praha) a načtení jeho dat.
   Data oblasti jsou JS soubory (data/oblast/<kód>.js), které volají window.VOLBY_V2_REGION("<gzip+base64>");
   načítají se vložením <script>, takže web funguje i otevřený z disku (file://). Rozbalení: js/data.js. */
(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  function fail(msg) {
    const ld = $("loading");
    ld.querySelector("span").textContent = msg;
    ld.hidden = false;
  }
  if (!window.VolbyData.supported) {
    fail("Tento prohlížeč neumí rozbalit data mapy (chybí DecompressionStream). Použijte prosím aktuální Chrome, Edge, Firefox nebo Safari.");
    return;
  }
  window.VolbyData.unpack(window.VOLBY_V2_PACKED)
    .then((V2) => main(window.VolbyData.prepareOverview(V2)))
    .catch((err) => { console.error(err); fail("Data mapy se nepodařilo načíst."); });

  function main(V2) {
    const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const KEY = "volbyMapaMc";
    const ALL = "praha";
    // pořadí: Praha 1–22 podle čísla, potom ostatní MČ abecedně (česky)
    const coll = new Intl.Collator("cs");
    const num = (m) => { const x = /^Praha (\d+)$/.exec(m.nazev); return x ? +x[1] : null; };
    V2.mc.sort((a, b) => {
      const na = num(a), nb = num(b);
      if (na != null && nb != null) return na - nb;
      if (na != null) return -1;
      if (nb != null) return 1;
      return coll.compare(a.nazev, b.nazev);
    });
    const byCode = Object.fromEntries(V2.mc.map((m) => [m.kod, m]));
    const valid = (k) => k === ALL || !!byCode[k];
    const nameOf = (k) => (k === ALL ? "Celá Praha" : byCode[k]?.nazev || k);
    let loaded = null;

    function stored() {
      try { return localStorage.getItem(KEY); } catch (e) { return null; }
    }
    function store(k) {
      try { localStorage.setItem(KEY, k); } catch (e) { /* bez úložiště */ }
    }

    // ---------------------------------------------------------------- přepínač v hlavičce
    const sel = $("sel-region");
    sel.innerHTML = `<option value="${ALL}">Celá Praha (Sněmovna, ZHMP)</option><optgroup label="Městské části">` +
      V2.mc.map((m) => `<option value="${m.kod}">${esc(m.nazev)}</option>`).join("") + "</optgroup>";
    sel.addEventListener("change", () => go(sel.value));
    $("btn-region").addEventListener("click", () => openPicker());

    /** Přechod na jiné území: zachová typ voleb a stranu (dohledá se podle členských stran). */
    function go(k) {
      if (!valid(k)) return;
      store(k);
      if (!loaded) { load(k); return; }
      if (k === loaded) return;
      const h = new URLSearchParams(location.hash.slice(1));
      const st = window.volbyStav ? window.volbyStav() : null;
      const out = new URLSearchParams();
      out.set("mc", k);
      // z celé Prahy (jen ZHMP) zpět do MČ: komunální volby zobrazit opět pro zastupitelstvo MČ
    if (st?.eid) out.set("volby", loaded === ALL && k !== ALL ? st.eid.replace(/^(kv\d{4})-zhmp$/, "$1-zmc") : st.eid);
      if (st?.tagy?.length) out.set("kotva", st.tagy.join(","));
      for (const key of ["rezim", "srovnat", "skala"]) if (h.get(key)) out.set(key, h.get(key));
      history.replaceState(null, "", "#" + out.toString());
      location.reload();
    }

    function load(k) {
      loaded = k;
      sel.value = k;
      const h = new URLSearchParams(location.hash.slice(1));
      if (h.get("mc") !== k) { h.set("mc", k); history.replaceState(null, "", "#" + h.toString()); }
      document.title = `Volební mapa – ${nameOf(k)}`;
      const ld = $("loading");
      ld.querySelector("span").textContent = `Načítám data – ${nameOf(k)}…`;
      ld.hidden = false;
      const failed = (err) => {
        if (err) console.error(err);
        ld.querySelector("span").textContent = `Data pro „${nameOf(k)}“ se nepodařilo načíst.`;
      };
      window.VOLBY_V2_REGION = (b64) => {
        window.VolbyData.unpack(b64).then((R) => {
          window.startApp(V2, window.VolbyData.prepareRegion(R));
          ld.hidden = true;
        }).catch(failed);
      };
      const sc = document.createElement("script");
      sc.src = `data/oblast/${k}.js`;
      sc.onerror = () => failed();
      document.body.appendChild(sc);
    }

    // ---------------------------------------------------------------- výběr na mapě
    const dlg = $("dlg-region");
    let pickerMap = null;
    dlg.addEventListener("cancel", (ev) => { if (!loaded) ev.preventDefault(); }); // při první návštěvě je nutné vybrat
    $("btn-region-close").addEventListener("click", () => { if (loaded) dlg.close(); });

    function renderList(filter = "") {
      const f = filter.trim().toLowerCase();
      const items = V2.mc.filter((m) => !f || m.nazev.toLowerCase().includes(f) || m.nazev.toLowerCase().replace("praha", "").trim().startsWith(f));
      $("region-list").innerHTML = items.map((m) => `<button type="button" class="region-item${m.kod === loaded ? " active" : ""}" data-kod="${m.kod}">
        <span>${esc(m.nazev)}</span><span class="muted">${m.okrsku} ${m.okrsku === 1 ? "okrsek" : m.okrsku < 5 ? "okrsky" : "okrsků"}</span></button>`).join("")
        || `<p class="muted small">Nic nenalezeno.</p>`;
    }
    $("region-search").addEventListener("input", (ev) => renderList(ev.target.value));
    $("region-list").addEventListener("click", (ev) => {
      const b = ev.target.closest("[data-kod]");
      if (b) choose(b.dataset.kod);
    });
    $("btn-region-all").addEventListener("click", () => choose(ALL));
    $("region-search").addEventListener("keydown", (ev) => {
      if (ev.key !== "Enter") return;
      const first = $("region-list").querySelector("[data-kod]");
      if (first) choose(first.dataset.kod);
    });

    function choose(k) {
      if (dlg.open) dlg.close();
      go(k);
    }

    function openPicker() {
      $("btn-region-close").hidden = !loaded;
      renderList("");
      $("region-search").value = "";
      dlg.showModal();
      if (!pickerMap) {
        pickerMap = L.map("picker-map", { zoomControl: true, attributionControl: true, zoomSnap: 0.25 });
        L.tileLayer("https://ags.cuzk.gov.cz/arcgis1/rest/services/ZTM_WM/MapServer/tile/{z}/{y}/{x}",
          { attribution: '&copy; <a href="https://geoportal.cuzk.gov.cz/">ČÚZK</a>', maxZoom: 16, className: "tiles-gray", opacity: 0.45 }).addTo(pickerMap);
        const layer = L.geoJSON(V2.obrysy_mc, {
          style: (f) => ({ weight: 1, color: "#4a4a46", fillColor: f.properties.kod === loaded ? "#034ea2" : "#9a9992", fillOpacity: f.properties.kod === loaded ? 0.45 : 0.18 }),
          onEachFeature(f, l) {
            l.bindTooltip(esc(f.properties.nazev), { sticky: true, className: "okrsek-tip" });
            l.on({
              mouseover: () => l.setStyle({ fillColor: "#034ea2", fillOpacity: 0.5 }),
              mouseout: () => layer.resetStyle(l),
              click: () => choose(f.properties.kod),
            });
          },
        }).addTo(pickerMap);
        pickerMap.fitBounds(layer.getBounds(), { padding: [6, 6] });
      } else {
        pickerMap.eachLayer((l) => l.feature && l.setStyle && l.setStyle({
          fillColor: l.feature.properties.kod === loaded ? "#034ea2" : "#9a9992", fillOpacity: l.feature.properties.kod === loaded ? 0.45 : 0.18 }));
      }
      setTimeout(() => { pickerMap.invalidateSize(); $("region-search").focus(); }, 50);
    }

    // ---------------------------------------------------------------- start
    const fromHash = new URLSearchParams(location.hash.slice(1)).get("mc");
    const start = valid(fromHash) ? fromHash : valid(stored()) ? stored() : null;
    if (start) {
      store(start);
      load(start);
    } else {
      openPicker();
    }
  }
})();
