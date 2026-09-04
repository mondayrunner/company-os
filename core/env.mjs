/**
 * Secrets live in env files outside the vault (~/.config/<tool>/.env), never
 * in the repo. A connector names the file in its options and asks for keys.
 */
import { readFile } from "node:fs/promises";
import { expandHome } from "./config.mjs";

const cache = new Map();

export async function readEnvFile(file) {
  const path = expandHome(file);
  if (cache.has(path)) return cache.get(path);
  const out = {};
  try {
    for (const line of (await readFile(path, "utf8")).split("\n")) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
    }
  } catch {}
  cache.set(path, out);
  return out;
}

/** A secret from the connector's env file, else the process environment. Throws with a helpful message. */
export async function secret(options, name, { required = true } = {}) {
  const env = options?.envFile ? await readEnvFile(options.envFile) : {};
  const v = env[name] ?? process.env[name];
  if (!v && required) throw new Error(`${name} missing${options?.envFile ? ` in ${options.envFile}` : ""}`);
  return v;
}

/**
 * fetch that waits and tries again.
 *
 * Three cases, deliberately not the same. A connection that never happened is
 * always safe to repeat. A 429 is the server saying "not yet", so repeating it
 * is the whole point — Trello hands one out as soon as you read a dozen cards
 * in a row. A 5xx only gets repeated for a read: a write that may have landed
 * is not something you send twice.
 */
export async function fetchRetry(url, init = {}, attempts = 3) {
  const read = !init.method || init.method.toUpperCase() === "GET";
  let last;
  for (let i = 0; i < attempts; i++) {
    const backoff = 500 * 2 ** i;
    try {
      const r = await fetch(url, init);
      if (i < attempts - 1 && (r.status === 429 || (read && r.status >= 500))) {
        const after = Number(r.headers.get("retry-after"));
        await new Promise((f) => setTimeout(f, Number.isFinite(after) && after > 0 ? Math.min(after * 1000, 10_000) : backoff));
        continue;
      }
      return r;
    } catch (e) { last = e; if (i < attempts - 1) await new Promise((f) => setTimeout(f, backoff)); }
  }
  if (last) throw last;
  return fetch(url, init);
}
