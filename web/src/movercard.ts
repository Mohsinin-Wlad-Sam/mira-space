// A CONFIRMED MOVER'S CARD — what the map says about one object of the verified catalogue, shared by the 3D map and
// the sky map: its kind in plain words, what was checked on raw SPHEREx exposures, three real pictures on a slider,
// and, where the object is in no reference database, three buttons to say what one sees.
import { mountPastView } from "./pastview";

/** the verified catalogue's columns used by the maps (web/public/data/verified/objects.json) */
export type Ver = { glat: number[]; id: string[]; ra: number[]; dec: number[]; pm: number[]; pmra: number[]; pmdec: number[]; epm: number[]; conf: number[]; known: number[]; gaia: string[]; kind: string[];
  w12: (number | null)[]; methane: number[]; simbad: string[]; yr: number[]; dp: number[]; ds: number[]; n: number[] };
export const KIND_PLAIN: Record<string, string> = { "M dwarf": "Red dwarf star", "late M or L dwarf": "Very cool dwarf, at the edge between star and brown dwarf", "K dwarf": "Orange dwarf star", "F/G star": "Sun-like star",
  "white dwarf": "White dwarf: the Earth-sized core a dead star leaves", subdwarf: "Old, metal-poor star from the Galaxy's halo", "L dwarf": "Brown dwarf (type L): too small to shine as a star",
  "T dwarf": "Brown dwarf (type T): cold enough for methane, like Jupiter", "Y dwarf": "Brown dwarf (type Y): the coldest kind", "brown dwarf": "Brown dwarf: too small to shine as a star",
  "methane dwarf": "Methane dwarf: cold enough for methane, like Jupiter", "red: brown dwarf?": "Cold and red: possibly a brown dwarf", "cool dwarf?": "Cool dwarf star, not yet classified", unclassified: "Not yet classified" };
const REPO = (import.meta.env.VITE_MIRA_REPORT_URL as string | undefined) ?? "https://github.com/Mohsinin-Wlad-Sam/assrar-dawla/issues/new";
const VOTES = "mira.votes.v1";
export const votes = (): Record<string, { v: string; t: number; name: string }> => { try { return JSON.parse(localStorage.getItem(VOTES) ?? "{}"); } catch { return {}; } };

let verP: Promise<Ver | null> | null = null;
/** the verified catalogue, fetched once for every map */
/** What a neural ensemble estimates for a mover from its SPHEREx spectrum, its WISE colour and its motion (census/ai_phys.py, joined to
 *  the catalogue by census/ai_join.py): a distance with its range, a temperature, a kind. Estimates, each with its own uncertainty. */
export type Ai = { classes: string[]; d: (number | null)[]; dlo: (number | null)[]; dhi: (number | null)[]; teff: (number | null)[]; et: (number | null)[]; cls: number[]; p: (number | null)[];
  check: { with_an_estimate: number; no_gaia_source_with_an_estimate: number; distance_on_tiles_never_trained_on: { n: number; scatter_percent: number; within_its_own_error: number }; kind: { known_L_and_T_dwarfs: number; called_brown_dwarf: number } } };
export let ai: Ai | null = null; let aiP: Promise<Ai | null> | null = null;
export const loadAi = (base: string) => (aiP ??= fetch(`${base}data/verified/ai.json`).then((r) => (r.ok ? r.json() : null)).then((j: Ai | null) => (ai = j), () => null));
const LY = 3.2616, lyText = (pc: number) => { const v = pc * LY; return v >= 100 ? Math.round(v).toLocaleString("en-US") : v.toFixed(v < 20 ? 1 : 0); };
export const aiOf = (k: number) => { if (!ai || k < 0 || ai.d[k] === null || ai.d[k] === undefined || ai.cls[k] < 0) return null; const c = ai.cls[k];
  return { kind: ai.classes[c], sure: ai.p[k] ?? 0, teff: c <= 2 ? ai.teff[k] : null, et: ai.et[k], pc: ai.d[k]!, ly: lyText(ai.d[k]!), lo: lyText(ai.dlo[k]!), hi: lyText(ai.dhi[k]!) }; };
