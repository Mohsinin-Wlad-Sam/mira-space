// LOGBOOK — the visitor's own data. Observations they saved, with the instrument readouts and their notes; lists of
// targets they brought; the open cases of the survey they have judged. Everything lives in this browser
// (localStorage), leaves as a file (JSON or CSV) and comes back from one: no account, nothing stored by MIRA.
// When NASA releases new SPHEREx data, entries whose place has new exposures are marked.
import { findExposures, chooseExposures, build, mjdToDate, PIX_ARCSEC, type Target } from "./blink/engine";
import { analyzeFrames, answerMove, answerChange, answerMade, type Answer } from "./blink/answers";
import { parseCoords, resolveName, CHALLENGE } from "./blink/catalogs";
import type { BlinkTarget, Snapshot } from "./blink/view";
import { sexa } from "./data";

const KEY = "mira.logbook.v1", BASE = import.meta.env.BASE_URL;
type Brief = { chip: string; text: string };
export type LogEntry = { id: string; name: string; ra: number; dec: number; pmra?: number; pmdec?: number; epoch?: number; otype?: string; plx?: number; source?: string;
  savedAt: string; note: string; verdict: string; thumb?: string; answers?: Record<"move" | "change" | "made", Brief> | null; frames?: number; covered?: number; lastMjd?: number; size?: number; kind: "saved" | "list" | "case" };
export type LogCtx = { onObserve: (t: BlinkTarget | string) => void; toast: (m: string) => void };

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
export function loadLog(): LogEntry[] { try { const L = JSON.parse(localStorage.getItem(KEY) || "[]"); return Array.isArray(L) ? L : []; } catch { return []; } }
function storeLog(L: LogEntry[]) { try { localStorage.setItem(KEY, JSON.stringify(L)); } catch { /* private mode or quota: the page keeps working, the entry is not kept */ } }
const idOf = (ra: number, dec: number) => `${ra.toFixed(4)}${dec >= 0 ? "+" : ""}${dec.toFixed(4)}`;
function upsert(e: LogEntry) { const L = loadLog(), k = L.findIndex((x) => x.id === e.id); if (k >= 0) L[k] = { ...L[k], ...e, note: e.note || L[k].note, verdict: e.verdict || L[k].verdict }; else L.unshift(e); storeLog(L); }
/** called by Observe's "Save to logbook" */
export function saveSnapshot(s: Snapshot) {
  const t = s.target;
  upsert({ id: idOf(t.ra, t.dec), name: t.name ?? sexa(s.center[0], s.center[1]), ra: t.ra, dec: t.dec, pmra: t.pmra, pmdec: t.pmdec, epoch: t.epoch, otype: t.otype, plx: t.plx, source: t.source,
    savedAt: new Date().toISOString(), note: "", verdict: "", thumb: s.thumb, answers: s.answers, frames: s.frames, covered: s.covered, lastMjd: s.lastMjd, size: s.size, kind: "saved" });
}
const targetOf = (e: LogEntry): BlinkTarget => ({ ra: e.ra, dec: e.dec, pmra: e.pmra, pmdec: e.pmdec, epoch: e.epoch, name: /^\d\dh/.test(e.name) ? undefined : e.name, otype: e.otype, plx: e.plx, source: e.source });
function download(text: string, name: string, type: string) { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); }
const brief = (a: Answer): Brief => ({ chip: a.chip, text: `${a.big}${a.unit ? ` ${a.unit}` : ""} — ${a.label}` });

const VERDICTS: [string, string][] = [["", "no verdict yet"], ["real", "looks real"], ["moving", "moves"], ["variable", "varies"], ["artifact", "artifact or blend"], ["nothing", "nothing there"], ["follow", "needs follow-up"]];

