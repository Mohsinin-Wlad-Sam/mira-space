/** THE OPENING WAVE. When the Sky or the Universe opens, the picture arrives behind a ring that spreads from where the
 * visitor clicked: at the ring the view is bent as through a lens and split into colours, behind it the view is
 * itself, ahead of it there is still the dark.
 *
 * The idea is that of "Distortion Waves", a screen transition for SwiftUI (libraries.dev/waves, MIT licence, by Jakub
 * Antalik), which is made of Metal shaders and cannot run in a browser. This is a WebGL version written for this
 * site with its own shader: it bends the live picture of the map that is opening (read from its canvas on every
 * frame), so nothing is a recording. Not played when the visitor asks for reduced motion, nor in the film and deck. */
const VS = `attribute vec2 p; void main(){ gl_Position = vec4(p, 0., 1.); }`;
const FS = `precision highp float;
uniform sampler2D T; uniform vec2 R, C; uniform float P, A, H;     // size, centre (pixels, y up), progress, reach, 1 if the picture could be read
vec3 pal(float t){ return .55 + .45 * cos(6.2831853 * (t + vec3(.02, .36, .68))); }
void main(){
  vec2 q = gl_FragCoord.xy, d = (q - C) / R.y; float r = length(d); vec2 n = r > 1e-4 ? d / r : vec2(0.);
  float w = mix(.09, .20, P), x = (r - P * A) / w, lens = exp(-x * x * 3.);
  vec2 o = n * (-.08 * (1. - .5 * P) * lens * sign(x + 1e-4)) * vec2(R.y / R.x, 1.), uv = q / R;
  float ab = .4 * lens;
  vec3 c = H * vec3(texture2D(T, uv + o * (1. + ab)).r, texture2D(T, uv + o).g, texture2D(T, uv + o * (1. - ab)).b);
  float seen = smoothstep(.6, -.4, x);
  vec3 rim = pal(atan(d.y, d.x) / 6.2831853 + P * .6 + r * .3) * lens * (1. - P * P) * .5;
  float a = 1. - seen * (1. - lens * .92);
  gl_FragColor = vec4(c * seen * lens * .92 + rim * a, a);
}`;
export type Wave = { /** the map is ready: the ring starts from here */ go: (src: HTMLCanvasElement | null) => void; cancel: () => void };
const still = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Lay the dark over the place where the map will be, at once; `go` then lets the ring travel. Returns null where it cannot or should not play. */
export function openingWave(at: [number, number] | null, ms = 1250): Wave | null {
  if (still()) return null;
  const cv = document.createElement("canvas"), gl = cv.getContext("webgl", { premultipliedAlpha: true, alpha: true, antialias: false });
  if (!gl) return null;
  const k = Math.min(1.5, devicePixelRatio || 1), W = Math.round(innerWidth * k), Hh = Math.round(innerHeight * k); cv.width = W; cv.height = Hh;
  Object.assign(cv.style, { position: "fixed", inset: "0", width: "100vw", height: "100vh", zIndex: "40", pointerEvents: "none" }); cv.setAttribute("aria-hidden", "true");
  const sh = (type: number, src: string) => { const s = gl.createShader(type)!; gl.shaderSource(s, src); gl.compileShader(s); return s; };
  const pr = gl.createProgram()!; gl.attachShader(pr, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(pr);
  if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) return null;
  gl.useProgram(pr); const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(pr, "p"); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  for (const [a, b] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, a, b);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
  const U = (n: string) => gl.getUniformLocation(pr, n), cx = (at ? at[0] : innerWidth / 2) * k, cy = Hh - (at ? at[1] : innerHeight * 0.42) * k;
  const reach = Math.max(Math.hypot(cx, cy), Math.hypot(W - cx, cy), Math.hypot(cx, Hh - cy), Math.hypot(W - cx, Hh - cy)) / Hh + 0.45;
  gl.uniform2f(U("R"), W, Hh); gl.uniform2f(U("C"), cx, cy); gl.uniform1f(U("A"), reach); gl.viewport(0, 0, W, Hh);
  let src: HTMLCanvasElement | null = null, t0 = 0, raf = 0, readable = true, done = false;
  const draw = (p: number) => {
    let has = 0;
    if (src && readable && src.width > 1) { try { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src); has = 1; } catch { readable = false; } }      // a picture that holds tiles from another site may not be read: the ring then opens on the dark alone
    gl.uniform1f(U("P"), p); gl.uniform1f(U("H"), has); gl.drawArrays(gl.TRIANGLES, 0, 3);
  };
  const end = () => { if (done) return; done = true; cancelAnimationFrame(raf); clearTimeout(guard); cv.remove(); gl.getExtension("WEBGL_lose_context")?.loseContext(); };
  const step = (now: number) => { const u = Math.min(1, (now - t0) / ms), e = u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2; draw(e); if (u < 1) raf = requestAnimationFrame(step); else end(); };
  document.body.appendChild(cv); draw(0);
  const guard = window.setTimeout(() => { if (!t0) { t0 = performance.now(); raf = requestAnimationFrame(step); } }, 2500);      // a map that is slow to come does not leave the page dark
  return { go: (s) => { if (done || t0) return; src = s; t0 = performance.now(); raf = requestAnimationFrame(step); }, cancel: end };
}
