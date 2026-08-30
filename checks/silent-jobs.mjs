// Jobs that fail without anyone noticing.
//
// A scheduled job writes a status file and a log, and then nobody opens either.
// The failure mode is not a crash — it is silence: a job that stopped running,
// or one that says "ok" about work it did not do. Both look identical from the
// outside, which is exactly why they last for weeks.
//
// What this catches:
//   - a job that never wrote a status file at all
//   - a job whose last run reported an error, which nobody read (except the
//     check job itself, whose "partial" means it found something)
//   - a job that reported ok while doing nothing (done: 0)
//   - a job whose last run is older than its own schedule allows
//
// What it cannot catch: a step inside a job that skips itself while the job as
// a whole still reports ok. That has to be fixed where the job counts its work
// — a step that is skipped is not a step that succeeded.
//
// Configure with `checks.silent-jobs`:
//   { "ignore": ["dashboard"], "graceDays": { "daily": 2, "weekdays": 4, "weekly": 8, "monthly": 32 } }
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { listJobs } from "../core/jobs.mjs";

const DEFAULT_GRACE = { daily: 2, weekdays: 4, weekly: 8, monthly: 32 };

const daysSince = (iso) => (Date.now() - new Date(iso).getTime()) / 864e5;

/** How stale a job may get before silence is the more likely explanation. */
export function graceFor(job, grace) {
  if (job.monthly) return grace.monthly;
  if (job.weekly) return grace.weekly;
  if (job.weekdays) return grace.weekdays;
  return grace.daily;
}

export default {
  name: "silent-jobs",
  description: "scheduled jobs that stopped running, or report ok about nothing",
  async run(ctx, h, options = {}) {
    const grace = { ...DEFAULT_GRACE, ...(options.graceDays ?? {}) };
    const ignore = new Set(options.ignore ?? []);
    const findings = [];

    for (const job of await listJobs(ctx)) {
      // A service is always on; when it dies the symptom is a dead port, not a
      // stale status file. Different check, different day.
      if (job.service || ignore.has(job.name)) continue;

      const where = `jobs/${job.name}`;

      if (!job.lastRun) {
        findings.push({ severity: "warn", where, what: `job \`${job.name}\` (${job.schedule}) has never written a status file — has it ever run?` });
        continue;
      }

      const age = daysSince(job.lastRun);
      const day = job.lastRun.slice(0, 10);

      // The check job is the one job whose "partial" means it found something,
      // not that it broke. Reporting on that would be a loop: every finding
      // would produce a finding about having found something.
      const reportsOnFindings = job.run?.includes("check") || job.name === "check";

      // It said something was wrong and nobody read it. The status file and the
      // log are not places anyone looks; the inbox is.
      if (reportsOnFindings) {
        // its result is about the vault, not about itself
      } else if (job.result === "error") {
        findings.push({ severity: "error", where, what: `job \`${job.name}\` last reported an error on ${day}: ${job.message || "no message"}` });
      } else if (job.result === "partial") {
        findings.push({ severity: "warn", where, what: `job \`${job.name}\` last reported partial on ${day}: ${job.message || "no message"}` });
      }

      // "ok" over zero work. This is the one that hides longest, because every
      // dashboard shows a green light.
      const raw = await readFile(join(ctx.stateDir, `${job.name}-status.json`), "utf8").then(JSON.parse).catch(() => null);
      const done = raw?.done ?? raw?.gedaan;
      if (job.result === "ok" && done === 0) {
        findings.push({ severity: "error", where, what: `job \`${job.name}\` reported ok on ${day} but did nothing (done: 0) — a job that reports ok about no work is the hardest kind to notice` });
      }

      const allowed = graceFor(job, grace);
      if (age > allowed) {
        findings.push({ severity: "warn", where, what: `job \`${job.name}\` (${job.schedule}) last ran ${Math.floor(age)} days ago, on ${day} — more than the ${allowed} days its schedule allows` });
      }
    }

    return findings;
  },
};
