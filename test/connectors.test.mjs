import { test } from "node:test";
import assert from "node:assert/strict";
import { monthlyOf, normalizeSubscription } from "../connectors/stripe.mjs";
import { normalizeCard } from "../connectors/trello.mjs";
import { parseTasks } from "../connectors/tasks-markdown.mjs";
import { parseEvents, unfold, eventsOn } from "../connectors/ics-calendar.mjs";
import { parseHeaders, decodeWords } from "../connectors/imap.mjs";

test("stripe: monthly amount across intervals", () => {
  const price = (unit_amount, interval, interval_count = 1) => ({ price: { unit_amount, recurring: { interval, interval_count } }, quantity: 1 });
  assert.equal(monthlyOf({ items: { data: [price(55000, "month")] } }), 550);
  assert.equal(monthlyOf({ items: { data: [price(450000, "month", 3)] } }), 1500);
  assert.equal(monthlyOf({ items: { data: [price(120000, "year")] } }), 100);
  const s = normalizeSubscription({ id: "sub_1", status: "active", start_date: 1780000000, currency: "eur", customer: { name: "Northwind", email: "k@x.nl" }, items: { data: [price(25000, "month")] } });
  assert.deepEqual([s.customer, s.monthly, s.currency, s.interval], ["Northwind", 250, "EUR", "month"]);
});

test("trello: card shape and overdue", () => {
  const c = normalizeCard({ id: "c1", name: "Bel Brent", due: "2026-01-01T10:00:00Z", dueComplete: false, url: "u", labels: [{ name: "sales" }] }, "Vandaag", Date.parse("2026-02-01"));
  assert.deepEqual([c.title, c.list, c.due, c.overdue, c.labels], ["Bel Brent", "Vandaag", "2026-01-01", true, ["sales"]]);
});

test("tasks-markdown: parses open tasks with due and account", () => {
  const items = parseTasks("## Today\n- [ ] Send proposal (due: 2026-01-01) @accounts/leads/acme\n- [x] done thing\n## Later\n- [ ] Call Brent", Date.parse("2026-02-01"));
  assert.equal(items.length, 2);
  assert.deepEqual([items[0].title, items[0].list, items[0].due, items[0].overdue, items[0].account], ["Send proposal", "Today", "2026-01-01", true, "accounts/leads/acme"]);
  assert.equal(items[1].list, "Later");
});

test("ics: weekly recurrence with exdate, all-day, unfolding", () => {
  const ics = ["BEGIN:VCALENDAR", "BEGIN:VEVENT", "DTSTART:20260105T090000", "DTEND:20260105T093000", "RRULE:FREQ=WEEKLY;BYDAY=MO", "EXDATE:20260119T090000", "SUMMARY:Weekly", "  standup", "END:VEVENT",
    "BEGIN:VEVENT", "DTSTART;VALUE=DATE:20260112", "DTEND;VALUE=DATE:20260113", "SUMMARY:Holiday", "END:VEVENT", "END:VCALENDAR"].join("\r\n");
  const all = parseEvents(unfold(ics));
  assert.equal(all[0].summary, "Weekly standup");
  assert.equal(eventsOn(all, new Date(2026, 0, 12)).length, 2);          // Monday: standup + holiday
  assert.equal(eventsOn(all, new Date(2026, 0, 19)).length, 0);          // exdate
  assert.equal(eventsOn(all, new Date(2026, 0, 13)).length, 0);          // Tuesday
});

test("imap: header parsing and encoded words", () => {
  const h = parseHeaders("Subject: =?utf-8?B?SGVsbG8gSmFuZSDDqcOp?=\r\nFrom: \"Jane Harper\" <jane@harper.example>\r\nDate: Mon, 3 Aug 2026 10:00:00 +0200\r\n");
  assert.equal(h.subject, "Hello Jane éé");
  assert.equal(decodeWords("=?ISO-8859-1?Q?caf=E9?="), "café");
});
