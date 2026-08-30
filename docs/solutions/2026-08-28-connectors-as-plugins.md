---
date: 2026-08-28
phase: 2 — connectors as plugins
tags: [connectors, live-retrieval, zero-deps]
---

# Connectors as plugins

**What we did.** Five public connectors (`stripe`, `trello`, `tasks-markdown`, `ics-calendar`, `imap`) next to the built-ins (`markdown`, `status`, `metrics-http`), a `company-os live <kind> [what]` command, and a `secret()` helper that reads keys from env files outside the vault.

**What we learned.**

1. *One `kind`, one item shape, two implementations.* `trello` and `tasks-markdown` both answer `live({ what: "cards" })` with `{ id, title, list, due, overdue, url }`. That is the whole "instelbaar" story: a check or a prompt asks the `tasks` kind, never a product. Keep the shapes small and identical; resist per-product extras.
2. *`volatile` decides the schedule, not the kind.* `index` runs the connectors that read files and logs; `snapshot` runs the volatile ones once a day for history. The first version keyed snapshot on `kind === "metrics"` and silently skipped Stripe. Rule: anything you would never copy into markdown is volatile and belongs to `snapshot`.
3. *Live checks pay for themselves on the first run.* `subscriptions-vs-accounts` found an active €550/m subscription with no account folder the moment a `finance` connector existed. Deterministic + live beats AI + stale.
4. *IMAP without a dependency is ~120 lines.* LOGIN, EXAMINE (read-only), UID SEARCH UNSEEN, UID FETCH BODY.PEEK[HEADER.FIELDS (…)] and an RFC 2047 decoder cover "what is unread". EXAMINE instead of SELECT so nothing is ever marked seen. *(Since 2026-08-30 the draft write SELECTs Drafts to replace an earlier draft; reads still use EXAMINE.)*
5. *Browser scrapers are jobs, not connectors.* LinkedIn/X/WhatsApp harvesting stays a scheduled job that writes markdown; the `markdown` connector picks it up. Putting a headless browser inside `company-os index` would make every index slow and flaky. Connectors read APIs and files; signal jobs write files.