export function mountLogbook(host: HTMLElement, ctx: LogCtx) {
  let tab: "mine" | "cases" = "mine", checked = new Map<string, any>(), cases: any[] | null = null, ac: AbortController | null = null, fresh = new Map<string, { n: number; last: number }>();
  host.innerHTML = `<div class="lg">
    <div class="lg-top"><div><div class="eyebrow">Cases · your saved measurements</div><h2 class="display">Your cases</h2>
      <p class="lg-sub">What you save stays in this browser: MIRA has no accounts and keeps nothing. Take it with you as a file, bring it back on any device, or hand it to a colleague.</p></div>
      <div class="lg-acts"><button class="btn sm" id="lgadd">Add a list of targets</button><button class="btn sm ghost" id="lgexp">Export</button><label class="btn sm ghost" for="lgfile">Import</label><input type="file" id="lgfile" accept=".json,application/json" hidden></div></div>
    <div class="lg-addbox" id="lgaddbox" hidden>
      <p>One name or position per line (up to 15). MIRA measures each in turn — about 15 seconds apiece — and files the instrument readings here.</p>
      <textarea id="lgq" rows="6" spellcheck="false" placeholder="Luhman 16&#10;Wolf 359&#10;331.0965 -56.8007&#10;08h55m10.83s -07d14m42.5s"></textarea>
      <div class="lg-row"><button class="btn sm" id="lgrun">Measure them all</button><button class="btn sm ghost" id="lgcancel">Close</button><span class="mono" id="lgprog"></span></div></div>
    <div class="bk-modes lg-tabs" role="tablist"><button data-t="mine">My cases <span id="lgn"></span></button><button data-t="cases">Survey candidates <span id="lgc"></span></button></div>
    <div id="lgbody"></div></div>`;
  const $ = <T extends HTMLElement>(q: string) => host.querySelector(q) as T;

  function card(e: LogEntry) {
    const nw = fresh.get(e.id), more = nw && e.lastMjd && nw.last > e.lastMjd + 0.5;
    const A = e.answers, line = (k: "made" | "change" | "move", ins: string) => (A?.[k] ? `<li><span>${ins}</span><em class="tag neutral">${esc(A[k].chip)}</em><b>${esc(A[k].text)}</b></li>` : "");
    return `<article class="lg-card" data-id="${esc(e.id)}">
      <div class="lg-thumb">${e.thumb ? `<img src="${e.thumb}" alt="" width="112" height="112">` : `<span>${e.kind === "case" ? "case" : "no picture"}</span>`}</div>
      <div class="lg-main"><div class="eyebrow">${esc(e.otype ?? (e.kind === "case" ? "open case" : "saved place"))}${more ? ` · <span class="lg-new">new NASA data through ${mjdToDate(nw!.last)}</span>` : ""}</div>
        <h3 class="display">${esc(e.name)}</h3>
        <div class="mono lg-coord">${sexa(e.ra, e.dec)} · saved ${e.savedAt.slice(0, 10)}${e.frames ? ` · ${e.frames} exposures` : ""}</div>
        ${A ? `<ul class="lg-ans">${line("made", "Spectrograph")}${line("change", "Photometer")}${line("move", "Astrometer")}</ul>` : ""}
        <textarea class="lg-note" placeholder="Your note…" rows="2">${esc(e.note)}</textarea></div>
      <div class="lg-side"><button class="btn sm" data-a="obs">${more ? "Observe again" : "Observe"}</button>
        <select data-a="verdict" aria-label="Your verdict">${VERDICTS.map(([v, l]) => `<option value="${v}"${e.verdict === v ? " selected" : ""}>${l}</option>`).join("")}</select>
        <button class="link" data-a="del">remove</button></div></article>`;
  }
  function renderMine() {
    const L = loadLog(), body = $("#lgbody");
    $("#lgn").textContent = L.length ? `(${L.length})` : "";
    body.innerHTML = L.length ? `<div class="lg-list">${L.map(card).join("")}</div>` : `<div class="lg-empty"><b>Nothing here yet.</b>
      <p>Measure a field in the Lab and press <b>Save as a case</b>, add a list of targets above, or examine one of the survey's candidates.</p>
      <div class="lg-row"><button class="btn sm" id="lgfirst">Measure ε Indi B, a brown dwarf 12 light-years away</button><button class="btn sm ghost" id="lgcases">See the survey candidates</button></div></div>`;
    host.querySelector<HTMLElement>("#lgfirst")?.addEventListener("click", () => ctx.onObserve("eps-indi-b"));
    host.querySelector<HTMLElement>("#lgcases")?.addEventListener("click", () => { tab = "cases"; render(); });
    body.querySelectorAll<HTMLElement>(".lg-card").forEach((c) => { const id = c.dataset.id!, get = () => loadLog().find((x) => x.id === id);
      (c.querySelector('[data-a="obs"]') as HTMLElement).onclick = () => { const e = get(); if (e) ctx.onObserve(targetOf(e)); };
      (c.querySelector('[data-a="del"]') as HTMLElement).onclick = () => { storeLog(loadLog().filter((x) => x.id !== id)); render(); };
      (c.querySelector('[data-a="verdict"]') as HTMLSelectElement).onchange = (ev) => { const L2 = loadLog(), e = L2.find((x) => x.id === id); if (e) { e.verdict = (ev.target as HTMLSelectElement).value; storeLog(L2); } };
      (c.querySelector(".lg-note") as HTMLTextAreaElement).onchange = (ev) => { const L2 = loadLog(), e = L2.find((x) => x.id === id); if (e) { e.note = (ev.target as HTMLTextAreaElement).value; storeLog(L2); } }; });
  }
  /** the survey's unconfirmed brown-dwarf candidates: nobody has looked at them one by one */
  function renderCases() {
    const body = $("#lgbody");
    if (!cases) { body.innerHTML = `<div class="lg-empty">Loading the survey candidates…</div>`;
      Promise.all([fetch(`${BASE}data/candidates.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null), fetch(`${BASE}data/verified/candidates.json`).then((r) => (r.ok && !(r.headers.get("content-type") ?? "").includes("html") ? r.json() : null)).catch(() => null)]).then(([j, v]) => {
        cases = j?.items ?? []; checked = new Map(((v?.items ?? []) as any[]).map((q) => [q.id, q])); $("#lgc").textContent = cases!.length ? `(${cases!.length})` : ""; if (tab === "cases") renderCases(); });
      return; }
    if (!cases.length) { body.innerHTML = `<div class="lg-empty">The list of survey candidates is not available on this deployment.</div>`; return; }
    const mine = new Map(loadLog().map((e) => [e.id, e]));
    const nOk = [...checked.values()].filter((q) => q.tags?.includes("MOVED")).length;
    body.innerHTML = `<p class="lg-intro">The survey of 16 years of infrared sky singled out <b>${cases.length} objects</b> that look like cold, nearby brown dwarfs — they move, or show a methane dip — and have no identification among known brown dwarfs (the same search recovers 125 known ones). ${checked.size ? `Each was then put through the Lab's motion detector on raw SPHEREx exposures: <b>${nOk} of ${checked.size}</b> show a motion above 5σ over 15 to 27 years. NASA's CatWISE2020 catalogue lists ${[...checked.values()].filter((q) => q.catwise).length} of them as moving sources with the same motion, and ${[...checked.values()].filter((q) => q.simbad).length} have an entry in SIMBAD, none with a measured spectral type: what MIRA adds is a new epoch and a 0.75–5 µm spectrum.` : ""} They are candidates, not discoveries: open one in the Lab, look at its track and its spectrum, and record your verdict.</p>
      <div class="lg-list">${cases.map((it: any, k: number) => { const id = idOf(it.ra_sx, it.dec_sx), e = mine.get(id), mu = Math.hypot(it.pmra ?? 0, it.pmdec ?? 0);
        const q = checked.get(`${it.tile}-${it.obj}`), ok = q?.tags?.includes("MOVED");
        const chk = !q ? "" : !q.detected ? `<em class="tag off">not detected</em> not seen on the raw exposures` : ok ? `<em class="tag pos">motion confirmed</em> ${Math.hypot(q.pm.ra, q.pm.dec).toFixed(3)} ± ${q.pm.err.toFixed(3)}″/yr over ${q.pm.baseline.toFixed(0)} yr (${q.pm.sigma.toFixed(0)}σ)`
          : q.pm ? `<em class="tag warn">not confirmed</em> ${Math.hypot(q.pm.ra, q.pm.dec).toFixed(3)} ± ${q.pm.err.toFixed(3)}″/yr (${q.pm.sigma.toFixed(1)}σ)${q.tags?.length ? ` · ${q.tags.join(", ").toLowerCase()}` : ""}` : `<em class="tag warn">not measured</em>`;
        return `<article class="lg-case" data-k="${k}"><span class="mono lg-k">${String(k + 1).padStart(2, "0")}</span>
          <div class="lg-main"><b class="mono">${sexa(it.ra_sx, it.dec_sx)}</b><span>${it.moving ? `survey: moves ${mu.toFixed(2)}″ a year · ` : ""}${it.has_methane ? "methane dip · " : ""}AI estimate: about ${(it.ai_dist * 3.2616).toFixed(0)} light-years, ${Math.round(it.ai_teff / 10) * 10} K${it.gaia_dist ? ` · Gaia sees it at ${(it.gaia_dist * 3.2616).toFixed(0)} light-years` : ""}</span>
            ${q ? `<span class="lg-chk">${chk}${q.catwise ? ` · ${esc(q.catwise.name)}: ${Math.hypot(q.catwise.pmra, q.catwise.pmdec).toFixed(3)}″/yr` : ""}${q.ch4 !== null && q.ch4 !== undefined ? ` · 3.3/4.0 µm flux ratio ${q.ch4}` : ""} · ${q.simbad ? `SIMBAD: ${esc(q.simbad)}` : "no SIMBAD entry"}</span>` : ""}</div>
          <select aria-label="Your verdict">${VERDICTS.map(([v, l]) => `<option value="${v}"${e?.verdict === v ? " selected" : ""}>${l}</option>`).join("")}</select>
          <button class="btn sm">Open in the Lab</button></article>`; }).join("")}</div>`;
    body.querySelectorAll<HTMLElement>(".lg-case").forEach((c) => { const it = cases![+c.dataset.k!], k = +c.dataset.k!;
      const t: BlinkTarget = { ra: it.ra_sx, dec: it.dec_sx, pmra: it.reliable_motion ? it.pmra : 0, pmdec: it.reliable_motion ? it.pmdec : 0, epoch: 2025.84, name: `Candidate ${String(k + 1).padStart(2, "0")}`, otype: "possible brown dwarf · unconfirmed", source: "MIRA survey, WISE 2010–2020" };
      (c.querySelector("button") as HTMLElement).onclick = () => ctx.onObserve(t);
      (c.querySelector("select") as HTMLSelectElement).onchange = (ev) => { const v = (ev.target as HTMLSelectElement).value;
        upsert({ id: idOf(t.ra, t.dec), name: t.name!, ra: t.ra, dec: t.dec, pmra: t.pmra, pmdec: t.pmdec, epoch: t.epoch, otype: t.otype, source: t.source, savedAt: new Date().toISOString(), note: "", verdict: v, kind: "case" });
        $("#lgn").textContent = `(${loadLog().length})`; }; });
  }
  function render() {
    host.querySelectorAll<HTMLElement>(".lg-tabs button").forEach((b) => b.classList.toggle("on", b.dataset.t === tab));
    if (tab === "mine") renderMine(); else renderCases();
  }
  /** has NASA released exposures of these places since they were saved? (one small index file per entry) */
  async function checkFresh() {
    for (const e of loadLog().slice(0, 40)) {
      if (!e.lastMjd) continue;
      try { const idx = await findExposures(e.ra, e.dec), { cover } = chooseExposures(idx.exposures, targetOf(e) as Target, 9999); if (cover.length) fresh.set(e.id, { n: cover.length, last: cover[cover.length - 1].mjd }); } catch { /* index unavailable */ }
    }
    if (tab === "mine" && [...fresh.entries()].some(([id, v]) => { const e = loadLog().find((x) => x.id === id); return e?.lastMjd && v.last > e.lastMjd + 0.5; })) renderMine();
  }
  /** run a list of names / positions through the telescope, one after another */
  async function runList() {
    const lines = ($("#lgq") as HTMLTextAreaElement).value.split("\n").map((x) => x.trim()).filter(Boolean).slice(0, 15); if (!lines.length) return;
    ac?.abort(); ac = new AbortController(); const my = ac, prog = $("#lgprog"), N = 32; let done = 0, failed = 0;
    for (const q of lines) {
      if (my.signal.aborted) return;
      prog.textContent = `${done + 1} of ${lines.length} · ${q}`;
      try {
        const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9]/g, ""), ch = CHALLENGE.find((c) => norm(c.name) === norm(q) || c.key === q), xy = parseCoords(q);
        const t: BlinkTarget | null = ch ? { ...ch } : xy ? { ra: xy[0], dec: xy[1] } : await resolveName(q).catch(() => null);
        if (!t) { failed++; done++; continue; }
        const b = await build(t, { size: N, maxFrames: 72, concurrency: 6, signal: my.signal });
        if (!b.frames.length) { failed++; done++; continue; }
        const A = analyzeFrames(b.frames, N, b.center, { dx: 0, dy: 0 }, true);
        upsert({ id: idOf(t.ra, t.dec), name: t.name ?? sexa(b.center[0], b.center[1]), ra: t.ra, dec: t.dec, pmra: t.pmra, pmdec: t.pmdec, epoch: t.epoch, otype: t.otype, plx: t.plx, source: t.source, savedAt: new Date().toISOString(), note: "", verdict: "",
          answers: { move: brief(answerMove(A, t)), change: brief(answerChange(A)), made: brief(answerMade(A)) }, frames: b.frames.length, covered: b.covered, lastMjd: b.frames[b.frames.length - 1].mjd, size: N, kind: "list" });
        if (tab === "mine") renderMine();
      } catch (e) { if ((e as Error).name === "AbortError") return; failed++; }
      done++;
    }
    prog.textContent = `Done: ${done - failed} observed${failed ? `, ${failed} not found or not covered` : ""}.`;
  }

  host.querySelectorAll<HTMLButtonElement>(".lg-tabs button").forEach((b) => (b.onclick = () => { tab = b.dataset.t as "mine" | "cases"; render(); }));
  $("#lgadd").onclick = () => { const bx = $("#lgaddbox"); bx.hidden = !bx.hidden; if (!bx.hidden) ($("#lgq") as HTMLTextAreaElement).focus(); };
  $("#lgcancel").onclick = () => { ac?.abort(); $("#lgaddbox").hidden = true; };
  $("#lgrun").onclick = runList;
  $("#lgexp").onclick = () => { const L = loadLog(); if (!L.length) { ctx.toast("No case saved yet"); return; }
    download(JSON.stringify({ format: "mira-logbook", version: 1, exported: new Date().toISOString(), field_arcmin_per_32px: +((32 * PIX_ARCSEC) / 60).toFixed(2), entries: L }, null, 1), `mira_logbook_${new Date().toISOString().slice(0, 10)}.json`, "application/json");
    const rows = ["name,ra_deg,dec_deg,pmra_arcsec_yr,pmdec_arcsec_yr,saved_utc,exposures,spectrograph,photometer,astrometer,verdict,note"];
    for (const e of L) rows.push([e.name, e.ra, e.dec, e.pmra ?? "", e.pmdec ?? "", e.savedAt, e.frames ?? "", e.answers?.made.text ?? "", e.answers?.change.text ?? "", e.answers?.move.text ?? "", e.verdict, e.note].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","));
    download(rows.join("\n") + "\n", `mira_logbook_${new Date().toISOString().slice(0, 10)}.csv`, "text/csv"); };
  ($("#lgfile") as HTMLInputElement).onchange = async (ev) => { const f = (ev.target as HTMLInputElement).files?.[0]; if (!f) return;
    try { const j = JSON.parse(await f.text()), L: LogEntry[] = Array.isArray(j) ? j : j.entries; if (!Array.isArray(L)) throw new Error("not a logbook file");
      let n = 0; for (const e of L) if (e && isFinite(e.ra) && isFinite(e.dec)) { upsert({ ...e, id: e.id ?? idOf(e.ra, e.dec), name: String(e.name ?? sexa(e.ra, e.dec)), savedAt: e.savedAt ?? new Date().toISOString(), note: e.note ?? "", verdict: e.verdict ?? "", kind: e.kind ?? "saved" }); n++; }
      ctx.toast(`${n} entries imported`); render(); } catch { ctx.toast("That file is not a MIRA cases file"); }
    (ev.target as HTMLInputElement).value = ""; };
  render(); checkFresh();
  Promise.all([fetch(`${BASE}data/candidates.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null), fetch(`${BASE}data/verified/candidates.json`).then((r) => (r.ok && !(r.headers.get("content-type") ?? "").includes("html") ? r.json() : null)).catch(() => null)]).then(([j, v]) => {
    if (v?.items) checked = new Map((v.items as any[]).map((q) => [q.id, q]));
    if (j?.items) { cases = j.items; $("#lgc").textContent = `(${j.items.length})`; if (tab === "cases") renderCases(); } });
  return { refresh: render };
}
