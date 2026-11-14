// MIRA Lab — a standalone page: pick an experiment, run it on the real census data, read the verdict.
// Everything runs in the browser on the 3D catalogue (data/space/*.bin) and JPL planet orbits.
import * as THREE from "three";
import { AU, PLANETS, planetPos, ecl2gal } from "./bodies";
import { planetx, parallax, hunt, batch, type LabCtx } from "./labpro";

const BASE = import.meta.env.BASE_URL;
const PCYR = 1.0227121650537077e-6, KMS = 1 / PCYR, LY = 3.261563777;
type Cat = { n: number; pos: Float32Array; vel: Float32Array; teff: Uint16Array; M: Float32Array; cls: Uint8Array; src: Uint8Array; hasRV: Uint8Array };
type Named = { name: string; p: THREE.Vector3; v: THREE.Vector3 };

async function loadCat(): Promise<Cat | null> {
  const meta = await fetch(`${BASE}data/space/meta.json`).then((r) => (r.ok && !(r.headers.get("content-type") ?? "").includes("html") ? r.json() : null)).catch(() => null);
  if (!meta) return null;
  const bufs = await Promise.all([meta.core.file, meta.deep.file].map((f: string) => fetch(`${BASE}data/space/${f}`).then((r) => r.arrayBuffer())));
  const n = bufs.reduce((a, b) => a + b.byteLength / 32, 0);
  const c: Cat = { n, pos: new Float32Array(n * 3), vel: new Float32Array(n * 3), teff: new Uint16Array(n), M: new Float32Array(n), cls: new Uint8Array(n), src: new Uint8Array(n), hasRV: new Uint8Array(n) };
  let i = 0;
  for (const b of bufs) { const dv = new DataView(b); for (let o = 0; o < b.byteLength; o += 32, i++) {
    for (let k = 0; k < 3; k++) { c.pos[i * 3 + k] = dv.getFloat32(o + 4 * k, true); c.vel[i * 3 + k] = dv.getInt16(o + 12 + 2 * k, true) / 10 * PCYR; }
    c.teff[i] = dv.getUint16(o + 18, true); c.M[i] = dv.getInt16(o + 20, true) / 100; const f = dv.getUint8(o + 22); c.cls[i] = f & 7; c.src[i] = (f >> 3) & 7; c.hasRV[i] = (f >> 6) & 1; } }
  return c;
}
async function loadNamed(): Promise<Named[]> {
  const j = await fetch(`${BASE}data/neighbors.json`).then((r) => r.json()).catch(() => null); if (!j) return [];
  return (j.stars as any[]).filter((s) => s[9]).map((s) => ({ name: s[12] as string, p: new THREE.Vector3(s[0], s[1], s[2]).divideScalar(LY), v: new THREE.Vector3(s[3], s[4], s[5]).divideScalar(LY) }))
    .sort((a, b) => a.p.length() - b.p.length());
}

type Exp = { id: string; g: string; icon: string; q: string; d: string; tag: string };
const EXPS: Exp[] = [
  { id: "planetx", g: "Start here", icon: "✕", q: "Could SPHEREx see Planet X?", d: "Push a hidden planet, or a cold brown dwarf, out into the dark and find where SPHEREx loses it — and how far it would jump between two passes.", tag: "Anyone · 1 minute" },
  { id: "parallax", g: "Start here", icon: "△", q: "How far is that star? Measure it.", d: "Read real SPHEREx exposures, watch a nearby brown dwarf swing as Earth circles the Sun, and turn the swing into light-years.", tag: "Anyone · live NASA data" },
  { id: "hunt", g: "Start here", icon: "◎", q: "Be the first to look", d: "Objects that look like cold nearby worlds and sit in no catalogue of known brown dwarfs. Check them one by one and keep your verdicts.", tag: "Citizen science" },
  { id: "hr", g: "The Galaxy around us", icon: "✦", q: "Where do stars live?", d: "Plot temperature against true brightness for 400,000 objects and watch families appear.", tag: "Curious" },
  { id: "avr", g: "The Galaxy around us", icon: "↗", q: "Do older stars move faster?", d: "Test a 70-year-old prediction with SPHEREx temperatures and 16 years of WISE motion.", tag: "Curious" },
  { id: "apex", g: "The Galaxy around us", icon: "☉", q: "Which way is the Sun heading?", d: "Measure our own motion through the Galaxy from the stars around us.", tag: "Curious" },
  { id: "reach", g: "The Galaxy around us", icon: "⟷", q: "How far can each method see?", d: "Gaia parallaxes against our AI distances from SPHEREx spectra.", tag: "Curious" },
  { id: "probe", g: "The Galaxy around us", icon: "➤", q: "How long to reach a star?", d: "Launch a probe at a real speed and intercept a moving star.", tag: "Anyone" },
  { id: "flyby", g: "The Galaxy around us", icon: "⊛", q: "What if a star flew past the Sun?", d: "A real gravity simulation of the planets and a visiting star.", tag: "Anyone" },
  { id: "batch", g: "For researchers", icon: "≡", q: "Run a whole target list", d: "Paste names or coordinates: saturation, motion, variability and methane for each, measured from SPHEREx exposures, as a table and a CSV.", tag: "Research tool" },
];
const PRO: Record<string, (P: HTMLElement, S: HTMLElement, ctx: LabCtx) => () => void> = { planetx, parallax, hunt, batch };