export const aiLine = (V: Ver, k: number) => { const a = aiOf(k); if (!a) return "";
  return `<div class="sp-ai"><b>AI estimate</b> ${a.kind}${a.sure < 0.8 ? ", unsure" : ""}${a.teff ? ` · about ${a.teff.toLocaleString("en-US")} K` : ""} · ${a.ly} light-years <span>(${a.lo} to ${a.hi})</span><small>Read from its SPHEREx spectrum by a neural network${V.known[k] === 0 ? "; Gaia has no distance for this one" : ""}. An estimate, not a measurement. <a href="/docs/#ai" target="_blank" rel="noopener">How good is it?</a></small></div>`; };
export const loadVerified = (base: string) => (verP ??= Promise.all([fetch(`${base}data/verified/objects.json`).then((r) => (r.ok ? r.json() : null)), loadAi(base)]).then(([j]) => (j?.cols as Ver) ?? null, () => null));
/** away from the crowded Galactic plane, no Gaia source, no SIMBAD entry: an object a visitor can help look at */
export const isOpenCase = (V: Ver, k: number) => V.known[k] === 0 && !V.simbad[k] && Math.abs(V.glat[k]) >= 10;
/** a confirmed mover goes by its SIMBAD name, its Gaia designation, or by none */
const GREEK: Record<string, string> = { alf: "Alpha", bet: "Beta", gam: "Gamma", del: "Delta", eps: "Epsilon", zet: "Zeta", eta: "Eta", tet: "Theta", iot: "Iota", kap: "Kappa", lam: "Lambda", "mu.": "Mu", "nu.": "Nu", ksi: "Xi",
  omi: "Omicron", "pi.": "Pi", rho: "Rho", sig: "Sigma", tau: "Tau", ups: "Upsilon", phi: "Phi", chi: "Chi", psi: "Psi", ome: "Omega" };
