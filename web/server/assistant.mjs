// The assistant's server side: one small handler shared by the dev server (vite.config.ts) and the production proxy
// (deploy/assistant-proxy.mjs). It holds the model key (never sent to the browser, never in the repository), owns the
// instructions and the list of tools, limits how often it can be called, and forwards to an OpenAI-compatible endpoint.
//   env: MIRA_LLM_KEY (required)   MIRA_LLM_URL (default https://api.ifm.ai/v1)   MIRA_LLM_MODEL (default K2 Horizon)
const SYSTEM = `You are the assistant of MIRA, a digital research observatory: a web Lab whose instruments measure NASA SPHEREx Level-2 exposures (0.75–5 µm, 102 wavelength channels on 6 detectors, 6.15 arcsec pixels, each sky position revisited about every 6 months since April 2025).
The Lab works on one field at a time (3.3 to 13 arcmin wide). Its instruments: Evolution (deep image per visit on a time bar), Motion detector (every source of the field: moved / brighter / fainter / new / steady, with significance and Gaia identity), Astrometer (position against time with 2MASS ~1999, AllWISE 2010.5 and SPHEREx visits; proper motion; parallax), Spectrograph (0.75–5 µm spectrum; methane at 3.3 µm marks cold brown dwarfs and giant planets), Photometer (brightness against 2MASS and AllWISE, and visit to visit), Detection limits (which planet or brown dwarf this field's depth would reveal, and out to what distance).
The Catalogue is the verified survey: motion claims from 16 years of WISE data that were re-measured on raw SPHEREx exposures and confirmed. Cases are the visitor's saved measurements. Universe is a 3D map for context.
The motivating problem is "Planet X": an unknown cold body near the Sun shows itself by moving against the stars; the same instruments serve any star, brown dwarf or variable source.

How to work:
- You receive PAGE, a JSON snapshot of what the visitor sees. Base every number you state on PAGE or on a tool result. If a number is not there, say it is not measured; never invent values, identifiers or references.
- You can operate the site with tools. When the visitor asks to open, find, show, compare or filter something, do it with a tool, then describe what the result shows. After open_field the result already contains the measurements.
- Answer first in one or two plain sentences a non-astronomer can follow, then, if useful, the technical statement with the numbers and their uncertainties. Keep it under 130 words unless asked for more. No headings. Units always.
- Be honest about limits: SPHEREx-only motion needs more than about 2.5 arcsec/yr; slower motions rely on the 2010 and 1999 catalogue positions; blended, saturated and edge sources are not judged; Planet Nine as proposed is below SPHEREx depth.
- Coordinates are ICRS degrees unless the visitor writes them otherwise.
- Speak about what is on the screen in the visitor's words ("the Motion detector lists…", "no Gaia motion"), never with the names of JSON fields or tools. Do not add comparisons, distances or identifications that are not in PAGE.`;
const TOOLS = [
  { name: "open_field", description: "Point the Lab at an object (by name, e.g. 'Luhman 16') or at coordinates ('RA Dec' in degrees or sexagesimal), read its SPHEREx exposures and run all instruments. Returns the measured page state when the exposures are in (about 20 seconds).",
    parameters: { type: "object", properties: { target: { type: "string", description: "object name or coordinates" } }, required: ["target"] } },
  { name: "lab_control", description: "Operate the Lab on the field that is open: choose an instrument panel, select a source by its number in the Motion detector, change the image view, move the time bar, play or pause, switch overlays.",
    parameters: { type: "object", properties: {
      instrument: { type: "string", enum: ["changes", "motion", "spectrum", "light", "limits", "frames", "export"], description: "changes = Motion detector, motion = Astrometer, spectrum = Spectrograph, light = Photometer, limits = Detection limits, frames = Exposures" },
      select: { type: "integer", description: "number of the source to point the instruments at" }, view: { type: "string", enum: ["evolve", "frames", "rgb", "diff"] },
      range: { type: "string", enum: ["sx", "2010", "1999"], description: "how far back the time bar reaches" }, date: { type: "number", description: "decimal year to move the time bar to" }, play: { type: "boolean" },
      layers: { type: "object", properties: { det: { type: "boolean" }, gaia: { type: "boolean" }, wise: { type: "boolean" }, mask: { type: "boolean" }, track: { type: "boolean" } } } } } },
  { name: "catalogue_query", description: "Open the Catalogue and filter or sort the verified movers; returns the matching count and the first rows. Use select with a census id to pick a row; open=true sends the selected row to the Lab.",
    parameters: { type: "object", properties: {
      filter: { type: "string", enum: ["all", "nogaia", "red", "methane", "wd", "fast", "changes"], description: "nogaia = confirmed movers without a Gaia motion; red = W1-W2 > 0.6 (cold); methane = methane dip; wd = white dwarfs; fast = above 1 arcsec/yr; changes = verified brightness changes" },
      include_plane: { type: "boolean", description: "also list rows within 10 degrees of the Galactic plane (crowded, less reliable; hidden by default)" }, min_motion: { type: "number", description: "arcsec per year" }, max_motion: { type: "number" }, search: { type: "string" }, sort: { type: "string", enum: ["pm", "conf", "kind", "known", "W2", "w12", "simbad"] }, descending: { type: "boolean" },
      select: { type: "string", description: "census id, e.g. 6661-325678" }, view: { type: "string", enum: ["rpm", "sky"] }, open: { type: "boolean" } } } },
  { name: "navigate", description: "Go to a section of the site.", parameters: { type: "object", properties: { section: { type: "string", enum: ["lab", "catalogue", "cases", "universe", "method"] } }, required: ["section"] } },
  { name: "get_page", description: "Read the current page state again (after the visitor or a tool changed it).", parameters: { type: "object", properties: {} } },
].map((f) => ({ type: "function", function: f }));