export async function openLab(host: HTMLElement, onClose: () => void, ctx: LabCtx, start?: string) {
  host.classList.add("open");
  const groups = [...new Set(EXPS.map((e) => e.g))];
  host.innerHTML = `<div class="lab-in">
    <div class="lab-top"><div><div class="eyebrow">MIRA Lab</div><h2 class="display">Ask the sky a question</h2>
      <p class="lab-sub">Ten experiments on real data. Each starts with a question, gives a plain answer, and shows the working for those who want it. Nothing here is pre-recorded: the numbers are computed in your browser.</p></div>
      <button class="icon-btn" id="labx" aria-label="Close the Lab">✕</button></div>
    <div id="labhome">${groups.map((g) => `<div class="eyebrow lab-g">${g}</div><div class="lab-grid${g === "Start here" ? " big" : ""}">${EXPS.filter((e) => e.g === g).map((e) =>
      `<button class="lab-card" data-id="${e.id}"><span class="ic">${e.icon}</span><span class="tg">${e.tag}</span><b>${e.q}</b><span class="ds">${e.d}</span><span class="go">Open →</span></button>`).join("")}</div>`).join("")}</div>
    <div class="lab-run" id="labrun" style="display:none"></div></div>`;
  const $ = (s: string) => host.querySelector(s) as HTMLElement;
  let stop: (() => void) | null = null;
  ($("#labx")).onclick = () => { stop?.(); host.classList.remove("open", "running"); host.innerHTML = ""; onClose(); };
  const run = $("#labrun"), home = $("#labhome");
  const catP = loadCat(), namedP = loadNamed();
  const back = () => { stop?.(); stop = null; run.style.display = "none"; run.innerHTML = ""; home.style.display = ""; host.scrollTop = 0; host.classList.remove("running"); };
  const open = async (id: string) => {
    const e = EXPS.find((x) => x.id === id); if (!e) return;
    stop?.(); stop = null; home.style.display = "none"; run.style.display = ""; host.scrollTop = 0; host.classList.add("running");
    run.innerHTML = `<button class="link lab-back" id="labback">← All experiments</button><div class="eyebrow">${e.g} · ${e.tag}</div><h3 class="display">${e.q}</h3>
      <div class="lab-body"><div class="lab-plot" id="lp"></div><div class="lab-side" id="ls"><div class="soon">Running…</div></div></div>`;
    $("#labback").onclick = back;
    if (PRO[e.id]) { stop = PRO[e.id]($("#lp"), $("#ls"), ctx); return; }
    const cat = await catP, named = await namedP;
    if (!$("#ls")) return;
    if (!cat && e.id !== "flyby") { $("#ls").innerHTML = `<div class="soon">The census catalogue is not available on this deployment.</div>`; return; }
    stop = ({ hr, avr, apex, reach, probe, flyby } as Record<string, (c: Cat, n: Named[], P: HTMLElement, S: HTMLElement) => (() => void) | void>)[e.id](cat!, named, $("#lp"), $("#ls")) || null;
  };
  host.querySelectorAll<HTMLButtonElement>(".lab-card").forEach((b) => (b.onclick = () => open(b.dataset.id!)));
  if (start) open(start);
}

function canvas(el: HTMLElement, h = 420) {
  const c = document.createElement("canvas"), d = Math.min(2, devicePixelRatio || 1), w = Math.max(320, el.clientWidth);
  c.width = w * d; c.height = h * d; c.style.width = "100%"; c.style.height = `${h}px`; el.innerHTML = ""; el.appendChild(c);
  const g = c.getContext("2d")!; g.scale(d, d); return { c, g, w, h };
}
const tcol = (T: number) => (T < 1300 ? "#c060ff" : T < 2300 ? "#ff4d6d" : T < 3900 ? "#ff8a4c" : T < 5300 ? "#ffc27a" : T < 6300 ? "#fff1c9" : "#bcd3ff");
const verdict = (ok: boolean | null, html: string) => `<div class="verdict ${ok === null ? "" : ok ? "yes" : "no"}">${html}</div>`;
const how = (html: string) => `<details class="how"><summary>How we did it</summary><p>${html}</p></details>`;
const med = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : NaN; };

