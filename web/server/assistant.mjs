// The assistant's server side: one small handler shared by the dev server (vite.config.ts) and the production proxy
// (deploy/assistant-proxy.mjs). It holds the model key (never sent to the browser, never in the repository), owns the
// instructions and the list of tools, limits how often it can be called, and forwards to an OpenAI-compatible endpoint.
//   env: MIRA_LLM_KEY (required)   MIRA_LLM_URL (default https://api.ifm.ai/v1)   MIRA_LLM_MODEL (default K2 Horizon)
export const SYSTEM = `You are the assistant of MIRA, a digital research observatory: a web Lab whose instruments measure NASA SPHEREx Level-2 exposures (0.75–5 µm, 102 wavelength channels on 6 detectors, 6.15 arcsec pixels, each sky position revisited about every 6 months since April 2025).
The site has two layers. The first screen is the Map, made for everyone: the Sun's neighbourhood in 3D, every point a real star at its distance. The stars caught moving and confirmed on SPHEREx images are marked; each has a card with its kind in plain words, its distance, how long it takes to cross a full Moon's width of sky, and three real pictures on a slider (2MASS about 1999, WISE 2010, and SPHEREx's own, which is read when the visitor moves past 2010) with its measured path. Confirmed movers with no entry in astronomical databases have three answer buttons so that visitors can say what they see; this is a prototype (answers stay on the visitor's device until they send them, nothing is collected automatically). The second layer is the deep analysis: the Lab and the Catalogue.
The Lab works on one field at a time (3.3 to 13 arcmin wide). Its instruments: Evolution (one time bar through three NASA pictures of the same field: 2MASS at 2.2 µm around 1999, WISE at 4.6 µm in 2010, then one deep SPHEREx image per visit in 2025–26; the pictures are for the eye, the numbers come from the catalogues and the SPHEREx exposures), Motion detector (every source of the field: moved / brighter / fainter / new / steady, with significance and Gaia identity), Astrometer (position against time with 2MASS ~1999, AllWISE 2010.5 and SPHEREx visits; proper motion; parallax), Spectrograph (0.75–5 µm spectrum; methane at 3.3 µm marks cold brown dwarfs and giant planets), Photometer (brightness against 2MASS and AllWISE, and visit to visit), Detection limits (which planet or brown dwarf this field's depth would reveal, and out to what distance).
The Catalogue is the verified survey: motion claims from 16 years of WISE data that were re-measured on raw SPHEREx exposures and confirmed. Cases are the visitor's saved measurements.
The motivating problem is "Planet X": an unknown cold body near the Sun shows itself by moving against the stars; the same instruments serve any star, brown dwarf or variable source.

How to work:
- Many visitors are not scientists. On the Map especially, answer in everyday words first (what it is, how far, why it is interesting), and offer one next thing to do: look at its pictures, help with an unnamed one, or open the deep analysis.
- When PAGE.section is "map" and the visitor asks to see, find or be shown something, use map_control and stay on the Map: fly_to for a named object, pick "cold_world" for a known brown dwarf that is not listed in Gaia, pick "unnamed" for one with no database entry that they can help look at. Go to the Lab or the Catalogue only when they ask for measurements, tables or deep analysis. After map_control, describe the selected object from the returned card, and only that: PAGE.map holds three counts and one selected object, so say nothing about the other points. "Not in Gaia" means only that: do not say why (cold, faint) unless the card's kind says so. A distance marked as an estimate or as not known must be reported that way.
- You receive PAGE, a JSON snapshot of what the visitor sees. Base every number you state on PAGE or on a tool result. If a number is not there, say it is not measured; never invent values, identifiers or references.
- You can operate the site with tools. When the visitor asks to open, find, show, compare or filter something, do it with a tool, then describe what the result shows. After open_field the result already contains the measurements.
- Answer first in one or two plain sentences a non-astronomer can follow, then, if useful, the technical statement with the numbers and their uncertainties. Keep it under 130 words unless asked for more. No headings. Units always.
- Be honest about limits: SPHEREx-only motion needs more than about 2.5 arcsec/yr; slower motions rely on the 2010 and 1999 catalogue positions; blended, saturated and edge sources are not judged; Planet Nine as proposed is below SPHEREx depth.
- Coordinates are ICRS degrees unless the visitor writes them otherwise.
- Speak about what is on the screen in the visitor's words ("the Motion detector lists…", "no Gaia motion"), never with the names of JSON fields or tools. Do not add comparisons, distances or identifications that are not in PAGE.`;
export const TOOLS = [
  { name: "open_field", description: "Point the Lab at an object (by name, e.g. 'Luhman 16') or at coordinates ('RA Dec' in degrees or sexagesimal), read its SPHEREx exposures and run all instruments. Returns the measured page state when the exposures are in (about 20 seconds).",
    parameters: { type: "object", properties: { target: { type: "string", description: "object name or coordinates" } }, required: ["target"] } },
  { name: "lab_control", description: "Operate the Lab on the field that is open: choose an instrument panel, select a source by its number in the Motion detector, change the image view, move the time bar, play or pause, switch overlays.",
    parameters: { type: "object", properties: {
      instrument: { type: "string", enum: ["changes", "motion", "spectrum", "light", "limits", "frames", "export"], description: "changes = Motion detector, motion = Astrometer, spectrum = Spectrograph, light = Photometer, limits = Detection limits, frames = Exposures" },
      select: { type: "integer", description: "number of the source to point the instruments at" }, view: { type: "string", enum: ["evolve", "frames", "rgb", "diff"] },
      range: { type: "string", enum: ["sx", "2010", "1999"], description: "how far back the time bar reaches: sx = SPHEREx visits only, 2010 = from the WISE picture, 1999 = from the 2MASS picture" }, date: { type: "number", description: "decimal year to move the time bar to; 2010.5 shows the WISE picture, 1999.5 the 2MASS picture, 2026 the latest SPHEREx visit" }, play: { type: "boolean", description: "true plays the time bar from its earliest picture to today" },
      layers: { type: "object", properties: { det: { type: "boolean" }, gaia: { type: "boolean" }, wise: { type: "boolean" }, mask: { type: "boolean" }, track: { type: "boolean" } } } } } },
  { name: "catalogue_query", description: "Open the Catalogue and filter or sort the verified movers; returns the matching count and the first rows. Properties in filters combine (all must hold). Use select with a census id to pick a row; open=true sends the selected row to the Lab.",
    parameters: { type: "object", properties: {
      filters: { type: "array", items: { type: "string", enum: ["all", "nogaia", "red", "methane", "wd", "fast", "changes"] }, description: "Properties a row must have, all at once (e.g. [\"nogaia\", \"red\"]). nogaia = confirmed movers without a matching Gaia motion; red = W1-W2 > 0.6 (cold); methane = methane dip at 3.3 um; wd = white dwarfs; fast = above 1 arcsec/yr; all = no condition; changes = the separate table of verified brightness changes" },
      include_plane: { type: "boolean", description: "also list rows within 10 degrees of the Galactic plane (crowded, less reliable; hidden by default)" }, min_motion: { type: "number", description: "arcsec per year" }, max_motion: { type: "number" }, search: { type: "string" }, sort: { type: "string", enum: ["pm", "conf", "kind", "known", "W2", "w12", "simbad"] }, descending: { type: "boolean" },
      select: { type: "string", description: "census id, e.g. 6661-325678" }, view: { type: "string", enum: ["rpm", "sky"] }, open: { type: "boolean" } } } },
  { name: "map_control", description: "Operate the Map (the first screen). Fly to an object by name or survey id, show only the confirmed movers or only those unknown to Gaia, or fly to a confirmed mover nobody has named so that the visitor can help look at it. Returns the map state with the selected object's card.",
    parameters: { type: "object", properties: { fly_to: { type: "string", description: "a star's name (Barnard's Star, Sirius, a 2MASS or WISE designation) or a survey id such as 6275-47643" },
      pick: { type: "string", enum: ["cold_world", "unnamed"], description: "let the map choose: cold_world = a known brown dwarf that is not listed in the Gaia optical catalogue; unnamed = a confirmed mover with no database entry, for the visitor to help look at" },
      show: { type: "string", enum: ["everything", "confirmed", "unknown_to_gaia"], description: "which points are displayed" } } } },
  { name: "navigate", description: "Go to a section of the site.", parameters: { type: "object", properties: { section: { type: "string", enum: ["map", "lab", "catalogue", "cases", "method"] } }, required: ["section"] } },
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
    // the model service wants each earlier assistant turn back as it was returned, thinking field included (measured:
    // without it the model sometimes writes its thinking into the answer). The page keeps that field and sends it
    // back; it is never displayed.
    else if (m?.role === "assistant") out.push({ role: "assistant", content: clip(m.content, 6000), reasoning_content: clip(m.reasoning_content, 12000), ...(Array.isArray(m.tool_calls) ? { tool_calls: m.tool_calls.slice(0, 6).map((t) => ({ id: clip(t.id, 80), type: "function", function: { name: clip(t.function?.name, 40), arguments: clip(t.function?.arguments, 2000) } })) } : {}) });
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
  // a browser on another site may not use this endpoint (its Origin would differ from our host); MIRA_ALLOWED_ORIGINS adds exceptions
  const origin = req.headers.origin, host = String(req.headers["x-forwarded-host"] ?? req.headers.host ?? "");
  if (origin) { let oh = ""; try { oh = new URL(origin).host; } catch { /* malformed */ } const extra = String(env.MIRA_ALLOWED_ORIGINS ?? "").split(",").map((x) => x.trim()).filter(Boolean);
    if (oh !== host && !extra.includes(origin)) return send(res, 403, { error: "This assistant answers only from its own site." }); }
  // the forwarded address is believed only when the request reaches us from the local reverse proxy
  const peer = String(req.socket?.remoteAddress ?? "?"), local = /^(::1|127\.|::ffff:127\.)/.test(peer);
  const ip = local && req.headers["x-forwarded-for"] ? String(req.headers["x-forwarded-for"]).split(",").pop().trim() : peer, why = limited(ip);
  if (why) return send(res, 429, { error: why });
  let raw = ""; let tooBig = false;
  await new Promise((ok) => { req.on("data", (c) => { raw += c; if (raw.length > 300000) { tooBig = true; req.destroy(); ok(); } }); req.on("end", ok); req.on("error", ok); });
  if (tooBig) return send(res, 413, { error: "Request too large." });
  let body; try { body = JSON.parse(raw); } catch { return send(res, 400, { error: "Bad request." }); }
  const page = clip(JSON.stringify(body.page ?? {}), 16000);
  const messages = [{ role: "system", content: `${SYSTEM}\n\nPAGE (what the visitor sees now):\n${page}` }, ...clean(body.messages)];
  try {
    const ac = new AbortController(), timer = setTimeout(() => ac.abort(), 90000);
    const r = await fetch(`${url}/chat/completions`, { method: "POST", signal: ac.signal, headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({ model, messages, tools: TOOLS, tool_choice: "auto", temperature: 0.2, max_tokens: +(env.MIRA_LLM_MAX_TOKENS ?? 4000) }) });
    clearTimeout(timer);
    if (!r.ok) return send(res, 502, { error: `The model service answered ${r.status}.` });
    const j = await r.json(), ch = j?.choices?.[0], m = ch?.message;
    if (!m) return send(res, 502, { error: "The model service returned no answer." });
    // the model thinks before it answers. Its thinking is never shown: what precedes a closing think tag is dropped,
    // and a turn cut off by the length limit before any answer or tool call is reported as such
    let text = String(m.content ?? "").replace(/<think>[\s\S]*?<\/think>/g, ""); const cut = text.lastIndexOf("</think>"); if (cut >= 0) text = text.slice(cut + 8);
    text = text.trim();
    if (ch.finish_reason === "length" && !(Array.isArray(m.tool_calls) && m.tool_calls.length)) return send(res, 200, { message: { role: "assistant", content: "I ran out of room before reaching an answer. Ask again in a shorter or more specific form." }, model: model.split("/").pop() });
    // only tools we declared, with arguments that parse as an object, are handed to the page
    const known = new Set(TOOLS.map((t) => t.function.name));
    const calls = (Array.isArray(m.tool_calls) ? m.tool_calls : []).filter((t) => { if (!known.has(t?.function?.name)) return false; try { const a = JSON.parse(t.function.arguments || "{}"); return a !== null && typeof a === "object" && !Array.isArray(a); } catch { return false; } }).slice(0, 4)
      .map((t) => ({ id: String(t.id ?? "").slice(0, 80), type: "function", function: { name: t.function.name, arguments: String(t.function.arguments || "{}").slice(0, 2000) } }));
    return send(res, 200, { message: { role: "assistant", content: text, reasoning_content: clip(String(m.reasoning_content ?? m.reasoning ?? ""), 12000), ...(calls.length ? { tool_calls: calls } : {}) }, model: model.split("/").pop() });
  } catch (e) {
    return send(res, 504, { error: e?.name === "AbortError" ? "The model took too long to answer." : "The model service could not be reached." });
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Visitors' answers on objects that have no SIMBAD entry ("take part" on the map). No account and nothing about the
// visitor is kept: one line per answer {id, v, day} appended to a file on this server, and a tally per object.
//   GET  /api/answers            -> { ok: true, total }            (is collection available here?)
//   GET  /api/answers?ids=a,b,c  -> { tallies: { id: { moves, unsure, no } } }
//   POST /api/answers {id, v, prev?} -> { tally: { moves, unsure, no } }   (prev = the visitor's earlier answer, taken back)
//   env: MIRA_ANSWERS_FILE (default ./mira-answers.jsonl), MIRA_ANSWERS_PER10MIN (default 60 per address)
const ANSWERS = new Set(["moves", "unsure", "no"]), ID_RE = /^\d{1,6}-\d{1,9}$/;
let tallies = null, answersTotal = 0; const answerHits = new Map();
async function loadTallies(file) {
  if (tallies) return tallies;
  tallies = new Map();
  try {
    const { readFile } = await import("node:fs/promises"), text = await readFile(file, "utf8");
    for (const line of text.split("\n")) { if (!line) continue; try { const a = JSON.parse(line); count(a.id, a.v, a.prev); answersTotal++; } catch { /* a damaged line is skipped */ } }
  } catch { /* no file yet */ }
  return tallies;
}
function count(id, v, prev) {
  if (!ID_RE.test(String(id)) || !ANSWERS.has(v)) return null;
  const t = tallies.get(id) ?? { moves: 0, unsure: 0, no: 0 }; t[v]++; if (ANSWERS.has(prev) && t[prev] > 0) t[prev]--; tallies.set(id, t); return t;
}
function sameSite(req, env) {
  const origin = req.headers.origin, host = String(req.headers["x-forwarded-host"] ?? req.headers.host ?? ""); if (!origin) return true;
  let oh = ""; try { oh = new URL(origin).host; } catch { /* malformed */ }
  return oh === host || String(env.MIRA_ALLOWED_ORIGINS ?? "").split(",").map((x) => x.trim()).includes(origin);
}
export async function handleAnswers(req, res, env = process.env) {
  const file = env.MIRA_ANSWERS_FILE ?? "./mira-answers.jsonl";
  if (!sameSite(req, env)) return send(res, 403, { error: "Answers are accepted only from this site." });
  const T = await loadTallies(file);
  if (req.method === "GET") {
    const ids = new URL(req.url ?? "/", "http://x").searchParams.get("ids");
    if (!ids) return send(res, 200, { ok: true, total: answersTotal });
    const out = {}; for (const id of ids.split(",").slice(0, 60)) if (ID_RE.test(id)) out[id] = T.get(id) ?? { moves: 0, unsure: 0, no: 0 };
    return send(res, 200, { tallies: out });
  }
  if (req.method !== "POST") return send(res, 405, { error: "GET or POST" });
  const peer = String(req.socket?.remoteAddress ?? "?"), local = /^(::1|127\.|::ffff:127\.)/.test(peer);
  const ip = local && req.headers["x-forwarded-for"] ? String(req.headers["x-forwarded-for"]).split(",").pop().trim() : peer, now = Date.now();
  const L = (answerHits.get(ip) ?? []).filter((t) => now - t < 600000); L.push(now); answerHits.set(ip, L);
  if (answerHits.size > 5000) for (const [k, v] of answerHits) if (!v.length || now - v[v.length - 1] > 600000) answerHits.delete(k);
  if (L.length > +(env.MIRA_ANSWERS_PER10MIN ?? 60)) return send(res, 429, { error: "Too many answers in a short time." });
  if (answersTotal > 500000) return send(res, 507, { error: "The answers file is full." });
  let raw = ""; await new Promise((ok) => { req.on("data", (c) => { raw += c; if (raw.length > 2000) { req.destroy(); ok(); } }); req.on("end", ok); req.on("error", ok); });
  let b; try { b = JSON.parse(raw); } catch { return send(res, 400, { error: "Bad request." }); }
  const id = String(b?.id ?? ""), v = b?.v, prev = ANSWERS.has(b?.prev) && b.prev !== v ? b.prev : undefined;
  if (!ID_RE.test(id) || !ANSWERS.has(v)) return send(res, 400, { error: "Unknown object or answer." });
  try { const { appendFile } = await import("node:fs/promises"); await appendFile(file, JSON.stringify({ id, v, ...(prev ? { prev } : {}), day: new Date().toISOString().slice(0, 10) }) + "\n"); }
  catch { return send(res, 500, { error: "The answer could not be saved." }); }
  answersTotal++; return send(res, 200, { tally: count(id, v, prev) });
}
