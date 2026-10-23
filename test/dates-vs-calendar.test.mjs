import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadContext } from "../core/config.mjs";
import { openDb } from "../core/db.mjs";
import { makeHelpers } from "../core/checks.mjs";
import check, { datesIn, currentLines, dayKey } from "../checks/dates-vs-calendar.mjs";
import { parseEvents, unfold, eventsOn } from "../connectors/ics-calendar.mjs";

const fixture = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "company");
const lead = "accounts/leads/2026-01-15-acme-website";
const DAY = 86400000;
const ahead = (n) => dayKey(Date.now() + n * DAY);
const dm = (n) => { const d = ahead(n); return `${+d.slice(8, 10)}-${+d.slice(5, 7)}`; };

let root, ctx, db, h, calendar, cards;

function setup(status) {
  root = mkdtempSync(join(tmpdir(), "company-os-dvc-"));
  cpSync(fixture, root, { recursive: true });
  rmSync(join(root, ".company-os"), { recursive: true, force: true });
  writeFileSync(join(root, lead, "STATUS.md"), status);
  ctx = loadContext({ root });
  db = openDb(ctx);
  h = makeHelpers(ctx, db, []);
  calendar = {};
  cards = null;
  h.live = async (kind, q) => {
    if (kind === "calendar") {
      const days = {};
      for (let d = Date.parse(`${q.from}T12:00:00`); dayKey(d) <= q.to; d += DAY) days[dayKey(d)] = calendar[dayKey(d)] ?? [];
      return { days };
    }
    if (kind === "tasks") { if (!cards) throw new Error("no tasks connector"); return { items: cards }; }
    throw new Error(`unexpected ${kind}`);
  };
}
afterEach(() => { try { db?.close(); } catch {} if (root) rmSync(root, { recursive: true, force: true }); root = null; db = null; });

const status = (ball, extra = "") => `# STATUS — Acme website\n\n**Ball with:** ${ball}\n\n${extra}## Log\n\n- 2026-01-15 — first contact.\n`;

test("datesIn: ISO, day-month, written months, the nearest year", () => {
  const today = new Date(2026, 9, 23);
  const got = datesIn("kickoff 26-10; build days 24–26/11, 2026-12-01, 3 nov 2026, 26 oktober, 5 Jan, 15:48, 10.5", today).map((d) => d.day);
  assert.deepEqual(got, ["2026-10-26", "2026-11-26", "2026-12-01", "2026-11-03", "2026-10-26", "2027-01-05"]);
  assert.deepEqual(datesIn("31-2 and 13-13 and 2026-02-30", today), []);
  assert.deepEqual(datesIn("on 2-3", new Date(2026, 1, 1)).map((d) => d.day), ["2026-03-02"]);
});

test("currentLines: the ball line, next-action and planning lines; never the log", () => {
  const text = "# S\n\n**Ball with:** them, kickoff 3-11\n\n## Notes\n\nworkshop 4-11\n\n## Next steps\n\n- demo 5-11\n\n### Sub\n\n- call 6-11\n\n## Log\n\n- workshop 7-11\n\n### Old\n\nmeeting 8-11\n";
  const a = { ballLine: "**Ball with:**" };
  assert.deepEqual(currentLines(text, { accounts: a }), ["**Ball with:** them, kickoff 3-11", "- demo 5-11", "- call 6-11"]);
  assert.deepEqual(currentLines(text, { accounts: a, scope: "all" }), ["**Ball with:** them, kickoff 3-11", "workshop 4-11", "- demo 5-11", "- call 6-11"]);
  assert.deepEqual(currentLines("- 2026-10-01 — kickoff 3-11\n**Ball with:** me\n", { accounts: a }), ["**Ball with:** me"]);
});

test("an appointment day in the ball line that the calendar does not have is a question", async () => {
  setup(status(`them — they want to use the toolkit on their leadership day of ${dm(3)}.`));
  calendar[ahead(3)] = [{ summary: "Dentist", start: null, allDay: true, uid: "x1" }];
  const f = await check.run(ctx, h, { snapshot: false });
  assert.equal(f.length, 1);
  assert.equal(f[0].kind, "question");
  assert.equal(f[0].where, `${lead}/STATUS.md`);
  assert.match(f[0].what, new RegExp(`names ${dm(3)} as an appointment.*it has: "Dentist"`));
  assert.equal(f[0].action.type, "edit-markdown");
  assert.equal(f[0].action.appendReply, true);
  assert.equal(f[0].action.under, "Log");
});

test("no question when the calendar has a matching event, or the date is a deadline, a choice, history or too far", async () => {
  setup(status(`them — workshop on ${dm(4)}.`));
  calendar[ahead(4)] = [{ summary: "Acme workshop", start: null, allDay: true }];
  assert.equal((await check.run(ctx, h, { snapshot: false })).length, 0);
  calendar[ahead(4)] = [{ summary: "Website review", start: null, allDay: true }];  // a word of the folder
  assert.equal((await check.run(ctx, h, { snapshot: false })).length, 0);

  for (const ball of [`them — send the deck before ${dm(4)} for the summit.`, `them — pick a day for the session (${dm(4)} or ${dm(5)}).`, `them — the workshop moved from ${dm(4)} to next year.`, `them — workshop on ${dm(30)}.`, `me — send the proposal by ${dm(2)}.`]) {
    setup(status(ball));
    assert.deepEqual((await check.run(ctx, h, { snapshot: false })).map((x) => x.what), [], ball);
  }
});

