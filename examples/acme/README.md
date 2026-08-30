# Acme Studio — an example brain

A small, fictional web studio: three accounts, one partner, a pipeline, a price list, a compass, a task list and one recorded call waiting to be filed. Everything here is made up. Use it to see what a company brain looks like before you point company-os at your own folders.

```bash
cd examples/acme
company-os index                 # read the markdown into the index
company-os account harper        # what is going on with one lead, in one answer
company-os accounts              # one line per open and won account
company-os canon pricing         # the one file prices live in
company-os tasks                 # the task list, grouped by list
company-os check --no-live       # finds the drift this example plants
```

The planted drift: `pipeline/pipeline.md` says the ball for Harper & Co is with *them*, `accounts/leads/2026-08-12-harper-co-website/STATUS.md` says it is with *us*. `check` reports it; the finding lands in `inbox/`.

Then delete `.company-os/` and run `company-os index` again: nothing is lost, because the markdown is the source and the database is a cache.
