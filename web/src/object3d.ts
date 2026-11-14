// 3D impression of the selected object, driven by its measured properties (not decoration):
//   colour  = blackbody colour of the estimated temperature (stars: SPHEREx J/K colour; brown dwarfs: methane depth)
//   bands   = brown dwarfs (T < 2000 K) get banded, cloudy atmospheres like Jupiter's; stars get granulation + corona
//   disk    = a dusty disk when the spectrum shows hot-dust excess (young stars such as RW Aurigae)
// One shared WebGL renderer for every dossier (phones allow only a few GL contexts); renders only while visible.
import * as THREE from "three";
import type { Obj } from "./data";

export type Phys = { T: number; kind: "star" | "brown dwarf" | "young star" | "unknown"; disk: boolean; basis: string; radiusRsun?: number };
const KNOWN: Record<string, Phys> = {
  "Barnard's Star": { T: 3200, kind: "star", disk: false, basis: "M4 red dwarf, literature T ≈ 3200 K" },
  "WISE 0855-0714": { T: 285, kind: "brown dwarf", disk: false, basis: "Y4 brown dwarf, literature T ≈ 285 K (water clouds)" },
  "WISE 0855−0714": { T: 285, kind: "brown dwarf", disk: false, basis: "Y4 brown dwarf, literature T ≈ 285 K (water clouds)" },
  "Epsilon Indi B": { T: 1300, kind: "brown dwarf", disk: false, basis: "T1 + T6 binary brown dwarf, literature T ≈ 1300 / 900 K" },
  "RW Aurigae": { T: 4900, kind: "young star", disk: true, basis: "K-type T Tauri star with a dusty disk" },
  "R Draconis": { T: 2700, kind: "star", disk: false, basis: "Mira-type pulsating giant, T ≈ 2700 K" },
};

// F_nu ratio of a blackbody between two wavelengths (µm)
const bbRatio = (T: number, l1: number, l2: number) => {
  const c = 14387.77; // hc/k in µm·K
  return Math.pow(l2 / l1, 3) * (Math.exp(c / (l2 * T)) - 1) / (Math.exp(c / (l1 * T)) - 1);
};
export function estimatePhys(o: Obj, title?: string): Phys {
  if (title && KNOWN[title]) return KNOWN[title];
  // AI ensemble temperature (trained on Gaia + UltracoolSheet) when it is confident
  if (o.ai_teff && o.ai_cls !== null && o.ai_cls !== undefined && o.ai_cls < 3 && (o.ai_p ?? 0) > 0.6) {
    const T = Math.round(o.ai_teff / 10) * 10, disk = (o.idx_hotdust ?? 0) > 0.5;
    return { T, kind: o.ai_cls === 2 ? "brown dwarf" : disk ? "young star" : "star", disk, basis: `AI from its SPHEREx spectrum → T ≈ ${T.toLocaleString()} K` };
  }
  const ch4 = o.methane_ratio, sig = o.methane_sigma ?? 0;
  if (ch4 !== null && sig > 5 && ch4 > -0.05 && ch4 < 0.6) {
    const T = Math.round(Math.min(1400, Math.max(300, 350 + 1900 * Math.max(0, ch4))) / 10) * 10;
    return { T, kind: "brown dwarf", disk: false, basis: `methane absorbs ${Math.round((1 - ch4) * 100)}% of its 3.3 µm light → T ≈ ${T} K (rough)` };
  }
  const J = (o as any).sx_J_uJy as number | null, K = (o as any).sx_K_uJy as number | null;
  const disk = (o.idx_hotdust ?? 0) > 0.5;
  if (J && K && J > 0 && K > 0) {
    const r = J / K; let lo = 600, hi = 40000;                       // bisection on the J/K blackbody colour
    for (let i = 0; i < 40; i++) { const m = Math.sqrt(lo * hi); if (bbRatio(m, 1.25, 2.2) < r) lo = m; else hi = m; }
    const T = Math.round(Math.sqrt(lo * hi) / 50) * 50;
    return { T: Math.min(30000, T), kind: disk ? "young star" : T < 2000 ? "brown dwarf" : "star", disk, basis: `SPHEREx 1.25/2.2 µm colour → blackbody T ≈ ${T} K` };
  }
  return { T: 3000, kind: "unknown", disk, basis: "too faint in SPHEREx for a temperature; shown as a generic cool star" };
}

