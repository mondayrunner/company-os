# brainlane

A company brain in markdown and SQLite. Your files stay the source of truth; brainlane indexes them, checks them against reality, and answers questions with sources — for people and for agents. Zero dependencies (Node 22, `node:sqlite`).

```
brainlane init            # a config in your vault
brainlane index           # markdown → documents, chunks, relations
brainlane search "koos"   # full-text, ranked
brainlane check           # drift: stale pages, dead links, pipeline vs. folders, copied figures
brainlane ask "what did we promise Acme?"   # answer with [[sources]] via a headless agent
```

## Like you're five

Your company has a memory that lives in folders. Every morning notes come in: messages, recordings, what happened in the bank. A robot sorts them into the right folder. When you ask something, it looks through every folder and tells you *where* it found the answer. Every week it checks whether notes have gone stale, and asks: "shall I fix this?" It never fixes anything on its own. Anything that leaves the building — an email, an invoice — a human sends by hand.

## The four parts of a company brain

Every company brain, home-made or bought, is the same four parts (after *The Ontology of the Company Brain*, Slite 2026). What brainlane does for each, and the choice behind it:

1. **Getting signals.** Connectors pull from your tools on a schedule (chat exports, recordings, task boards, payments) and every job writes a status file. Choice: capture rides along with work that happens anyway. A brain that waits for someone to write things down starves.
2. **Remembering.** Markdown in git is the canon. `brain.db` (SQLite, FTS5) is an index you can delete; `brainlane index` rebuilds it. Choice: context sovereignty — the brain sits above the platforms and above the models, so no vendor can lock it in or throttle it.
3. **Dreaming and pruning.** `brainlane check` runs deterministic checks: stale articles, dead links, the pipeline's own claims against its log and against live sources. Findings are proposals in an inbox; a human decides. Choice: AI does not yet get to decide what is true. Company context is political; two people can both be right about their slice.
4. **Speaking and searching.** `brainlane search` for machines, `brainlane ask` for people, an MCP server for agents. Every claim cites a path. Choice: "not found in the brain" is a valid answer. Inventing is not.

## The flow: from raw data to an answer

**Sanitise** — decide per source what may enter, what is sensitive, which system owns the current version. **Structure** — stable knowledge in `knowledge/`, relationship-specific in `accounts/<id>/`, procedures in playbooks, rules in the OS layer. **Ingest** — every connector has a contract (`kind`, `volatile`, `scan()`, optional `live()`), and none of them writes back. **Retrieve** — start from the question, fetch the smallest relevant piece, check a live source when the fact can change, cite it.

The one rule that follows from this: **figures that live in a system of record (MRR in Stripe, tasks in Trello) are never copied into markdown.** They are read live and snapshotted daily for history. A copy is a second system that starts ageing the moment you make it. `brainlane check` flags copies.

## Configuration

Everything is `brainlane.config.json` at the root of your vault. Folder names are yours; brainlane only needs to know which folder plays which role:

```json
{
  "name": "Acme", "language": "en",
  "kinds": [{ "kind": "knowledge", "prefix": "knowledge/" }, { "kind": "account", "pattern": "^accounts/[^/]+/" }],
  "accounts": { "root": "accounts", "sides": ["leads", "customers"], "statusFile": "STATUS.md", "ballLine": "**Ball with:**" },
  "connectors": { "markdown": {}, "status": {}, "metrics-http": { "url": "http://localhost:4321/api", "metrics": { "mrr": "finance.stripe.mrr" } } },
  "checks": { "knowledge": { "slaDays": 60 }, "docs": ["CLAUDE.md"] }
}
```

`language` is the language agents answer in; the code and prompts are English. Frontmatter keys are configurable too, so an existing vault keeps its vocabulary.

## Connectors are plugins

```js
export default {
  name: "trello", kind: "tasks", volatile: true,
  scan(ctx, options) { /* scheduled pull → { documents?, events?, metrics?, count, added, message } */ },
  live(query, ctx, options) { /* inference-time retrieval → { items } */ },
}
```

Built-in: `markdown`, `status`, `metrics-http`, `stripe` (finance), `trello` and `tasks-markdown` (tasks — same item shape, so they are interchangeable), `ics-calendar` (calendar), `imap` (mail; works with Proton Mail Bridge). Private ones go in `<vault>/connectors/<name>.mjs` and are found first — no fork needed. There is deliberately no `write()`.

`volatile: true` means: read live (`brainlane live finance subscriptions`), snapshot a few numbers daily (`brainlane snapshot`), never copy into markdown. Secrets come from an env file the connector names (`"envFile": "~/.config/finance/.env"`), never from the vault.

## Checks are plugins too

`checks/*.mjs` (built-in) and `<vault>/checks/*.mjs`. Each returns findings `{ severity, where, line, what }`. A finding on a line a human already marked (`⚠️`, `SUPERSEDED`, your own markers) is dropped: the human's note wins.

## Design rules

From Anthropic's *New rules of context engineering* (2026): judgement over rules, interfaces over examples, progressive disclosure, one place per instruction, auto-memory, rich references. In practice: a short CLAUDE.md that says *why*, tool interfaces whose shape explains their use, and everything else loaded only when needed.

And one rule above all: **the approval gate.** Anything irreversible or outward-facing is a proposal until a human has seen the final version and said yes.

## The inbox: where agents talk back

Every finding, proposal and question from a check, a job or an agent becomes one markdown file in `inbox/`, fingerprinted so the same finding never lands twice. You answer in the file, in the dashboard or with `brainlane inbox reply <id> "..." --approve`; `brainlane inbox run` then executes the approved ones — a deterministic edit where the fix is mechanical, an agent run from your reply where it is not. Outward actions (send, publish, invoice) are refused by design: those stay proposals a human executes.

This is the approval gate as software, and it is what every builder in the field converged on independently.

## Jobs

```json
"jobs": [
  { "name": "index", "title": "Index the vault", "run": "brainlane index", "cron": "45 7 * * 1-5" },
  { "name": "check", "title": "Weekly checks", "run": "brainlane check", "cron": "0 8 * * 1" },
  { "name": "ui", "title": "Dashboard", "run": "cd ui && npx nuxt dev --port 4321", "service": true }
]
```

`brainlane jobs install` renders launchd plists (macOS), a crontab block or systemd user timers — same list, whatever the machine has. Every job gets the same status contract: a status file per run, a rotating log, and a row in the brain's event history. `brainlane jobs list` shows schedule and last result.

## The dashboard

`ui/` is a Nuxt app that mirrors your config: a panel per live connector kind, an inbox page, and a status page that lists every module. It is a Nuxt layer, so a private dashboard can `extends` it and add its own pages and brand. See `ui/README.md`.

## MCP

`brainlane serve` exposes the brain over stdio: `search`, `context`, `ask`, `live`, `check`, `inbox_post`, `inbox_list`, `status`. Register it once (`claude mcp add brainlane -- brainlane serve`) and every agent can query the brain instead of grepping — and talk back through the inbox.

## Status

Early, but running a real company. Extracted from a single-founder setup that has been in daily use; the parts here are the parts that survived contact with reality. MIT.
