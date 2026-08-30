---
date: 2026-08-28
phase: 5 — dashboard, and a rename
tags: [data-loss, invariants, naming, nuxt]
---

# "The database is a cache" was true for everything except metrics

**What happened.** Renaming the project meant a new data directory, so the old `brain.db` was deleted on the assumption that `index` rebuilds everything. It rebuilt documents, chunks, relations, events and the inbox — and silently lost ~two weeks of daily metrics (MRR, open tasks, unread mail). Those are point-in-time observations: nothing on disk can recompute what MRR was on 14 August.

**The fix.** Every `snapshot` now writes the full series to `metrics.csv` in the vault, which git tracks; `index` reads it back and fills any gaps. The invariant holds again: delete the database, lose nothing.

**The lesson, generalised.** When a system claims "X is derived, Y is the source", enumerate what is actually in X and check each one against that claim. The exception is where the data loss lives. Here it was one table out of eight — appended-to daily, never rewritten, and therefore invisible in every "does index rebuild it?" test that ran on a fresh vault.

**Also learned while porting the dashboard.**

1. *Nitro rewrites relative imports.* A server route importing `../../../core/config.mjs` resolves fine in dev and breaks after bundling (`Cannot find module '/core/config.mjs'`). Use an absolute alias resolved in `nuxt.config.ts` and mark it external.
2. *npm can fail to resolve a fresh Nuxt tree* ("Cannot read properties of null (reading 'edgesOut')" in arborist's peer-set loader). Copying a known-good `package-lock.json` from a working app and rewriting its root entry to match the new `package.json` sidesteps it entirely.
3. *A dashboard that reads its own config needs no feature flags.* The overview renders one panel per live connector kind; `/status` lists connectors and jobs as modules. Adding a connector adds a panel; removing it removes one. No dead UI for sources a user does not have.
4. *Renaming is cheap if paths were already contracts.* Config file, data directory, env var, CLI name and MCP server all moved in one scripted pass, because every reference already went through `loadContext()` or `$OS_CLI` rather than a literal path.