// ---------------------------------------------------------------- experiments
function hr(C: Cat, _n: Named[], P: HTMLElement, S: HTMLElement) {
  const { c, g, w, h } = canvas(P, 460);
  const X = (T: number) => 50 + (Math.log10(20000) - Math.log10(T)) / (Math.log10(20000) - Math.log10(400)) * (w - 70), Y = (m: number) => 16 + (m + 6) / 24 * (h - 50);
  const idx: number[] = []; const step = Math.max(1, Math.floor(C.n / 60000));
  for (let i = 0; i < C.n; i += step) if (C.teff[i] > 400 && C.teff[i] < 20000 && isFinite(C.M[i])) idx.push(i);
  const draw = (box?: number[]) => {
    g.fillStyle = "#05070c"; g.fillRect(0, 0, w, h);
    for (const i of idx) { const y = Y(C.M[i]); if (y < 0 || y > h - 30) continue; g.fillStyle = tcol(C.teff[i]) + "99"; g.fillRect(X(C.teff[i]), y, 1.5, 1.5); }
    g.fillStyle = "#8b97b3"; g.font = "11px Barlow, sans-serif";
    [[10000, "10,000 K"], [5772, "Sun 5,772 K"], [3000, "3,000 K"], [1000, "1,000 K"], [500, "500 K"]].forEach(([T, t]) => g.fillText(t as string, X(T as number) - 20, h - 10));
    g.save(); g.translate(14, h / 2 + 50); g.rotate(-Math.PI / 2); g.fillText("← fainter      brighter →", 0, 0); g.restore();
    g.font = "600 12px Barlow, sans-serif"; g.fillStyle = "#fff";
    g.fillText("Main sequence", X(7000), Y(1.5)); g.fillText("Giants", X(4200), Y(-4)); g.fillText("Brown dwarfs", X(1500) - 30, Y(14.5)); g.fillText("White dwarfs", X(11000), Y(11));
    g.strokeStyle = "#fff"; g.lineWidth = 1.5; g.beginPath(); g.arc(X(5772), Y(3.27), 5, 0, 7); g.stroke();
    if (box) { g.strokeStyle = "#5be3a6"; g.setLineDash([5, 4]); g.strokeRect(box[0], box[1], box[2] - box[0], box[3] - box[1]); g.setLineDash([]); }
  };
  draw();
  S.innerHTML = verdict(null, `Each dot is a star or brown dwarf from the census: <b>left = hot, right = cold</b>, <b>up = intrinsically bright</b>. They gather into families because a star's mass sets both its temperature and its brightness. The ringed dot is the Sun.`) +
    `<p class="note"><b>Drag a box</b> over any group to count what it contains.</p><div id="hrres"></div>` +
    how("Temperature from Gaia or our AI (SPHEREx spectrum); true brightness = absolute magnitude at 4.6 µm from the distance (Gaia parallax or AI). 1 in " + Math.max(1, Math.floor(C.n / 60000)) + " objects plotted.");
  let a: number[] | null = null;
  const pos = (e: PointerEvent) => { const r = c.getBoundingClientRect(); return [(e.clientX - r.left) / r.width * w, (e.clientY - r.top) / r.height * h]; };
  c.onpointerdown = (e) => { a = pos(e); c.setPointerCapture(e.pointerId); };
  c.onpointermove = (e) => { if (a) { const b = pos(e); draw([Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])]); } };
  c.onpointerup = (e) => { if (!a) return; const b = pos(e), bx = [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])]; a = null;
    let n = 0; const k = [0, 0, 0, 0], dist: number[] = []; const p = new THREE.Vector3();
    for (let i = 0; i < C.n; i++) { if (!C.teff[i]) continue; const x = X(C.teff[i]), y = Y(C.M[i]); if (x < bx[0] || x > bx[2] || y < bx[1] || y > bx[3]) continue; n++; k[C.cls[i]]++; dist.push(p.set(C.pos[i * 3], C.pos[i * 3 + 1], C.pos[i * 3 + 2]).length() * LY); }
    const names = ["dwarf stars", "giants", "brown dwarfs", "galaxies"];
    (S.querySelector("#hrres") as HTMLElement).innerHTML = n ? verdict(null, `<b>${n.toLocaleString()}</b> objects selected: ${k.map((v, j) => v ? `${v.toLocaleString()} ${names[j]}` : "").filter(Boolean).join(", ")}. Typical distance <b>${Math.round(med(dist)).toLocaleString()} light-years</b>.`) : ""; };
}

