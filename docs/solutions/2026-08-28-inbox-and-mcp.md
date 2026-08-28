---
date: 2026-08-28
phase: 3 — inbox, MCP, live retrieval
tags: [inbox, mcp, human-in-the-loop]
---

# The inbox is where the approval gate becomes software

**What we did.** `inbox/` with one markdown file per item, fingerprinted; `brainlane inbox list|post|reply|approve|reject|run`; checks and `link` post there; `brainlane serve` exposes the brain as an MCP server; `ask` fetches a live source when the question touches one.

**What we learned.**

1. *Fingerprint on (check, where, what), not on time.* A weekly check must not re-post the same finding. Same fingerprint while an item is open, approved or rejected → nothing new. A *rejected* item is the human's "stop telling me" — cheaper and more precise than editing markers into files.
2. *Attach a deterministic action only where the fix is mechanical.* `pipeline-freshness` knows the exact line to replace, so it ships `edit-markdown`. Everything else ships no action: the human's reply becomes the instruction for an agent run. Do not invent actions the check cannot guarantee.
3. *Refuse outward actions by regex before anything runs.* "Send the invoice" as an approved item must fail with a clear message, not execute. The gate is enforced in `runApproved`, not in prompts.
4. *Tests that post to the inbox must run on a copy.* The first checks test polluted the fixture folder with items; the next test file inherited them. Copy the fixture to a temp dir in `before()`.
5. *Live hints are words, configured per language.* Detecting "this question touches finance" by keyword is crude and enough: the cost of a false positive is one extra API call, the cost of a miss is a stale number cited as truth.
6. *MCP over stdio is ~80 lines without a dependency.* initialize, tools/list, tools/call, ping; newline-delimited JSON-RPC. The tool descriptions are the interface design: `live` says "never copy these numbers into markdown" so the agent learns the rule where it uses the tool.
