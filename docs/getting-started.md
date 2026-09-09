# Getting started

Ten minutes to a brain that answers questions about your own company.

## 1. Install

There is no package. Clone the repo and link the command:

```bash
git clone https://github.com/mondayrunner/company-os.git
cd company-os
npm link                      # puts `company-os` on your PATH
company-os --help
```

No `npm link`? `alias company-os="node $PWD/bin/company-os.mjs"` does the same.
Node 22.5 or newer. No other dependencies: the database is `node:sqlite`.

Steps 1 to 4 need nothing but this folder. Steps 5 and 6 add outside sources,
and each is optional: skip the ones you do not use, or write your own.

## 2. Make a vault

A vault is a folder of markdown with a config in it. Yours, in its own private
git repo, readable without this tool. Keep it next to the `company-os` clone,
never inside it: the engine is public and updated with `git pull`, the vault
holds your clients and is nobody's business.

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
company-os account northwind
```

`search` is full text over your own words. `account` is one account in one
answer: the head of its status file, who holds the ball, its pipeline row,
commitments, last contact and newest files.

## 4. Get an answer

```bash
company-os accounts            # one line per open account: ball, next action, last touch
company-os account acme        # everything about one account, in a few kilobytes
```

Nothing here calls a model. Ask the questions in the agent you already use:
register the MCP server (`claude mcp add company-os -- company-os serve`) and
Claude Code or Cursor gets these same answers as tools.

## 5. Connect a source (optional)

Numbers that live in another system stay there. A connector reads them when
asked, and nothing copies them into your markdown. Stripe is the example below
because it ships; if your money lives elsewhere, [extending.md](extending.md)
shows the one-file contract a connector has to meet, and the shipped ones in
`connectors/` are the templates to copy.

```json
"connectors": { "stripe": { "envFile": "~/.config/finance/.env" } }
```

```bash
company-os live finance subscriptions
company-os snapshot     # one row of numbers per day, for the line later
```

Which sources exist and how to write your own: [extending.md](extending.md).

## 6. Make the boards, pick up a ticket (optional, Trello)

Skip this step if your work does not live in Trello: `tasks.md` in the vault
already gives the brain a task list, and a connector for your own tool takes
this step's place.

The Trello connector expects three kinds of board: one for sales, one for your
own to-do list, and one per client. It makes them itself, so the column names
are an agreement instead of something you have to remember to type the same way
twice.

```bash
company-os boards                   # what exists, what is missing
company-os boards --create          # make what is missing
company-os boards "Acme" --create   # one client board from the template
```

Rename the lists under `boards` in the config first if you want other names.
Nothing is created without `--create`, and a board that already carries the name
is left alone, so running it twice is safe.

With a board in place, one card is a briefing:

```bash
company-os ticket 6a9413 --repo ~/code/acme-site
```

Description, checklists, comments, and every attachment downloaded to disk, so
whoever picks it up can open the screenshot instead of staring at a private URL.
Pipe it into the agent you use. A card with nothing on it says so, instead of
starting a session that has to guess what the work was.

## 7. Let it run

```bash
company-os jobs install   # launchd, cron or systemd, whichever this machine has
company-os jobs list
```

Every job writes the same status file, rotates its own log and adds a row to
the run history. When one goes quiet you see it, which is the point.

## 8. Open the dashboard

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