function avr(C: Cat, _n: Named[], P: HTMLElement, S: HTMLElement) {
  const bins = [[6500, 20000], [6000, 6500], [5300, 6000], [4500, 5300], [3900, 4500], [3300, 3900], [2600, 3300]], sp: number[][] = bins.map(() => []);
  const p = new THREE.Vector3(), v = new THREE.Vector3();
  for (let i = 0; i < C.n; i++) {
    if (C.cls[i] !== 0 || (C.src[i] !== 1 && C.src[i] !== 4)) continue; const b = bins.findIndex(([lo, hi]) => C.teff[i] >= lo && C.teff[i] < hi); if (b < 0) continue;
    const d = p.set(C.pos[i * 3], C.pos[i * 3 + 1], C.pos[i * 3 + 2]).length(); if (d > 50) continue;
    v.set(C.vel[i * 3], C.vel[i * 3 + 1], C.vel[i * 3 + 2]).multiplyScalar(KMS); const vr = v.dot(p) / d, vt = Math.sqrt(Math.max(0, v.lengthSq() - vr * vr));
    if (vt > 0 && vt < 300) sp[b].push(vt);
  }
  const m = sp.map(med), { g, w, h } = canvas(P, 400);
  g.fillStyle = "#05070c"; g.fillRect(0, 0, w, h);
  const ymax = Math.max(...m.filter(isFinite)) * 1.3, bw = (w - 60) / bins.length;
  m.forEach((val, k) => { if (!isFinite(val)) return; const x = 40 + k * bw, y = h - 46 - val / ymax * (h - 80);
    g.fillStyle = tcol((bins[k][0] + bins[k][1]) / 2); g.fillRect(x + 8, y, bw - 16, h - 46 - y);
    g.fillStyle = "#fff"; g.font = "600 13px Barlow, sans-serif"; g.fillText(`${val.toFixed(0)} km/s`, x + 10, y - 6);
    g.fillStyle = "#8b97b3"; g.font = "11px Barlow, sans-serif"; g.fillText(k === 0 ? "> 6,500 K" : `${(bins[k][0] / 1000).toFixed(1)}–${(bins[k][1] / 1000).toFixed(1)}k K`, x + 8, h - 26); g.fillText(`${sp[k].length.toLocaleString()} stars`, x + 8, h - 10); });
  const hot = m[0], cool = Math.max(m[5], m[6]);
  S.innerHTML = verdict(cool > hot * 1.2, `${cool > hot * 1.2 ? "<b>Yes.</b>" : "<b>Not clearly.</b>"} Hot stars move about <b>${hot.toFixed(0)} km/s</b> across our line of sight; the coolest move <b>${cool.toFixed(0)} km/s</b>.
      Hot stars burn out within a few billion years, so they are all young; cool ones live for tens of billions, so most are old — and old stars have had more time to be shaken up by the Galaxy's spiral arms and gas clouds.`) +
    how(`Dwarf stars within 160 light-years with Gaia distances; sideways speed = 4.74 × distance × the census' 16-year WISE proper motion. Median per temperature bin. First described by Strömberg and Roman in the 1920s–50s.`);
}

function apex(C: Cat, _n: Named[], P: HTMLElement, S: HTMLElement) {
  const V: number[][] = [[], [], []], p = new THREE.Vector3(), v = new THREE.Vector3();
  for (let i = 0; i < C.n; i++) { if (!C.hasRV[i] || C.cls[i] !== 0) continue; if (p.set(C.pos[i * 3], C.pos[i * 3 + 1], C.pos[i * 3 + 2]).length() > 50) continue;
    v.set(C.vel[i * 3], C.vel[i * 3 + 1], C.vel[i * 3 + 2]).multiplyScalar(KMS); if (v.length() > 120) continue; V[0].push(v.x); V[1].push(v.y); V[2].push(v.z); }
  const sun = new THREE.Vector3(-med(V[0]), -med(V[1]), -med(V[2])), spd = sun.length();
  const l = (Math.atan2(sun.y, sun.x) * 180 / Math.PI + 360) % 360, b = Math.asin(sun.z / spd) * 180 / Math.PI;
  const std = [56, 23], ang = Math.acos(Math.cos(b * Math.PI / 180) * Math.cos(23 * Math.PI / 180) * Math.cos((l - 56) * Math.PI / 180) + Math.sin(b * Math.PI / 180) * Math.sin(23 * Math.PI / 180)) * 180 / Math.PI;
  // all-sky (Galactic, Aitoff) with the two directions
  const { g, w, h } = canvas(P, 360);
  g.fillStyle = "#05070c"; g.fillRect(0, 0, w, h);
  const A = (lon: number, lat: number) => { let L = ((lon + 180) % 360) - 180; L = -L * Math.PI / 180; const B = lat * Math.PI / 180, al = Math.acos(Math.cos(B) * Math.cos(L / 2)), s = al ? Math.sin(al) / al : 1;
    return [w / 2 + 2 * Math.cos(B) * Math.sin(L / 2) / s * (w * 0.46 / Math.PI), h / 2 - Math.sin(B) / s * (h * 0.44 / (Math.PI / 2))]; };
  g.strokeStyle = "#ffffff44"; g.beginPath(); g.ellipse(w / 2, h / 2, w * 0.46, h * 0.44, 0, 0, 7); g.stroke();
  g.strokeStyle = "#ffffff22"; for (let lat = -60; lat <= 60; lat += 30) { g.beginPath(); for (let lo = -180; lo <= 180; lo += 5) { const [x, y] = A(lo, lat); lo === -180 ? g.moveTo(x, y) : g.lineTo(x, y); } g.stroke(); }
  g.strokeStyle = "#ffc85766"; g.beginPath(); for (let lo = -180; lo <= 180; lo += 5) { const [x, y] = A(lo, 0); lo === -180 ? g.moveTo(x, y) : g.lineTo(x, y); } g.stroke();
  g.fillStyle = "#8b97b3"; g.font = "11px Barlow, sans-serif"; const [gx, gy] = A(0, 0); g.fillText("Galactic centre", gx + 6, gy + 14); g.fillText("plane of the Milky Way", A(120, 2)[0], A(120, 2)[1] - 6);
  const [sx, sy] = A(std[0], std[1]); g.strokeStyle = "#fff"; g.lineWidth = 2; g.beginPath(); g.arc(sx, sy, 9, 0, 7); g.stroke(); g.fillStyle = "#fff"; g.fillText("classic solar apex", sx + 12, sy - 4);
  const [mx, my] = A(l, b); g.fillStyle = "#5be3a6"; g.beginPath(); g.arc(mx, my, 6, 0, 7); g.fill(); g.fillText("measured here", mx + 10, my + 16);
  S.innerHTML = verdict(ang < 15, `The Sun heads toward Galactic longitude <b>${l.toFixed(0)}°</b>, latitude <b>${b.toFixed(0)}°</b> — <b>${ang.toFixed(0)}°</b> from the classic "solar apex" (56°, 23°) in Hercules. Speed relative to these neighbours: <b>${spd.toFixed(0)} km/s</b>.
      ${spd > 22 ? "That is faster than the classic 19.5 km/s for a known reason: our neighbours are mostly old red dwarfs, which lag behind in the Galaxy's rotation (the 'asymmetric drift')." : ""}`) +
    how(`${V[0].length.toLocaleString()} dwarf stars within 160 light-years with full 3D velocities (Gaia radial velocity + WISE motion). The Sun's motion = minus their median velocity. Modern value: 18 km/s relative to the local standard of rest (Schönrich, Binney & Dehnen 2010).`);
}

