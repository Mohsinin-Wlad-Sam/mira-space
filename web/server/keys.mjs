// API keys, metering and credits for MIRA's data API (web/server/api.mjs). No dependencies.
//
// A key is made by POST /api/v1/keys and shown once; the server keeps only its SHA-256. Every answered call costs
// credits (PRICES). A key starts with a free allowance; at zero the API answers 402 until credits are granted
// (POST /api/v1/keys/{id}/credits with the operator's X-Admin-Key: the place where a payment provider's webhook would
// land). No payment provider is connected in this build: nobody is charged, and the console says so.
//
//   env: MIRA_API_STORE            the JSON file that holds the keys (default mira-api-keys.json.local, in the working folder)
//        MIRA_API_FREE_CREDITS     credits a new key starts with (default 2000)
//        MIRA_API_KEY_PER10MIN     calls a key may make in ten minutes (default 3000)
//        MIRA_API_NEW_KEYS_PER_DAY keys one address may make in a day (default 5)
//        MIRA_API_ADMIN            the operator's secret for granting credits (unset: grants are off)
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";

/** credits per answered call. A cross-match costs 1 per started hundred positions */
export const PRICES = { "/status": 0, "/openapi.json": 0, "/targets": 0, "/prices": 0, "/movers": 1, "/movers/{id}": 1, "/coverage": 1, "/scout": 1, "/exposures": 2, "/crossmatch": 1 };
/** proposed, not charged: what credits beyond the free allowance would cost */
export const RATE = { currency: "USD", per_10000_credits: 1 };

export class KeyError extends Error { constructor(message, code = 400) { super(message); this.code = code; } }
const sha = (s) => createHash("sha256").update(s).digest("hex"), today = () => new Date().toISOString().slice(0, 10);
const ALPHA = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
function secret(n = 32) { let s = ""; while (s.length < n) for (const b of randomBytes(48)) if (b < 248 && s.length < n) s += ALPHA[b % 62]; return s; }
const clean = (v) => String(v ?? "").replace(/[\u0000-\u001f\u007f<>]/g, "").trim().slice(0, 60) || "my key";

let store = null, storePath = null, timer = null;
function load(env) {
  const p = env.MIRA_API_STORE ?? "mira-api-keys.json.local";
  if (store && storePath === p) return store;
  storePath = p; store = { keys: {} };
  if (existsSync(p)) { try { store = JSON.parse(readFileSync(p, "utf8")); } catch { try { renameSync(p, `${p}.unreadable-${Date.now()}`); } catch { /* left as it is */ } store = { keys: {} }; } }
  store.keys ??= {}; return store;
}
function save() { if (timer) return; timer = setTimeout(() => { timer = null; try { writeFileSync(`${storePath}.tmp`, JSON.stringify(store)); renameSync(`${storePath}.tmp`, storePath); } catch (e) { console.error("api keys: could not write", storePath, String(e).slice(0, 120)); } }, 1200); timer.unref?.(); }

const left = (k) => Math.max(0, k.granted - k.used);
/** what a key's owner may see of it */
export const view = (k) => ({ id: k.id, label: k.label, key_hint: k.hint, made: k.made, last_used: k.last ?? null, revoked: !!k.revoked, credits: { granted: k.granted, used: k.used, left: left(k) }, calls: k.calls });

/** the key record for a key as sent, or null */
export function findKey(env, raw) {
  const m = /^mira_sk_([0-9a-f]{10})_[A-Za-z0-9]{32}$/.exec(raw ?? ""); if (!m) return null;
  const k = load(env).keys[m[1]]; if (!k) return null;
  const a = Buffer.from(sha(raw), "hex"), b = Buffer.from(k.hash, "hex");
  return a.length === b.length && timingSafeEqual(a, b) ? k : null;
}

