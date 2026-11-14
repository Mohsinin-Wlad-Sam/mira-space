// UI for the in-browser SPHEREx flipbook + on-the-fly spectrum (see sphxlive.ts).
import { buildLive, type Target } from "./sphxlive";
import { renderFlipbook, lamColor } from "./flipbook";

export async function mountLiveFlipbook(el: HTMLElement, t: Target, autostart = false): Promise<() => void> {
  let stop: () => void = () => {}, ac: AbortController | null = null, size = 32;
  const start = async () => {
    ac?.abort(); stop(); ac = new AbortController();
    el.innerHTML = `<div class="lfb"><div class="lfb-bar"><i style="width:0%"></i></div><p class="note" id="lfbmsg">Finding SPHEREx exposures of this spot…</p></div>`;
    const bar = el.querySelector(".lfb-bar i") as HTMLElement, msg = el.querySelector("#lfbmsg") as HTMLElement;
    try {
      const b = await buildLive(t, (d, n, m) => { bar.style.width = `${n ? (d / n) * 100 : 3}%`; msg.textContent = m; }, size > 48 ? 48 : 72, size, ac.signal);
      if (!b.frames.length) { el.innerHTML = `<div class="soon">SPHEREx has not covered this exact spot yet (${b.covered} overlapping exposures, none with the spot inside the detector edges).</div>`; return; }
      el.innerHTML = `<div class="lffov">Field of view ${[32, 64, 96].map((s2) => `<button class="btn sm ${s2 === size ? "" : "ghost"}" data-s="${s2}">${(s2 * 6.15 / 60).toFixed(1)}′</button>`).join("")}<span class="note">wider = more data to read</span></div>
        <div class="lfbook"></div><div class="eyebrow" style="margin-top:18px">Its spectrum, measured just now · ${b.phot.length} SPHEREx exposures</div><div class="lfspec"></div>`;
      el.querySelectorAll<HTMLButtonElement>(".lffov button").forEach((x) => x.onclick = () => { size = +x.dataset.s!; start(); });
      const spec = b.phot.length > 5 ? { lam: b.phot.map((p) => p.lam), flux: b.phot.map((p) => (p.flux > 0 ? p.flux : null)) } : undefined;   // enables "De-flashed"
      stop = renderFlipbook(el.querySelector(".lfbook") as HTMLElement, { size: b.size, n: b.frames.length, frames: b.frames }, b.stamps, spec,
        `Built live in your browser from ${b.frames.length} of the ${b.covered} SPHEREx exposures covering this spot, read straight from NASA's archive (IRSA, Amazon S3).${t.pmra || t.pmdec ? " The crosshair follows the object's measured motion." : ""}`) ?? (() => {});
      drawSpec(el.querySelector(".lfspec") as HTMLElement, b.phot);
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      el.innerHTML = `<div class="soon">Could not reach NASA's SPHEREx archive just now (${(e as Error).message}). Try again in a moment.</div>`;
    }
  };
  if (autostart) start();
  else {
    el.innerHTML = `<div class="soon"><b>Make a flipbook of this spot from every SPHEREx pass.</b> Your browser reads ~70 small image cut-outs (~15 MB) directly from NASA's SPHEREx archive and measures the spectrum on the fly.
      <div style="margin-top:10px"><button class="btn sm" id="lfgo">Build it now</button></div></div>`;
    (el.querySelector("#lfgo") as HTMLButtonElement).onclick = start;
  }
  return () => { ac?.abort(); stop(); };
}

function drawSpec(el: HTMLElement, P: { lam: number; flux: number; err: number }[]) {
  if (P.length < 4) { el.innerHTML = `<div class="soon">Too few exposures for a spectrum.</div>`; return; }
  const W = 420, H = 190, l0 = 0.7, l1 = 5.05, fl = P.map((p) => p.flux).sort((a, b) => a - b);
  const lo = Math.min(0, fl[Math.floor(fl.length * 0.02)]), hi = fl[Math.floor(fl.length * 0.98)] * 1.15 || 1;
  const X = (l: number) => 10 + (l - l0) / (l1 - l0) * (W - 20), Y = (f: number) => 14 + (1 - (f - lo) / (hi - lo)) * (H - 40);
  const pts = P.map((p) => `<line x1="${X(p.lam)}" x2="${X(p.lam)}" y1="${Y(p.flux - p.err)}" y2="${Y(p.flux + p.err)}" stroke="${lamColor(p.lam)}55"/><circle cx="${X(p.lam).toFixed(1)}" cy="${Y(p.flux).toFixed(1)}" r="2.6" fill="${lamColor(p.lam)}"/>`).join("");
  const ticks = [1, 2, 3, 4, 5].map((l) => `<text x="${X(l)}" y="${H - 6}" fill="#8b97b3" font-size="10" text-anchor="middle">${l} µm</text>`).join("");
  const ch4 = P.filter((p) => p.lam > 3.2 && p.lam < 3.45), w = P.filter((p) => p.lam > 3.85 && p.lam < 4.2);
  const m = (a: typeof P) => a.reduce((s, p) => s + p.flux, 0) / Math.max(1, a.length);
  const dip = ch4.length > 1 && w.length > 1 && m(w) > 0 ? 1 - m(ch4) / m(w) : NaN;
  el.innerHTML = `<svg class="specstory" viewBox="0 0 ${W} ${H}"><line x1="10" x2="${W - 10}" y1="${Y(0)}" y2="${Y(0)}" stroke="#ffffff22"/>${pts}${ticks}</svg>
    <p class="note">Each dot is one exposure (flux in mJy, 2-pixel aperture, local background removed): SPHEREx's filter changes colour across its detectors, so every exposure measures a different wavelength. Together they make a spectrum.
    ${isFinite(dip) && dip > 0.3 ? ` <b style="color:#c792ff">At 3.3 µm it is ${Math.round(dip * 100)}% fainter than at 4 µm — a methane signature.</b>` : ""}</p>`;
}