function reach(C: Cat, _n: Named[], P: HTMLElement, S: HTMLElement) {
  const nb = 30, lo = 0, hi = 4.5, H = [new Array(nb).fill(0), new Array(nb).fill(0), new Array(nb).fill(0)], D: number[][] = [[], [], []], p = new THREE.Vector3();
  for (let i = 0; i < C.n; i++) { const k = C.src[i] === 1 ? 0 : C.src[i] === 3 ? 1 : C.src[i] === 2 ? 2 : -1; if (k < 0) continue;
    const d = p.set(C.pos[i * 3], C.pos[i * 3 + 1], C.pos[i * 3 + 2]).length() * LY, bb = Math.floor((Math.log10(Math.max(d, 1)) - lo) / (hi - lo) * nb); if (bb >= 0 && bb < nb) H[k][bb]++; D[k].push(d); }
  const { g, w, h } = canvas(P, 380), cols = ["#8cd9ff", "#5be3a6", "#c060ff"], mx = Math.max(...H.flat());
  g.fillStyle = "#05070c"; g.fillRect(0, 0, w, h);
  H.forEach((hh, k) => { g.fillStyle = cols[k] + "55"; g.strokeStyle = cols[k]; g.lineWidth = 2; g.beginPath(); g.moveTo(30, h - 36);
    hh.forEach((v, bb) => g.lineTo(30 + bb / (nb - 1) * (w - 50), h - 36 - v / mx * (h - 70))); g.lineTo(w - 20, h - 36); g.closePath(); g.fill(); g.stroke(); });
  g.fillStyle = "#8b97b3"; g.font = "11px Barlow, sans-serif"; [1, 10, 100, 1000, 10000].forEach((d) => g.fillText(d >= 1000 ? `${d / 1000}k ly` : `${d} ly`, 30 + (Math.log10(d) - lo) / (hi - lo) * (w - 50) - 10, h - 14));
  S.innerHTML = verdict(null, `<span style="color:#8cd9ff">■</span> <b>Gaia</b> (parallax): ${D[0].length.toLocaleString()} objects, typical ${Math.round(med(D[0])).toLocaleString()} ly<br>
      <span style="color:#5be3a6">■</span> <b>Our AI</b> (SPHEREx spectrum): ${D[1].length.toLocaleString()} objects, typical ${Math.round(med(D[1])).toLocaleString()} ly<br>
      <span style="color:#c060ff">■</span> <b>Brown-dwarf parallaxes</b> (UltracoolSheet): ${D[2].length.toLocaleString()}, typical ${Math.round(med(D[2])).toLocaleString()} ly<br><br>
      The AI places objects Gaia cannot measure — mostly too red and faint in visible light — with a typical error of ±27%.`) +
    how("Gaia's parallax is a direct geometric measurement. The AI learns, from 1.57 million stars with Gaia parallaxes, how a SPHEREx spectrum relates to true brightness, then infers distance from apparent brightness. Tested on sky it never saw.");
}

