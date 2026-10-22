import { test } from "node:test";
import assert from "node:assert/strict";
import { cronField, parseCron, describeCron, launchdCalendar, systemdCalendar, renderLaunchd, renderCron, renderSystemd, everyMinutes, selectJobs, install } from "../core/jobs.mjs";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("cron fields", () => {
  assert.deepEqual(cronField("1-5", 0, 7), [1, 2, 3, 4, 5]);
  assert.deepEqual(cronField("*/15", 0, 59), [0, 15, 30, 45]);
  assert.deepEqual(cronField("1,3", 0, 7), [1, 3]);
  assert.equal(cronField("*", 0, 7), null);
  assert.deepEqual(cronField("7", 0, 7), [0]);
});

test("describe", () => {
  assert.deepEqual(describeCron("0 9 * * 1-5"), { text: "weekdays 09:00", weekdays: true, weekly: false, monthly: false });
  assert.equal(describeCron("0 16 * * 5").text, "Fri 16:00");
  assert.equal(describeCron("0 8 1 * *").text, "day 1 08:00");
  assert.equal(describeCron("0 13 * * *").text, "daily 13:00");
});

test("launchd calendar is the product of fixed fields", () => {
  assert.deepEqual(launchdCalendar("45 7 * * 1-5").length, 5);
  assert.deepEqual(launchdCalendar("0 13 * * *"), { Minute: 0, Hour: 13 });
  assert.deepEqual(launchdCalendar("0 16 * * 5"), { Minute: 0, Hour: 16, Weekday: 5 });
});

test("systemd OnCalendar", () => {
  assert.equal(systemdCalendar("0 8 * * 1"), "Mon *-*-* 8:00:00");
  assert.equal(systemdCalendar("30 6 1 * *"), "*-*-1 6:30:00");
});

test("rendered files carry the job", () => {
  const ctx = { root: "/tmp/vault", home: "/tmp/home", config: {} };
  const job = { name: "check", label: "com.x.check", run: "company-os check", cron: "0 8 * * 1", log: "/tmp/check.log" };
  const plist = renderLaunchd(ctx, job);
  assert.match(plist, /<key>Label<\/key><string>com.x.check<\/string>/);
  assert.match(plist, /jobs run check/);
  assert.match(plist, /<key>Weekday<\/key><integer>1<\/integer>/);
  const cron = renderCron(ctx, [job, { name: "ui", label: "com.x.ui", run: "company-os ui", service: true, log: "/tmp/ui.log" }]);
  assert.match(cron, /^0 8 \* \* 1 /m);
  assert.match(cron, /^@reboot /m);
});

test("every: a poll is one StartInterval, the same minutes for cron and systemd", () => {
  const ctx = { root: "/tmp/vault", home: "/tmp/home", config: {} };
  const job = { name: "sent-watch", label: "com.x.sent-watch", run: "company-os check --only drafts-vs-sent --quiet --job sent-watch", every: 900, log: "/tmp/sw.log" };
  const plist = renderLaunchd(ctx, job);
  assert.match(plist, /<key>StartInterval<\/key><integer>900<\/integer>/);
  assert.doesNotMatch(plist, /StartCalendarInterval/);
  assert.match(renderCron(ctx, [job]), /^\*\/15 \* \* \* \* /m);
  assert.match(renderSystemd(ctx, job).timer, /OnCalendar=\*:0\/15/);
  assert.equal(everyMinutes(job), 15);
  assert.throws(() => everyMinutes({ name: "x", every: 420 }));
  assert.throws(() => everyMinutes({ name: "x", every: 3600 }));
});

test("install --only: just the named jobs, unknown names fail", async () => {
  const all = [{ name: "a" }, { name: "b" }, { name: "c" }];
  assert.equal(selectJobs(all, null), all);
  assert.deepEqual(selectJobs(all, "b").map((j) => j.name), ["b"]);
  assert.deepEqual(selectJobs(all, "c, a").map((j) => j.name), ["a", "c"]);
  assert.throws(() => selectJobs(all, "b,typo"), /no job named typo/);
  const root = await mkdtemp(join(tmpdir(), "cos-jobs-"));
  try {
    const ctx = { root, home: root, path: (p) => (p.startsWith("/") ? p : join(root, p)),
      config: { scheduler: { logs: join(root, "logs") }, jobs: [{ name: "a", run: "true", cron: "0 8 * * 1" }, { name: "b", run: "true", every: 900 }] } };
    const r = await install(ctx, { target: "launchd", only: "b", dryRun: true });
    assert.deepEqual(r.jobs.map((j) => j.job), ["b"]);
    assert.equal((await readdir(r.generated)).length, 1);
    await assert.rejects(install(ctx, { target: "launchd", only: "nope", dryRun: true }), /no job named nope/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
