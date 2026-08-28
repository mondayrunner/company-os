---
date: 2026-08-28
phase: 5b — UX pass
tags: [ux, search-quality, inbox, layers]
---

# What reference apps taught us, and what the UI exposed about the system

**What we did.** Studied inbox, AI-answer and dashboard patterns in shipping products (Deel, Graphite, Juicebox, Workable for approval queues; ChatGPT, Sana, Customer.io for cited answers; Cloudflare, Toggl for overview grids) and applied them.

**What we learned.**

1. *Chips are cheap and information is not.* The first inbox row spent its width on three labels — kind, sender, status — and truncated the actual finding. In the Open section every row said "open" and "check": three chips, zero information. Splitting the item into a title (the finding) and a `where` (the location) made every row readable at a glance. The rule: only render a field where it varies.
2. *Batches need batch gestures.* Checks post findings in groups of eight; approving them one modal at a time is the wrong shape. Keyboard triage (j/k/e/x/a/r) plus a selection bar is what every mature queue converges on.
3. *An honest progress view beats a spinner — and it audits the system.* Showing the index hits while the agent reads was meant as a nicety. It immediately exposed that a question about a customer returned morning notes instead of that customer's folder: FTS was ANDing every word, so common words decided the ranking. The UI made a retrieval bug visible that no test had caught.
4. *Rerank beats embeddings for a vault of a thousand files.* A word in the path or the filename outranks ten mentions in a chatty note; a status file outranks its attachments; each document kind carries a configurable weight; one hit per document. Four cheap deterministic signals moved the right file to the top for every question we tried — no vector index needed.
5. *Building a second view of the same number finds the bug in the first.* Putting MRR in a stat strip meant comparing the dashboard's figure with the connector's: €8.375 against €9.025. The dashboard had been counting only the first line item of each subscription for months, undercounting two customers by €650 a month. Nobody notices a plausible number until something computes it twice.
6. *A layer needs its Tailwind sources declared.* Extending a Nuxt layer from another repo compiles the components but not their classes: Tailwind v4 scans the project of the CSS entry, so the layer needs an explicit `@source`. Symptom is deceptive — the shared classes work, only the layer's unique ones vanish.
7. *An external alias means no hot reload.* Marking the core external so Nitro leaves the import alone also means edits to it are invisible until the server restarts. Worth knowing before debugging a change that "did not apply".
8. *Do not overwrite a status the job deliberately left alone.* The job runner wrote "no status written" over a real morning result, because the daily planner skips when the day is already done and keeps its earlier status on purpose. A wrapper should only speak when the job stayed silent *and* failed.
