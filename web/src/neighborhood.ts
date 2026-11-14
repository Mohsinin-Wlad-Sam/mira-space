// 3D solar neighbourhood: Gaia DR3 stars < 20 pc moving along their measured space velocities.
// Physics: straight-line motion p(t) = p0 + v t (Galactic Cartesian, light-years), evaluated per vertex on the GPU.
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

type Star = [number, number, number, number, number, number, number | null, number | null, number, string, number, number, string];
type Data = { n: number; stars: Star[]; approaches: { name: string; t: number; d: number }[] };

// BP-RP -> display colour (blue-white hot stars ... red dwarfs ... magenta brown dwarfs)
const STOPS: [number, [number, number, number]][] = [[-0.3, [155, 176, 255]], [0.4, [240, 244, 255]], [0.9, [255, 236, 200]], [1.5, [255, 205, 140]],
  [2.3, [255, 160, 95]], [3.2, [255, 110, 70]], [4.5, [235, 70, 80]], [6, [190, 60, 150]]];
function bpColor(b: number | null): THREE.Color {
  const x = b ?? 2.5; let i = 0; while (i < STOPS.length - 2 && x > STOPS[i + 1][0]) i++;
  const [x0, c0] = STOPS[i], [x1, c1] = STOPS[i + 1], f = Math.min(1, Math.max(0, (x - x0) / (x1 - x0)));
  return new THREE.Color(...c0.map((c, k) => (c + (c1[k] - c) * f) / 255) as [number, number, number]);
}

const VERT = `
  attribute vec3 vel; attribute vec3 col; attribute float size; attribute float hl;
  uniform float uTime; uniform float uPx;
  varying vec3 vCol; varying float vHl;
  void main() {
    vec3 p = position + vel * uTime;                        // exact straight-line space motion
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = clamp(size * uPx / -mv.z, 2.0, 46.0) * (1.0 + hl);
    vCol = col; vHl = hl;
  }`;
const FRAG = `
  varying vec3 vCol; varying float vHl;
  void main() {
    vec2 d = gl_PointCoord - 0.5; float r = length(d);
    if (r > 0.5) discard;
    float core = smoothstep(0.5, 0.0, r); float glow = pow(core, 2.2);
    vec3 c = mix(vCol, vec3(1.0), pow(core, 6.0) * 0.8);
    gl_FragColor = vec4(c * (0.25 + glow * 1.25), glow * 0.9 + vHl * 0.25 * core);
  }`;

