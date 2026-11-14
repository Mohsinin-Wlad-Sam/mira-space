import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";

// Molecular / atomic features in SPHEREx range (um)
export const BANDS: [number, number, string, string][] = [
  [1.35, 1.45, "H₂O", "#5aa9ff"], [1.80, 1.95, "H₂O", "#5aa9ff"], [2.20, 2.40, "CH₄", "#c792ff"], [2.60, 2.85, "H₂O", "#5aa9ff"],
  [2.95, 3.15, "H₂O ice", "#7be0ff"], [3.20, 3.45, "CH₄", "#c792ff"], [4.20, 4.32, "CO₂", "#ffc857"], [4.45, 4.80, "CO", "#ff8f6b"],
];

export function drawSpectrum(el: HTMLElement, lam: number[], spec: [number | null, number | null][], title = "", back?: () => void) {
  el.innerHTML = `<div class="sciwrap"><div class="scihead"><span class="mono" id="sciread">hover the plot for values</span>${back ? `<button class="btn sm ghost" id="sciback">Simple view</button>` : ""}</div><div class="sciplot"></div>
    <p class="note">Flux density per SPHEREx channel (points) with its ±1σ uncertainty (shaded). Tinted columns mark molecular bands. Saturated or blended channels are omitted.</p></div>`;
  if (back) (el.querySelector("#sciback") as HTMLButtonElement).onclick = back;
  const host = el.querySelector(".sciplot") as HTMLElement;
  const idx = lam.map((_, i) => i).filter((i) => spec[i] && spec[i][0] !== null).sort((a, b) => lam[a] - lam[b]);
  const x = idx.map((i) => lam[i]);
  const y = idx.map((i) => spec[i][0] as number);
  const lo = idx.map((i) => (spec[i][0] as number) - ((spec[i][1] as number) ?? 0));
  const hi = idx.map((i) => (spec[i][0] as number) + ((spec[i][1] as number) ?? 0));
  const width = Math.max(300, el.clientWidth - 4);
  const dpr = devicePixelRatio || 1;
  const bandsPlugin: uPlot.Plugin = {
    hooks: {
      drawClear: (u: uPlot) => {
        const ctx = u.ctx; ctx.save();
        BANDS.forEach(([a, b, name, col], k) => {
          const x0 = u.valToPos(a, "x", true), x1 = u.valToPos(b, "x", true);
          ctx.fillStyle = col + "18"; ctx.fillRect(x0, u.bbox.top, x1 - x0, u.bbox.height);
          ctx.fillStyle = col + "cc"; ctx.font = `${10 * dpr}px Barlow, sans-serif`;
          ctx.fillText(name, x0 + 2 * dpr, u.bbox.top + (11 + (k % 2) * 12) * dpr);       // two staggered rows: no overlapping labels
        });
        ctx.restore();
      },
      // shaded uncertainty band between the -1σ and +1σ series
      drawSeries: (u: uPlot, si: number) => {
        if (si !== 2) return;
        const ctx = u.ctx; ctx.save(); ctx.beginPath();
        x.forEach((xv, k) => { const px = u.valToPos(xv, "x", true), py = u.valToPos(hi[k], "y", true); k ? ctx.lineTo(px, py) : ctx.moveTo(px, py); });
        for (let k = x.length - 1; k >= 0; k--) ctx.lineTo(u.valToPos(x[k], "x", true), u.valToPos(lo[k], "y", true));
        ctx.closePath(); ctx.fillStyle = "rgba(124,196,255,.16)"; ctx.fill(); ctx.restore();
      },
      setCursor: (u: uPlot) => {
        const i = u.cursor.idx; const r = el.querySelector("#sciread"); if (!r) return;
        r.textContent = i == null ? "hover the plot for values" : `${x[i].toFixed(3)} µm · ${y[i].toFixed(3)} ± ${(hi[i] - y[i]).toFixed(3)} mJy`;
      },
    },
  };
  new uPlot({
    title, width, height: 240, plugins: [bandsPlugin],
    scales: { x: { time: false, range: [0.7, 5.05] } },
    axes: [{ label: "wavelength (µm)", stroke: "#8b97b3", grid: { stroke: "#ffffff0d" }, ticks: { stroke: "#ffffff22" } },
           { label: "flux density (mJy)", stroke: "#8b97b3", grid: { stroke: "#ffffff0d" }, ticks: { stroke: "#ffffff22" }, size: 56 }],
    series: [{}, { label: "−1σ", stroke: "transparent", width: 0, points: { show: false } }, { label: "+1σ", stroke: "transparent", width: 0, points: { show: false } },
             { label: "SPHEREx", stroke: "#7cc4ff88", width: 1, points: { show: true, size: 4, fill: "#7cc4ff", stroke: "#7cc4ff" } }],
    legend: { show: false }, cursor: { points: { size: 8 } },
  }, [x, lo, hi, y], host);
}
