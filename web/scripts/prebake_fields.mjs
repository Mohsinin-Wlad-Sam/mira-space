// PREPARE THE TEST FIELDS. Opens each of NASA's five test targets in the Lab (in a headless browser, against the dev
// server or a preview of the built site), waits until everything for the field has been read from the archive, and
// saves it as one compressed file under web/public/data/lab/. Run it after each SPHEREx data release (after
// deploy/update_spherex.sh): a prepared field is only used while the exposure index it was read with is current.
//
//   PLAYWRIGHT_CORE=/path/to/playwright-core/index.mjs node web/scripts/prebake_fields.mjs [--url http://127.0.0.1:5173] [--out web/public/data/lab]
import { mkdirSync, writeFileSync } from "node:fs";
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const base = arg("url", "http://127.0.0.1:5173"), out = arg("out", "web/public/data/lab"), targets = (arg("targets", "barnard,eps-indi-b,wise-0855,rw-aur,r-dra")).split(",");
const { chromium } = await import(process.env.PLAYWRIGHT_CORE ?? "playwright-core");
const file = (key) => { let h = 5381; for (let i = 0; i < key.length; i++) h = ((h * 33) ^ key.charCodeAt(i)) >>> 0; return `f${h.toString(16)}.bin`; };
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true }), page = await (await browser.newContext({ acceptDownloads: true })).newPage(), fields = {};
for (const t of targets) {
  await page.goto(`${base}/explore/?embed=1&deck=1&target=${t}`); const t0 = Date.now(); let ok = false;
  while (Date.now() - t0 < 240000 && !ok) { await page.waitForTimeout(3000); ok = await page.evaluate(async () => !!(await window.__mira?.lab?.dump?.())).catch(() => false); }
  if (!ok) { console.log(t, "could not be read in time: skipped"); continue; }
  const [dl] = await Promise.all([page.waitForEvent("download"), page.evaluate(async () => { const d = await window.__mira.lab.dump(); window.__key = d.key; const a = document.createElement("a"); a.href = URL.createObjectURL(d.blob); a.download = "field.bin"; document.body.appendChild(a); a.click(); })]);
  const key = await page.evaluate(() => window.__key); await dl.saveAs(`${out}/${file(key)}`); fields[key] = file(key); console.log(t, "->", file(key), `${Math.round((Date.now() - t0) / 1000)} s`);
}
writeFileSync(`${out}/index.json`, JSON.stringify({ about: "Prepared copies of the Lab's test fields (web/src/blink/fieldpack.ts). Each is used only while the exposure index it was read with is current.", built: new Date().toISOString(), fields }, null, 1));
await browser.close();