// blackbody -> sRGB (Tanner Helland fit), with an infrared false-colour ramp below 1000 K (such worlds emit almost no visible light)
export function tempColor(T: number): THREE.Color {
  if (T < 1000) { const f = Math.max(0, (T - 250) / 750); return new THREE.Color().setRGB(0.32 + 0.45 * f, 0.07 + 0.08 * f, 0.30 - 0.12 * f); }
  const t = T / 100; let r: number, g: number, b: number;
  if (t <= 66) { r = 255; g = 99.47 * Math.log(t) - 161.12; b = t <= 19 ? 0 : 138.52 * Math.log(t - 10) - 305.04; }
  else { r = 329.7 * Math.pow(t - 60, -0.1332); g = 288.12 * Math.pow(t - 60, -0.0755); b = 255; }
  const c = (x: number) => Math.min(255, Math.max(0, x)) / 255;
  return new THREE.Color().setRGB(c(r), c(g), c(b));
}

const NOISE = `
  vec3 hash3(vec3 p){ p = fract(p * 0.3183099 + .1); p *= 17.0; return fract(vec3(p.x*p.y*p.z, p.x+p.y*p.z, p.x*p.y+p.z)); }
  float noise(vec3 x){ vec3 i = floor(x); vec3 f = fract(x); f = f*f*(3.0-2.0*f);
    return mix(mix(mix(hash3(i).x, hash3(i+vec3(1,0,0)).x, f.x), mix(hash3(i+vec3(0,1,0)).x, hash3(i+vec3(1,1,0)).x, f.x), f.y),
               mix(mix(hash3(i+vec3(0,0,1)).x, hash3(i+vec3(1,0,1)).x, f.x), mix(hash3(i+vec3(0,1,1)).x, hash3(i+vec3(1,1,1)).x, f.x), f.y), f.z); }
  float fbm(vec3 p){ float a = .5, s = 0.; for (int i = 0; i < 5; i++){ s += a * noise(p); p *= 2.03; a *= .5; } return s; }`;
const BODY_V = `varying vec3 vN; varying vec3 vP; varying vec3 vV;
  void main(){ vN = normalize(normalMatrix * normal); vP = position; vec4 mv = modelViewMatrix * vec4(position,1.); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`;
const BODY_F = `uniform vec3 uCol; uniform float uTime; uniform float uBD; uniform float uSeed;
  varying vec3 vN; varying vec3 vP; varying vec3 vV; ${NOISE}
  void main(){
    float mu = clamp(dot(normalize(vN), normalize(vV)), 0., 1.);
    vec3 p = normalize(vP);
    vec3 c;
    if (uBD > 0.5) {   // banded atmosphere: latitude bands + turbulent cloud fbm advected with differential rotation
      float lat = p.y; float shear = uTime * (0.05 + 0.12 * cos(lat * 9.0));
      vec3 q = vec3(p.x * cos(shear) - p.z * sin(shear), p.y, p.x * sin(shear) + p.z * cos(shear));
      float bands = sin(lat * 14.0 + fbm(q * 3.0 + uSeed) * 3.2);
      float clouds = fbm(q * 6.0 + vec3(0., uTime * .03, uSeed));
      c = uCol * (0.62 + 0.28 * bands + 0.35 * (clouds - .5));
      c *= 0.45 + 0.75 * pow(mu, 0.6);                                     // thermal limb darkening
    } else {           // star: granulation cells + limb darkening (Eddington approximation)
      float gran = fbm(p * 22.0 + vec3(uTime * .05, 0., uSeed));
      float spots = smoothstep(.70, .78, fbm(p * 3.5 + uSeed + uTime * .01));
      c = uCol * (0.85 + 0.35 * (gran - .5)) * (1. - .55 * spots);
      c *= 0.4 + 0.6 * (0.4 + 0.6 * mu);
      c += uCol * 0.25 * pow(1. - mu, 3.);
    }
    gl_FragColor = vec4(c, 1.);
  }`;
const DISK_F = `uniform vec3 uCol; uniform float uTime; varying vec2 vUv; ${NOISE}
  void main(){ vec2 d = vUv - .5; float r = length(d) * 2.; if (r < .34 || r > 1.) discard;
    float a = atan(d.y, d.x); float n = fbm(vec3(r * 9., a * 3. + uTime * .25 / (r + .2), 1.7));
    float dens = smoothstep(.34, .45, r) * (1. - smoothstep(.7, 1., r)) * (.45 + .9 * n);
    vec3 c = mix(vec3(1., .72, .45), vec3(.55, .25, .2), r) * (1.2 - r * .6);
    gl_FragColor = vec4(c * dens, dens * .9); }`;

