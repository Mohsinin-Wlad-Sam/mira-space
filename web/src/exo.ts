// Known planetary systems (NASA Exoplanet Archive) in MIRA Space: a ring marks every host; selecting one shows its
// planets on their real orbits (semi-major axis, period), sized by their measured radius. Orbits are drawn edge-on
// as seen from Earth — the geometry that lets most of them be found by transits.
import * as THREE from "three";
import { AU } from "./bodies";

const KM = 3.2407792894443654e-14;
export type Planet = [string, number | null, number | null, number | null, number | null, number, string];   // name, R_earth, P_days, a_au, Teq, year, method
export type Host = [string, number, number, number, number, number, Planet[]];

// markers only for hosts at the scale being looked at (fade beyond ~2x the viewing distance)
const MARK_VERT = `attribute float vis; uniform float uPx; uniform float uScale; varying float vA;
  void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * mv; float d = length(mv.xyz);
    vA = vis * clamp(1.3 - d / (uScale * 0.9), 0.0, 1.0) * 0.6; gl_PointSize = vA > 0.01 && mv.z < 0.0 ? 8.0 * uPx : 0.0; }`;
const MARK_FRAG = `varying float vA; void main(){ float r = length(gl_PointCoord - 0.5) * 2.0; float ring = smoothstep(0.62, 0.72, r) * (1.0 - smoothstep(0.86, 0.98, r));
  if (ring < 0.02) discard; gl_FragColor = vec4(vec3(0.36, 0.89, 0.65) * ring * vA, 1.0); }`;

