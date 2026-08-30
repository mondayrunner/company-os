# company-os homepage copy

Written 2026-08-30 with the Napier Holland method: pain first, ability-led headlines, claims with their source. The Paper file "company-os homepage" is the design of this copy.

## Nav

company-os · Docs · GitHub · **npm i -g companyos**

## Hero

Kicker: Open-source company brain for Claude Code and Cursor

# Your agent gets the answer, not a list of files.

company-os turns a folder of markdown and your live tools into one MCP server. Ask about a client and get the status, who holds the ball and what you promised, in one call. No model inside, no vector database, no dependencies.

[Install in two minutes] [See how it works]
MIT · zero dependencies · runs on your laptop

Proof line: Runs one company every day. Measured, not promised: a todo from a mail went from 1 min 47 s to 1.3 s.

Illustration: `$ company-os account harper` with its output.

## The problem

## Your agent knows your code. It knows nothing about your company.

**Ask what you promised a client and it starts grepping.** Ten tool calls, four reads, and a guess. A todo from one mail took 1 min 47 s.

**Search tools hand back pointers.** Forty paths and a pile of snippets, four of them the same daily note. The reading is still on the agent, and on your bill.

**SaaS brains copy your numbers.** Your MRR now lives in three places and two are stale. And they charge per seat, for a company of one.

Every question costs a minute and a guess.

## The idea

## Markdown is the truth. SQLite is the cache. Live stays live.

Canon: your status files, pipeline and wiki, in git. You edit them; the brain reads them.
Index: rebuilt from the files whenever you like. Delete it and nothing is lost.
Live: Stripe, Trello, mail and calendar are asked when needed, never copied into markdown.

## Answers

### Ask about a client and get the whole picture in one call.

`account("harper")` returns the head of the status file, who holds the ball, the pipeline row, open commitments, last contact and the newest files. 11 ms, 7 KB, on a vault of 1,100 documents.

- canon first; transcripts and daily notes only when you ask for raw
- search dedupes the 77 identical lines that daily notes repeat
- `canon("pricing")` for the file everyone keeps quoting wrong

## Actions

### Turn a mail into a todo in two calls.

`mail` gives you the body, `todo` puts the card on the board. Only writes the source can undo: a card, a draft. Nothing here sends, pays or publishes.

- mail, finance, tasks, calendar: live, answer-shaped
- todo, task_done, mail_draft: reversible and logged
- 1.3 s instead of 1 min 47 s, measured on the same mail

## Honesty

### It tells you when it is wrong.

Nine deterministic checks run on a schedule: stale status, ball mismatch, copied figures, dead links, silent jobs. Findings land in an inbox. Approve one and an agent fixes it; git holds the undo.

- $0 a run, no model involved
- one item per finding, never the same one twice
- the dashboard moves within 3 seconds of any change

## Quote

"Measured on my own vault, n = 1: an account in 11 ms, a mail to a todo in 1.3 s, MRR in 1.8 s and $0. Before: 19 seconds and 18 cents for one question."
Tim van den Bosch, runs it every day at Sitelane

## Midway CTA

## Three commands to your first answer.

    npm i -g companyos
    company-os init --example
    company-os account harper

[Install in two minutes]

## Questions people ask before they trust it

**Does it call a model?** Never inside a tool. Your agent does the thinking; the tools answer in milliseconds.
**Can it send mail?** No. It files a draft in your Drafts folder; you press send.
**Where is my data?** In a folder you own, in git. The database is a cache you can delete.
**Is it for teams?** Built for one person. The dashboard binds to localhost; there is no login.
**How is it different from Basic Memory, Obsidian MCP or Slite?** Those hand your agent docs and blocks. This hands it answers.

## Final CTA

## Give your company a memory your agent can use.

[Install in two minutes] [Read the source]
MIT · under 4,000 lines · read it in an evening

## Footer

company-os · Docs · GitHub · Made by Sitelane