let R: { renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera } | null = null;
function shared() {
  if (R) return R;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  const scene = new THREE.Scene(); const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100); camera.position.set(0, 0.6, 4.2); camera.lookAt(0, 0, 0);
  R = { renderer, scene, camera }; return R;
}

export function mountObject3D(host: HTMLElement, o: Obj, title?: string): () => void {
  const ph = estimatePhys(o, title);
  const { renderer, scene, camera } = shared();
  while (scene.children.length) scene.remove(scene.children[0]);
  host.innerHTML = `<div class="o3d-stage"></div><div class="o3d-cap"><b>${ph.kind === "unknown" ? "Object" : ph.kind} · ≈ ${ph.T.toLocaleString()} K</b>
    <span>${ph.basis}. Colour is the light such a body would emit${ph.T < 1000 ? " (false colour: it is almost dark in visible light)" : ""}. Not to scale. Drag to rotate.</span></div>`;
  const stage = host.querySelector(".o3d-stage") as HTMLElement; stage.appendChild(renderer.domElement);
  const col = tempColor(ph.T); const bd = ph.kind === "brown dwarf" || ph.T < 2000;
  const uni = { uCol: { value: col }, uTime: { value: 0 }, uBD: { value: bd ? 1 : 0 }, uSeed: { value: (o.obj % 97) * 0.37 } };
  const body = new THREE.Mesh(new THREE.SphereGeometry(1, 96, 64), new THREE.ShaderMaterial({ vertexShader: BODY_V, fragmentShader: BODY_F, uniforms: uni }));
  body.rotation.z = 0.35; scene.add(body);
  // glow halo (corona for stars, faint thermal haze for brown dwarfs)
  const glowC = document.createElement("canvas"); glowC.width = glowC.height = 128; const g = glowC.getContext("2d")!;
  const grd = g.createRadialGradient(64, 64, 30, 64, 64, 64); grd.addColorStop(0, `rgba(255,255,255,${bd ? .25 : .6})`); grd.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(glowC), color: col, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  halo.scale.set(bd ? 2.6 : 3.4, bd ? 2.6 : 3.4, 1); scene.add(halo);
  let disk: THREE.Mesh | null = null;
  if (ph.disk) {
    disk = new THREE.Mesh(new THREE.PlaneGeometry(5.2, 5.2), new THREE.ShaderMaterial({ fragmentShader: DISK_F, uniforms: { uCol: { value: col }, uTime: uni.uTime },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }`, transparent: true, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
    disk.rotation.x = -1.25; scene.add(disk);
  }
  // drag to spin (inertial)
  let vx = 0.25, dragging = false, px = 0, tilt = 0.35;
  const el = renderer.domElement;
  el.onpointerdown = (e) => { dragging = true; px = e.clientX; el.setPointerCapture(e.pointerId); };
  el.onpointermove = (e) => { if (!dragging) return; vx = (e.clientX - px) * 0.01 / 0.016; px = e.clientX; tilt = Math.max(-0.8, Math.min(0.8, tilt + e.movementY * 0.004)); };
  el.onpointerup = () => { dragging = false; };
  let visible = true, alive = true, raf = 0, last = performance.now();
  const io = new IntersectionObserver((es) => { visible = es[0].isIntersecting; if (visible && alive && !raf) raf = requestAnimationFrame(loop); });
  io.observe(stage);
  const size = () => { const w = stage.clientWidth || 400, h = stage.clientHeight || 240; renderer.setSize(w, h, false); el.style.width = "100%"; el.style.height = "100%"; camera.aspect = w / h; camera.updateProjectionMatrix(); };
  size(); const ro = new ResizeObserver(size); ro.observe(stage);
  function loop(now: number) {
    raf = 0; if (!alive || !visible) return;
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (!dragging) vx += (0.25 - vx) * Math.min(1, dt * 1.5);
    body.rotation.y += vx * dt; body.rotation.z += (tilt - body.rotation.z) * Math.min(1, dt * 4);
    uni.uTime.value += dt; renderer.render(scene, camera); raf = requestAnimationFrame(loop);
  }
  raf = requestAnimationFrame(loop);
  return () => { alive = false; cancelAnimationFrame(raf); io.disconnect(); ro.disconnect(); body.geometry.dispose(); (body.material as THREE.Material).dispose(); disk?.geometry.dispose(); };
}
