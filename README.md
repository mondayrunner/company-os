# company-os

A company brain in markdown and SQLite. Your files stay the source of truth. company-os indexes them, checks them against reality and answers questions in milliseconds, for you and for the agent you already use. Zero dependencies (Node 22, `node:sqlite`). MIT.

```
company-os init            # a config in your folder
company-os index           # markdown → index
company-os account harper  # one account: status, ball, pipeline row, last contact
company-os canon pricing   # the one file prices live in
company-os check           # drift: stale pages, dead links, pipeline vs. folders, copied figures
company-os serve           # the same answers as MCP tools, for Claude Code or Cursor
```

New here? Read [docs/getting-started.md](docs/getting-started.md), ten minutes from install to a brain that answers. Prefer pictures? Open [docs/explained.html](docs/explained.html): nine drawings, few words.

Your company has a memory that lives in folders. Every morning notes come in: messages, recordings, what happened in the bank. A robot sorts them into the right folder. When you ask something, it looks through the folders and tells you where it found the answer. Every week it checks whether notes have gone stale and asks you: shall I fix this? It never fixes anything on its own. Anything that leaves the building, an email or an invoice, you send by hand.

## Try the example first

`examples/acme` is a small fictional studio: three accounts, a partner, a pipeline, a price list, a compass, a task list and one recording waiting for you to file.

```bash
cd examples/acme
company-os index
company-os account harper
company-os accounts
company-os canon pricing
company-os check --no-live     # finds the drift the example plants
```

Delete `.company-os/` and run `index` again. Nothing is lost, because the markdown is the source and the database is a cache. `test/example.test.mjs` keeps every command above working.

## Four parts

Every company brain has the same four parts (after *The Ontology of the Company Brain*, Slite 2026). What company-os does for each:

1. **Getting signals.** Connectors pull from your tools on a schedule. Every job writes a status file, so a job that stops is a finding and not a silence.
2. **Remembering.** Markdown in git is the canon. `brain.db` is an index you can delete; `company-os index` rebuilds it. Daily numbers also go to `metrics.csv`, because you cannot recompute yesterday's MRR.
3. **Dreaming and pruning.** `company-os check` runs deterministic checks and posts findings to an inbox. You decide. The brain proposes, it never changes canon on its own.
4. **Speaking and searching.** An MCP server with tools that answer from the files: `account`, `accounts`, `canon`, `search`, the live sources, and three reversible writes. No tool calls a model. The agent you talk to does the thinking, so an answer takes milliseconds.

One rule follows from this: **figures that live in a system of record (MRR in Stripe, cards in Trello) are never copied into markdown.** The brain reads them live and snapshots a few numbers a day. A copy starts ageing the moment you make it, and `check` flags copies.

## Configuration

Everything is `company-os.config.json` at the root of your folder. Folder names are yours; the config says which folder plays which role.

```json
{
  "name": "Acme", "language": "en",
  "kinds": [{ "kind": "knowledge", "prefix": "knowledge/" }, { "kind": "account", "pattern": "^accounts/[^/]+/" }],
  "accounts": { "root": "accounts", "sides": ["leads", "customers"], "statusFile": "STATUS.md", "ballLine": "**Ball with:**" },
  "canon": { "pricing": "knowledge/pricing.md" },
  "connectors": { "markdown": {}, "status": {}, "tasks-markdown": { "file": "tasks.md" } }
}
```

`language` is the language agents write in. The code and the prompts are English.

## Connectors

A connector is one file with one contract:

```js
export default {
  name: "trello", kind: "tasks", volatile: true,
  scan(ctx, options) { /* scheduled pull → { documents?, events?, metrics?, count, added, message } */ },
  live(query, ctx, options) { /* read now → { items } */ },
  act(action, params, ctx, options) { /* one reversible write, e.g. create a card */ },
}
```

Built in: `markdown`, `status`, `metrics-http`, `stripe`, `trello`, `tasks-markdown`, `ics-calendar`, `imap`. Put a private one in `<folder>/connectors/<name>.mjs` and company-os finds it first. `act()` is for what the source itself can undo: a card, a draft, a move. Sending, paying and publishing are not actions and will not be. Secrets come from an env file the connector names, never from the folder. Details: [docs/extending.md](docs/extending.md).

## Checks

`checks/*.mjs`, plus your own in `<folder>/checks/`. Each returns findings `{ severity, where, line, what }`. company-os drops a finding on a line you already marked (`⚠️`, `SUPERSEDED`): your note wins. `silent-jobs` watches the jobs themselves, including the one that reports ok while doing nothing. That case went unnoticed here for four weeks.

## Inbox

Every finding and proposal is one markdown file in `inbox/`, fingerprinted so the same finding never lands twice. Approve and the brain applies it; reject and it stays quiet for good. The brain refuses outward actions by design.

## Jobs

```json
"jobs": [
  { "name": "index", "title": "Index the folder", "run": "company-os index", "cron": "45 7 * * 1-5" },
  { "name": "check", "title": "Weekly checks", "run": "company-os check", "cron": "0 8 * * 1" }
]
```

`company-os jobs install` renders launchd (macOS), cron or systemd timers from the same list. Every job gets a status file, a rotating log and a row in the event history. `company-os jobs run <name>` runs one now.

## MCP

`company-os serve` exposes the brain over stdio. Register it once:

```bash
claude mcp add company-os -e COMPANY_OS_ROOT=/path/to/your/folder -- company-os serve
```

Reading: `account`, `accounts`, `canon`, `search`, `mail`, `finance`, `tasks`, `calendar`, `live`, `status`, `check`. Writing, reversible and logged: `todo`, `task_done`, `mail_draft`. Talking back: `inbox_post`, `inbox_list`.

## Dashboard

`ui/` is a Nuxt app that shows the brain: overview, inbox, activity, status. It is a view. It polls for changes every few seconds, so a card you create from Claude Code shows up within seconds. A private dashboard can `extends` it and add its own pages. See `ui/README.md`.

## Status

Early, and running a real company every day. The parts here survived contact with reality.
