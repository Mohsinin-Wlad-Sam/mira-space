// THE DECK AS A PDF: seven pages, one per slide, for uploading where a link to the live deck is not enough.
//   PLAYWRIGHT_CORE=/path/to/playwright-core/index.mjs node web/scripts/deck_pdf.mjs [--url http://127.0.0.1:4173/deck/] [--out media/MIRA_deck.pdf]
// The live frames of the product are replaced by their still pictures (a PDF cannot run the site).
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const url = arg("url", "http://127.0.0.1:4173/deck/"), out = arg("out", "media/MIRA_deck.pdf");
const { chromium } = await import(process.env.PLAYWRIGHT_CORE ?? "playwright-core");
const browser = await chromium.launch({ channel: "chrome", headless: true }), page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await page.goto(url, { waitUntil: "networkidle", timeout: 120000 }); await page.waitForTimeout(3500);
await page.evaluate(async () => {
  const fmt = (n) => (n >= 1e6 ? (n / 1e6).toFixed(2).replace(/0$/, "") + " M" : n.toLocaleString("en-US"));
  document.querySelectorAll("[data-count]").forEach((el) => (el.textContent = fmt(+el.dataset.count)));
  document.querySelectorAll("iframe").forEach((f) => f.remove()); await document.fonts.ready;
});
await page.emulateMedia({ media: "print" });
await page.pdf({ path: out, width: "1600px", height: "900px", printBackground: true, preferCSSPageSize: true, margin: { top: "0", right: "0", bottom: "0", left: "0" } });
await browser.close(); console.log("written", out);