function probe(C: Cat, named: Named[], P: HTMLElement, S: HTMLElement) {
  void C;
  const stars = named.filter((s) => s.p.length() < 6).slice(0, 40);
  const speeds: [string, number][] = [["Voyager 1 · 17 km/s", 17], ["Parker Solar Probe at its fastest · 190 km/s", 190], ["Fusion rocket (concept) · 3% of light", 9000], ["Starshot light sail (concept) · 20% of light", 59958], ["Light itself", 299792]];
  S.innerHTML = `<label class="lrow"><span>Destination</span><select id="pd">${stars.map((s, i) => `<option value="${i}" ${/Proxima/.test(s.name) ? "selected" : ""}>${s.name} · ${(s.p.length() * LY).toFixed(1)} ly</option>`).join("")}</select></label>
    <label class="lrow"><span>Probe</span><select id="pv">${speeds.map(([n, v], k) => `<option value="${v}" ${k === 3 ? "selected" : ""}>${n}</option>`).join("")}</select></label>
    <button class="btn" id="pgo">Launch</button><div id="pres"></div>` + how("The star keeps moving at its measured 3D velocity (Gaia), so the probe aims where it will be: we solve |star(t)| = speed × t exactly. Acceleration and deceleration are ignored.");
  const go = () => {
    const s = stars[+(S.querySelector("#pd") as HTMLSelectElement).value], spd = +(S.querySelector("#pv") as HTMLSelectElement).value * PCYR;
    const A = s.v.lengthSq() - spd * spd, B = 2 * s.p.dot(s.v), Cq = s.p.lengthSq(), disc = B * B - 4 * A * Cq;
    let t = NaN; if (disc >= 0) { const r = [(-B - Math.sqrt(disc)) / (2 * A), (-B + Math.sqrt(disc)) / (2 * A)].filter((x) => x > 0).sort((a, b) => a - b); t = r[0]; }
    const res = S.querySelector("#pres") as HTMLElement;
    if (!isFinite(t)) { res.innerHTML = verdict(false, `<b>Never.</b> ${s.name} moves at ${(s.v.length() * KMS).toFixed(0)} km/s and never comes within reach of this probe.`); drawProbe(P, s, null, 0); return; }
    const meet = s.p.clone().addScaledVector(s.v, t), yr = new Date().getFullYear() + t;
    res.innerHTML = verdict(true, `Arrival in <b>${t < 1 ? Math.round(t * 365) + " days" : t < 1e4 ? Math.round(t).toLocaleString() + " years" : (t / 1000).toFixed(1) + " thousand years"}</b> — around <b>AD ${yr < 10000 ? Math.round(yr) : Math.round(yr).toLocaleString()}</b>${t > 50 ? `, about ${Math.round(t / 25).toLocaleString()} human generations` : ""}.
      Meanwhile the star moves ${(meet.distanceTo(s.p) * LY).toFixed(2)} light-years, so the meeting point is ${(meet.length() * LY).toFixed(2)} ly from the Sun.`);
    drawProbe(P, s, meet, t);
  };
  (S.querySelector("#pgo") as HTMLElement).onclick = go; go();
}
function drawProbe(P: HTMLElement, s: Named, meet: THREE.Vector3 | null, t: number) {
  const { g, w, h } = canvas(P, 400); g.fillStyle = "#05070c"; g.fillRect(0, 0, w, h);
  // project onto the plane containing the Sun, the star and its velocity
  const e1 = s.p.clone().normalize(), e2 = s.v.clone().addScaledVector(e1, -s.v.dot(e1)).normalize(); if (!isFinite(e2.x)) e2.set(0, 0, 1);
  const T = meet ? t : 20000, end = s.p.clone().addScaledVector(s.v, T), pts = [new THREE.Vector3(), s.p, end];
  const xs = pts.map((p) => p.dot(e1)), ys = pts.map((p) => p.dot(e2)), span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), 0.5) * 1.3;
  const cx = (Math.max(...xs) + Math.min(...xs)) / 2, cy = (Math.max(...ys) + Math.min(...ys)) / 2, S2 = Math.min(w, h) / span;
  const X = (p: THREE.Vector3) => w / 2 + (p.dot(e1) - cx) * S2, Y = (p: THREE.Vector3) => h / 2 - (p.dot(e2) - cy) * S2;
  g.strokeStyle = "#ffc85788"; g.setLineDash([4, 4]); g.beginPath(); g.moveTo(X(s.p), Y(s.p)); g.lineTo(X(end), Y(end)); g.stroke(); g.setLineDash([]);
  if (meet) { g.strokeStyle = "#5be3a6"; g.lineWidth = 2; g.beginPath(); g.moveTo(X(pts[0]), Y(pts[0])); g.lineTo(X(meet), Y(meet)); g.stroke(); g.fillStyle = "#5be3a6"; g.beginPath(); g.arc(X(meet), Y(meet), 5, 0, 7); g.fill(); }
  g.fillStyle = "#ffd27a"; g.beginPath(); g.arc(X(pts[0]), Y(pts[0]), 6, 0, 7); g.fill(); g.fillStyle = "#fff"; g.font = "12px Barlow, sans-serif"; g.fillText("Sun", X(pts[0]) + 9, Y(pts[0]) + 4);
  g.fillStyle = "#ff8a4c"; g.beginPath(); g.arc(X(s.p), Y(s.p), 5, 0, 7); g.fill(); g.fillStyle = "#fff"; g.fillText(`${s.name} today`, X(s.p) + 9, Y(s.p) - 6);
  g.fillStyle = "#8b97b3"; g.fillText(meet ? "green: probe path · dashed: the star's own motion" : "dashed: the star's motion over 20,000 years", 12, h - 12);
}

