import { test, before } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadContext } from "../core/config.mjs";
import { openDb } from "../core/db.mjs";
import { indexAll } from "../core/index.mjs";
import { search } from "../core/search.mjs";
import { account, accounts, canon, resolveAccount } from "../core/brief.mjs";

const fixture = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "company");
let root, ctx, db;

before(async () => {
  root = mkdtempSync(join(tmpdir(), "company-os-brief-"));
  cpSync(fixture, root, { recursive: true });
  // A raw transcript that repeats the word the canon also carries.
  mkdirSync(join(root, "transcripts", "_inbox"), { recursive: true });
  writeFileSync(join(root, "transcripts", "_inbox", "2026-01-21-acme-call.md"), "---\naccount: accounts/leads/2026-01-15-acme-website\n---\n# Call with Acme\n\nproposal proposal proposal — they liked the proposal and want the proposal by Friday.\n");
  ctx = loadContext({ root });
  db = openDb(ctx);
  await indexAll(ctx, db);
});

test("resolveAccount: full path, folder name, and a word of the name", () => {
  assert.equal(resolveAccount(ctx, db, "accounts/leads/2026-01-15-acme-website").folder, "accounts/leads/2026-01-15-acme-website");
  assert.equal(resolveAccount(ctx, db, "2026-01-15-acme-website").folder, "accounts/leads/2026-01-15-acme-website");
  assert.equal(resolveAccount(ctx, db, "acme").folder, "accounts/leads/2026-01-15-acme-website");
  assert.equal(resolveAccount(ctx, db, "Acme Website").folder, "accounts/leads/2026-01-15-acme-website");
  const miss = resolveAccount(ctx, db, "nobody");
  assert.equal(miss.folder, null);
});

test("account: status head, ball, pipeline row and log, last contact", async () => {
  const a = await account(ctx, db, "acme");
  assert.equal(a.account, "accounts/leads/2026-01-15-acme-website");
  assert.equal(a.side, "leads");
  assert.equal(a.ball, "Me — send the proposal.");
  assert.match(a.status.text, /^# STATUS — Acme website/);
  assert.equal(a.status.truncated, false);
  assert.equal(a.pipeline.lead.stage, "Proposal");
  assert.equal(a.pipeline.lead.ball, "Them");
  assert.ok(a.pipeline.log[0].includes("Acme: proposal sent"));
  assert.equal(a.transcripts, 1);
  assert.equal(a.lastContact.path, "transcripts/_inbox/2026-01-21-acme-call.md");
  assert.ok(a.files >= 1);
});

test("account: unknown name answers with candidates, not a crash", async () => {
  const a = await account(ctx, db, "nobody");
  assert.match(a.error, /no account matching/);
  assert.ok(Array.isArray(a.candidates));
});

test("account: head keeps the first section whole and cuts the next at a paragraph", async () => {
  // A status file with a short intro and a long newest section.
  const folder = join(root, "accounts", "customers", "2026-02-01-globex-platform");
  const long = Array.from({ length: 12 }, (_, i) => `Paragraph ${i + 1} of the newest update, long enough to matter.`).join("\n\n");
  writeFileSync(join(folder, "STATUS.md"), `# STATUS — Globex platform\n\n**Ball with:** Them.\n\n## Update 2026-02-10\n\n${long}\n\n## Older\n\nOld news.\n`);
  await indexAll(ctx, db, { only: ["markdown"] });
  const a = await account(ctx, db, "globex", { maxChars: 400 });
  assert.match(a.status.text, /^# STATUS — Globex platform/);
  assert.match(a.status.text, /## Update 2026-02-10/, "the newest section is not skipped");
  assert.match(a.status.text, /…$/, "and is cut, not dropped");
  assert.equal(a.status.truncated, true);
  assert.ok(a.status.text.length < 700);
  assert.deepEqual(a.status.headings.map((h) => h.heading), ["Update 2026-02-10", "Older"]);
  assert.equal((await account(ctx, db, "globex", { full: true })).status.truncated, false);
});

test("accounts: one line per open and won account, newest first", async () => {
  const rows = await accounts(ctx, db);
  assert.equal(rows.length, 2);
  const acme = rows.find((r) => r.account.includes("acme"));
  assert.equal(acme.ball, "Me — send the proposal.");
  assert.equal(acme.stage, "Proposal");
  assert.equal(acme.next, "Wait for reply");
  assert.equal((await accounts(ctx, db, { side: "customers" })).length, 1);
});

test("canon: by key, one section, and the list of keys", async () => {
  const list = await canon(ctx, null);
  assert.deepEqual(list.keys.map((k) => k.key), ["pricing"]);
  const c = await canon(ctx, "pricing");
  assert.equal(c.path, "knowledge/pricing.md");
  assert.match(c.text, /^# Pricing/);
  assert.match((await canon(ctx, "nope")).error, /no canon entry/);
});

test("search: canon before raw, raw on request, thin payload", () => {
  const hits = search(db, "proposal", 8, ctx);
  assert.ok(hits.length > 0);
  assert.equal(hits[0].raw, undefined, "top hit is canon");
  assert.ok(!("text" in hits[0]), "no chunk text in the payload");
  const withRaw = search(db, "proposal", 8, ctx, { raw: true });
  assert.ok(withRaw.some((h) => h.path.startsWith("transcripts/") && h.raw === true));
  // Default search still fills up with raw when canon is short, flagged as such.
  const filled = search(db, "friday", 8, ctx);
  assert.ok(filled.every((h) => !h.path.startsWith("transcripts/") || h.raw === true));
});
