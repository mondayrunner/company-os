// The three "live source vs. folder" checks that share one idea: something
// happened (a recording, an appointment, a card) and the folder does not know.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, writeFileSync, utimesSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadContext } from "../core/config.mjs";
import { openDb } from "../core/db.mjs";
import { indexAll } from "../core/index.mjs";
import { makeHelpers } from "../core/checks.mjs";
import transcripts from "../checks/transcripts-vs-accounts.mjs";
import calendar from "../checks/calendar-vs-accounts.mjs";
import board from "../checks/board-vs-pipeline.mjs";

const fixture = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "company");
const lead = "accounts/leads/2026-01-15-acme-website";
const customer = "accounts/customers/2026-02-01-globex-platform";
const written = new Date("2026-09-04T14:00:00Z");

let ctx, db, h, live;

before(async () => {
  const root = mkdtempSync(join(tmpdir(), "company-os-vs-accounts-"));
  cpSync(fixture, root, { recursive: true });
  // A recording attached to the lead, from after the status file was last written; one older, for the customer.
  mkdirSync(join(root, "transcripts"), { recursive: true });
  writeFileSync(join(root, "transcripts", "2026-09-06-abc.md"), `---\naccount: ${lead}\ndate: 2026-09-06T10:00:00Z\nduration_s: 1500\napp: Zoom\n---\n# Call 2026-09-06 10:00 · Hi Jane, about the site\n`);
  // A one-minute dictation the same day: not a conversation, never a finding.
  writeFileSync(join(root, "transcripts", "2026-09-06-def.md"), `---\naccount: ${lead}\ndate: 2026-09-06T11:00:00Z\nduration_s: 60\n---\n# Note\n`);
  writeFileSync(join(root, customer, "transcript-2026-08-01-renewal.md"), "# Renewal call\n");
  utimesSync(join(root, lead, "STATUS.md"), written, written);
  utimesSync(join(root, customer, "STATUS.md"), new Date("2026-08-05T10:00:00Z"), new Date("2026-08-05T10:00:00Z"));
  ctx = loadContext({ root });
  ctx.config.boards = { sales: { title: "Sales" } };
  db = openDb(ctx);
  await indexAll(ctx, db);
  h = makeHelpers(ctx, db, []);
  h.live = async (kind, q) => live(kind, q);
});

test("transcripts: a recording after the status file is a finding; one written up already is not", async () => {
  const out = await transcripts.run(ctx, h, {});
  assert.equal(out.length, 1);
  assert.equal(out[0].where, `${lead}/STATUS.md`);
  assert.match(out[0].what, /`transcripts\/2026-09-06-abc\.md` \(2026-09-06, 25 min, Zoom\) "Hi Jane, about the site"/);
});

test("calendar: a past appointment naming the lead, after the folder's newest file, is a finding", async () => {
  live = async (kind, q) => {
    assert.equal(kind, "calendar");
    assert.equal(q.what, "range");
    return { days: {
      "2026-09-05": [{ start: "2026-09-05T09:00:00Z", end: "2026-09-05T10:00:00Z", summary: "Kickoff Acme website", allDay: false }],
      "2026-09-06": [{ start: "2026-09-06T12:00:00Z", end: "2026-09-06T13:00:00Z", summary: "Lunch with a friend", allDay: false }],
      "2099-01-01": [{ start: "2099-01-01T09:00:00Z", end: "2099-01-01T10:00:00Z", summary: "Acme review", allDay: false }],
    } };
  };
  const out = await calendar.run(ctx, h, {});
  assert.equal(out.length, 1);
  assert.equal(out[0].where, `${lead}/STATUS.md`);
  assert.match(out[0].what, /"Kickoff Acme website" on 2026-09-05/);
});

test("calendar: 'lead' in a title does not hit a folder that merely contains the word", async () => {
  live = async () => ({ days: { "2026-09-05": [{ start: "2026-09-05T09:00:00Z", end: "2026-09-05T10:00:00Z", summary: "Call a lead", allDay: false }] } });
  assert.deepEqual(await calendar.run(ctx, h, {}), []);
});

test("board: an open lead without a card, and a card without a lead, both in one run", async () => {
  live = async (kind, q) => {
    assert.equal(kind, "tasks");
    if (q.what === "boards") return { items: [{ id: "b1", title: "Sales" }, { id: "b2", title: "Todo" }] };
    assert.equal(q.board, "b1");
    return { items: [
      { id: "c1", title: "Initech — discovery", list: "LEADS" },
      { id: "c2", title: "Old Umbrella deal", list: "ON HOLD" },
      { id: "c3", title: "Globex renewed", list: "WON" },
    ], lists: ["LEADS", "ON HOLD", "RUNNING", "WON"] };
  };
  const out = await board.run(ctx, h, {});
  const whats = out.map((f) => `${f.where} :: ${f.what}`);
  assert.equal(out.length, 2, whats.join("\n"));
  // Without sync the lead with a row is named in one finding on the pipeline file, not one item per lead.
  assert.ok(whats.some((w) => w.startsWith("pipeline/pipeline.md") && w.includes("no card") && w.includes("Acme")));
  const orphan = out.find((f) => f.what.includes('"Old Umbrella deal"'));
  assert.ok(orphan && orphan.what.includes("no open lead") && orphan.kind === "question" && orphan.action?.type === "agent");
});

test("board: an open folder with neither a row nor a card is one grouped question", async () => {
  const stray = join(ctx.root, "accounts/leads/2026-03-01-stray-lead");
  mkdirSync(stray, { recursive: true });
  writeFileSync(join(stray, "STATUS.md"), "# Stray lead\n\n**Ball with:** them\n");
  live = async (kind, q) => (q.what === "boards" ? { items: [{ id: "b1", title: "Sales" }] } : { items: [{ id: "c1", title: "Initech — discovery", list: "LEADS" }, { id: "c4", title: "Acme website", list: "RUNNING" }] });
  // Fresh helpers: the folder list is cached for the length of one run.
  const h2 = makeHelpers(ctx, db, []);
  h2.live = async (kind, q) => live(kind, q);
  const out = await board.run(ctx, h2, {});
  const group = out.find((f) => f.what.includes("neither a pipeline row nor a card"));
  assert.ok(group, out.map((f) => f.what).join("\n"));
  assert.match(group.what, /2026-03-01-stray-lead/);
  assert.equal(group.kind, "question");
  assert.match(group.action.instruction, /accounts\/leads\/2026-03-01-stray-lead/);
  assert.equal(out.filter((f) => f.what.includes("neither")).length, 1);
});

test("board: a missing board is one finding, not a crash", async () => {
  live = async () => ({ items: [{ id: "b2", title: "Todo" }] });
  const out = await board.run(ctx, h, {});
  assert.equal(out.length, 1);
  assert.match(out[0].what, /no board named "Sales"/);
});
