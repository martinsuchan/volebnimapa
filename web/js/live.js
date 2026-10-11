/*
 * Živé výsledky komunálních voleb 2026 z otevřených dat ČSÚ (volby.gov.cz).
 *
 * VYPNUTO po sečtení KV 2026: soubor se nenačítá (zakomentováno v index.html) a volání v js/app.js
 * jsou zakomentovaná (hledejte „ŽIVÉ VÝSLEDKY“ / „vypnuto“). Pro příští volby obojí odkomentovat a v buildu
 * dat vrátit položku voleb s vlastností live.
 *
 *  - souhrn zastupitelstva:  {base}/zastup/vysledky_obec_{KODZASTUP}.xml   (stavový, aktualizace 60 s)
 *  - okrsky po dávkách:      {base}/okrsky/vysledky_okrsky_{NNNNN}.xml      (přírůstkový, nová dávka cca po 5 min)
 *
 * Dávky jsou přírůstkové: obsahují jen okrsky zpracované od minulé dávky. Okrsek může přijít
 * opakovaně (oprava) – platí verze s nejvyšším PORADI_ZPRAC. Neexistující dávka = HTTP 404
 * nebo <CHYBA KOD_CHYBY="10">. Server posílá Access-Control-Allow-Origin: *, takže lze číst
 * přímo z prohlížeče bez vlastního serveru.
 */