/** a SIMBAD identifier as a person would write it: "* eps Ind B" -> "Epsilon Ind B", "NAME Barnard's star" -> "Barnard's star" */
export const cleanName = (s: string) => { const bayer = /^\* /.test(s), t = s.replace(/^(NAME|\*\*|V\*|EM\*|\*) +/, "").replace(/ \(.*$/, "").replace(/\s+/g, " ").trim();
  return bayer ? t.replace(/^([a-z]{2,3}\.?)(\d{0,2})(?= )/, (m, g, n) => (GREEK[g] ? GREEK[g] + (n ? " " + +n : "") : m)) : t; };
export const moverName = (V: Ver, k: number) => cleanName(V.simbad[k]) || (V.known[k] === 1 && V.gaia[k] ? `Gaia DR3 ${V.gaia[k]}` : `Unnamed mover ${V.id[k]}`);
export const moonYears = (V: Ver, k: number) => Math.round(1800 / Math.max(V.pm[k], 1e-3)).toLocaleString();
export const gaiaLine = (V: Ver, k: number) => (V.known[k] === 1 ? "Gaia, Europe's star-mapping satellite, lists the same motion." : V.known[k] === 0 ? "Gaia, Europe's optical star-mapping satellite, lists nothing at this place." : "Gaia lists a source here, but not this motion.");
/** the evidence, in one paragraph */
/** the sky model's own look at the whole sky (census/wm2_run.py): its test figures, what it marks, and for every catalogue star whether it marks it too */
export type Scout = { threshold: number; copies: { weights_millions: number }[]; test: { n: number; recall: number; false_per_sqdeg: number; pm_err_median: number | null; by_pm: { lo: number; hi: number; n: number; recall: number }[] };
  test_forecast?: { recall: number; by_pm: { lo: number; hi: number; n: number; recall: number }[] }; comparison?: Record<string, { patches: number; with_a_real_mover: number; vjepa2_probe_auc: number; vjepa2_surprise_auc: number; mira_auc: number }> | null;
  sky: { tiles: number; marks: number; marks_on_catalogue_stars: number; marks_in_the_galactic_plane: number; marks_elsewhere: number }; objects: { id: string[]; conf: number[]; pm: number[] }; marks: { ra: number; dec: number; conf: number; pm: number; pa: number; glat: number; vj?: number; gaia?: { pm: number; g: number | null; id: string } | null; simbad?: { name: string; kind: string; pm: number; sp: string | null }; lab?: { verdict: string; pm: number | null; epm: number | null; gaia_pm: number | null } }[];
  /** the marks checked against ESA's Gaia DR3: how many have a fast-moving star at their place */
  gaia_check?: { asked: number; with_a_gaia_fast_mover: number; without: number; radius_arcsec: number; min_pm_arcsec_yr: number; model_motion_error_median: number | null; with_a_simbad_fast_mover?: number; known_fast_movers?: number; open?: number; lab_measured?: number; lab_confirmed_and_in_gaia?: number; lab_tally?: Record<string, number> } | null;
  /** Meta's V-JEPA 2 after fine-tuning on MIRA's examples: its score on the test sky, and how many of the marks it also calls movers */
  vjepa_finetuned?: { auc_test: number; patches?: number; marks_scored?: number; marks_agree?: number; scorer_auc_test?: number } | null };
let scoutP: Promise<Scout | null> | null = null, scout: Scout | null = null, scoutIdx: Map<string, number> | null = null;
export const loadScout = (base: string) => (scoutP ??= fetch(`${base}data/wm/scout.json`).then((r) => (r.ok ? r.json() : null)).then((j: Scout | null) => { scout = j; if (j) scoutIdx = new Map(j.objects.id.map((id, i) => [id, i])); return j; }, () => null));
/** one sentence for a star's card: does the model, shown only three pictures of the patch, mark it too? */
export const scoutLine = (V: Ver, k: number) => { const i = scout && scoutIdx ? scoutIdx.get(V.id[k]) : undefined; if (!scout || i === undefined) return "";
  return scout.objects.conf[i] >= scout.threshold ? `<div class="sp-wm"><b>The sky model marks it too.</b> A neural network shown only three pictures of this patch of sky (1999, 2010, 2025) points at this star by itself and reads about ${scout.objects.pm[i].toFixed(2)}″ per year.</div>`
    : V.pm[k] >= 0.6 ? `<div class="sp-wm off">The sky model does not mark this one. It works on the all-sky pictures (13″ pixels), where this star's shift is small.</div>` : ""; };
export const evidenceHTML = (V: Ver, k: number) => `${scoutLine(V, k)}<div class="sp-ver"><b>Caught moving: ${V.pm[k].toFixed(2)}″ per year.</b> Checked on ${V.n[k]} raw SPHEREx exposures: it sits ${V.dp[k].toFixed(1)}″ from where this motion predicts and ${V.ds[k].toFixed(1)}″ from where it would be had it stood still. ${gaiaLine(V, k)}</div>${aiLine(V, k)}`;
export const PICS_HTML = `<div class="sp-pics"><div class="eyebrow">Three real NASA pictures: about 1999, 2010, and SPHEREx today</div><div id="sppv"></div></div>`;
export const VOTE_HTML = `<div class="sp-vote" id="spvote"><b>Take part <small>(prototype)</small>.</b> This object is in the WISE catalogues but has no entry in SIMBAD, astronomy's reference database, and no Gaia source. Use the slider above: is there a dot inside the circle in 2010, and again in SPHEREx's picture?
        <div class="sp-vbtn"><button data-v="moves">Yes, it follows</button><button data-v="unsure">I can't tell</button><button data-v="no">No dot there</button></div><small id="spvmsg"></small></div>`;

/** Is this site collecting answers (the optional server process is running)? Then an answer is sent there, with no
 *  account and nothing about the visitor, and the tally of everyone's answers is shown. Otherwise it stays on the device. */
let answersApi: Promise<boolean> | null = null;
const answersOn = () => (answersApi ??= fetch("/api/answers").then((r) => (r.ok ? r.json() : null)).then((j) => !!j?.ok, () => false));
const tallyText = (t: { moves: number; unsure: number; no: number } | null | undefined) => { const n = t ? t.moves + t.unsure + t.no : 0;
  return n ? `All visitors so far (${n}): ${t!.moves} saw it follow · ${t!.unsure} could not tell · ${t!.no} saw no dot.` : "No answer yet for this object."; };
/** the "send as a public note" link is offered only where that public place can actually be reached */
let reportOpenP: Promise<boolean> | null = null;
const reportOpen = () => (reportOpenP ??= (() => { const m = REPO.match(/^https:\/\/github\.com\/([^/]+\/[^/]+)\/issues\/new/); if (!m) return Promise.resolve(true);
  return fetch(`https://api.github.com/repos/${m[1]}`).then((r) => r.ok, () => false); })());

/** the take-part buttons of a card: the answer is kept on the device, sent to the site's endpoint when one is running
 *  (no account), and everyone's tally is shown */
export function wireVote(el: HTMLElement, vid: string, label: string, ctx: { poolIds: () => string[]; next: () => void }) {
  const vb = el.querySelector("#spvote") as HTMLElement | null; if (!vb) return;
  const msg = el.querySelector("#spvmsg") as HTMLElement;
  const show = (sentTally?: { moves: number; unsure: number; no: number }) => {
    const v = votes(), mine = v[vid], ids = ctx.poolIds(), seen = ids.filter((q) => v[q]).length;
    vb.querySelectorAll<HTMLButtonElement>(".sp-vbtn button").forEach((b) => b.classList.toggle("on", mine?.v === b.dataset.v));
    const next = `You have looked at <b>${seen} of ${ids.length.toLocaleString()}</b>. <button class="link" id="spvnext">Next one</button>`;
    // first as if nothing is collected here; completed below if this site runs the answers endpoint
    msg.innerHTML = mine ? `<span id="spvwhere">Saved on this device.</span> ${next}<span id="spvlocal"> · <button class="link" id="spvcopy">Copy my answers</button><a class="link" id="spvsend" target="_blank" rel="noopener" hidden> · Send them as a public note</a></span><br><span id="spvtally"></span><span id="spvhow">Prototype: nothing is collected here automatically.</span>`
      : `<span id="spvtally"></span>No account is needed and nothing about you is kept.`;
    const q = <T extends HTMLElement>(sel: string) => msg.querySelector(sel) as T | null;
    const nx = q("#spvnext"); if (nx) nx.onclick = ctx.next;
    const lines = Object.entries(v).slice(-40).map(([id, a]) => `${id} | ${a.v} | ${a.name}`), cp = q("#spvcopy"), sd = q<HTMLAnchorElement>("#spvsend");
    if (cp) cp.onclick = () => { const t = `MIRA map: is there a dot in the circle in the 2010 and SPHEREx pictures?\nid | answer | label\n${lines.join("\n")}`; (navigator.clipboard?.writeText(t) ?? Promise.reject()).then(() => (cp.textContent = "Copied"), () => (cp.textContent = "Copying is not allowed here")); };
    answersOn().then((on) => {
      if (!msg.isConnected) return;
      if (!on) { if (sd) { sd.href = `${REPO}?title=${encodeURIComponent(`Visitor answers on ${lines.length} objects`)}&body=${encodeURIComponent(`Sent from the MIRA map. For each object: is there a dot in the circle in the 2010 and SPHEREx pictures?\n\nid | answer | label\n${lines.join("\n")}`)}`; reportOpen().then((ok) => { sd.hidden = !ok; }); } return; }
      const tl = q("#spvtally"), where = q("#spvwhere"), how = q("#spvhow"), loc = q("#spvlocal");
      if (where) where.textContent = "Sent: no account, nothing about you kept."; if (loc) loc.hidden = true;
      if (how) how.textContent = "A person on the team reads the answers; objects on which several visitors agree go first for a deep analysis.";
      if (tl && sentTally) tl.textContent = tallyText(sentTally) + " ";
      else if (tl) fetch(`/api/answers?ids=${vid}`).then((r) => r.json()).then((j) => { if (msg.contains(tl)) tl.textContent = tallyText(j?.tallies?.[vid]) + " "; }).catch(() => {});
    });
  };
  vb.querySelectorAll<HTMLButtonElement>(".sp-vbtn button").forEach((b) => (b.onclick = () => {
    const v = votes(), prev = v[vid]?.v, ans = b.dataset.v!; if (prev === ans) return;
    v[vid] = { v: ans, t: Date.now(), name: label }; try { localStorage.setItem(VOTES, JSON.stringify(v)); } catch { /* private mode: the answer lasts for this page only */ }
    show();
    answersOn().then((on) => { if (on) fetch("/api/answers", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: vid, v: ans, prev }) }).then((r) => r.json()).then((j) => { if (j?.tally) show(j.tally); }).catch(() => {}); });
  }));
  show();
}

