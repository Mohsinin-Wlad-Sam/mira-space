import uPlot from "uplot";

type LC = { id: string; points: { mjd: number; band: string; uJy: number; err: number }[]; spherex: { mjd: number; w2_uJy: number; err: number | null } | null };
const year = (mjd: number) => 2000 + (mjd - 51544.5) / 365.25;

export async function mountLightCurve(el: HTMLElement, id: string, saturated = false, back?: () => void) {
  const r = await fetch(`${import.meta.env.BASE_URL}data/lc/${id}.json`, { cache: "no-store" });
  if (!r.ok || (r.headers.get("content-type") ?? "").includes("html")) { el.innerHTML = `<div class="soon"><b>Light curve not built yet</b> — precomputed for featured objects.</div>`; return; }
  const d = (await r.json()) as LC;
  if (!d.points.length) { el.innerHTML = `<div class="soon">No WISE-era detections in the unWISE catalog (too bright — saturated — or too faint).</div>`; return; }
  // x grid: union of all times; series: W1, W2, SPHEREx
  const xs = [...new Set([...d.points.map((p) => year(p.mjd)), ...(d.spherex ? [year(d.spherex.mjd)] : [])])].sort((a, b) => a - b);
  const idx = new Map(xs.map((x, i) => [x, i]));
  const w1: (number | null)[] = xs.map(() => null), w2: (number | null)[] = xs.map(() => null), sx: (number | null)[] = xs.map(() => null);
  for (const p of d.points) if (p.uJy > 0) (p.band === "W1" ? w1 : w2)[idx.get(year(p.mjd))!] = p.uJy / 1000;
  if (d.spherex && d.spherex.w2_uJy > 0) sx[idx.get(year(d.spherex.mjd))!] = d.spherex.w2_uJy / 1000;
  const allW2 = d.points.filter((p) => p.band === "W2" && p.uJy > 0).map((p) => p.uJy);
  const amp = allW2.length > 2 ? Math.max(...allW2) / Math.min(...allW2) : 1;
  el.innerHTML = `${back ? `<div class="scihead"><span></span><button class="btn sm ghost" id="lcback">Simple view</button></div>` : ""}<div class="lcplot"></div><p class="note">WISE W1 (3.4 µm) and W2 (4.6 µm) per 6-month epoch, 2010–2020, and SPHEREx 2025–26 synthesized into the W2 band.
    ${amp > 1.5 ? `<b style="color:#fff">W2 varied by ×${amp.toFixed(1)} across the WISE era.</b>` : ""}
    ${saturated ? " <i>SPHEREx point unreliable here (saturated).</i>" : ""}</p>`;
  if (back) (el.querySelector("#lcback") as HTMLButtonElement).onclick = back;
  const width = Math.max(300, el.clientWidth - 4);
  const pts = (fill: string, size: number) => ({ show: true, size, fill, stroke: fill });
  new uPlot({
    width, height: 220, legend: { show: true },
    scales: { x: { time: false, range: [2009.8, 2026.5] }, y: { distr: 3 } },
    axes: [{ stroke: "#8b97b3", grid: { stroke: "#ffffff0d" } }, { label: "flux (mJy, log)", stroke: "#8b97b3", grid: { stroke: "#ffffff0d" }, size: 60 }],
    series: [{ label: "year", value: (_u, v) => (v == null ? "–" : v.toFixed(2)) },
      { label: "WISE W1 3.4 µm", stroke: "#7cc4ff", width: 0, points: pts("#7cc4ff", 4), spanGaps: false },
      { label: "WISE W2 4.6 µm", stroke: "#ffc857", width: 0, points: pts("#ffc857", 4), spanGaps: false },
      { label: "SPHEREx → W2", stroke: "#ff5cf0", width: 0, points: pts("#ff5cf0", 10), spanGaps: false }],
  }, [xs, w1, w2, sx], el.querySelector(".lcplot") as HTMLElement);
}
