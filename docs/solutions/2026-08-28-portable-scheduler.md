---
date: 2026-08-28
phase: 4 — portable scheduler
tags: [jobs, launchd, cron, systemd, status-contract]
---

# One job list, three schedulers

**What we did.** `jobs` in the config with standard five-field cron; `brainlane jobs install` renders launchd plists, a crontab block or systemd user units and installs them; `brainlane jobs run <name>` wraps any command in the status contract (log rotation, a status file from the exit code when the job wrote none). The dashboard reads the same list.

**What we learned.**

1. *Cron is the portable schedule language; everything else is a rendering.* launchd's `StartCalendarInterval` is the cartesian product of the fixed cron fields; systemd's `OnCalendar` is `Mon *-*-* 08:00:00`. One parser, three renderers, one describe() for humans.
2. *Reinstalling a scheduler kills running jobs.* `launchctl bootout` of a job mid-run ends it with exit 0 and no status (bash's EXIT trap sees the last command's status). The first `install` did exactly that to a 10-minute advisory run that had started a minute earlier. Guard: check for a PID first, skip with a message, `--force` to override.
3. *`bootout` is asynchronous.* A `bootstrap` right after it fails with "Input/output error" while the old job unloads. Retry with a growing delay; treat "already loaded" as success.
4. *Do not normalise 7→0 on the hour field.* The Sunday alias only applies to weekdays; applying it everywhere turned 07:45 into 00:45 in the dashboard.
5. *Keep the old labels.* `label` per job in the config means the existing `launchctl list` names, log files and the dashboard's kickstart allowlist stay valid across the migration.
