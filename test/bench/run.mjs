#!/usr/bin/env node
/**
 * Benchmarks for the MCP layer: how long a call takes and how much it returns.
 *
 *   node test/bench/run.mjs --root <vault> account=harper search="Harper proposal" accounts canon=pricing
 *
 * Targets: every call under 100 ms in-process, answers under a few kilobytes.
 * Run it before and after a change to search or brief; put the numbers in the
 * commit message. This is the loop: change, measure, keep or revert.
 */
import { loadContext } from "../../core/config.mjs";
import { openDb } from "../../core/db.mjs";
import { search } from "../../core/search.mjs";
import { account, accounts, canon } from "../../core/brief.mjs";

const args = process.argv.slice(2);
const rootIdx = args.indexOf("--root");
const root = rootIdx >= 0 ? args.splice(rootIdx, 2)[1] : undefined;
const ctx = loadContext({ root });
const db = openDb(ctx);
const calls = args.length ? args : ["account=harper", "search=Harper proposal", "accounts", "canon=pricing"];

const time = async (label, fn) => {
  const t = performance.now();
  const r = await fn();
  const ms = performance.now() - t;
  const bytes = Buffer.byteLength(JSON.stringify(r));
  const note = r?.error ? ` error: ${r.error}` : Array.isArray(r) ? ` ${r.length} rows` : "";
  console.log(`${label.padEnd(44)} ${ms.toFixed(1).padStart(7)} ms ${String(bytes).padStart(7)} B${note}`);
  return r;
};

for (const c of calls) {
  const [name, value] = c.split(/=(.*)/s);
  if (name === "account") await time(`account ${value}`, () => account(ctx, db, value));
  else if (name === "search") await time(`search "${value}"`, () => search(db, value, 8, ctx));
  else if (name === "search-raw") await time(`search --raw "${value}"`, () => search(db, value, 8, ctx, { raw: true }));
  else if (name === "accounts") await time("accounts", () => accounts(ctx, db, { side: value ?? null }));
  else if (name === "canon") await time(`canon ${value ?? ""}`, () => canon(ctx, value ?? null));
  else console.error(`unknown call: ${c}`);
}
db.close();
