---
title: Answers, not pointers — the MCP layer went from minutes to milliseconds
date: 2026-08-30
tags: [mcp, search, performance, design]
category: architecture
---

**Problem.** Through MCP the brain was slow in a way no profiler shows: every
tool returned pointers, so the agent asking had to keep going. `search
"<lead name> proposal"` put four identical daily plans from June above the
account's status file; `context <account>` returned 46 paths, 46 trivial
`part-of` relations and no content (~20 KB); `ask` spawned a headless Claude
that searched again (19 s, $0.18 for "what is my MRR"). Turning one mail into a
Trello card took a Sonnet session 1 min 47 s and about fifteen tool calls,
including a hand-written IMAP script, because `live mail` had no bodies and no
tool knew the board's list ids.

**What we did.**

1. *Tools answer; they never think.* No tool calls a model. `ask` is gone with
   its table and log. The agent on the other end of MCP does the reasoning.
2. *One call per question.* `account(x)` returns the status head (first
   sections, cut at a paragraph, ~3 KB), who holds the ball, the pipeline row
   and the log lines about it, commitments, last contact, newest files.
   `accounts()` is one line per open/won account. `canon(key)` is the one file
   a fact lives in, from `config.canon`. `finance()` is MRR, ARR, open and
   overdue in one object. `mail(query)` searches server-side and returns the
   body and attachment names.
3. *Canon before raw.* Search has two tiers: status files, pipeline, knowledge
   and contacts first; transcripts, daily plans and advice only with `raw:
   true` or to fill up. Raw hits decay with age; canon does not. Repeated text
   is one hit (hash of the chunk), and one account folder gets at most three.
   The payload dropped the chunk text: path, title, snippet, date.
4. *Reversible writes with a trace.* Connectors gained `act()`: Trello creates
   and moves cards, IMAP files a draft with APPEND (replacing an earlier one
   with the same subject and address; never sends). `core/actions.mjs` wraps
   them and writes an `events` row, so the activity log and the dashboard see
   what an agent did.
5. *The UI is a view.* It polls `/api/version` (max of newest event, inbox
   file, job status) every 3 s and refetches when it moves. The "fix with AI"
   and kickstart routes are gone: an agent with Write+Bash over the vault
   behind an unauthenticated button was the worst of the review's P0s.

**Measured** (real vault, 1,130 documents): `account` 11 ms / 7 KB;
`search` 24–50 ms / 3.4 KB, 8 of 8 hits from the right folder; `accounts` 23 ms;
`canon` 0.5 ms; `mail <sender>` 0.46 s; `todo` 0.87 s; `finance` 1.8 s (Stripe
round trip); `mail_draft` 1.5 s. Mail → card: 1.3 s and two calls.

**What we learned.**

- *Ranking beats retrieval.* FTS5 was never the problem; weights were. A daily
  plan that repeats the same block seventy times wins any BM25 unless you
  dedupe on text and separate canon from raw.
- *The head of a status file is the news.* Long deals grow 20 KB status files
  whose newest section sits at the top. Return the first sections whole and
  cut the one that does not fit — skipping it returned only the warning box.
- *Tool descriptions are the interface.* Written as a briefing for someone who
  has never seen the company: when to use it, what comes back, what to do
  next. `mail` says "mail is live, not in the vault" because the last agent
  grepped markdown for it.
- *Reversible is the line, not "read-only".* A brain that can only read makes
  the agent write the card by hand. A todo, a draft and a move are safe
  because the source itself can undo them; sending is not, so it is not a tool.
- *Delete the chat, keep the view.* The slow part of "talk to the brain in the
  browser" was the model in the middle. Claude Code with the same tools is the
  chat, and it is fast.

**Prevention.** `test/bench/run.mjs --root <vault>` prints ms and bytes per
call; run it before and after touching `search.mjs` or `brief.mjs` and put the
numbers in the commit. `test/brief.test.mjs` and `test/actions.test.mjs` pin
the shapes; stub connectors in `<root>/connectors/` stand in for Trello,
Stripe and IMAP.
