// RENDER THE FILM, frame by frame. The film page (/film/) drives the running site; here a virtual clock replaces the
// browser's, is advanced by exactly one frame at a time, and each frame is photographed. Nothing can stutter: the
// result is as smooth as the frame rate asked for, whatever the machine.
//
//   PLAYWRIGHT_CORE=/path/to/playwright-core/index.mjs node web/scripts/render_film.mjs --out /tmp/frames [--fps 30] [--url http://127.0.0.1:5173/film/] [--scale 1]
//   ffmpeg -framerate 30 -i /tmp/frames/f%05d.jpg -i music.m4a -c:v libx264 -crf 16 -pix_fmt yuv420p -c:a aac -shortest film.mp4
//
// It needs the dev server (npm run dev) or a preview of the built site, and Google Chrome.
import { mkdirSync } from "node:fs";
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const url = arg("url", "http://127.0.0.1:5173/film/"), fps = +arg("fps", "30"), out = arg("out", "./film_frames"), scale = +arg("scale", "1"), from = +arg("from", "0"), to = +arg("to", "30");
const { chromium } = await import(process.env.PLAYWRIGHT_CORE ?? "playwright-core");

// the virtual clock, installed in every frame before any of the site's code runs. Until freeze() it is the real
// clock; after it, time only moves when step(ms) is called.
const SHIM = () => {
  if (window.__vt) return;
  const R = { now: performance.now.bind(performance), raf: window.requestAnimationFrame.bind(window), caf: window.cancelAnimationFrame.bind(window), st: window.setTimeout.bind(window), ct: window.clearTimeout.bind(window), si: window.setInterval.bind(window), ci: window.clearInterval.bind(window) };
  const RealDate = Date, D0 = RealDate.now() - R.now(); let frozen = false, vnow = 0; const rafQ = new Map(), timers = new Map(); let ids = 1e9;
  const t = () => (frozen ? vnow : R.now());
  performance.now = t;
  window.Date = new Proxy(RealDate, { construct: (T, a) => (a.length ? new T(...a) : new T(D0 + t())), apply: (T, _th, a) => T(...a), get: (T, p) => (p === "now" ? () => D0 + t() : T[p]) });
  window.requestAnimationFrame = (fn) => { if (!frozen) return R.raf(() => fn(t())); const id = ++ids; rafQ.set(id, fn); return id; };
  window.cancelAnimationFrame = (id) => { rafQ.delete(id); R.caf(id); };
  window.setTimeout = (fn, ms = 0, ...a) => { if (!frozen || typeof fn !== "function") return R.st(fn, ms, ...a); const id = ++ids; timers.set(id, { at: vnow + ms, fn, a }); return id; };
  window.clearTimeout = (id) => { timers.delete(id); R.ct(id); };
  window.setInterval = (fn, ms = 0, ...a) => { if (!frozen || typeof fn !== "function") return R.si(fn, ms, ...a); const id = ++ids; timers.set(id, { at: vnow + ms, fn, a, every: Math.max(1, ms) }); return id; };
  window.clearInterval = (id) => { timers.delete(id); R.ci(id); };
  window.__vt = { realRaf: R.raf, freeze() { if (!frozen) { vnow = R.now(); frozen = true; } },
    step(dt) { vnow += dt;
      for (const [id, q] of [...timers]) if (q.at <= vnow) { if (q.every) q.at += q.every; else timers.delete(id); try { q.fn(...q.a); } catch (e) { console.warn(e); } }
      const cbs = [...rafQ.values()]; rafQ.clear(); for (const fn of cbs) { try { fn(vnow); } catch (e) { console.warn(e); } }
      try { document.getAnimations().forEach((a) => { a.pause(); a.currentTime = (Number(a.currentTime) || 0) + dt; }); } catch (e) { /* no animations */ } } };
};

mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader", "--autoplay-policy=no-user-gesture-required", "--hide-scrollbars"] });
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: scale });
await ctx.addInitScript(SHIM);
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("page error:", String(e).slice(0, 200)));
await page.goto(url, { waitUntil: "load", timeout: 120000 });
const t0 = Date.now(); process.stdout.write("preparing");
for (;;) { if (await page.evaluate(() => !!window.__film?.ready)) break; if (Date.now() - t0 > 420000) throw new Error("the film page did not become ready"); process.stdout.write("."); await new Promise((r) => setTimeout(r, 3000)); }
console.log(` ready in ${Math.round((Date.now() - t0) / 1000)} s`);
for (const f of page.frames()) await f.addStyleTag({ content: ".embed-out{display:none!important}" }).catch(() => {});
await page.evaluate(() => window.__film.start(true));
const N = Math.round(fps * to), dt = 1000 / fps, t1 = Date.now();
for (let k = 0; k <= N; k++) {
  await page.evaluate((d) => window.__vt.step(d), k ? dt : 0);
  if (k < Math.round(fps * from)) continue;
  await page.evaluate(() => window.__film.settle());
  await page.screenshot({ path: `${out}/f${String(k).padStart(5, "0")}.jpg`, type: "jpeg", quality: 96 });
  if (k % fps === 0) console.log(`${(k / fps).toFixed(0)} s of ${to} · ${Math.round((Date.now() - t1) / 1000)} s elapsed`);
}
await browser.close(); console.log("frames in", out);
