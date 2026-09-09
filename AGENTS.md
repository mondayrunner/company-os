# For the agent setting this up

You are reading this because someone pointed you at this repo and asked you to install company-os for them. This file is the setup you run together. Read `README.md` for what the thing is; this is how you get it running for one person.

## What you are building

A folder of markdown (the vault) that this tool indexes, checks and exposes as MCP tools to you. The vault is theirs, in their git. This repo is the engine and stays a sibling folder. Nothing here calls a model: you do the thinking, the tool answers from their files.

## Two folders, and only one of them is theirs

Keep the engine and the vault apart, always:

- **This repo** (`company-os/`) is the engine. Public, MIT, cloned from GitHub, updated with `git pull`. Nothing of theirs goes in here: no notes, no config, no keys, no connector with their account in it. If they want to change the engine, that is a fork or a pull request, not an edit in place.
- **The vault** is their own folder, next to it, with its own git repo. Private. Everything about their company lives there: the markdown, `company-os.config.json`, their own connectors and checks, `metrics.csv`, `runs.jsonl` and the inbox. `init` writes a `.gitignore` for the index and the job state, because those are derived. Make the repo private and say so out loud: this folder will hold client names, prices and deal terms, and a key can be rotated but a client file cannot be unpublished.
- **The example** (`examples/acme` in this repo, or `init --example`) is fictional and for looking at. `init --example` copies it into their vault as a starting point; it never points back into this repo. Delete the Acme files once their own writing is in.

Should the vault be in git at all? Yes. Markdown in git is the whole design: the index can be deleted and rebuilt, the history is the audit trail, and an agent that edits a status file leaves a diff somebody can read. Outside git you lose all three. What stays out of any git is the env files under `~/.config/<tool>/`.

## The steps

1. **Clone and link.** `git clone https://github.com/mondayrunner/company-os.git`, then `cd company-os && npm link`. If `npm link` is not welcome on this machine, an alias works: `alias company-os="node $PWD/bin/company-os.mjs"`. Needs Node 22.5 or newer, no other dependencies.

2. **Ask where things live.** Before you configure anything, ask three questions and stop for the answers:
   - Where does the work live? (Trello, Linear, Notion, a text file, nowhere yet)
   - Where do conversations live? (recordings, transcripts, a mail account, nowhere yet)
   - Where does the money live? (Stripe, Mollie, Moneybird, the bank, nowhere yet)
   Also ask whether they already have a folder of notes about clients, prices or plans. If so, that folder becomes the vault; do not make a new one next to it.

3. **Make the vault.** In their folder: `company-os init --name "<their name>"`. Add `--example` only if they have nothing yet and want something to look at. Then `company-os index` and `company-os accounts`. This works with zero connectors. Stop here and show them an answer before touching any outside source.

4. **Wire the sources they named.** Match each answer from step 2:
   - A shipped connector exists (`connectors/`: trello, stripe, paraspeech, imap, ics-calendar, metrics-http, markdown, status, tasks-markdown): add it to `connectors` in `company-os.config.json`. It names an env file under `~/.config/<tool>/.env`; the human puts the key there. You never ask them to paste a key into the chat and you never write one into the vault.
   - No shipped connector: write one in `<vault>/connectors/<name>.mjs` against the contract in `docs/extending.md`. Copy the shipped connector of the same `kind` and keep its `what` values, so the checks and panels keep working. If the source has a check that depends on it (mail, transcripts, calendar, board), that check is yours to write too, in `<vault>/checks/`.
   - "Nowhere yet": skip it. `tasks.md` in the vault is a task list, and the rest of the brain does not mind a missing kind.

5. **Register the MCP server** in the agent they use, so you get the tools next time: `claude mcp add company-os -e COMPANY_OS_ROOT=<vault> -- company-os serve`. Cursor and others take the same command as a stdio server.

6. **Optional: jobs and dashboard.** `company-os jobs install` schedules index, check and snapshots with launchd, cron or systemd. The dashboard is `cd ui && npm install && npx nuxt dev`. Offer both, do neither unasked.

7. **Verify.** `company-os check` runs, `company-os accounts` lists what they have, and one MCP call from your side returns an answer from their files. Then say what is set up and what was skipped.

## Rules you keep while doing this

- Anything aimed at the outside world (sending, paying, publishing, deleting) is never a connector action. It becomes an inbox item the human carries out. Do not build around that.
- Numbers that live in a system of record stay there. Do not copy MRR, card counts or invoices into markdown, not even as a convenience.
- Secrets live in `~/.config/<tool>/.env`, named by the connector, never in the vault, never in this repo, never in a chat message.
- Their folder names win. The config maps folders to roles; do not rename their folders to match the example.
- One step at a time, and show the result of each before the next. A setup that ends with "it should work" has not been verified.