test("lines outside the focus are read only with scope all", async () => {
  setup(status("me — send the proposal.", `## Notes\n\nTheir kickoff is ${dm(2)}.\n\n`));
  assert.equal((await check.run(ctx, h, { snapshot: false })).length, 0);
  assert.equal((await check.run(ctx, h, { snapshot: false, scope: "all" })).length, 1);
});

test("a card with an appointment title due on a day without that event is asked about", async () => {
  setup(status("me — send the proposal."));
  cards = [
    { id: "c1", title: "Workshop at Globex", due: ahead(5), url: "https://tasks.example/c1" },
    { id: "c2", title: "Send invoice", due: ahead(5) },
    { id: "c3", title: "Demo for Initech", due: ahead(6) },
  ];
  calendar[ahead(6)] = [{ summary: "Initech demo", allDay: true }];
  const f = await check.run(ctx, h, { snapshot: false });
  assert.deepEqual(f.map((x) => x.where), ["https://tasks.example/c1"]);
  assert.equal((await check.run(ctx, h, { snapshot: false, tasks: false })).length, 0);
});

test("snapshot: a removed or moved event that the file still names is a finding", async () => {
  setup(status(`them — workshop with Acme on ${dm(5)}.`));
  calendar[ahead(5)] = [{ summary: "Acme workshop", start: `${ahead(5)}T09:00:00.000Z`, uid: "w1" }];
  calendar[ahead(8)] = [{ summary: "Globex call", start: `${ahead(8)}T09:00:00.000Z`, uid: "g1" }];
  assert.equal((await check.run(ctx, h, {})).length, 0);
  const snap = JSON.parse(readFileSync(join(ctx.stateDir, "calendar-snapshot.json"), "utf8"));
  assert.deepEqual(snap.events.map((e) => e.uid).sort(), ["g1", "w1"]);

  // Moved: same uid, another day. The file still says the old day.
  calendar[ahead(5)] = [];
  calendar[ahead(9)] = [{ summary: "Acme workshop", start: `${ahead(9)}T09:00:00.000Z`, uid: "w1" }];
  let f = await check.run(ctx, h, {});
  const moved = f.find((x) => /moved in the calendar/.test(x.what));
  assert.ok(moved, JSON.stringify(f));
  assert.match(moved.what, new RegExp(`from ${dm(5)} to ${dm(9)}`));
  // The snapshot now has the new day: the same move is not news twice.
  f = await check.run(ctx, h, {});
  assert.equal(f.filter((x) => /moved in the calendar/.test(x.what)).length, 0);

  // Removed: gone from the calendar; nothing names the Globex day, so only Acme counts.
  setup(status(`them — workshop with Acme on ${dm(5)}.`));
  calendar[ahead(5)] = [{ summary: "Acme workshop", start: `${ahead(5)}T09:00:00.000Z`, uid: "w1" }];
  calendar[ahead(8)] = [{ summary: "Globex call", start: `${ahead(8)}T09:00:00.000Z`, uid: "g1" }];
  await check.run(ctx, h, {});
  calendar = {};
  f = await check.run(ctx, h, {});
  const gone = f.filter((x) => /gone from the calendar/.test(x.what));
  assert.equal(gone.length, 1);
  assert.equal(gone[0].where, `${lead}/STATUS.md`);
  assert.equal(gone[0].action.appendReply, true);
});

test("snapshot: off with snapshot false; no stateDir write", async () => {
  setup(status("me — send the proposal."));
  await check.run(ctx, h, { snapshot: false });
  assert.equal(existsSync(join(ctx.stateDir, "calendar-snapshot.json")), false);
});

test("ics: every occurrence carries the event's UID", () => {
  const ics = ["BEGIN:VCALENDAR", "BEGIN:VEVENT", "UID:abc-123@example", "DTSTART:20260112T090000", "DTEND:20260112T093000", "RRULE:FREQ=WEEKLY;BYDAY=MO", "SUMMARY:Standup", "BEGIN:VALARM", "UID:alarm-1", "END:VALARM", "END:VEVENT", "BEGIN:VEVENT", "DTSTART;VALUE=DATE:20260113", "SUMMARY:No uid", "END:VEVENT", "END:VCALENDAR"].join("\r\n");
  const all = parseEvents(unfold(ics));
  assert.equal(all[0].uid, "abc-123@example");
  assert.deepEqual(eventsOn(all, new Date(2026, 0, 19)).map((e) => e.uid), ["abc-123@example"]);
  assert.deepEqual(eventsOn(all, new Date(2026, 0, 13)).map((e) => e.uid), [null]);
});
