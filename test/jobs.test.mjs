import { test } from "node:test";
import assert from "node:assert/strict";
import { cronField, parseCron, describeCron, launchdCalendar, systemdCalendar, renderLaunchd, renderCron } from "../core/jobs.mjs";

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
  const job = { name: "check", label: "com.x.check", run: "brainlane check", cron: "0 8 * * 1", log: "/tmp/check.log" };
  const plist = renderLaunchd(ctx, job);
  assert.match(plist, /<key>Label<\/key><string>com.x.check<\/string>/);
  assert.match(plist, /jobs run check/);
  assert.match(plist, /<key>Weekday<\/key><integer>1<\/integer>/);
  const cron = renderCron(ctx, [job, { name: "ui", label: "com.x.ui", run: "brainlane ui", service: true, log: "/tmp/ui.log" }]);
  assert.match(cron, /^0 8 \* \* 1 /m);
  assert.match(cron, /^@reboot /m);
});
