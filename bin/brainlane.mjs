#!/usr/bin/env node
// brainlane: a company brain in markdown and SQLite.
//
//   brainlane index [--only a,b]     scan connectors → documents, chunks, relations, events
//   brainlane snapshot               daily metrics from the live (metric) connectors
//   brainlane event <status.json>    record one job run (called by job wrappers)
//   brainlane search "<query>"       full-text search, top 8 (N=20 for more)
//   brainlane context <account>      everything around one account
//   brainlane ask "<question>"       answer with sources via a headless agent
//   brainlane link [--dry-run] [--smart]   attach waiting transcripts to accounts
//   brainlane check [--no-live] [--only a,b] [--json]   deterministic checks, report + status
//   brainlane status                 what is in the brain, which sources were scanned
//   brainlane import-legacy <db>     copy events/metrics/questions from a pre-brainlane db
//   brainlane init [--language xx]   write a starter brainlane.config.json here
//
// Global: --root <dir> (else BRAINLANE_ROOT / COMPANY_OS / nearest config upward).
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadContext, DEFAULTS, CONFIG_FILE } from "../core/config.mjs";
import { openDb, importLegacy } from "../core/db.mjs";
import { indexAll, snapshotAll } from "../core/index.mjs";
import { search, context, status } from "../core/search.mjs";
import { recordEvent } from "../core/status.mjs";
import { ask } from "../core/ask.mjs";
import { link, linkSmart } from "../core/link.mjs";
import { runChecks } from "../core/checks.mjs";

const argv = process.argv.slice(2);
const flags = {};
const positional = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith("--")) {
    const k = a.slice(2);
    if (["root", "only", "language", "name"].includes(k)) flags[k] = argv[++i];
    else flags[k] = true;
  } else positional.push(a);
}
const [cmd, ...rest] = positional;
const out = (x) => console.log(JSON.stringify(x, null, 2));

if (cmd === "init") {
  const file = join(process.cwd(), CONFIG_FILE);
  if (existsSync(file)) { console.error(`${CONFIG_FILE} already exists`); process.exit(1); }
  const cfg = { name: flags.name ?? "My company", language: flags.language ?? "en", ...pick(DEFAULTS, ["db", "stateDir", "outputs", "kinds", "accounts", "transcripts", "connectors"]) };
  writeFileSync(file, JSON.stringify(cfg, null, 2) + "\n");
  console.log(`wrote ${file}\nnext: brainlane index && brainlane check`);
  process.exit(0);
}
if (!cmd || cmd === "help" || flags.help) { console.log(help()); process.exit(0); }

const ctx = loadContext({ root: flags.root });
const db = openDb(ctx);
try {
  switch (cmd) {
    case "index": out(await indexAll(ctx, db, { only: flags.only?.split(",") })); break;
    case "snapshot": out(await snapshotAll(ctx, db)); break;
    case "event": out(await recordEvent(ctx, db, rest[0])); break;
    case "search": out(search(db, rest.join(" "), Number(process.env.N) || 8)); break;
    case "context": out(context(db, ctx, rest[0])); break;
    case "status": out(status(db, ctx)); break;
    case "ask": {
      const r = await ask(ctx, db, rest.join(" "), { askedBy: flags.agent ? "agent" : "human" });
      if (flags.json) out(r); else console.log(r.answer);
      break;
    }
    case "link": {
      const dryRun = !!flags["dry-run"];
      const r = flags.smart ? await linkSmart(ctx, { dryRun }) : await link(ctx, { dryRun });
      out({ dryRun, ...r });
      if (!dryRun && !r.error) out({ reindex: await indexAll(ctx, db, { only: ["markdown"] }) });
      break;
    }
    case "check": {
      const r = await runChecks(ctx, db, { live: !flags["no-live"], only: flags.only?.split(",") });
      if (flags.json) out(r); else { const { readFileSync } = await import("node:fs"); console.log(readFileSync(r.report, "utf8")); }
      break;
    }
    case "import-legacy": out(importLegacy(db, rest[0])); break;
    default: console.error(`unknown command: ${cmd}\n`); console.log(help()); process.exit(1);
  }
} finally { db.close(); }

function pick(o, keys) { return Object.fromEntries(keys.map((k) => [k, o[k]])); }
function help() {
  return `brainlane — a company brain in markdown and SQLite

  index [--only a,b]         scan connectors → documents, chunks, relations, events
  snapshot                   daily metrics from live connectors
  event <status.json>        record one job run
  search "<query>"           full-text search (N=20 brainlane search ... for more)
  context <account>          everything around one account
  ask "<question>" [--json]  answer with sources via a headless agent
  link [--dry-run] [--smart] attach waiting transcripts to accounts
  check [--no-live] [--only a,b] [--json]   deterministic checks → report + status
  status                     what is in the brain
  import-legacy <db>         copy history from a pre-brainlane database
  init [--language xx] [--name "..."]   starter config in the current folder

  --root <dir>               root with brainlane.config.json (else BRAINLANE_ROOT)`;
}
