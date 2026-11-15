// MIRA's server process: the assistant's proxy and the data API (/api/v1, web/server/api.mjs). Optional: without it the
// site works, except the assistant panel and the API. It keeps the model key out of the browser, owns the instructions and tools, and rate-limits calls.
//   MIRA_LLM_KEY=...  node deploy/assistant-proxy.mjs          (listens on 127.0.0.1:8787; Caddy/nginx forward /api/ to it)
//   optional: MIRA_LLM_URL, MIRA_LLM_MODEL, MIRA_PROXY_PORT, MIRA_LLM_PER10MIN (40), MIRA_LLM_DAILY (4000),
//             MIRA_ANSWERS_FILE (visitors' answers on the map, default ./mira-answers.jsonl), MIRA_ANSWERS_PER10MIN (60)
//             MIRA_DATA (folder of the data files for the API), MIRA_API_PER10MIN (300), MIRA_API_KEYS (optional keys)
// Memory: ~40 MB. No dependencies. Put the key in an environment file readable only by the service user.
import { createServer } from "node:http";
import { handle, handleAnswers } from "../web/server/assistant.mjs";
import { handleApi } from "../web/server/api.mjs";

const port = +(process.env.MIRA_PROXY_PORT ?? 8787);
createServer((req, res) => {
  if (req.url?.split("?")[0] === "/api/assistant") return handle(req, res);
  if (req.url?.split("?")[0] === "/api/answers") return handleAnswers(req, res);       // visitors' answers on the map; file set by MIRA_ANSWERS_FILE
  if (req.url?.startsWith("/api/v1")) return handleApi(req, res);                      // the data API; MIRA_DATA = the folder of the data files (for example /srv/mira/data)
  res.statusCode = 404; res.end("not found");
}).listen(port, "127.0.0.1", () => console.log(`MIRA assistant proxy on 127.0.0.1:${port} · key ${process.env.MIRA_LLM_KEY ? "set" : "MISSING (the assistant will report itself unavailable)"}`));