const made = new Map();            // address -> when it made keys (kept in memory only: no address is written to the file)
export function createKey(env, address, label) {
  const S = load(env), now = Date.now(), L = (made.get(address) ?? []).filter((t) => now - t < 86400000), max = +(env.MIRA_API_NEW_KEYS_PER_DAY ?? 5);
  if (L.length >= max) throw new KeyError(`this address has already made ${max} keys today`, 429);
  if (Object.keys(S.keys).length >= 20000) throw new KeyError("this server holds as many keys as it can", 503);
  let id; do { id = randomBytes(5).toString("hex"); } while (S.keys[id]);
  const raw = `mira_sk_${id}_${secret()}`, free = Math.max(0, Math.round(+(env.MIRA_API_FREE_CREDITS ?? 2000)));
  S.keys[id] = { id, hash: sha(raw), hint: `mira_sk_${id}_…${raw.slice(-4)}`, label: clean(label), made: new Date().toISOString(), granted: free, used: 0, calls: 0, days: {}, recent: [] };
  L.push(now); made.set(address, L); if (made.size > 5000) made.clear(); save();
  return { key: raw, ...view(S.keys[id]) };
}
/** a new secret for the same key: the old one stops working at once */
export function rotateKey(env, k) { const raw = `mira_sk_${k.id}_${secret()}`; k.hash = sha(raw); k.hint = `mira_sk_${k.id}_…${raw.slice(-4)}`; save(); return { key: raw, ...view(k) }; }
export function revokeKey(env, k) { k.revoked = true; save(); return view(k); }
/** the operator adds credits to a key (the admin secret is compared in constant time) */
export function grant(env, id, credits, admin) {
  const want = env.MIRA_API_ADMIN ?? ""; if (!want) throw new KeyError("credit grants are switched off on this server (no payment provider is connected)", 403);
  const a = Buffer.from(sha(String(admin ?? "")), "hex"), b = Buffer.from(sha(want), "hex"); if (!timingSafeEqual(a, b)) throw new KeyError("the admin key is not right", 403);
  const k = load(env).keys[id]; if (!k) throw new KeyError("no such key", 404);
  const n = Math.round(+credits); if (!(n > 0 && n <= 1e9)) throw new KeyError("credits must be a number above zero");
  k.granted += n; save(); return view(k);
}

export const endpointOf = (path) => (path.startsWith("/movers/") ? "/movers/{id}" : path);
export const costOf = (path, positions = 0) => (path === "/crossmatch" ? Math.max(1, Math.ceil(positions / 100)) : PRICES[endpointOf(path)] ?? 1);
export const creditsLeft = left;

const perKey = new Map();
/** true when the key has made more calls in ten minutes than it may */
export function keyLimited(env, k) { const now = Date.now(), L = (perKey.get(k.id) ?? []).filter((t) => now - t < 600000); L.push(now); perKey.set(k.id, L); return L.length > +(env.MIRA_API_KEY_PER10MIN ?? 3000); }

/** write one call down against a key. Only an answered call costs credits */
export function record(env, k, path, credits, status) {
  const ep = endpointOf(path), d = today(); k.calls++; k.last = new Date().toISOString(); k.used += credits;
  const D = (k.days[d] ??= {}), e = (D[ep] ??= [0, 0]); e[0]++; e[1] += credits;
  k.recent.unshift({ at: k.last, endpoint: ep, credits, status }); if (k.recent.length > 40) k.recent.length = 40;
  const days = Object.keys(k.days).sort(); while (days.length > 92) delete k.days[days.shift()];
  save();
}
export function usage(k) {
  const by_endpoint = {}, by_day = Object.keys(k.days).sort().map((date) => { const D = k.days[date]; let calls = 0, credits = 0; const eps = {};
    for (const [ep, [c, cr]] of Object.entries(D)) { calls += c; credits += cr; eps[ep] = { calls: c, credits: cr }; const t = (by_endpoint[ep] ??= { calls: 0, credits: 0 }); t.calls += c; t.credits += cr; }
    return { date, calls, credits, by_endpoint: eps }; });
  return { key: view(k), by_day, by_endpoint, recent: k.recent };
}
export function priceList(env) {
  return { unit: "credit", per_call: PRICES, crossmatch: "1 credit for each started hundred of positions", free_credits_per_key: Math.max(0, Math.round(+(env.MIRA_API_FREE_CREDITS ?? 2000))),
    calls_per_10_minutes: { without_a_key: +(env.MIRA_API_PER10MIN ?? 300), with_a_key: +(env.MIRA_API_KEY_PER10MIN ?? 3000) }, only_answered_calls_cost: true,
    pay_as_you_go: { ...RATE, status: "proposed, not charged: no payment provider is connected in this build", when_a_key_runs_out: "HTTP 402 until credits are granted" },
    self_service_keys: !(env.MIRA_API_KEYS ?? "").trim(), credit_grants: (env.MIRA_API_ADMIN ?? "") ? "by the operator: POST /api/v1/keys/{id}/credits with X-Admin-Key" : "switched off on this server" };
}
