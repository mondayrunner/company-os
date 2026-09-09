import { test, before } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, writeFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadContext } from "../core/config.mjs";
import { openDb } from "../core/db.mjs";
import { makeHelpers } from "../core/checks.mjs";
import check from "../checks/mail-vs-accounts.mjs";

const fixture = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "company");
const lead = "accounts/leads/2026-01-15-acme-website";
const touched = new Date("2026-09-04T14:00:00Z");

let ctx, h, mails;

before(() => {
  const root = mkdtempSync(join(tmpdir(), "company-os-mail-check-"));
  cpSync(fixture, root, { recursive: true });
  // The folder knows Jane's address from the proposal that was mailed, and our own from the signature.
  writeFileSync(join(root, lead, "mail-2026-09-04-proposal.txt"), "To: jane@harper.example\nFrom: studio@acme.example\n\nHi Jane, the proposal.\n");
  for (const f of ["STATUS.md", "mail-2026-09-04-proposal.txt"]) utimesSync(join(root, lead, f), touched, touched);
  ctx = loadContext({ root });
  ctx.config.connectors = { imap: { from: "Acme Studio <studio@acme.example>" } };
  const db = openDb(ctx);
  h = makeHelpers(ctx, db, []);
  h.live = async (kind, q) => ({ items: mails[q.mailbox] ?? [] });
});

test("a reply newer than the folder is a finding, one per folder, naming the mail", async () => {
  mails = {
    INBOX: [
      { uid: 1, subject: "Re: Proposal", from: "Jane Harper", address: "jane@harper.example", to: "studio@acme.example", date: "2026-09-08T09:42:00Z" },
      { uid: 2, subject: "Newsletter", from: "Someone", address: "news@other.example", to: "studio@acme.example", date: "2026-09-08T10:00:00Z" },
    ],
    Sent: [{ uid: 3, subject: "Proposal", from: "Acme Studio", address: "studio@acme.example", to: "Jane <jane@harper.example>", date: "2026-09-04T16:04:00Z" }],
  };
  const out = await check.run(ctx, h, {});
  assert.equal(out.length, 1);
  assert.equal(out[0].where, `${lead}/STATUS.md`);
  assert.match(out[0].what, /2 mails newer than the folder \(last touched 2026-09-04\)/);
  assert.match(out[0].what, /from Jane Harper 2026-09-08 "Re: Proposal"/);
  assert.match(out[0].what, /to jane@harper.example 2026-09-04 "Proposal"/);
});

test("mail older than the folder, or from an unknown address, is quiet", async () => {
  mails = {
    INBOX: [
      { uid: 1, subject: "Old", from: "Jane Harper", address: "jane@harper.example", date: "2026-09-01T09:00:00Z" },
      { uid: 2, subject: "New but unknown", from: "Stranger", address: "x@stranger.example", date: "2026-09-08T09:00:00Z" },
    ],
    Sent: [],
  };
  assert.deepEqual(await check.run(ctx, h, {}), []);
});

test("the calendar's own notices are traffic, not contact", async () => {
  mails = { INBOX: [], Sent: [{ uid: 1, subject: "Invitation for an event starting on Thursday October 15th, 2026", from: "Acme Studio", address: "studio@acme.example", to: "jane@harper.example", date: "2026-09-08T09:00:00Z" }] };
  assert.deepEqual(await check.run(ctx, h, {}), []);
});

test("our own address never counts as a contact", async () => {
  mails = { INBOX: [{ uid: 1, subject: "Note to self", from: "Acme Studio", address: "studio@acme.example", date: "2026-09-08T09:00:00Z" }], Sent: [] };
  assert.deepEqual(await check.run(ctx, h, {}), []);
});
