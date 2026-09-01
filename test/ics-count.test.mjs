import { test } from "node:test";
import assert from "node:assert/strict";
import { parseEvents, occursOn } from "../connectors/ics-calendar.mjs";

const lines = [
  "BEGIN:VEVENT",
  "DTSTART;TZID=Europe/Amsterdam:20250114T083000",
  "DTEND;TZID=Europe/Amsterdam:20250114T093000",
  "RRULE:FREQ=WEEKLY;COUNT=6",
  "SUMMARY:StartOff bootcamp (online)",
  "END:VEVENT",
];

test("a weekly series with COUNT=6 ends after six Tuesdays", () => {
  const [ev] = parseEvents(lines);
  assert.ok(occursOn(ev, new Date(2025, 0, 14)), "first occurrence");
  assert.ok(occursOn(ev, new Date(2025, 1, 18)), "sixth occurrence (18 Feb 2025)");
  assert.ok(!occursOn(ev, new Date(2025, 1, 25)), "seventh Tuesday is past the count");
  assert.ok(!occursOn(ev, new Date(2026, 8, 1)), "and it stays dead a year later");
});

test("without COUNT a weekly series still recurs", () => {
  const [ev] = parseEvents(lines.map((l) => l.replace(";COUNT=6", "")));
  assert.ok(occursOn(ev, new Date(2026, 8, 1)));
});
