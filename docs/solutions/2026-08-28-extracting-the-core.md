---
date: 2026-08-28
phase: 1 — extract the core
tags: [architecture, checks, dev-loop]
---

# Extracting the core from a private company OS

**What we did.** Moved the brain (index, search, link, ask) and the health check out of a private repo into company-os, English, config-driven. The private repo keeps its Dutch folder names and frontmatter keys; the config maps roles to folders and keys to meaning.

**What we learned.**

1. *A submodule is the wrong dev loop for a two-repo split on one machine.* Edits in `~/Sites/company-os` (the engine) were invisible to the pinned submodule inside `~/Sites/sitelane-brain` (a separate checkout on the old commit) until commit + push + pull. A sibling folder plus `npm link` gives an instant loop; pinning can come back later for others (npm version), not for the author.
2. *Deterministic checks are only useful after a noise pass on real data.* First run: 45 findings, 8 errors. Real: 8 findings, 0 errors. The cuts that mattered: only look for copied figures where a *current* figure would live (pipeline, knowledge), not in account folders that hold dated decisions; treat a folder as covered when *any* table in the pipeline names it; skip URL-ish and slug-ish backtick tokens in doc-path checks; look one folder down for contextual relative paths; strip prose from frontmatter `sources` before resolving.
3. *Keep the API response shape, change the SQL underneath.* The dashboard kept working through a full schema rename (Dutch → English columns) because the routes alias columns (`kind soort`). The UI gets its own pass later; two things did not have to change at once.
4. *The status contract needs both vocabularies during a migration.* `normalizeStatus()` accepts `last_run|laatste_run`, `result|resultaat`; the dashboard reads both. Nothing had to be migrated in lockstep.
5. *`ask` costs ~$1 per question on the default model with a 1,000-document vault.* Fine for a founder, not for agents querying at machine frequency. `ask.model` exists for that reason; the MCP phase should default agents to a cheaper model. *(Update 2026-08-30: `ask` is gone; the key is now `agent.model`.)*

**Where it lives.** `core/checks.mjs` (runner + helpers), `checks/*.mjs`, `connectors/status.mjs` (`normalizeStatus`), `core/config.mjs` (`kinds`, `frontmatter`, `accounts`).
