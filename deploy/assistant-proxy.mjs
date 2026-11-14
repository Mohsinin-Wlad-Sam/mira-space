// MIRA assistant proxy — the only server-side code of the site, and optional: without it everything works except the
// assistant panel. It keeps the model key out of the browser, owns the instructions and tools, and rate-limits calls.
//   MIRA_LLM_KEY=...  node deploy/assistant-proxy.mjs          (listens on 127.0.0.1:8787; Caddy/nginx forward /api/ to it)
//   optional: MIRA_LLM_URL, MIRA_LLM_MODEL, MIRA_PROXY_PORT, MIRA_LLM_PER10MIN (40), MIRA_LLM_DAILY (4000)
// Memory: ~40 MB. No dependencies. Put the key in an environment file readable only by the service user.
import { createServer } from "node:http";
import { handle } from "../web/server/assistant.mjs";

const port = +(process.env.MIRA_PROXY_PORT ?? 8787);
createServer((req, res) => {
  if (req.url?.split("?")[0] === "/api/assistant") return handle(req, res);
  res.statusCode = 404; res.end("not found");
}).listen(port, "127.0.0.1", () => console.log(`MIRA assistant proxy on 127.0.0.1:${port} · key ${process.env.MIRA_LLM_KEY ? "set" : "MISSING (the assistant will report itself unavailable)"}`));
