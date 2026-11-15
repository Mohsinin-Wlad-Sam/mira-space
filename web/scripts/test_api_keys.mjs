// TEST: keys, credits and usage of the data API (web/server/keys.mjs), against a server started here.
//   node web/scripts/test_api_keys.mjs
import { createServer } from "node:http";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handleApi } from "../server/api.mjs";
const store = join(tmpdir(), `mira-keys-test-${process.pid}.json`), env = { ...process.env, MIRA_API_STORE: store, MIRA_API_FREE_CREDITS: "3", MIRA_API_ADMIN: "operator-secret", MIRA_API_KEYS: "" };
const srv = createServer((req, res) => handleApi(req, res, env)); await new Promise((r) => srv.listen(0, "127.0.0.1", r)); const base = `http://127.0.0.1:${srv.address().port}/api/v1`;
let bad = 0; const ok = (name, cond, extra = "") => { console.log(`${cond ? "ok  " : "FAIL"} ${name}${extra ? "  " + extra : ""}`); if (!cond) bad++; };
const call = async (path, o = {}) => { const r = await fetch(base + path, { method: o.method ?? "GET", headers: { ...(o.key ? { "X-API-Key": o.key } : {}), ...(o.body ? { "Content-Type": "application/json" } : {}), ...(o.headers ?? {}) }, body: o.body ? JSON.stringify(o.body) : undefined }); let j = null; try { j = await r.json(); } catch { /* not JSON */ } return { s: r.status, j, cost: r.headers.get("x-credits-cost"), left: r.headers.get("x-credits-left") }; };

let r = await call("/prices"); ok("prices", r.s === 200 && r.j.per_call["/exposures"] === 2 && r.j.free_credits_per_key === 3);
r = await call("/movers?ra=331.0966&dec=-56.8007&radius=0.5"); ok("a call without a key is answered and not metered", r.s === 200 && r.cost === null, `${r.j?.count ?? r.j?.movers?.length ?? "?"} rows`);
r = await call("/keys", { method: "POST", body: { label: "test <b>key</b>" } }); const key = r.j?.key; ok("a key is made and shown once", r.s === 201 && /^mira_sk_[0-9a-f]{10}_[A-Za-z0-9]{32}$/.test(key ?? "") && r.j.credits.left === 3 && !r.j.label.includes("<"), r.j?.key_hint);
r = await call("/keys/me", { key }); ok("the key reads itself, without its secret", r.s === 200 && !("key" in r.j) && !("hash" in r.j));
r = await call("/movers?ra=331.0966&dec=-56.8007&radius=0.5", { key }); ok("a keyed call costs 1 credit", r.s === 200 && r.cost === "1" && r.left === "2");
r = await call("/targets", { key }); ok("a free endpoint costs nothing", r.s === 200 && r.cost === "0" && r.left === "2");
r = await call("/movers?ra=abc", { key }); ok("a refused call costs nothing", r.s >= 400 && r.cost === "0" && r.left === "2", `HTTP ${r.s}`);
r = await call("/exposures?ra=269.452&dec=4.693&limit=2", { key }); ok("exposures cost 2", r.s === 200 && r.cost === "2" && r.left === "0", `HTTP ${r.s}`);
r = await call("/coverage?ra=10&dec=10", { key }); ok("no credits left: 402", r.s === 402 && /credits left/.test(r.j.error));
r = await call(`/keys/${key.slice(8, 18)}/credits`, { method: "POST", body: { credits: 10 }, headers: { "X-Admin-Key": "wrong" } }); ok("a wrong admin key grants nothing", r.s === 403);
r = await call(`/keys/${key.slice(8, 18)}/credits`, { method: "POST", body: { credits: 10 }, headers: { "X-Admin-Key": "operator-secret" } }); ok("the operator grants credits", r.s === 200 && r.j.credits.left === 10);
r = await call("/crossmatch", { key, method: "POST", body: { positions: Array.from({ length: 250 }, (_, i) => ({ ra: i, dec: 0 })), radius_arcsec: 30 } }); ok("a cross-match of 250 positions costs 3", r.s === 200 && r.cost === "3" && r.left === "7", `HTTP ${r.s}`);
r = await call("/usage", { key }); ok("usage: by day, by endpoint, recent calls", r.s === 200 && r.j.by_day.length === 1 && r.j.by_endpoint["/movers"].credits === 1 && r.j.by_endpoint["/exposures"].credits === 2 && r.j.recent.length >= 6 && r.j.key.credits.used === 6, JSON.stringify(r.j?.by_endpoint));
r = await call("/keys/rotate", { key, method: "POST" }); const key2 = r.j?.key; ok("rotate gives a new secret for the same key", r.s === 200 && key2 !== key && key2.slice(0, 18) === key.slice(0, 18));
r = await call("/keys/me", { key }); ok("the earlier secret no longer works", r.s === 401);
r = await call("/movers?limit=1", { key: "mira_sk_0000000000_" + "a".repeat(32) }); ok("an unknown key is refused", r.s === 401);
r = await call("/keys/me", { key: key2, method: "DELETE" }); ok("revoke", r.s === 200 && r.j.revoked === true);
r = await call("/movers?limit=1", { key: key2 }); ok("a revoked key is refused", r.s === 401);
for (let i = 0; i < 4; i++) await call("/keys", { method: "POST", body: {} }); r = await call("/keys", { method: "POST", body: {} }); ok("a sixth key from one address in a day is refused", r.s === 429);
r = await call("/openapi.json"); ok("the interface lists the new endpoints", r.s === 200 && !!r.j.paths["/usage"] && !!r.j.paths["/keys"]);
srv.close(); await new Promise((r2) => setTimeout(r2, 1500)); try { rmSync(store); } catch { /* never written */ } try { rmSync(store + ".tmp"); } catch { /* none */ }
console.log(bad ? `${bad} FAILED` : "all passed"); process.exit(bad ? 1 : 0);