export type CardCtx = { /** the sentence that opens the card (distance, or why there is none) */ lead: string; poolIds: () => string[]; next: () => void; onClose: () => void;
  /** open the deep analysis (the Lab) on this object */ onObserve?: (t: { ra: number; dec: number; pmra: number; pmdec: number; epoch: number; name: string }) => void;
  /** more buttons after "Deep analysis": [label, title, handler] */ more?: [string, string, () => void][]; /** ask the assistant to explain this card */ onExplain?: (question: string) => void; autoplay?: boolean };
/** A whole card for one object of the verified catalogue, from that catalogue alone. Returns what to call when it is replaced. */
export function mountMoverCard(el: HTMLElement, V: Ver, k: number, ctx: CardCtx): () => void {
  const vid = V.id[k], name = moverName(V, k);
  el.classList.add("ver", "hud");
  el.innerHTML = `<button class="icon-btn" id="spiclose" aria-label="Close">✕</button>
    <div class="eyebrow">${KIND_PLAIN[V.kind[k]] ?? V.kind[k]}</div>
    <h3 class="display">${name}</h3>
    <p class="sp-lead">${ctx.lead}</p>
    ${evidenceHTML(V, k)}
    ${PICS_HTML}
    ${isOpenCase(V, k) ? VOTE_HTML : ""}
    <div class="actions">${ctx.onObserve ? `<button class="btn sm solid" id="spobs" title="Read the SPHEREx exposures of this object and run the instruments on it">Deep analysis in the Lab</button>` : ""}
      ${ctx.onExplain ? `<button class="btn sm ghost" id="spexplain" title="Ask the assistant to explain this object in everyday words">Explain it to me</button>` : ""}
      ${(ctx.more ?? []).map(([t, tip], q) => `<button class="btn sm ghost" data-more="${q}" title="${tip}">${t}</button>`).join("")}</div>`;
  el.classList.add("open");
  (el.querySelector("#spiclose") as HTMLElement).onclick = ctx.onClose;
  wireVote(el, vid, name, ctx);
  const pv = mountPastView(el.querySelector("#sppv") as HTMLElement, { ra: V.ra[k], dec: V.dec[k], pmra: V.pmra[k], pmdec: V.pmdec[k], epoch: V.yr[k] }, { autoplay: ctx.autoplay });
  const ob = el.querySelector("#spobs") as HTMLElement | null; if (ob) ob.onclick = () => ctx.onObserve!({ ra: V.ra[k], dec: V.dec[k], pmra: V.pmra[k], pmdec: V.pmdec[k], epoch: V.yr[k], name });
  const ex = el.querySelector("#spexplain") as HTMLElement | null; if (ex) ex.onclick = () => ctx.onExplain!(`Explain ${name} to me in everyday words: what it is, how we know it moved, and why it matters.`);
  el.querySelectorAll<HTMLButtonElement>("[data-more]").forEach((b) => (b.onclick = ctx.more![+b.dataset.more!][2]));
  return () => { pv.destroy(); el.classList.remove("ver", "hud"); };
}
