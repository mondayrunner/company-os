#!/usr/bin/env node
/**
 * company-os: a company brain in markdown and SQLite.
 *
 * Reading
 *   index [--only a,b]        scan connectors into documents, chunks, relations, events
 *   search "<query>" [--raw]  full-text, canon first; --raw adds transcripts, plans, advice
 *   account <name> [--full]   one account: status, ball, pipeline row, last contact
 *   accounts [--side x]       one line per open and won account
 *   canon [key] [--section]   a canonical file by short name
 *   mail | finance | tasks | calendar   live sources, answer-shaped
 *   live <kind> [what]        any live source, raw
 *   ticket <id>… [--repo dir] cards as a brief an agent can start on
 *   status                    what is in the brain
 *
 * Writing, reversible and logged
 *   todo "title" [--due d]    a card on the task board
 *   task-done <id>            move a card to done
 *   draft --to --title --file a draft in the mail client, never sent
 *
 * Keeping it honest
 *   boards [--create]         the boards this brain expects, made if you ask
 *   check [--no-live]         deterministic checks, report and inbox items
 *   link [--dry-run]          attach waiting transcripts to accounts
 *   inbox list|show|post|reply|approve|reject|run   where agents talk back and you answer
 *   snapshot | event <file>   daily metrics; record one job run
 *
 * Running it
 *   serve                     MCP server over stdio
 *   jobs list|install|uninstall|run   the job list from the config on launchd, cron or systemd
 *   init [--example]          a folder you can run a command against
 *   import-legacy             carry the events log over from an older database
 *
 * Global: --root <dir>, else COMPANY_OS_ROOT or the nearest config upward.
 * `company-os help` prints the same list with every flag.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadContext } from "../core/config.mjs";
import { openDb, importLegacy } from "../core/db.mjs";
import { indexAll, snapshotAll } from "../core/index.mjs";
import { search, status } from "../core/search.mjs";
import { account, accounts, canon } from "../core/brief.mjs";
import { finance, tasks, calendar, mail } from "../core/live.mjs";
import { todo, taskDone, mailDraft } from "../core/actions.mjs";
import { recordEvent } from "../core/status.mjs";
import { link, linkSmart } from "../core/link.mjs";
import { runChecks } from "../core/checks.mjs";
import { loadConnectors, byKind } from "../core/connectors.mjs";
import { ticket, tickets } from "../core/ticket.mjs";
import { boards } from "../core/boards.mjs";
import { postItem, listItems, reply, runApproved } from "../core/inbox.mjs";
import { serve } from "../mcp/server.mjs";
import { install, uninstall, runJob, listJobs } from "../core/jobs.mjs";
import { init, nextSteps } from "../core/init.mjs";

const argv = process.argv.slice(2);
const flags = {};
const positional = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith("--")) {
    const k = a.slice(2);
    if (["root", "only", "language", "name", "kind", "from", "title", "file", "action", "status", "id", "target", "side", "section", "uid", "limit", "mailbox", "board", "to", "due", "list", "body", "repo", "who", "client"].includes(k)) flags[k] = argv[++i];
    else flags[k] = true;
  } else positional.push(a);
}
const [cmd, ...rest] = positional;
const out = (x) => console.log(JSON.stringify(x, null, 2));

if (cmd === "init") {
  try {
    const r = await init(process.cwd(), { name: flags.name, language: flags.language, example: !!flags.example });
    console.log(`${r.written.length} files and ${r.folders.length} folders in ${r.dir}\n`);
    if (!r.example) console.log("Empty vault. `company-os init --example` adds a small company with a real problem in it.\n");
    console.log(nextSteps(r).join("\n"));
  } catch (e) { console.error(`company-os: ${e.message}`); process.exit(1); }
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
    case "search": out(search(db, rest.join(" "), Number(process.env.N) || 8, ctx, { raw: !!flags.raw })); break;
    case "account": case "context": out(await account(ctx, db, rest.join(" "), { full: !!flags.full })); break;
    case "accounts": out(await accounts(ctx, db, { side: flags.side ?? null })); break;
    case "canon": out(await canon(ctx, rest[0] ?? null, { section: flags.section ?? null })); break;
    case "mail": out(await mail(ctx, { query: rest.join(" ") || null, uid: flags.uid ? Number(flags.uid) : null, limit: flags.limit ? Number(flags.limit) : 5, mailbox: flags.mailbox ?? null })); break;
    case "finance": out(await finance(ctx)); break;
    case "tasks": out(await tasks(ctx, { board: flags.board ?? null })); break;
    case "calendar": out(await calendar(ctx, { from: flags.from ?? null, to: flags.to ?? null })); break;
    case "todo": out(await todo(ctx, { title: rest.join(" "), body: flags.body ?? "", due: flags.due ?? null, list: flags.list ?? null })); break;
    case "task-done": out(await taskDone(ctx, { id: rest[0], list: flags.list ?? null })); break;
    case "draft": out(await mailDraft(ctx, { to: flags.to, subject: flags.title, body: flags.file ? readFileSync(flags.file, "utf8") : rest.join(" ") })); break;
    case "ticket": {
      // The brief is text on purpose: pipe it into an agent, or read it yourself.
      // More than one id is one brief for one agent, not one brief each.
      const r = rest.length > 1
        ? await tickets(ctx, rest.map((id) => ({ id, repo: flags.repo ?? null, who: flags.who ?? null })), { files: !flags["no-files"] })
        : await ticket(ctx, rest[0], { repo: flags.repo ?? null, who: flags.who ?? null, files: !flags["no-files"] });
      if (flags.json || r.error) out(r);
      else { if (r.empty) console.error(`(nothing on this card: no description, checklist, comment or attachment)`); console.log(r.brief); }
      break;
    }
    case "boards": out(await boards(ctx, { create: !!flags.create, client: flags.client ?? rest[0] ?? null })); break;
    case "status": out(status(db, ctx)); break;
    case "link": {
      const dryRun = !!flags["dry-run"];
      const r = flags.smart ? await linkSmart(ctx, { dryRun }) : await link(ctx, { dryRun });
      out({ dryRun, ...r });
      if (!dryRun && !r.error) out({ reindex: await indexAll(ctx, db, { only: ["markdown"] }) });
      break;
    }
    case "check": {
      const r = await runChecks(ctx, db, { live: !flags["no-live"], only: flags.only?.split(",") });
      if (flags.json) out(r); else console.log(readFileSync(r.report, "utf8"));
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

function help() {
  return `company-os — a company brain in markdown and SQLite

  index [--only a,b]         scan connectors → documents, chunks, relations, events
  snapshot                   daily metrics from live connectors
  event <status.json>        record one job run
  search "<query>" [--raw]   full-text search, canon first (N=20 ... for more; --raw adds transcripts, plans, advice)
  account <name|path> [--full]   what is going on with one account: status, ball, pipeline, last contact
  accounts [--side x]        one line per open and won account
  canon [key] [--section s]  a canonical file by short name (no key: list them)
  link [--dry-run] [--smart] attach waiting transcripts to accounts
  check [--no-live] [--only a,b] [--json]   deterministic checks → report + status
  live <kind> [what] [k=v]   read a live source raw (tasks cards, finance subscriptions, calendar today, mail unread)
  ticket <id>… [--repo d] [--who name] [--no-files] [--json]   cards as a brief: description, checklists, comments, attachments on disk (more ids = one brief for one agent)
  mail [query] [--uid n]     mail with the body: search, one by uid, or the latest unread
  finance | tasks | calendar [--from d --to d]   live sources, answer-shaped
  todo "title" [--body ..] [--due d] [--list l]   a card on the task board (reversible, logged)
  task-done <id> [--list l]  move a card to done (reversible, logged)
  draft --to a --title s --file body.txt   a draft in the mail client (never sends)
  boards [client name] [--create]   the boards this brain expects; shows the plan, --create makes what is missing
  inbox list|post|reply|approve|reject|show|run   agents talk back here; approved items get executed
  serve                      MCP server over stdio for agents
  jobs list|install|uninstall|run <name>   schedule the config's jobs on launchd, cron or systemd
  status                     what is in the brain
  import-legacy <db>         copy history from a pre-company-os database
  init [--name "..."] [--language xx] [--example]   config, folders and optionally a demo company

  --root <dir>               root with company-os.config.json (else COMPANY_OS_ROOT)`;
}
