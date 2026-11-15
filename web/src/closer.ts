// A CLOSER LOOK — real survey tiles of one place, drawn by Aladin Lite (CDS, Strasbourg) from the HiPS copies at NASA's
// infrared archive: 2MASS (~1999), WISE (2010) and SPHEREx's all-sky cube (2025–26) under one slider, the SPHEREx
// layer at any of its 102 wavelengths, Gaia's stars on top on request. At this scale (a fraction of a degree) the
// view is a plain tangent-plane picture: it pans and zooms without bending.
import { gaia } from "./blink/catalogs";

const IRSA = "https://irsa.ipac.caltech.edu/data/hips", TM = `${IRSA}/CDS/2MASS/K`, WISE = `${IRSA}/CDS/AllWISE/W2`, SX = `${IRSA}/SPHEREx/spherex_allsky_cube`;
/** Aladin converts a cube slice to a frequency before asking for it: ask for the frequency whose bin is frame k */
function setCubeFrame(l: any, k: number) {
  if (!l) return; const lo = +l.emMin, hi = +l.emMax, n = +l.cubeDepth;
  if (typeof l.setFrequency === "function" && lo > 0 && hi > lo && n > 1) { const C = 299792458, f0 = C / hi, f1 = C / lo; l.slice = k; l.setFrequency({ value: f0 + ((k + 0.5) / n) * (f1 - f0), unit: "Hz" }); } else l.setSliceNumber?.(k);
}
export async function openCloser(host: HTMLElement, ra: number, dec: number, o: { lam: () => number[]; onObserve: (t: { ra: number; dec: number }) => void }) {
  host.hidden = false;
  host.innerHTML = `<div class="cl-box hud"><button class="icon-btn" id="clx" aria-label="Close">✕</button>
    <div class="eyebrow">A closer look · real survey tiles, drawn with Aladin (CDS)</div>
    <div class="cl-sky" id="clsky"><p class="cl-wait">Loading the sky viewer…</p></div>
    <div class="cl-ctl">
      <div class="sk-stops" id="clstops"><button data-i="0"><b>1999</b>2MASS 2.2 µm</button><button data-i="1"><b>2010</b>WISE 4.6 µm</button><button data-i="2" class="on"><b>2025</b>SPHEREx</button></div>
      <div class="sk-row"><input type="range" id="clt" min="0" max="2000" value="2000" aria-label="Year: from 2MASS to SPHEREx"></div>
      <div class="sk-row"><span class="eyebrow">SPHEREx colour</span><input type="range" id="clw" min="0" max="101" value="84" aria-label="SPHEREx wavelength"><b class="mono" id="clwl">–</b></div>
      <div class="sk-row"><label class="cl-chk"><input type="checkbox" id="clgaia"> Gaia stars</label><button class="btn sm solid" id="clmeas" title="Read every SPHEREx exposure of this field and measure what moved in it">Measure this field in the Lab</button></div>
      <p class="sk-hint">Each survey looked at a different colour of light, so stars change brightness between them; a star that changes <i>place</i> is moving. SPHEREx's all-sky pixels are 13″ here; the Lab reads its full 6″ exposures.</p>
    </div></div>`;
  const $ = <T extends HTMLElement>(s: string) => host.querySelector(s) as T; let al: any = null, wise: any = null, sx: any = null, gcat: any = null, dead = false;
  const close = () => { dead = true; host.hidden = true; host.innerHTML = ""; };
  $("#clx").onclick = close; host.onclick = (e) => { if (e.target === host) close(); };
  $("#clmeas").onclick = () => { const c = al?.getRaDec?.() ?? [ra, dec]; close(); o.onObserve({ ra: c[0], dec: c[1] }); };
  const nudge = () => [300, 900, 2000].forEach((ms) => setTimeout(() => { try { if (!dead && al) al.setFoV(al.getFov()[0]); } catch { /* */ } }, ms));      // makes Aladin draw a layer that has just changed
  const frame = () => { let k = +$<HTMLInputElement>("#clw").value; if (k === 50) k = 49; if (k === 51) k = 52; return k; };
  const apply = () => { const t = +$<HTMLInputElement>("#clt").value / 1000; try { wise?.setOpacity(Math.min(1, Math.max(0, t))); sx?.setOpacity(Math.min(1, Math.max(0, t - 1))); } catch { /* layer not ready */ }
    host.querySelectorAll<HTMLButtonElement>("#clstops button").forEach((b) => b.classList.toggle("on", Math.abs(t - +b.dataset.i!) < 0.02)); const lam = o.lam()[frame()]; $("#clwl").textContent = lam ? `${lam.toFixed(2)} µm` : "–"; };
  try {
    const A = (await import("aladin-lite")).default; await A.init; if (dead) return;
    $("#clsky").innerHTML = "";
    al = A.aladin($("#clsky"), { survey: TM, fov: 0.4, target: `${ra.toFixed(6)} ${dec >= 0 ? "+" : ""}${dec.toFixed(6)}`, projection: "TAN", cooFrame: "ICRS", showReticle: true, showLayersControl: false, showZoomControl: true,
      showFullscreenControl: false, showCooLocation: true, showFrame: false, showProjectionControl: false, showSettingsControl: false, showStatusBar: false, showShareControl: false, showSimbadPointerControl: false,
      showCooGridControl: false, showContextMenu: false, showFov: true, log: false, backgroundColor: "rgb(0,0,0)" });
    wise = A.imageHiPS(WISE, { name: "WISE 2010" }); al.setOverlayImageLayer(wise, "wise");
    sx = A.imageHiPS(SX, { name: "SPHEREx", successCallback: (h: any) => { try { setCubeFrame(h, frame()); } catch { /* */ } } }); al.setOverlayImageLayer(sx, "spherex");
    setTimeout(apply, 80); nudge();
    $<HTMLInputElement>("#clt").oninput = () => { const e = $<HTMLInputElement>("#clt"); for (const q of [0, 1000, 2000]) if (Math.abs(+e.value - q) < 30) e.value = String(q); apply(); };
    host.querySelectorAll<HTMLButtonElement>("#clstops button").forEach((b) => (b.onclick = () => { $<HTMLInputElement>("#clt").value = String(+b.dataset.i! * 1000); apply(); nudge(); }));
    $<HTMLInputElement>("#clw").oninput = () => { $<HTMLInputElement>("#clt").value = "2000"; try { setCubeFrame(sx, frame()); } catch { /* */ } apply(); nudge(); };
    $<HTMLInputElement>("#clgaia").onchange = async (e) => {
      if (!(e.target as HTMLInputElement).checked) { try { gcat?.hide(); } catch { /* */ } return; }
      if (gcat) { gcat.show(); return; }
      const c = al.getRaDec(), rows = await gaia(c[0], c[1], Math.min(1500, (al.getFov()[0] * 3600) / 2), 400).catch(() => []); if (dead) return;
      gcat = A.catalog({ name: "Gaia DR3", sourceSize: 12, color: "#7cc4ff", shape: "circle" }); al.addCatalog(gcat);
      gcat.addSources(rows.map((s) => A.source(s.ra, s.dec, { name: s.id, G: s.mag })));
    };
  } catch { if (!dead) $("#clsky").innerHTML = `<p class="cl-wait">The sky viewer could not start in this browser. The Lab still measures this field.</p>`; }
}