const hits = new Map(); let day = "", dayCount = 0;
function limited(ip) {
  const now = Date.now(), today = new Date().toISOString().slice(0, 10);
  if (today !== day) { day = today; dayCount = 0; }
  if (++dayCount > +(process.env.MIRA_LLM_DAILY ?? 4000)) return "The assistant has reached its daily limit. It will be back tomorrow.";
  const L = (hits.get(ip) ?? []).filter((t) => now - t < 600000); L.push(now); hits.set(ip, L);
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.length || now - v[v.length - 1] > 600000) hits.delete(k);
  return L.length > +(process.env.MIRA_LLM_PER10MIN ?? 40) ? "Too many questions in a short time. Wait a few minutes." : "";
}
const clip = (s, n) => (typeof s === "string" ? s.slice(0, n) : "");
function clean(messages) {
  const out = [];
  for (const m of Array.isArray(messages) ? messages.slice(-24) : []) {
    if (m?.role === "user") out.push({ role: "user", content: clip(m.content, 2000) });
    else if (m?.role === "assistant") out.push({ role: "assistant", content: clip(m.content, 6000), ...(Array.isArray(m.tool_calls) ? { tool_calls: m.tool_calls.slice(0, 6).map((t) => ({ id: clip(t.id, 80), type: "function", function: { name: clip(t.function?.name, 40), arguments: clip(t.function?.arguments, 2000) } })) } : {}) });
    else if (m?.role === "tool") out.push({ role: "tool", tool_call_id: clip(m.tool_call_id, 80), content: clip(m.content, 14000) });
  }
  return out;
}
function send(res, code, obj) { res.statusCode = code; res.setHeader("content-type", "application/json; charset=utf-8"); res.setHeader("cache-control", "no-store"); res.end(JSON.stringify(obj)); }

/** Node http handler for /api/assistant (GET: is it available; POST {messages, page}: one model turn) */
export async function handle(req, res, env = process.env) {
  const key = env.MIRA_LLM_KEY, url = (env.MIRA_LLM_URL ?? "https://api.ifm.ai/v1").replace(/\/$/, ""), model = env.MIRA_LLM_MODEL ?? "IFM/K2-Horizon-375B-A23B";
  if (req.method === "GET") return send(res, 200, { ok: !!key, model: key ? model.split("/").pop() : null });
  if (req.method !== "POST") return send(res, 405, { error: "POST only" });
  if (!key) return send(res, 503, { error: "The assistant is not configured on this server." });
  const ip = String(req.headers["x-forwarded-for"] ?? req.socket?.remoteAddress ?? "?").split(",")[0].trim(), why = limited(ip);
  if (why) return send(res, 429, { error: why });
  let raw = ""; let tooBig = false;
  await new Promise((ok) => { req.on("data", (c) => { raw += c; if (raw.length > 120000) { tooBig = true; req.destroy(); ok(); } }); req.on("end", ok); req.on("error", ok); });
  if (tooBig) return send(res, 413, { error: "Request too large." });
  let body; try { body = JSON.parse(raw); } catch { return send(res, 400, { error: "Bad request." }); }
  const page = clip(JSON.stringify(body.page ?? {}), 16000);
  const messages = [{ role: "system", content: `${SYSTEM}\n\nPAGE (what the visitor sees now):\n${page}` }, ...clean(body.messages)];
  try {
    const ac = new AbortController(), timer = setTimeout(() => ac.abort(), 90000);
    const r = await fetch(`${url}/chat/completions`, { method: "POST", signal: ac.signal, headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({ model, messages, tools: TOOLS, tool_choice: "auto", temperature: 0.2, max_tokens: 1100 }) });
    clearTimeout(timer);
    if (!r.ok) return send(res, 502, { error: `The model service answered ${r.status}.` });
    const j = await r.json(), m = j?.choices?.[0]?.message;
    if (!m) return send(res, 502, { error: "The model service returned no answer." });
    return send(res, 200, { message: { role: "assistant", content: String(m.content ?? "").replace(/<think>[\s\S]*?<\/think>/g, "").trim(), ...(Array.isArray(m.tool_calls) && m.tool_calls.length ? { tool_calls: m.tool_calls } : {}) }, model: model.split("/").pop() });
  } catch (e) {
    return send(res, 504, { error: e?.name === "AbortError" ? "The model took too long to answer." : "The model service could not be reached." });
  }
}