export class Exo {
  hosts: Host[] = []; star: Int32Array = new Int32Array(0);   // matched census/neighbour index per host (−1 if none)
  byStar = new Map<number, number>();
  points: THREE.Points | null = null; mat: THREE.ShaderMaterial;
  sys = new THREE.Group(); sysHost = -1; planetPos: THREE.Vector3[] = []; private planetMeshes: THREE.Mesh[] = []; private normal = new THREE.Vector3(); private u = new THREE.Vector3(); private v = new THREE.Vector3();
  private scene: THREE.Scene;
  constructor(scene: THREE.Scene, dpr: number) {
    this.scene = scene;
    this.mat = new THREE.ShaderMaterial({ vertexShader: MARK_VERT, fragmentShader: MARK_FRAG, transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, uniforms: { uPx: { value: dpr }, uScale: { value: 30 } } });
    scene.add(this.sys);
  }
  async load(url: string) {
    const j = await fetch(url).then((r) => r.json()).catch(() => null); if (!j) return 0;
    this.hosts = j.hosts as Host[];
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(this.hosts.flatMap((h) => [h[1], h[2], h[3]])), 3));
    g.setAttribute("vis", new THREE.BufferAttribute(new Float32Array(this.hosts.length).fill(1), 1));
    this.points = new THREE.Points(g, this.mat); this.points.frustumCulled = false; this.points.renderOrder = 3; this.scene.add(this.points);
    return this.hosts.length;
  }
  /** link hosts to catalogue objects: nearest within 0.5% of the distance (+0.01 pc) */
  attach(n: number, pos: (i: number) => THREE.Vector3, named: (i: number) => string | null) {
    this.star = new Int32Array(this.hosts.length).fill(-1); this.byStar.clear();
    const grid = new Map<string, number[]>(), cell = 0.5, key = (x: number, y: number, z: number) => `${Math.floor(x / cell)},${Math.floor(y / cell)},${Math.floor(z / cell)}`;
    for (let i = 0; i < n; i++) { const p = pos(i); if (p.lengthSq() > 2500) continue; const k = key(p.x, p.y, p.z); (grid.get(k) ?? grid.set(k, []).get(k)!).push(i); }   // within 50 pc
    const hp = new THREE.Vector3();
    this.hosts.forEach((h, k) => {
      hp.set(h[1], h[2], h[3]); const d = hp.length(); if (d > 50) return;
      const tol = 0.005 * d + 0.01; let best = -1, bd = tol;
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
        const ids = grid.get(`${Math.floor(hp.x / cell) + dx},${Math.floor(hp.y / cell) + dy},${Math.floor(hp.z / cell) + dz}`); if (!ids) continue;
        for (const i of ids) { const dd = pos(i).distanceTo(hp); if (dd < bd) { bd = dd; best = i; } }
      }
      if (best >= 0) { this.star[k] = best; this.byStar.set(best, k); }
    });
    void named;
  }
  setVisible(on: boolean) { if (this.points) this.points.visible = on; }

  /** show host k's planets around position c (moving with the star) */
  show(k: number) {
    this.sys.clear(); this.planetMeshes = []; this.planetPos = []; this.sysHost = k; if (k < 0) return;
    const h = this.hosts[k];
    const los = new THREE.Vector3(h[1], h[2], h[3]).normalize();
    this.normal.crossVectors(los, new THREE.Vector3(0, 0, 1)).normalize();          // orbit plane contains our line of sight: edge-on from Earth
    this.u.copy(los); this.v.crossVectors(this.normal, this.u).normalize();
    const mat = new THREE.LineBasicMaterial({ color: 0x5be3a6, transparent: true, opacity: 0.45, depthWrite: false });
    h[6].forEach((p, i) => {
      const a = (p[3] ?? Math.cbrt(Math.pow((p[2] ?? 10) / 365.25, 2))) * AU;
      const pts: THREE.Vector3[] = []; for (let s = 0; s <= 128; s++) { const t = s / 128 * Math.PI * 2; pts.push(this.u.clone().multiplyScalar(Math.cos(t) * a).addScaledVector(this.v, Math.sin(t) * a)); }
      this.sys.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat));
      const R = (p[1] ?? 1) * 6371 * KM, T = p[4] ?? 300;
      const col = T > 1000 ? 0xff8a5c : T > 500 ? 0xe0b070 : T > 330 ? 0xc9a27a : T > 200 ? 0x6fa8dc : 0x9fc5e8;
      const m = new THREE.Mesh(new THREE.SphereGeometry(R, 32, 24), new THREE.MeshBasicMaterial({ color: col })); m.renderOrder = 10;
      const dot = new THREE.Mesh(new THREE.CircleGeometry(1, 16), new THREE.MeshBasicMaterial({ color: 0x5be3a6, transparent: true, opacity: 0.9, depthTest: false })); dot.renderOrder = 12;
      m.userData = { a, P: p[2] ?? 365, phase: (i * 0.618) % 1, dot }; this.sys.add(m, dot); this.planetMeshes.push(m); this.planetPos.push(new THREE.Vector3());
    });
  }
  /** year = timeline year; center = current host position */
  setScale(d: number) { this.mat.uniforms.uScale.value = d; }
  update(year: number, center: THREE.Vector3 | null, camera: THREE.PerspectiveCamera, pxPerRad: number) {
    if (this.sysHost < 0 || !center) { this.sys.visible = false; return; }
    this.sys.visible = true; this.sys.position.copy(center);
    const days = (year - 2025.84) * 365.25;
    this.planetMeshes.forEach((m, i) => {
      const { a, P, phase, dot } = m.userData as { a: number; P: number; phase: number; dot: THREE.Mesh };
      const t = (phase + days / P) * Math.PI * 2;
      m.position.copy(this.u).multiplyScalar(Math.cos(t) * a).addScaledVector(this.v, Math.sin(t) * a);
      this.planetPos[i].copy(m.position).add(center);
      const d = camera.position.distanceTo(this.planetPos[i]);
      dot.position.copy(m.position); dot.quaternion.copy(camera.quaternion); dot.scale.setScalar(2.5 / pxPerRad * d);
      dot.visible = (m.geometry as THREE.SphereGeometry).parameters.radius / Math.max(d, 1e-15) * pxPerRad < 2;
    });
  }
}
