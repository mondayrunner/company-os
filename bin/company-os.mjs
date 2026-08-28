#!/usr/bin/env node
// company-os: a company brain in markdown and SQLite.
//
//   company-os index [--only a,b]     scan connectors → documents, chunks, relations, events
//   company-os snapshot               daily metrics from the live (metric) connectors
//   company-os event <status.json>    record one job run (called by job wrappers)
//   company-os search "<query>"       full-text search, top 8 (N=20 for more)
//   company-os context <account>      everything around one account
//   company-os ask "<question>"       answer with sources via a headless agent
//   company-os link [--dry-run] [--smart]   attach waiting transcripts to accounts
//   company-os check [--no-live] [--only a,b] [--json]   deterministic checks, report + status
//   company-os live <kind> [what]     read one live source now (tasks, finance, calendar, mail)
//   company-os inbox list|post|reply|approve|reject|run   the one place agents talk back and you answer
//   company-os serve                  MCP server over stdio (search, context, ask, live, check, inbox)
//   company-os jobs list|install|uninstall|run   the job list from the config on launchd, cron or systemd
//   company-os status                 what is in the brain, which sources were scanned
//   company-os import-legacy <db>     copy events/metrics/questions from a pre-company-os db
//   company-os init [--language xx]   write a starter company-os.config.json here
//
// Global: --root <dir> (else COMPANY_OS_ROOT / COMPANY_OS / nearest config upward).
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
import { loadConnectors, byKind } from "../core/connectors.mjs";
import { postItem, listItems, reply, runApproved } from "../core/inbox.mjs";
import { serve } from "../mcp/server.mjs";
import { install, uninstall, runJob, listJobs } from "../core/jobs.mjs";
import { readFileSync } from "node:fs";

const argv = process.argv.slice(2);
const flags = {};
const positional = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith("--")) {
    const k = a.slice(2);
    if (["root", "only", "language", "name", "kind", "from", "title", "file", "action", "status", "id", "target"].includes(k)) flags[k] = argv[++i];
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
  console.log(`wrote ${file}\nnext: company-os index && company-os check`);
  process.exit(0);
}
if (!cmd || cmd === "help" || flags.help) { console.log(help()); process.exit(0); }

let ctx;
try { ctx = loadContext({ root: flags.root }); }
catch (e) { console.error(`company-os: ${e.message}`); process.exit(2); }
const db = openDb(ctx);
try {
  switch (cmd) {
    case "index": out(await indexAll(ctx, db, { only: flags.only?.split(",") })); break;
    case "snapshot": out(await snapshotAll(ctx, db)); break;
    case "event": out(await recordEvent(ctx, db, rest[0])); break;
    case "search": out(search(db, rest.join(" "), Number(process.env.N) || 8, ctx)); break;
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
    case "live": {
      // company-os live <kind> [what] [key=value…]: inference-time retrieval from one connector
      const [kind, what, ...kv] = rest;
      const connectors = await loadConnectors(ctx);
      const c = byKind(connectors, kind).find((x) => x.live);
      if (!c) { console.error(`no live connector of kind "${kind}" (have: ${connectors.filter((x) => x.live).map((x) => `${x.name}:${x.kind}`).join(", ") || "none"})`); process.exit(1); }
      const query = { what, ...Object.fromEntries(kv.map((p) => p.split("=")).filter(([k, v]) => k && v)) };
      out({ connector: c.name, ...(await c.live(query, ctx, c.options)) });
      break;
    }
    case "inbox": {
      // company-os inbox list [--status open] | post --kind k --from f --title t [--file body.md] [--action json]
      //                | reply <id> "text" [--approve|--reject] | approve <id> | reject <id> | run [--id x]
      const [sub, id, ...words] = rest;
      if (sub === "list" || !sub) out((await listItems(ctx, { status: flags.status ?? null })).map(({ id, kind, from, created, status, title, action }) => ({ id, kind, from, created, status, title, action: action?.type ?? null })));
      else if (sub === "post") out(await postItem(ctx, { kind: flags.kind, from: flags.from ?? "cli", title: flags.title, body: flags.file ? readFileSync(flags.file, "utf8") : words.join(" "), action: flags.action ? JSON.parse(flags.action) : null }));
      else if (sub === "reply") out(await reply(ctx, id, words.join(" "), { status: flags.approve ? "approved" : flags.reject ? "rejected" : null }));
      else if (sub === "approve") out(await reply(ctx, id, words.join(" "), { status: "approved" }));
      else if (sub === "reject") out(await reply(ctx, id, words.join(" "), { status: "rejected" }));
      else if (sub === "show") out((await listItems(ctx)).find((i) => i.id === id) ?? { error: "not found" });
      else if (sub === "run") { out(await runApproved(ctx, { only: flags.id ?? null })); await indexAll(ctx, db, { only: ["markdown"] }); }
      else { console.error("inbox: list | post | reply | approve | reject | show | run"); process.exit(1); }
      break;
    }
    case "serve": await serve(ctx, db); break;
    case "jobs": {
      // company-os jobs list | install [--target launchd|cron|systemd] [name] [--dry-run] [--force] | uninstall [name] | run <name>
      const [sub, name] = rest;
      if (sub === "list" || !sub) out(await listJobs(ctx));
      else if (sub === "install") out(await install(ctx, { target: flags.target, only: name ?? null, dryRun: !!flags["dry-run"], force: !!flags.force }));
      else if (sub === "uninstall") out(await uninstall(ctx, { target: flags.target, only: name ?? null }));
      else if (sub === "run") { db.close(); process.exit(await runJob(ctx, name)); }
      else { console.error("jobs: list | install | uninstall | run <name>"); process.exit(1); }
      break;
    }
    case "import-legacy": out(importLegacy(db, rest[0])); break;
    default: console.error(`unknown command: ${cmd}\n`); console.log(help()); process.exit(1);
  }
} finally { db.close(); }

function pick(o, keys) { return Object.fromEntries(keys.map((k) => [k, o[k]])); }
function help() {
  return `company-os — a company brain in markdown and SQLite

  index [--only a,b]         scan connectors → documents, chunks, relations, events
  snapshot                   daily metrics from live connectors
  event <status.json>        record one job run
  search "<query>"           full-text search (N=20 company-os search ... for more)
  context <account>          everything around one account
  ask "<question>" [--json]  answer with sources via a headless agent
  link [--dry-run] [--smart] attach waiting transcripts to accounts
  check [--no-live] [--only a,b] [--json]   deterministic checks → report + status
  live <kind> [what] [k=v]   read a live source now (tasks cards, finance subscriptions, calendar today, mail unread)
  inbox list|post|reply|approve|reject|show|run   agents talk back here; approved items get executed
  serve                      MCP server over stdio for agents
  jobs list|install|uninstall|run <name>   schedule the config's jobs on launchd, cron or systemd
  status                     what is in the brain
  import-legacy <db>         copy history from a pre-company-os database
  init [--language xx] [--name "..."]   starter config in the current folder

  --root <dir>               root with company-os.config.json (else COMPANY_OS_ROOT)`;
}