export async function openNeighborhood(host: HTMLElement, focus?: string) {
  const r = await fetch(import.meta.env.BASE_URL + "data/neighbors.json"); const data = (await r.json()) as Data;
  host.innerHTML = `
    <div class="hood-canvas"></div>
    <div class="hood-labels"></div>
    <div class="hood-ui">
      <div class="eyebrow">Solar neighbourhood · ${data.n.toLocaleString()} stars within 65 light-years · Gaia DR3 + SPHEREx census</div>
      <h2 class="display">Year <span id="hyear">2016</span></h2>
      <p class="hood-sub" id="hsub">Drag to orbit · scroll to zoom · press play to run time. Every star moves along its measured space velocity.</p>
      <div class="hood-time"><button class="btn sm" id="hplay">▶ Play</button>
        <input type="range" id="htime" min="-50000" max="50000" step="10" value="0">
        <button class="btn sm ghost" id="hnow">Now</button></div>
      <div class="hood-speed eyebrow">Speed <button class="btn sm ghost" data-s="100">100 yr/s</button><button class="btn sm on" data-s="1000">1,000 yr/s</button><button class="btn sm ghost" data-s="5000">5,000 yr/s</button></div>
      <div class="eyebrow" style="margin-top:16px">Closest approaches to the Sun (straight-line, measured velocities)</div>
      <div class="hood-appr">${data.approaches.slice(0, 8).map((a, k) => `<button class="appr" data-k="${k}"><b>${a.name}</b><span>${a.d.toFixed(2)} ly · AD ${Math.round(2016 + a.t).toLocaleString()}</span></button>`).join("")}</div>
      <p class="note" style="margin-top:12px">Straight-line motion is accurate to better than 1% over ±100,000 years here; beyond that the Galaxy's gravity bends the paths.</p>
    </div>
    <div class="hood-info" id="hinfo"></div>
    <button class="icon-btn hood-close" id="hclose">✕</button>`;
  const W = () => host.clientWidth, H = () => host.clientHeight;
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.setSize(W(), H());
  host.querySelector(".hood-canvas")!.appendChild(renderer.domElement);
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0x000000);
  const camera = new THREE.PerspectiveCamera(55, W() / H(), 0.05, 2000); camera.position.set(28, -40, 22); camera.up.set(0, 0, 1);
  const controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = true; controls.dampingFactor = 0.06;
  controls.minDistance = 1; controls.maxDistance = 300; controls.autoRotate = true; controls.autoRotateSpeed = 0.25;
  // galactic plane rings (5, 10, 15, 20 pc) + direction to the Galactic centre
  for (const pc of [5, 10, 15, 20]) {
    const ring = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(Array.from({ length: 128 }, (_, k) => new THREE.Vector3(Math.cos(k / 128 * 2 * Math.PI) * pc * 3.26, Math.sin(k / 128 * 2 * Math.PI) * pc * 3.26, 0))),
      new THREE.LineBasicMaterial({ color: 0x5577aa, transparent: true, opacity: pc === 20 ? 0.35 : 0.18 }));
    scene.add(ring);
  }
  const gcLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(70, 0, 0)]), new THREE.LineDashedMaterial({ color: 0x8899bb, dashSize: 2, gapSize: 2, transparent: true, opacity: 0.4 }));
  gcLine.computeLineDistances(); scene.add(gcLine);
  // the Sun
  const sun = new THREE.Mesh(new THREE.SphereGeometry(0.35, 32, 16), new THREE.MeshBasicMaterial({ color: 0xffe9a8 })); scene.add(sun);
  const sunGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xffd27a, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  sunGlow.scale.set(5, 5, 1); scene.add(sunGlow);
  // stars (GPU-animated)
  const n = data.stars.length;
  const pos = new Float32Array(n * 3), vel = new Float32Array(n * 3), col = new Float32Array(n * 3), size = new Float32Array(n), hl = new Float32Array(n);
  const CENSUS = new Set(["Barnard's Star", "Epsilon Indi A", "Epsilon Indi B", "WISE 0855-0714", "Lacaille 9352", "GJ 1"]);
  data.stars.forEach((s, i) => {
    pos.set([s[0], s[1], s[2]], i * 3); vel.set([s[3], s[4], s[5]], i * 3);
    const c = bpColor(s[7]); col.set([c.r, c.g, c.b], i * 3);
    size[i] = s[6] === null ? 5 : Math.max(3, 22 - 1.45 * s[6]); hl[i] = CENSUS.has(s[9]) ? 1 : 0;
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3)); geo.setAttribute("vel", new THREE.BufferAttribute(vel, 3));
  geo.setAttribute("col", new THREE.BufferAttribute(col, 3)); geo.setAttribute("size", new THREE.BufferAttribute(size, 1)); geo.setAttribute("hl", new THREE.BufferAttribute(hl, 1));
  const mat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: { uTime: { value: 0 }, uPx: { value: 260 * Math.min(devicePixelRatio, 2) } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const points = new THREE.Points(geo, mat); scene.add(points);
  // labels for named stars (HTML, projected each frame: ~25 elements, negligible cost)
  const labelsEl = host.querySelector(".hood-labels") as HTMLElement;
  const named = data.stars.map((s, i) => ({ s, i })).filter((x) => x.s[9]);
  labelsEl.innerHTML = named.map((x) => `<span class="hlab ${CENSUS.has(x.s[9]) ? "census" : ""}">${x.s[9]}</span>`).join("");
  const labs = Array.from(labelsEl.children) as HTMLElement[];
  // time
  let t = 0, playing = false, speed = 1000, last = performance.now(), focusIdx = -1;
  const slider = host.querySelector("#htime") as HTMLInputElement, yearEl = host.querySelector("#hyear")!, sub = host.querySelector("#hsub")!;
  const setT = (v: number) => { t = Math.max(-50000, Math.min(50000, v)); slider.value = String(Math.round(t)); yearEl.textContent = fmtYear(2016 + t); };
  slider.oninput = () => { playing = false; playBtn.textContent = "▶ Play"; setT(+slider.value); };
  const playBtn = host.querySelector("#hplay") as HTMLButtonElement;
  playBtn.onclick = () => { playing = !playing; playBtn.textContent = playing ? "❚❚ Pause" : "▶ Play"; controls.autoRotate = false; };
  (host.querySelector("#hnow") as HTMLButtonElement).onclick = () => { playing = false; playBtn.textContent = "▶ Play"; setT(0); };
  host.querySelectorAll<HTMLButtonElement>(".hood-speed button").forEach((b) => b.onclick = () => {
    host.querySelectorAll(".hood-speed button").forEach((x) => { x.classList.remove("on"); x.classList.add("ghost"); }); b.classList.add("on"); b.classList.remove("ghost"); speed = +b.dataset.s!; });
  const at = (i: number, tt = t) => new THREE.Vector3(pos[i * 3] + vel[i * 3] * tt, pos[i * 3 + 1] + vel[i * 3 + 1] * tt, pos[i * 3 + 2] + vel[i * 3 + 2] * tt);
  const info = host.querySelector("#hinfo") as HTMLElement;
  function showInfo(i: number) {
    const s = data.stars[i]; focusIdx = i; const p = at(i), dist = p.length(), v = Math.hypot(s[3], s[4], s[5]) * 299792.458 * 3.16881e-8 * 3.15576e7 / 1; // ly/yr -> km/s
    info.innerHTML = `<div class="eyebrow">${s[8] ? "Gaia DR3 · measured 3D velocity" : "no radial velocity · sky motion only"}</div><h3 class="display">${s[9] || s[12] || "Gaia star"}</h3>
      <div class="kv2"><span>Distance at this time</span><b>${dist.toFixed(2)} ly</b><span>Space velocity</span><b>${(v).toFixed(1)} km/s</b>
      <span>Closest approach</span><b>${s[11].toFixed(2)} ly · AD ${Math.round(2016 + s[10]).toLocaleString()}</b><span>Colour (BP−RP)</span><b>${s[7] ?? "–"}</b></div>`;
    info.classList.add("on");
  }
  host.querySelectorAll<HTMLButtonElement>(".appr").forEach((b) => b.onclick = () => {
    const a = data.approaches[+b.dataset.k!]; const i = data.stars.findIndex((s) => (s[12] ?? s[9]) === a.name && Math.abs(s[10] - a.t) < 1);
    playing = false; playBtn.textContent = "▶ Play"; controls.autoRotate = false;
    tweenTime(a.t, 2200, () => { if (i >= 0) showInfo(i); }); if (i >= 0) flyCamera(at(i, a.t));
    sub.textContent = `${a.name} passes ${a.d.toFixed(2)} light-years from the Sun in AD ${Math.round(2016 + a.t).toLocaleString()} (today: ${at(i, 0).length().toFixed(2)} ly).`;
  });
  // picking: nearest projected star within 14 px
  renderer.domElement.addEventListener("click", (ev) => {
    const rect = renderer.domElement.getBoundingClientRect(); let best = -1, bd = 14;
    for (let i = 0; i < n; i++) { const q = at(i).project(camera); if (q.z > 1) continue;
      const x = (q.x + 1) / 2 * rect.width, y = (1 - q.y) / 2 * rect.height, d = Math.hypot(x - (ev.clientX - rect.left), y - (ev.clientY - rect.top));
      if (d < bd) { bd = d; best = i; } }
    if (best >= 0) showInfo(best);
  });
  // smooth tweens
  let tween: { from: number; to: number; t0: number; dur: number; done?: () => void } | null = null;
  function tweenTime(to: number, dur: number, done?: () => void) { tween = { from: t, to, t0: performance.now(), dur, done }; }
  let camTween: { from: THREE.Vector3; to: THREE.Vector3; t0: number } | null = null;
  function flyCamera(target: THREE.Vector3) { camTween = { from: controls.target.clone(), to: target, t0: performance.now() }; }
  const ease = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
  let raf = 0, alive = true;
  const onResize = () => { renderer.setSize(W(), H()); camera.aspect = W() / H(); camera.updateProjectionMatrix(); };
  addEventListener("resize", onResize);
  function frame(now: number) {
    if (!alive) return;
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (playing) { setT(t + speed * dt); if (Math.abs(t) >= 50000) { playing = false; playBtn.textContent = "▶ Play"; } }
    if (tween) { const f = Math.min(1, (now - tween.t0) / tween.dur); setT(tween.from + (tween.to - tween.from) * ease(f)); if (f >= 1) { const d = tween.done; tween = null; d?.(); } }
    if (camTween) { const f = Math.min(1, (now - camTween.t0) / 2200); controls.target.lerpVectors(camTween.from, camTween.to, ease(f)); if (f >= 1) camTween = null; }
    mat.uniforms.uTime.value = t;
    controls.update(); renderer.render(scene, camera);
    // labels
    const rect = renderer.domElement.getBoundingClientRect();
    named.forEach((x, k) => { const q = at(x.i).project(camera); const el = labs[k];
      if (q.z > 1 || Math.abs(q.x) > 1.1 || Math.abs(q.y) > 1.1) { el.style.display = "none"; return; }
      el.style.display = "block"; el.style.transform = `translate(${((q.x + 1) / 2 * rect.width + 8).toFixed(1)}px, ${((1 - q.y) / 2 * rect.height - 8).toFixed(1)}px)`; });
    if (focusIdx >= 0 && info.classList.contains("on")) { const d = at(focusIdx).length(); const b = info.querySelector(".kv2 b"); if (b) b.textContent = `${d.toFixed(2)} ly`; }
    raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);
  if (focus) { const i = data.stars.findIndex((s) => s[9] === focus); if (i >= 0) { controls.autoRotate = false; flyCamera(at(i)); showInfo(i); } }
  (host.querySelector("#hclose") as HTMLButtonElement).onclick = () => close();
  function close() { alive = false; cancelAnimationFrame(raf); removeEventListener("resize", onResize); renderer.dispose(); geo.dispose(); mat.dispose(); host.classList.remove("open"); host.innerHTML = ""; }
  host.classList.add("open");
  return close;
}

function fmtYear(y: number) { const r = Math.round(y); return r < 0 ? `${Math.abs(r).toLocaleString()} BC` : `AD ${r.toLocaleString()}`; }
let _glow: THREE.Texture | null = null;
export function glowTexture(): THREE.Texture {
  if (_glow) return _glow;
  const c = document.createElement("canvas"); c.width = c.height = 128; const g = c.getContext("2d")!;
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64); grd.addColorStop(0, "rgba(255,255,255,1)"); grd.addColorStop(0.2, "rgba(255,255,255,.6)"); grd.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grd; g.fillRect(0, 0, 128, 128); _glow = new THREE.CanvasTexture(c); return _glow;
}
