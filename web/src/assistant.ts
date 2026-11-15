// ASSISTANT — a panel that reads what is on the page and can operate it. The model runs behind /api/assistant (the
// key stays on the server); this module sends the visitor's question with a snapshot of the page, runs the tool calls
// the model asks for (open a field, select a source, filter the catalogue, change panel) and feeds the results back.
export type AsstCtx = {
  view: () => string; lab: () => any; labAct: (a: any) => void; catalogue: () => Promise<any>; catalogueAct: (a: any) => Promise<any>;
  observe: (q: string) => void; go: (v: string) => void; method: () => void; map?: () => unknown; mapAct?: (a: any) => string | undefined;
};
type Msg = { role: "user" | "assistant" | "tool"; content: string; /** the model's own thinking: kept so that it can be sent back with the conversation, never shown */ reasoning_content?: string; tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[]; tool_call_id?: string };
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
/** the little formatting a model answer uses: paragraphs, bold, bullet lines */
const fmt = (t: string) => esc(t).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/`([^`]+)`/g, "<code>$1</code>").split(/\n{2,}/).map((p) => (/^\s*[-•*] /m.test(p) ? `<ul>${p.split("\n").filter(Boolean).map((l) => `<li>${l.replace(/^\s*[-•*] /, "")}</li>`).join("")}</ul>` : `<p>${p.replace(/\n/g, "<br>")}</p>`)).join("");
const SUGGEST: Record<string, string[]> = {
  blink: ["What moved in this field?", "Explain the selected source in plain words", "Is this object already known?", "Open Luhman 16 and tell me how fast it moves"],
  cat: ["Show confirmed movers with no Gaia motion", "Which objects have a methane dip?", "What does the diagram tell me?", "Open the fastest red object in the Lab"],
  log: ["What can I do with my saved cases?", "Open Epsilon Indi B in the Lab"],
  universe: ["What am I looking at?", "Show me a brown dwarf that is not in Gaia", "Help me look at one that is in no reference database", "Fly to Barnard's Star"],
};
const DOING: Record<string, string> = { open_field: "Pointing the Lab and reading NASA's exposures", lab_control: "Operating the Lab", catalogue_query: "Querying the catalogue", map_control: "Flying the map", navigate: "Changing section", get_page: "Reading the page" };

let state: { el: HTMLElement; ctx: AsstCtx; msgs: Msg[]; busy: boolean; ok: boolean | null; model: string } | null = null;

export function toggleAssistant(el: HTMLElement, ctx: AsstCtx) {
  if (!state) { state = { el, ctx, msgs: [], busy: false, ok: null, model: "" }; mount(); }
  state.ctx = ctx; el.hidden = !el.hidden; document.body.classList.toggle("asst-on", !el.hidden);
  if (!el.hidden) { draw(); (el.querySelector("textarea") as HTMLTextAreaElement | null)?.focus(); }
}
function mount() {
  const s = state!;
  s.el.innerHTML = `<header><div><b>Assistant</b><small id="as-model"></small></div><button class="icon-btn" id="as-x" aria-label="Close the assistant">✕</button></header>
    <div class="as-log" id="as-log" aria-live="polite"></div>
    <div class="as-sug" id="as-sug"></div>
    <form id="as-form"><textarea rows="2" placeholder="Ask about this page, or tell me what to open or find" aria-label="Message for the assistant"></textarea><button class="btn sm" type="submit">Send</button></form>
    <p class="as-note">Answers come from an AI model (K2, MBZUAI IFM) that reads the numbers on this page and can operate it. It can be wrong: the measurements on the page are the reference. Your question and the page's readings are sent to the model.</p>`;
  (s.el.querySelector("#as-x") as HTMLElement).onclick = () => { s.el.hidden = true; document.body.classList.remove("asst-on"); document.getElementById("asstbtn")?.classList.remove("on"); };
  const form = s.el.querySelector("#as-form") as HTMLFormElement, ta = form.querySelector("textarea") as HTMLTextAreaElement;
  form.onsubmit = (e) => { e.preventDefault(); const q = ta.value.trim(); if (q && !s.busy) { ta.value = ""; ask(q); } };
  ta.onkeydown = (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); } };
  fetch("/api/assistant").then((r) => (r.ok ? r.json() : null)).then((j) => { s.ok = !!j?.ok; s.model = j?.model ?? ""; draw(); }).catch(() => { s.ok = false; draw(); });
}
function draw(status = "") {
  const s = state!; if (!s.el.querySelector("#as-log")) return;
  (s.el.querySelector("#as-model") as HTMLElement).textContent = s.ok === false ? "not available on this server" : s.model ? s.model.replace(/-/g, " ") : "";
  const log = s.el.querySelector("#as-log") as HTMLElement;
  log.innerHTML = (s.msgs.length ? "" : `<div class="as-hello"><b>I can read this page and work the instruments for you.</b><span>Ask what a result means, or tell me what to open, select or filter.</span></div>`) +
    s.msgs.filter((m) => m.role !== "tool" && (m.content || m.role === "user")).map((m) => `<div class="as-m ${m.role}">${m.role === "user" ? `<p>${esc(m.content)}</p>` : fmt(m.content)}</div>`).join("") +
    (status ? `<div class="as-m assistant busy"><p>${esc(status)}…</p></div>` : "") + (s.ok === false ? `<div class="as-m assistant"><p>The assistant needs a model key on the server (see the deployment notes). Everything else on the site works without it.</p></div>` : "");
  log.scrollTop = log.scrollHeight;
  const sug = s.el.querySelector("#as-sug") as HTMLElement;
  sug.innerHTML = s.busy || s.ok === false ? "" : (SUGGEST[s.ctx.view()] ?? SUGGEST.blink).map((t) => `<button type="button">${esc(t)}</button>`).join("");
  sug.querySelectorAll<HTMLButtonElement>("button").forEach((b) => (b.onclick = () => ask(b.textContent!)));
  (s.el.querySelector("#as-form button") as HTMLButtonElement).disabled = s.busy || s.ok === false;
}
async function page() {
  const s = state!, v = s.ctx.view();
  return { section: v === "blink" ? "lab" : v === "cat" ? "catalogue" : v === "log" ? "cases" : v === "universe" ? "map" : v, lab: s.ctx.lab(), ...(v === "cat" ? { catalogue: await s.ctx.catalogue() } : {}), ...(v === "universe" ? { map: s.ctx.map?.() ?? null } : {}) };
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** run one tool the model asked for; the returned text is what the model reads next */
async function runTool(name: string, a: any): Promise<string> {
  const s = state!;
  try {
    if (name === "open_field") {
      if (!a?.target) return "error: no target given";
      const before = JSON.stringify(s.ctx.lab()?.target ?? null);
      s.ctx.observe(String(a.target));
      // wait until a field is open, its exposures are in and the detector has run (or give up after 75 s)
      for (let k = 0; k < 150; k++) { await wait(500); const L = s.ctx.lab(); if (L?.open && !L.loading && L.exposures > 0 && L.field && (k > 8 || JSON.stringify(L.target) !== before)) { await wait(1500); break; } if (k > 30 && L?.open && !L.loading && !L.exposures) break; }
      const L = s.ctx.lab();
      return JSON.stringify(L?.open ? (L.exposures ? L : { ...L, note: "No SPHEREx exposure covers this position in the indexed releases, or the name could not be resolved." }) : { error: "The target could not be found. Ask for coordinates." });
    }
    if (name === "lab_control") { if (s.ctx.view() !== "blink") s.ctx.go("blink"); s.ctx.labAct(a ?? {}); await wait(700); return JSON.stringify(s.ctx.lab()); }
    if (name === "catalogue_query") { if (s.ctx.view() !== "cat") { s.ctx.go("cat"); await wait(400); } const r = await s.ctx.catalogueAct(a ?? {}); await wait(200); if (a?.open) { await wait(800); return JSON.stringify({ result: r, note: "The selected object is now loading in the Lab; call get_page in a few seconds or use open_field for its measurements." }); } return JSON.stringify({ result: r, catalogue: await s.ctx.catalogue() }); }
    if (name === "map_control") { if (s.ctx.view() !== "universe") { s.ctx.go("universe"); await wait(2500); } const r = s.ctx.mapAct?.(a ?? {}) ?? "the map is not available on this device";
      await wait(a?.fly_to || a?.take_part || a?.pick ? 5000 : 900); return JSON.stringify({ result: r, map: s.ctx.map?.() ?? null }); }
    if (name === "navigate") { const sec = String(a?.section ?? ""); if (sec === "method") s.ctx.method(); else s.ctx.go(sec === "lab" ? "blink" : sec === "catalogue" ? "cat" : sec === "cases" ? "log" : "universe"); await wait(500); return JSON.stringify(await page()); }
    if (name === "get_page") return JSON.stringify(await page());
    return `error: unknown tool ${name}`;
  } catch (e) { return `error: ${(e as Error).message}`; }
}
/** what is sent with a question: the last few exchanges, starting on a question (a tool result is never sent without
 *  the request it answers), with the long page readings of earlier exchanges shortened */
function recent(msgs: Msg[]): Msg[] {
  let from = Math.max(0, msgs.length - 18); while (from < msgs.length - 1 && msgs[from].role !== "user") from++;
  const lastQ = msgs.map((m) => m.role).lastIndexOf("user");
  return msgs.slice(from).map((m, k) => (m.role === "tool" && from + k < lastQ && m.content.length > 1500 ? { ...m, content: m.content.slice(0, 1500) + " …(shortened)" } : m));
}
async function ask(q: string) {
  const s = state!; if (s.busy) return;
  s.busy = true; s.msgs.push({ role: "user", content: q }); draw("Thinking");
  try {
    for (let round = 0; round < 6; round++) {
      const r = await fetch("/api/assistant", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ messages: recent(s.msgs), page: await page() }) });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.message) { s.msgs.push({ role: "assistant", content: j?.error ?? "The assistant could not answer just now." }); break; }
      const m = j.message as Msg; s.msgs.push(m);
      if (!m.tool_calls?.length) break;
      for (const t of m.tool_calls) { draw(DOING[t.function.name] ?? "Working"); let args: any = {}; try { args = JSON.parse(t.function.arguments || "{}"); } catch { /* empty arguments */ }
        s.msgs.push({ role: "tool", tool_call_id: t.id, content: (await runTool(t.function.name, args)).slice(0, 13000) }); }
      draw("Reading the result");
    }
  } catch { s.msgs.push({ role: "assistant", content: "The assistant could not be reached. Check the connection and try again." }); }
  s.busy = false; draw();
}
