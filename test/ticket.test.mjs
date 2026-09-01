import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadContext, DEFAULTS } from "../core/config.mjs";
import { openDb } from "../core/db.mjs";
import { runChecks } from "../core/checks.mjs";
import { briefText } from "../core/ticket.mjs";
import { wanted } from "../core/boards.mjs";
import { normalizeFullCard } from "../connectors/trello.mjs";

const fixture = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "company");

const card = (over = {}) => ({ id: "c1", title: "Map broken", url: "https://trello.com/c/abc", desc: "", due: null, labels: [], checklists: [], comments: [], attachments: [], ...over });

test("trello: a whole card, without Trello in the shape", () => {
  const c = normalizeFullCard({
    id: "c1", name: "Map broken", shortUrl: "u", desc: "the map", due: "2026-01-01T10:00:00Z", labels: [{ name: "bug" }],
    checklists: [{ name: "Steps", checkItems: [{ name: "reproduce", state: "complete" }, { name: "fix", state: "incomplete" }] }],
    actions: [{ type: "commentCard", date: "2026-01-03T09:00:00Z", memberCreator: { fullName: "Jane" }, data: { text: "still broken" } }, { type: "updateCard" }],
    attachments: [{ name: "shot.png", url: "https://trello.com/1/cards/c1/attachments/a1/download/shot.png", isUpload: true, fileName: "shot.png", bytes: 12 }],
  });
  assert.deepEqual([c.title, c.due, c.labels], ["Map broken", "2026-01-01", ["bug"]]);
  assert.deepEqual(c.checklists[0].items, [{ name: "reproduce", done: true }, { name: "fix", done: false }]);
  assert.deepEqual(c.comments, [{ date: "2026-01-03", who: "Jane", text: "still broken" }]);
  assert.equal(c.attachments[0].upload, true);
});

test("brief: the card is fenced and the work rules come first", () => {
  const { brief, hasText } = briefText(card({ desc: "the map does not load" }), { repo: "/tmp/site", who: "Acme" });
  assert.ok(hasText);
  assert.ok(brief.includes("Work in this repository: /tmp/site"));
  assert.ok(brief.includes("ticket for Acme"));
  assert.ok(brief.includes("branch `ticket/map-broken`"));
  assert.ok(brief.indexOf("## How to work") < brief.indexOf("----- CARD -----"));
  assert.ok(brief.includes("the map does not load"));
});

test("brief: without a repo there is no branch rule, and the card still arrives", () => {
  const { brief } = briefText(card({ desc: "hi" }));
  assert.ok(!brief.includes("branch"));
  assert.ok(brief.includes("1. When you are done"));
  assert.ok(brief.includes("----- END CARD -----"));
});

test("brief: a title and a file are a brief, and the file is named by its path", () => {
  const { brief, hasText } = briefText(card({ attachments: [{ name: "shot.png", url: "https://trello…", path: "/state/shot.png" }] }));
  assert.equal(hasText, false);
  assert.ok(brief.includes("This card has no description"));
  assert.ok(brief.includes("shot.png — on disk: /state/shot.png"));
});

test("brief: a card with text does not get the attachment rule", () => {
  const { brief } = briefText(card({ desc: "fix it", attachments: [{ name: "a.png", url: "u", path: "/p/a.png" }] }));
  assert.ok(!brief.includes("This card has no description"));
});

test("boards: the fixed ones from the config, or one client board from the template", () => {
  assert.deepEqual(wanted(DEFAULTS).map((b) => b.key), ["sales", "todo"]);
  const [c] = wanted(DEFAULTS, "Acme");
  assert.equal(c.title, "Acme");
  assert.ok(c.lists.length);
  assert.deepEqual(wanted({ boards: {} }, "Acme"), []);
});

test("unfiled-transcripts: old and unattached is a finding, linked or fresh is not", async () => {
  const root = mkdtempSync(join(tmpdir(), "company-os-ticket-"));
  cpSync(fixture, root, { recursive: true });
  const inbox = join(root, "transcripts", "_inbox");
  mkdirSync(inbox, { recursive: true });
  const today = new Date().toISOString().slice(0, 10);
  writeFileSync(join(inbox, "2026-01-02-aaaa.md"), "---\nsource: paraspeech\naccount_proposal: [accounts/leads/2026-01-15-acme-website]\naccount:\n---\n\nlong talk\n");
  writeFileSync(join(inbox, "2026-01-03-bbbb.md"), "---\nsource: paraspeech\naccount: accounts/customers/2026-02-01-globex-platform\n---\n\nfiled already\n");
  writeFileSync(join(inbox, `${today}-cccc.md`), "---\nsource: paraspeech\naccount:\n---\n\nrecorded today\n");

  const ctx = loadContext({ root });
  const db = openDb(ctx);
  const { findings } = await runChecks(ctx, db, { live: false, only: ["unfiled-transcripts"] });
  db.close();

  assert.equal(findings.length, 1);
  assert.equal(findings[0].where, "transcripts/_inbox/2026-01-02-aaaa.md");
  assert.ok(findings[0].what.includes("2026-01-15-acme-website"));
});
