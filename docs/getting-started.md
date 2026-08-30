# Getting started

Ten minutes to a brain that answers questions about your own company.

## 1. Install

```bash
npm install -g companyos      # or: npx companyos …
company-os --help
```

Node 22.5 or newer. No other dependencies: the database is `node:sqlite`.

## 2. Make a vault

A vault is a folder of markdown with a config in it. Yours, in git, readable
without this tool.

```bash
mkdir acme && cd acme
company-os init --name "Acme" --example
```

That writes the config, the folders and a small company: one customer, one
lead, one wiki page, and a pipeline. One thing in it is wrong on purpose.

```bash
company-os index      # read the markdown into the index
company-os check      # → pipeline says the ball is with them, the account file says you
```

That warning is the whole idea in one line. The markdown is the truth, the
index is derived, and a check tells you where two truths stopped agreeing.
Delete `.company-os/brain.db` and run `index` again: nothing is lost.

Leave off `--example` for an empty vault. You then get the folders and nothing
to look at, which is right when you already have your own markdown to point at.

## 3. Put your own writing in it

Move or write markdown into `knowledge/` and `accounts/<side>/<name>/`. Folder
names are yours — `kinds` and `accounts` in the config say which folder plays
which part, so an existing vault keeps its own vocabulary.

```bash
company-os index
company-os search "what we charge"
company-os context accounts/customers/northwind
```

`search` is full text over your own words. `context` is everything around one
account: its files, what links to it, what a job last said about it.

## 4. Ask it something

```bash
company-os accounts            # one line per open account: ball, next action, last touch
company-os account acme        # everything about one account, in a few kilobytes
```

Nothing here calls a model. Ask the questions in the agent you already use:
register the MCP server (`claude mcp add company-os -- company-os serve`) and
Claude Code or Cursor gets these same answers as tools.

## 5. Connect a source

Numbers that live in another system stay there. A connector reads them when
asked, and nothing copies them into your markdown.

```json
"connectors": { "stripe": { "envFile": "~/.config/finance/.env" } }
```

```bash
company-os live finance subscriptions
company-os snapshot     # one row of numbers per day, for the line later
```

Which sources exist and how to write your own: [extending.md](extending.md).

## 6. Let it run

```bash
company-os jobs install   # launchd, cron or systemd, whichever this machine has
company-os jobs list
```

Every job writes the same status file, rotates its own log and adds a row to
the run history. When one goes quiet you see it, which is the point.

## 7. Open the dashboard

```bash
cd ui && npm install && npx nuxt dev
```

One tile per live connector kind, an inbox, a status page listing every module.
Your name, your title and your logo come from the config:

```json
{ "name": "Acme", "ui": { "title": "Acme OS", "logo": "/brand/logo.svg" } }
```

Put the file in `ui/public/brand/logo.svg`, or point `logo` at any URL. Leave it
out and you get a small mark instead. Nothing else in the interface is branded.

## Where things end up

| | |
|---|---|
| Your writing | the vault, in git |
| The index | `.company-os/brain.db`, derived, safe to delete |
| Numbers per day | `metrics.csv` in the vault |
| Job runs | `runs.jsonl` in the vault |
| What a job wants from you | `inbox/`, one markdown file per item |
| Secrets | `~/.config/<tool>/.env`, never the vault |

## The one rule

Anything aimed at the outside world — sending, publishing, invoicing, deleting —
is a proposal until you have seen the final version and said yes. The inbox is
that gate in software: `company-os inbox run` executes what you approved, and
refuses the rest.