function flyby(_C: Cat, _n: Named[], P: HTMLElement, S: HTMLElement) {
  S.innerHTML = `<label class="lrow"><span>Visitor's mass</span><input type="range" id="fm" min="0.08" max="2" step="0.02" value="0.6"><b id="fmv"></b></label>
    <label class="lrow"><span>Closest pass</span><input type="range" id="fq" min="1.7" max="3.5" step="0.05" value="2.5"><b id="fqv"></b></label>
    <label class="lrow"><span>Speed</span><input type="range" id="fv" min="10" max="80" step="1" value="20"><b id="fvv"></b></label>
    <button class="btn" id="fgo">Run simulation</button><div id="fres"></div>` +
    how("Leapfrog N-body integration (G = 4π² au³ yr⁻² M☉⁻¹, 0.01-year steps) of the Sun, Earth, Mars, Jupiter, Saturn, Uranus, Neptune and the visitor, starting from today's planet positions (JPL). Orbits before/after from the two-body energy and angular momentum. Real case: Gliese 710 (0.6 Suns) will pass ~10,000 au from the Sun in ~1.3 million years.");
  const q = () => Math.round(Math.pow(10, +(S.querySelector("#fq") as HTMLInputElement).value));
  const upd = () => { (S.querySelector("#fmv") as HTMLElement).textContent = `${(+(S.querySelector("#fm") as HTMLInputElement).value).toFixed(2)} Suns`;
    (S.querySelector("#fqv") as HTMLElement).textContent = `${q().toLocaleString()} au`; (S.querySelector("#fvv") as HTMLElement).textContent = `${(S.querySelector("#fv") as HTMLInputElement).value} km/s`; };
  S.querySelectorAll("input").forEach((e) => e.addEventListener("input", upd)); upd();
  let stopAnim = () => {};
  const go = () => { stopAnim(); const r = sim(+(S.querySelector("#fm") as HTMLInputElement).value, q(), +(S.querySelector("#fv") as HTMLInputElement).value);
    (S.querySelector("#fres") as HTMLElement).innerHTML = r.html; stopAnim = animate(P, r); };
  (S.querySelector("#fgo") as HTMLElement).onclick = go; go();
  return () => stopAnim();
}
type SimR = { frames: Float32Array; nb: number; nf: number; years: number; html: string; q: number };
function sim(mStar: number, qAU: number, vKms: number): SimR {
  const G = 4 * Math.PI * Math.PI, ids = [2, 3, 4, 5, 6, 7], y0 = 1970 + Date.now() / (365.25 * 864e5), masses = [1, 3.0e-6, 3.2e-7, 9.55e-4, 2.86e-4, 4.37e-5, 5.15e-5, mStar];
  // work in the ecliptic frame (au) so the plot is a true top-down view of the planetary system
  const n = ecl2gal(0, 0, 1), xE = ecl2gal(1, 0, 0), yE = ecl2gal(0, 1, 0);
  const toE = (g: THREE.Vector3) => [g.dot(xE), g.dot(yE), g.dot(n)];
  const nb = 8, x = new Float64Array(nb * 3), v = new Float64Array(nb * 3);
  ids.forEach((k, j) => { const p0 = toE(planetPos(k, y0, new THREE.Vector3()).divideScalar(AU)), p1 = toE(planetPos(k, y0 + 1e-3, new THREE.Vector3()).divideScalar(AU));
    x.set(p0, (j + 1) * 3); v.set(p1.map((a, i) => (a - p0[i]) / 1e-3), (j + 1) * 3); });
  const vau = vKms / 4.74047, D0 = Math.max(10 * qAU, 1500), dir = [0.35, 1, 0.25], dn = Math.hypot(...dir); dir.forEach((_, i) => (dir[i] /= dn));
  const off = [dir[1], -dir[0], 0], on = Math.hypot(...off); off.forEach((_, i) => (off[i] /= on));
  x.set([off[0] * qAU - dir[0] * D0, off[1] * qAU - dir[1] * D0, off[2] * qAU - dir[2] * D0], 21); v.set([dir[0] * vau, dir[1] * vau, dir[2] * vau], 21);
  const Pm = [0, 0, 0]; let Mt = 0; for (let b = 0; b < nb; b++) { Mt += masses[b]; for (let k = 0; k < 3; k++) Pm[k] += masses[b] * v[b * 3 + k]; }
  for (let b = 0; b < nb; b++) for (let k = 0; k < 3; k++) v[b * 3 + k] -= Pm[k] / Mt;
  const years = 2 * D0 / vau, dt = 0.01, steps = Math.ceil(years / dt), every = Math.max(1, Math.floor(steps / 1800)), nf = Math.floor(steps / every) + 1;
  const frames = new Float32Array(nf * nb * 3), a = new Float64Array(nb * 3);
  const acc = () => { a.fill(0); for (let i = 0; i < nb; i++) for (let j = i + 1; j < nb; j++) {
    const dx = x[j * 3] - x[i * 3], dy = x[j * 3 + 1] - x[i * 3 + 1], dz = x[j * 3 + 2] - x[i * 3 + 2], r2 = dx * dx + dy * dy + dz * dz + 1e-6, r3 = r2 * Math.sqrt(r2);
    const fi = G * masses[j] / r3, fj = G * masses[i] / r3; a[i * 3] += fi * dx; a[i * 3 + 1] += fi * dy; a[i * 3 + 2] += fi * dz; a[j * 3] -= fj * dx; a[j * 3 + 1] -= fj * dy; a[j * 3 + 2] -= fj * dz; } };
  const el = () => masses.map((m, b) => { const r = [0, 1, 2].map((k) => x[b * 3 + k] - x[k]), w = [0, 1, 2].map((k) => v[b * 3 + k] - v[k]), rr = Math.hypot(...r), mu = G * (1 + m), en = (w[0] ** 2 + w[1] ** 2 + w[2] ** 2) / 2 - mu / rr;
    const hx = r[1] * w[2] - r[2] * w[1], hy = r[2] * w[0] - r[0] * w[2], hz = r[0] * w[1] - r[1] * w[0]; return { a: en < 0 ? -mu / (2 * en) : Infinity, e: Math.sqrt(Math.max(0, 1 + 2 * en * (hx * hx + hy * hy + hz * hz) / (mu * mu))) }; });
  const e0 = el(); acc(); let f = 0;
  for (let s = 0; s <= steps; s++) {
    if (s % every === 0 && f < nf) { for (let b = 0; b < nb; b++) for (let k = 0; k < 3; k++) frames[(f * nb + b) * 3 + k] = x[b * 3 + k] - x[k]; f++; }
    for (let k = 0; k < nb * 3; k++) v[k] += 0.5 * dt * a[k]; for (let k = 0; k < nb * 3; k++) x[k] += dt * v[k]; acc(); for (let k = 0; k < nb * 3; k++) v[k] += 0.5 * dt * a[k];
  }
  const e1 = el(), names = ids.map((k) => PLANETS[k].name);
  const rows = names.map((nm, j) => { const A = e0[j + 1], B = e1[j + 1]; const fate = B.e >= 1 ? "<b style='color:#ff5c6c'>thrown out of the Solar System</b>" : Math.abs(B.a - A.a) / A.a > 0.05 || B.e - A.e > 0.05 ? "<b style='color:#ffc857'>orbit reshaped</b>" : "barely touched";
    return `<tr><td>${nm}</td><td>${A.a.toFixed(2)} → ${B.e >= 1 ? "∞" : B.a.toFixed(2)} au</td><td>${A.e.toFixed(3)} → ${B.e.toFixed(3)}</td><td>${fate}</td></tr>`; }).join("");
  const bad = e1.slice(1, 7).some((o, j) => o.e >= 1 || Math.abs(o.a - e0[j + 1].a) / e0[j + 1].a > 0.05);
  return { q: qAU, frames, nb, nf, years, html: verdict(!bad, `${bad ? "<b>The planets are disturbed.</b>" : "<b>The planets survive almost untouched.</b>"} Simulated ${Math.round(years).toLocaleString()} years in ${steps.toLocaleString()} steps.`) +
    `<table class="ltab"><thead><tr><th>Planet</th><th>orbit size</th><th>stretch</th><th>outcome</th></tr></thead><tbody>${rows}</tbody></table>` };
}
function animate(P: HTMLElement, r: SimR) {
  const { g, w, h } = canvas(P, 460), t0 = performance.now(), cols = ["#5f8fe0", "#c8643c", "#d8b48a", "#e3cf9a", "#a6d8e0", "#4f73d8", "#ff9a5a"];
  let raf = 0, live = true; const view = Math.min(600, Math.max(40, r.q * 1.3));
  const loop = (now: number) => {
    const f = Math.min(r.nf - 1, Math.floor((now - t0) / 1000 / 25 * r.nf));
    g.fillStyle = "#05070c"; g.fillRect(0, 0, w, h);
    const sc = Math.min(w, h) / 2 / view, X = (x: number) => w / 2 + x * sc, Y = (y: number) => h / 2 - y * sc;
    for (let b = 1; b < r.nb; b++) { g.strokeStyle = cols[b - 1] + (b === r.nb - 1 ? "aa" : "66"); g.lineWidth = 1; g.beginPath();
      for (let k = Math.max(0, f - (b === r.nb - 1 ? r.nf : 400)); k <= f; k += 1) { const px = X(r.frames[(k * r.nb + b) * 3]), py = Y(r.frames[(k * r.nb + b) * 3 + 1]); k === Math.max(0, f - (b === r.nb - 1 ? r.nf : 400)) ? g.moveTo(px, py) : g.lineTo(px, py); } g.stroke();
      const px = X(r.frames[(f * r.nb + b) * 3]), py = Y(r.frames[(f * r.nb + b) * 3 + 1]); g.fillStyle = cols[b - 1]; g.beginPath(); g.arc(px, py, b === r.nb - 1 ? 6 : 3.5, 0, 7); g.fill(); }
    g.fillStyle = "#ffd27a"; g.beginPath(); g.arc(w / 2, h / 2, 5, 0, 7); g.fill();
    g.fillStyle = "#8b97b3"; g.font = "12px Barlow, sans-serif"; g.fillText(`year ${Math.round(f / r.nf * r.years).toLocaleString()} of ${Math.round(r.years).toLocaleString()} · top-down view of the planets' plane · orange = visitor`, 12, h - 12);
    ["Earth", "Mars", "Jupiter", "Saturn", "Uranus", "Neptune"].forEach((nm, j) => { const px = X(r.frames[(f * r.nb + j + 1) * 3]), py = Y(r.frames[(f * r.nb + j + 1) * 3 + 1]); if (j >= 2) g.fillText(nm, px + 6, py - 6); });
    if (live && f < r.nf - 1) raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);
  return () => { live = false; cancelAnimationFrame(raf); };
}
