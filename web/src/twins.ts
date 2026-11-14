// Spectral twins (AI fingerprint nearest neighbours) and spectrum-shape sparklines.
import { twinsSky } from "./explain";
type Twin = { tile: number; obj: number; ra: number; dec: number; d: number; shape: number[] };
type Twins = { id: string; shape: number[]; twins: Twin[] };

export function sparkline(shape: number[], lam: number[], ref?: number[], w = 150, h = 46): string {
  const idx = lam.map((_, i) => i).sort((a, b) => lam[a] - lam[b]);
  const vals = [...shape, ...(ref ?? [])].filter((v) => isFinite(v));
  const lo = Math.min(...vals, -0.5), hi = Math.max(...vals, 0.5);
  const X = (l: number) => 2 + ((l - 0.75) / 4.25) * (w - 4), Y = (v: number) => h - 2 - ((v - lo) / (hi - lo)) * (h - 4);
  const path = (s: number[]) => idx.filter((i) => isFinite(s[i]) && s[i] !== 0).map((i, k) => `${k ? "L" : "M"}${X(lam[i]).toFixed(1)},${Y(s[i]).toFixed(1)}`).join("");
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${ref ? `<path d="${path(ref)}" fill="none" stroke="rgba(255,255,255,.35)" stroke-width="1.2"/>` : ""}
    <path d="${path(shape)}" fill="none" stroke="#c792ff" stroke-width="1.6"/></svg>`;
}

export async function mountTwins(el: HTMLElement, id: string, lam: number[], fly: (ra: number, dec: number) => void, self?: { ra: number; dec: number }) {
  const r = await fetch(`${import.meta.env.BASE_URL}data/twins/${id}.json`, { cache: "no-store" });
  if (!r.ok || (r.headers.get("content-type") ?? "").includes("html")) { el.innerHTML = `<div class="soon"><b>Spectral twins</b> — computing: our GPU-trained model is learning a fingerprint for every SPHEREx spectrum.</div>`; return; }
  const t = (await r.json()) as Twins;
  el.innerHTML = `<p class="story">Our AI found <b>${t.twins.length} objects</b> elsewhere in the sky whose light has the <b>same recipe</b> — same temperature, same molecules — even though they sit in completely different places. Tap one to fly there.</p>
    ${self ? twinsSky(t.twins, self) : ""}
    <p class="note">How: a neural network trained on millions of SPHEREx spectra boils each one down to a 16-number fingerprint. Below, each cousin's light (purple) over this object's (white).</p>
    <div class="twins">${t.twins.map((tw, k) => `<button class="twin" data-k="${k}">${sparkline(tw.shape, lam, t.shape)}<span class="mono">#${k + 1} · ${tw.ra.toFixed(3)}, ${tw.dec.toFixed(3)}</span></button>`).join("")}</div>`;
  el.querySelectorAll<HTMLButtonElement>(".twin").forEach((b) => b.onclick = () => { const tw = t.twins[+b.dataset.k!]; fly(tw.ra, tw.dec); });
  el.querySelectorAll<SVGCircleElement>(".tw").forEach((c) => c.addEventListener("click", () => { const tw = t.twins[+(c.dataset.k ?? 0)]; fly(tw.ra, tw.dec); }));
}
