import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadContext } from "../core/config.mjs";
import { runJob } from "../core/jobs.mjs";

// A job that writes no status of its own: the runner writes one for it.
function setup(run) {
  const root = mkdtempSync(join(tmpdir(), "company-os-job-"));
  writeFileSync(join(root, "company-os.config.json"), JSON.stringify({ name: "t", stateDir: "state", scheduler: { logs: "logs" }, jobs: [{ name: "sync", run }] }));
  mkdirSync(join(root, "state"), { recursive: true });
  const ctx = loadContext({ root });
  const file = join(ctx.stateDir, "sync-status.json");
  return { ctx, file, status: () => JSON.parse(readFileSync(file, "utf8")), old: (s) => { writeFileSync(file, JSON.stringify(s)); const t = new Date(Date.now() - 86400000); utimesSync(file, t, t); } };
}

test("a failed run without a status is recorded as an error", async () => {
  const { ctx, status } = setup("exit 1");
  assert.equal(await runJob(ctx, "sync"), 1);
  assert.equal(status().result, "error");
  assert.match(status().message, /the job wrote no status/);
});

test("a clean run clears an error the runner wrote itself", async () => {
  const { ctx, status, old } = setup("true");
  old({ job: "sync", last_run: "2026-11-12T17:08:56.245Z", date: "2026-11-12", result: "error", done: 0, failed: 1, message: "exit 1 after 0s (the job wrote no status)" });
  assert.equal(await runJob(ctx, "sync"), 0);
  assert.equal(status().result, "ok");
  assert.notEqual(status().date, "2026-11-12");
});

test("a clean run leaves the job's own status alone", async () => {
  const { ctx, status, old } = setup("true");
  old({ job: "sync", last_run: "2026-11-12T08:00:00.000Z", date: "2026-11-12", result: "ok", done: 3, failed: 0, message: "3 appointments" });
  assert.equal(await runJob(ctx, "sync"), 0);
  assert.equal(status().message, "3 appointments");
});