(function () {
  "use strict";

  const POLL_MS = 60 * 1000;
  const RETRY_MS = 15 * 1000;
  const PARALLEL = 4;

  function attrs(el) {
    const o = {};
    for (const a of el.attributes) o[a.name] = a.value;
    return o;
  }
  function byTag(root, name) {
    return Array.from(root.getElementsByTagNameNS("*", name));
  }
  async function fetchXml(url) {
    const r = await fetch(url, { cache: "no-cache" });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`HTTP ${r.status} – ${url}`);
    const text = await r.text();
    const doc = new DOMParser().parseFromString(text, "application/xml");
    if (doc.getElementsByTagName("parsererror").length) throw new Error("Neplatné XML: " + url);
    return doc;
  }
  const pad5 = (n) => String(n).padStart(5, "0");

  class LiveFeed {
    /**
     * @param {object} election  položka z VOLBY_DATA s vlastností live {base, kodzastup}
     * @param {Set<number>} precinctNumbers  čísla okrsků, která nás zajímají (6001–6104)
     * @param {function} onUpdate  volá se po každé změně dat
     */
    constructor(election, precinctNumbers, onUpdate) {
      const params = new URLSearchParams(location.search);
      this.base = (params.get("livebase") || election.live.base).replace(/\/$/, "");
      this.kodzastup = election.live.kodzastup;
      this.wanted = precinctNumbers;
      this.onUpdate = onUpdate;
      this.precincts = {};   // číslo okrsku -> {z, v, o, h, s:{por: hlasy}, poradi, cas}
      this.nextBatch = 1;
      this.lastBatchInfo = null;
      this.summary = null;
      this.lastCheck = null;
      this.nextCheck = null;
      this.error = null;
      this.busy = false;
      this.timer = null;
      this.stopped = false;
    }

    start() {
      this.stopped = false;
      this.tick();
    }
    stop() {
      this.stopped = true;
      clearTimeout(this.timer);
    }
    refreshNow() {
      clearTimeout(this.timer);
      this.tick();
    }

    async tick() {
      if (this.busy || this.stopped) return;
      this.busy = true;
      this.error = null;
      try {
        await Promise.all([this.loadSummary(), this.loadBatches()]);
      } catch (e) {
        this.error = e.message || String(e);
        console.warn("Živé výsledky:", e);
      }
      this.busy = false;
      // po chybě (server ČSÚ pod zátěží občas spojení zahodí) zkusit znovu dřív, ať se dávky rychle dotáhnou
      const delay = this.error ? RETRY_MS : POLL_MS;
      this.lastCheck = new Date();
      this.nextCheck = new Date(Date.now() + delay);
      if (!this.stopped) {
        this.onUpdate(this);
        this.timer = setTimeout(() => this.tick(), delay);
      }
    }

    async loadSummary() {
      const doc = await fetchXml(`${this.base}/zastup/vysledky_obec_${this.kodzastup}.xml`);
      if (!doc) return;
      const obec = byTag(doc, "OBEC")[0];
      if (!obec) return;
      const ucast = byTag(obec, "UCAST")[0];
      const strany = byTag(obec, "VOLEBNI_STRANA").map((el) => {
        const a = attrs(el);
        return {
          id: a.POR_STR_HLAS_LIST,
          nazev: a.NAZEV_STRANY,
          hlasy: +a.HLASY,
          proc: +a.HLASY_PROC,
          mandaty: +a.ZASTUPITELE_POCET,
          kandidatu: +a.KANDIDATU_POCET || 0,
          zvoleni: byTag(el, "ZASTUPITEL").map((z) => {
            const b = attrs(z);
            const jmeno = [b.TITULPRED, b.JMENO, b.PRIJMENI].filter(Boolean).join(" ");
            return {
              j: b.TITULZA ? `${jmeno}, ${b.TITULZA}` : jmeno,
              h: +b.HLASY || 0,
              c: +b.PORADOVE_CISLO || 0,
            };
          }),
        };
      });
      const root = doc.documentElement;
      this.summary = {
        generovano: root.getAttribute("DATUM_CAS_GENEROVANI"),
        spocteno: obec.getAttribute("JE_SPOCTENO") === "1",
        voleno: +obec.getAttribute("VOLENO_ZASTUP"),
        ucast: ucast ? attrs(ucast) : null,
        strany,
      };
    }

    async loadBatches() {
      // Soubor bez čísla vrací vždy poslední dávku (před začátkem sčítání <CHYBA KOD_CHYBY="10">).
      // Z něj zjistíme číslo poslední dávky a dotáhneme jen dávky, které existují – neexistující
      // dávka totiž vrací 404 bez CORS hlavičky, což prohlížeč hlásí jen jako obecnou síťovou chybu.
      const latest = await fetchXml(`${this.base}/okrsky/vysledky_okrsky.xml`);
      if (!latest || byTag(latest, "CHYBA").length) return;
      const davka = byTag(latest, "DAVKA")[0];
      const last = davka ? +davka.getAttribute("PORADI_DAVKY") : 0;
      if (!last || last < this.nextBatch) return;
      // Chybějící dávky se stahují po skupinách paralelně, ale zpracovávají v pořadí vzniku.
      while (this.nextBatch < last && !this.stopped) {
        const nums = [];
        for (let n = this.nextBatch; n < last && nums.length < PARALLEL; n++) nums.push(n);
        const docs = await Promise.all(
          nums.map((n) => fetchXml(`${this.base}/okrsky/vysledky_okrsky_${pad5(n)}.xml`))
        );
        for (let i = 0; i < docs.length; i++) {
          if (!docs[i]) throw new Error(`Dávka ${nums[i]} není dostupná`);
          if (!byTag(docs[i], "CHYBA").length) this.processBatch(docs[i]);
          this.nextBatch = nums[i] + 1;
        }
      }
      if (this.nextBatch === last) {
        this.processBatch(latest);
        this.nextBatch = last + 1;
      }
    }

    processBatch(doc) {
      const davka = byTag(doc, "DAVKA")[0];
      if (davka) this.lastBatchInfo = Object.assign(attrs(davka), {
        generovano: doc.documentElement.getAttribute("DATUM_CAS_GENEROVANI"),
      });
      for (const el of byTag(doc, "OKRSEK")) {
        const a = attrs(el);
        if (a.KODZASTUP !== this.kodzastup) continue;
        const cislo = +a.CIS_OKRSEK;
        if (!this.wanted.has(cislo)) continue;
        // čísla okrsků jsou v rámci Prahy jedinečná, stačí tedy KODZASTUP + číslo okrsku zvoleného území
        const poradi = +a.PORADI_ZPRAC;
        const prev = this.precincts[cislo];
        if (prev && prev.poradi >= poradi) continue;
        const u = attrs(byTag(el, "UCAST_OKRSEK")[0] || el);
        const s = {};
        for (const h of byTag(el, "HLASY_OKRSEK")) {
          const v = +h.getAttribute("HLASY");
          if (v) s[h.getAttribute("POR_STR_HLAS_LIST")] = v;
        }
        this.precincts[cislo] = {
          z: +u.ZAPSANI_VOLICI || 0,
          v: +u.VYDANE_OBALKY || 0,
          o: +u.ODEVZDANE_OBALKY || 0,
          h: +u.PLATNE_HLASY || 0,
          s,
          poradi,
          cas: a.DATUM_CAS_ZPRAC,
        };
      }
    }

    /** Zpracované okrsky ve formátu shodném se statickými daty ({ "6001": {z,v,o,h,s} }). */
    okrsky() {
      const o = {};
      for (const k of Object.keys(this.precincts).sort()) o[k] = this.precincts[k];
      return o;
    }
  }

  /**
   * Rozdělení mandátů podle § 45 zákona č. 491/2001 Sb., o volbách do zastupitelstev obcí:
   *  - do skrutinia nepostupují strany, které obdržely méně než 5 % z celkového počtu platných hlasů
   *    poděleného počtem volených členů zastupitelstva a vynásobeného počtem kandidátů strany;
   *    postoupí-li méně než 2 strany, hranice se snižuje vždy o 1 %, dokud nepostoupí alespoň 2,
   *  - hlasy postupujících stran se dělí čísly 1, 2, 3 … (tolikrát, kolik má strana kandidátů na hlasovacím
   *    lístku) a mandáty připadnou největším podílům; při rovnosti podílů rozhoduje vyšší celkový počet hlasů
   *    strany, je-li i ten stejný, los.
   * @param {Array<{id: string, hlasy: number, kandidatu?: number}>} strany  (kandidatu neznámý = plná kandidátka)
   * @param {number} pocet  počet volených členů zastupitelstva
   * @returns {{mandaty: Object<string, number>, hranice: number, podily: Array<{id, hlasy, delitel}>, dalsi: ?{id, hlasy, delitel}, los: boolean}|null}
   *   podily = přidělené podíly v pořadí, dalsi = první podíl, na který už mandát nezbyl, los = o posledním mandátu by rozhodl los
   */
  function rozdelMandaty(strany, pocet) {
    const celkem = strany.reduce((a, s) => a + s.hlasy, 0);
    if (!celkem || !pocet) return null;
    const kand = (s) => (s.kandidatu > 0 ? s.kandidatu : pocet);
    let hranice = 5, postup;
    for (;;) {
      // hlasy >= hranice % × celkem / pocet × kandidátů (celočíselně, bez zaokrouhlení)
      postup = strany.filter((s) => s.hlasy > 0 && s.hlasy * 100 * pocet >= hranice * celkem * Math.min(kand(s), pocet));
      if (postup.length >= 2 || hranice <= 0) break;
      hranice--;
    }
    const podily = [];
    for (const s of postup) for (let d = 1; d <= kand(s); d++) podily.push({ id: s.id, hlasy: s.hlasy, delitel: d });
    // a před b, má-li větší podíl (porovnání křížovým násobením), při rovnosti větší celkový počet hlasů
    const cmp = (a, b) => (b.hlasy * a.delitel - a.hlasy * b.delitel) || (b.hlasy - a.hlasy);
    podily.sort(cmp);
    const prid = podily.slice(0, pocet);
    const mandaty = {};
    for (const q of prid) mandaty[q.id] = (mandaty[q.id] || 0) + 1;
    const posl = prid[prid.length - 1], dalsi = podily[pocet] || null;
    return { mandaty, hranice, podily: prid, dalsi, los: !!(posl && dalsi && posl.id !== dalsi.id && cmp(posl, dalsi) === 0) };
  }

  LiveFeed.rozdelMandaty = rozdelMandaty;
  window.LiveFeed = LiveFeed;
})();
