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

export async function fetchRetry(url, init = {}, attempts = 3) {
  let last;
  for (let i = 0; i < attempts; i++) {
    try { return await fetch(url, init); }
    catch (e) { last = e; if (i < attempts - 1) await new Promise((r) => setTimeout(r, 500 * 2 ** i)); }
  }
  throw last;
}
