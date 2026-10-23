import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, writeFileSync, utimesSync, readFileSync, rmSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadContext } from "../core/config.mjs";
import { openDb } from "../core/db.mjs";
import { makeHelpers, runChecks, autoApprovable } from "../core/checks.mjs";
import { listItems } from "../core/inbox.mjs";
import { findBallLine } from "../core/markdown.mjs";
import check, { normSubject, nextHolder, mailFileMeta, leftoverDrafts, matchDraftFiles, isCalendarMail } from "../checks/drafts-vs-sent.mjs";
import { draftsOnly, trashCommands, sameDraft } from "../connectors/imap.mjs";

const fixture = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "company");
const lead = "accounts/leads/2026-01-15-acme-website";
const drafted = new Date("2026-10-21T14:23:00Z");
const BALL = "**Ball with:** me — send the intake mail (in Drafts), then with Jane and Joe (do the intake).";

let root, ctx, h, db, mail;

function setup({ status = `# STATUS — Acme website\n\n${BALL}\n\n## Log\n\n- 2026-10-21 — intake drafted.\n`, mailFile = "---\nstatus: draft in Drafts, not sent yet\nto: info@harper.example\ncc: jane@harper.example\nsubject: \"Re: Build day in November\"\n---\n\nHi Jane and Joe,\n" } = {}) {
  root = mkdtempSync(join(tmpdir(), "company-os-dvs-"));
  cpSync(fixture, root, { recursive: true });
  rmSync(join(root, ".company-os"), { recursive: true, force: true });
  writeFileSync(join(root, lead, "STATUS.md"), status);
  if (mailFile !== null) writeFileSync(join(root, lead, "mail-2026-10-21-intake.md"), mailFile);
  for (const f of readdirSync(join(root, lead))) utimesSync(join(root, lead, f), drafted, drafted);
  ctx = loadContext({ root });
  ctx.config.connectors = { imap: { from: "Acme Studio <studio@acme.example>" } };
  ctx.config.timeZone = "Europe/Amsterdam";
  db = openDb(ctx);
  h = makeHelpers(ctx, db, []);
  h.live = async (kind, q) => { if (mail instanceof Error) throw mail; return { items: mail[q.mailbox] ?? [] }; };
}
afterEach(() => { try { db?.close(); } catch {} if (root) rmSync(root, { recursive: true, force: true }); db = null; root = null; });

const SENT = { uid: 9, subject: "Re: Build day in November", from: "Acme Studio", address: "studio@acme.example", to: "<info@harper.example>", cc: null, date: "2026-10-21T14:28:54Z" };

test("helpers: subjects, the next holder, a mail file's own header", () => {
  assert.equal(normSubject("RE: Re: Informatie en kennismaking"), normSubject("Re: informatie  en kennismaking"));
  assert.equal(nextHolder("me — send it (in Drafts), then with Jane and Joe (do the intake)."), "Jane and Joe (do the intake)");
  assert.equal(nextHolder("Sam (staat in Drafts), daarna bij Piet/Klaas (dag kiezen)"), "Piet/Klaas (dag kiezen)");
  assert.equal(nextHolder("Sam, versturen"), null);
  assert.deepEqual(mailFileMeta("---\nstatus: concept\nonderwerp: \"Re: X\"\n---\nbody").subject, "Re: X");
});

test("a sent mail after the draft: one proposal that rewrites only the ball line, marked auto", async () => {
  setup();
  mail = { Sent: [SENT], Drafts: [] };
  const out = await check.run(ctx, h, { leftovers: false });
  const ball = out.find((f) => f.auto === "ball-line-sent");
  assert.ok(ball, "ball finding");
  assert.equal(ball.where, `${lead}/STATUS.md`);
  assert.match(ball.what, /sent 21-10 16:28: "Re: Build day in November" to info@harper.example/);
  assert.equal(ball.action.replace[0].from, BALL);
  assert.equal(ball.action.replace[0].to, `**Ball with:** Jane and Joe (do the intake) — sent 21-10 16:28: "Re: Build day in November" to info@harper.example (auto, drafts-vs-sent)`);
  assert.match(ball.action.log.line, /^- \d{4}-\d\d-\d\d — Sent 21-10 16:28/);
  // the concept file gets its own proposal, never auto
  const file = out.find((f) => f.where.endsWith("mail-2026-10-21-intake.md"));
  assert.equal(file.auto, undefined);
  assert.deepEqual(file.action, { type: "set-frontmatter", file: `${lead}/mail-2026-10-21-intake.md`, fields: { status: "sent 21-10 16:28" } });
});

test("the next holder can come from a to-do line when the ball line names none", async () => {
  setup({ status: "# S\n\n**Ball with:** me, send the intake mail (in Drafts).\n\n## Next\n\nBall with me: send the draft. Then with Jane and Joe (intake).\n\n## Log\n\n- 2026-10-01 — me: send it, then with Someone Old.\n" });
  mail = { Sent: [SENT], Drafts: [] };
  const ball = (await check.run(ctx, h, { leftovers: false })).find((f) => f.auto);
  assert.match(ball.action.replace[0].to, /^\*\*Ball with:\*\* Jane and Joe \(intake\) — sent/);
});

test("info@ and Cc-only recipients count for sent mail", async () => {
  setup();
  mail = { Sent: [{ ...SENT, to: "someone@else.example", cc: "Jane <jane@harper.example>" }], Drafts: [] };
  assert.ok((await check.run(ctx, h, { leftovers: false })).some((f) => f.auto === "ball-line-sent"));
});

test("quiet: mail sent before the draft, another subject than the draft names, or the ball not with you", async () => {
  setup();
  mail = { Sent: [{ ...SENT, date: "2026-10-21T14:00:00Z" }], Drafts: [] };
  assert.deepEqual(await check.run(ctx, h, { leftovers: false }), []);
  mail = { Sent: [{ ...SENT, subject: "Invoice October" }], Drafts: [] };
  assert.deepEqual(await check.run(ctx, h, { leftovers: false }), []);
  rmSync(root, { recursive: true, force: true }); db.close();
  setup({ status: "# S\n\n**Ball with:** Jane — doing the intake.\n", mailFile: null });
  mail = { Sent: [SENT], Drafts: [] };
  assert.deepEqual(await check.run(ctx, h, { leftovers: false }), []);
});

test("leftover drafts are listed once, never acted on; a draft newer than the sent mail is not a leftover", async () => {
  setup({ mailFile: null, status: "# S\n\n**Ball with:** Jane.\n" });
  mail = {
    Sent: [SENT],
    Drafts: [
      { uid: 1, subject: "RE: build day in november", to: "<info@harper.example>", date: "2026-10-21T14:20:00Z" },
      { uid: 2, subject: "Re: Build day in November", to: "<info@harper.example>", date: "2026-10-22T07:00:00Z" },
      { uid: 3, subject: "(no subject)", to: "<info@harper.example>", date: "2026-10-21T13:50:00Z" },
    ],
  };
  const out = await check.run(ctx, h, {});
  assert.equal(out.length, 1);
  assert.equal(out[0].kind, "question");
  assert.equal(out[0].action, undefined);
  assert.match(out[0].what, /^1 draft in Drafts already sent: "RE: build day in november" to info@harper.example \(draft 21-10 16:20, sent 21-10 16:28\)$/);
});

test("mail server down: the check skips instead of crashing", async () => {
  setup();
  mail = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:1143"), { code: "ECONNREFUSED" });
  await assert.rejects(check.run(ctx, h, {}), (e) => e.skip === true);
  mail = Object.assign(new Error("IMAP LOGIN: A1 NO bad password"), {});
  await assert.rejects(check.run(ctx, h, {}), (e) => !e.skip);
});

test("autoApprovable: both keys needed, and only the narrow shape", () => {
  setup();
  const ok = { auto: "ball-line-sent", action: { type: "edit-markdown", inward: true, file: `${lead}/STATUS.md`, replace: [{ from: BALL, to: "**Ball with:** Jane — sent" }], log: { under: "Log", line: "- x" } } };
  assert.equal(autoApprovable(ctx, ok), false, "not listed in config");
  ctx.config.inbox = { ...(ctx.config.inbox ?? {}), autoApprove: ["ball-line-sent"] };
  assert.equal(autoApprovable(ctx, ok), true);
  const bad = (patch) => autoApprovable(ctx, { ...ok, action: { ...ok.action, ...patch } });
  assert.equal(bad({ type: "agent" }), false);
  assert.equal(bad({ inward: false }), false);
  assert.equal(bad({ file: `${lead}/notes.md` }), false);
  assert.equal(bad({ append: "more" }), false);
  assert.equal(bad({ replace: [{ from: "# STATUS — Acme website", to: "# hacked" }] }), false);
  assert.equal(bad({ replace: [{ from: BALL, to: "**Ball with:** x\n## injected" }] }), false);
  assert.equal(bad({ replace: [ok.action.replace[0], ok.action.replace[0]] }), false);
  assert.equal(autoApprovable(ctx, { ...ok, auto: "something-else" }), false);
});

test("findBallLine reads both spellings when ballLines lists them", () => {
  const acc = { ballLine: "**Bal bij:**", ballLines: ["**Bal:**"] };
  assert.equal(findBallLine("x\n**Bal:** bij Sam, versturen\n", acc).holder, "Sam, versturen");
  assert.equal(findBallLine("**Bal bij:** Sam (recap)\n", acc).holder, "Sam (recap)");
  assert.equal(findBallLine("Bal bij Sam: draft versturen\n", acc), null);
});

/** A mail connector in the root, so runChecks runs end to end without a server. */
function fakeConnector(state) {
  mkdirSync(join(root, "connectors"), { recursive: true });
  writeFileSync(join(root, "mail-fixture.json"), JSON.stringify(state));
  writeFileSync(join(root, "connectors", "fakemail.mjs"), `import { readFileSync } from "node:fs";
export default { name: "fakemail", kind: "mail", volatile: true, async live(q, ctx) {
  const s = JSON.parse(readFileSync(ctx.path("mail-fixture.json"), "utf8"));
  if (s.down) throw Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:1143"), { code: "ECONNREFUSED" });
  return { items: s[q.mailbox] ?? [] };
} };`);
  ctx.config.connectors = { fakemail: {} };
}

test("end to end: listed in inbox.autoApprove → the ball line is rewritten, logged, the item done; quiet writes no report", async () => {
  setup();
  fakeConnector({ Sent: [SENT], Drafts: [] });
  ctx.config.inbox = { ...(ctx.config.inbox ?? {}), autoApprove: ["ball-line-sent"] };
  const r = await runChecks(ctx, db, { only: ["drafts-vs-sent"], job: "sent-watch", quiet: true });
  assert.equal(r.report, null);
  assert.equal(r.inbox.auto, 1);
  const status = readFileSync(join(root, lead, "STATUS.md"), "utf8");
  assert.match(status, /^\*\*Ball with:\*\* Jane and Joe \(do the intake\) — sent 21-10 16:28/m);
  assert.ok(!status.includes(BALL), "the old ball line is gone");
  assert.match(status, /## Log\n\n- \d{4}-\d\d-\d\d — Sent 21-10 16:28: "Re: Build day in November"/);
  const items = await listItems(ctx);
  assert.equal(items.find((i) => i.where === `${lead}/STATUS.md`).status, "done");
  // the concept file proposal is not auto: it waits
  assert.equal(items.find((i) => i.where?.endsWith("mail-2026-10-21-intake.md")).status, "open");
  // no run summary item, no report file
  assert.ok(!items.some((i) => i.kind === "report"));
  assert.ok(!existsSync(join(ctx.outputs, `check-${new Date().toISOString().slice(0, 10)}.md`)));
  // next run: the ball is no longer with you, nothing new
  const again = await runChecks(ctx, db, { only: ["drafts-vs-sent"], job: "sent-watch", quiet: true });
  assert.equal(again.inbox.auto, 0);
});

test("end to end: not listed → the proposal waits and the status file is untouched", async () => {
  setup();
  fakeConnector({ Sent: [SENT], Drafts: [] });
  const before = readFileSync(join(root, lead, "STATUS.md"), "utf8");
  const r = await runChecks(ctx, db, { only: ["drafts-vs-sent"], job: "sent-watch", quiet: true });
  assert.equal(r.inbox.auto, 0);
  assert.equal(readFileSync(join(root, lead, "STATUS.md"), "utf8"), before);
  assert.equal((await listItems(ctx)).find((i) => i.where === `${lead}/STATUS.md`).status, "open");
});

test("end to end: mail server down → skipped, status 'skipped', open items stay open", async () => {
  setup();
  fakeConnector({ Sent: [SENT], Drafts: [] });
  await runChecks(ctx, db, { only: ["drafts-vs-sent"], job: "sent-watch", quiet: true });
  const open = (await listItems(ctx, { status: "open" })).length;
  assert.ok(open >= 1);
  writeFileSync(join(root, "mail-fixture.json"), JSON.stringify({ down: true }));
  const r = await runChecks(ctx, db, { only: ["drafts-vs-sent"], job: "sent-watch", quiet: true });
  assert.equal(r.findings.length, 0);
  assert.equal(r.skipped[0].check, "drafts-vs-sent");
  assert.equal((await listItems(ctx, { status: "open" })).length, open);
  const st = JSON.parse(readFileSync(join(ctx.stateDir, "sent-watch-status.json"), "utf8"));
  assert.equal(st.result, "skipped");
});

// ---- leftover drafts: the matching rule and the cleanup ----

const NOW = Date.parse("2026-10-22T12:00:00Z");
const S = (uid, subject, to, date) => ({ uid, subject, to, cc: null, date });

test("leftoverDrafts: same recipient and subject, sent later → leftover; a draft newer than the sent mail is kept", () => {
  const sent = [S(50, "Re: Build day in November", "Jane <info@harper.example>", "2026-10-21T14:28:54Z")];
  const drafts = [
    S(1, "RE:  build DAY in november ", "<info@harper.example>", "2026-10-21T14:20:00Z"), // older version
    S(2, "Fwd: Build day in November", "info@harper.example", "2026-10-20T09:00:00Z"),    // prefixes stripped
    S(3, "Re: Build day in November", "<info@harper.example>", "2026-10-22T07:07:00Z"),  // newer than the sent mail
  ];
  assert.deepEqual(leftoverDrafts(drafts, sent, { now: NOW }).map((l) => l.draft.uid), [2, 1]);
});

test("leftoverDrafts: another subject, another recipient, Cc only, or one of two recipients → kept", () => {
  const sent = [S(50, "Re: Build day in November", "<info@harper.example>", "2026-10-21T14:28:54Z")];
  sent[0].cc = "joe@harper.example";
  const drafts = [
    S(1, "Re: Build day in December", "<info@harper.example>", "2026-10-21T14:20:00Z"),
    S(2, "Re: Build day in November", "<other@harper.example>", "2026-10-21T14:20:00Z"),
    S(3, "Re: Build day in November", "<joe@harper.example>", "2026-10-21T14:20:00Z"),
    S(4, "Re: Build day in November", "info@harper.example, joe@harper.example", "2026-10-21T14:20:00Z"),
    S(5, "Re: Build day in November", null, "2026-10-21T14:20:00Z"),
    S(6, "Re: Build day in November", "<info@harper.example>", null),
  ];
  assert.deepEqual(leftoverDrafts(drafts, sent, { now: NOW }), []);
});

test("leftoverDrafts: untitled drafts only with the same recipient and a sent mail within the window", () => {
  const sent = [S(50, "Quote", "<info@harper.example>", "2026-10-21T14:28:00Z")];
  const drafts = [
    S(1, "(no subject)", "<info@harper.example>", "2026-10-21T14:05:00Z"),  // 23 min before → leftover
    S(2, "", "<info@harper.example>", "2026-10-21T13:50:00Z"),              // 38 min before → kept
    S(3, "(no subject)", "<other@harper.example>", "2026-10-21T14:20:00Z"), // other recipient → kept
    S(4, "(no subject)", "<info@harper.example>", "2026-10-21T14:30:00Z"),  // after the sent mail → kept
  ];
  assert.deepEqual(leftoverDrafts(drafts, sent, { now: NOW }).map((l) => l.draft.uid), [1]);
  assert.deepEqual(leftoverDrafts(drafts, sent, { now: NOW, untitledWindowMinutes: 45 }).map((l) => l.draft.uid), [2, 1]);
  // a titled sent mail never pairs with a titled draft of another subject, an untitled sent mail never with a titled draft
  assert.deepEqual(leftoverDrafts([S(5, "Quote v2", "<info@harper.example>", "2026-10-21T14:20:00Z")], sent, { now: NOW }), []);
  assert.deepEqual(leftoverDrafts([S(6, "Quote", "<info@harper.example>", "2026-10-21T14:20:00Z")], [S(51, "", "<info@harper.example>", "2026-10-21T14:28:00Z")], { now: NOW }), []);
});

test("leftoverDrafts: a sent mail younger than settleMinutes leaves its drafts alone this round", () => {
  const sent = [S(50, "Quote", "<info@harper.example>", "2026-10-22T11:55:00Z")];
  const drafts = [S(1, "Quote", "<info@harper.example>", "2026-10-22T11:50:00Z")];
  assert.deepEqual(leftoverDrafts(drafts, sent, { now: NOW }), []);
  assert.equal(leftoverDrafts(drafts, sent, { now: NOW, settleMinutes: 2 }).length, 1);
});

test("mailbox guard: trashDraft only ever touches the configured Drafts mailbox", () => {
  assert.deepEqual(draftsOnly(undefined, {}), { drafts: "Drafts", trash: "Trash" });
  assert.deepEqual(draftsOnly("Drafts", {}), { drafts: "Drafts", trash: "Trash" });
  for (const box of ["INBOX", "Sent", "Trash", "Archive", "drafts", "Drafts/old", "", null]) assert.throws(() => draftsOnly(box, {}), /refused/, String(box));
  assert.deepEqual(draftsOnly("Concepten", { drafts: "Concepten", trash: "Prullenbak" }), { drafts: "Concepten", trash: "Prullenbak" });
  assert.throws(() => draftsOnly("Drafts", { drafts: "Concepten" }), /refused/);
  // a misconfigured connector cannot point the guard at a real mailbox
  for (const drafts of ["INBOX", "Sent", "Trash", "All Mail"]) assert.throws(() => draftsOnly(drafts, { drafts }), /refused/, drafts);
  assert.throws(() => draftsOnly("Bin", { drafts: "Bin", trash: "Bin" }), /refused/);
});

test("trash commands: UID MOVE when offered, else COPY + flag + UID EXPUNGE of that one UID, else refuse", () => {
  assert.deepEqual(trashCommands("IMAP4rev1 MOVE UIDPLUS IDLE", 7, "Trash"), { via: "move", commands: ['UID MOVE 7 "Trash"'] });
  assert.deepEqual(trashCommands("IMAP4rev1 UIDPLUS", 7, "Trash").commands, ['UID COPY 7 "Trash"', "UID STORE 7 +FLAGS.SILENT (\\Deleted)", "UID EXPUNGE 7"]);
  assert.throws(() => trashCommands("IMAP4rev1", 7, "Trash"), /refused/);
  for (const uid of [0, -1, 1.5, NaN, "7"]) assert.throws(() => trashCommands("MOVE", uid, "Trash"), /uid/);
  assert.ok(sameDraft({ subject: "Quote", to: "<a@b.example>", date: "2026-10-21T14:00:00.000Z" }, { subject: "quote", to: "<a@b.example>", date: "2026-10-21T14:00:00.000Z" }));
  assert.ok(!sameDraft({ subject: "Quote", to: "<a@b.example>", date: "2026-10-21T14:05:00.000Z" }, { subject: "Quote", to: "<a@b.example>", date: "2026-10-21T14:00:00.000Z" }));
  assert.ok(!sameDraft(undefined, { subject: "Quote", to: "x", date: null }));
});

test("cleanupDrafts: one trash proposal per leftover, auto draft-cleanup, Drafts only; off → the old question", async () => {
  setup({ mailFile: null, status: "# S\n\n**Ball with:** Jane.\n" });
  mail = { Sent: [SENT], Drafts: [S(1, "RE: build day in november", "<info@harper.example>", "2026-10-21T14:20:00Z"), S(2, "Re: Build day in November", "<info@harper.example>", "2026-10-22T07:07:00Z")] };
  const off = await check.run(ctx, h, {});
  assert.equal(off.length, 1); assert.equal(off[0].kind, "question");
  const on = await check.run(ctx, h, { cleanupDrafts: true });
  assert.equal(on.length, 1);
  assert.equal(on[0].kind, "proposal");
  assert.equal(on[0].auto, "draft-cleanup");
  assert.deepEqual(on[0].action, { type: "trash-draft", inward: true, mailbox: "Drafts", uid: 1, expect: { subject: "RE: build day in november", to: "<info@harper.example>", date: "2026-10-21T14:20:00Z" } });
  assert.match(on[0].what, /^old draft to Trash: "RE: build day in november" to info@harper.example \(draft 21-10 16:20, sent 21-10 16:28\)$/);

  const f = { ...on[0], check: "drafts-vs-sent" };
  ctx.config.inbox = { autoApprove: ["draft-cleanup"] };
  assert.equal(autoApprovable(ctx, f), false, "cleanupDrafts must be on in the config too");
  ctx.config.checks = { "drafts-vs-sent": { cleanupDrafts: true } };
  assert.equal(autoApprovable(ctx, f), true);
  assert.equal(autoApprovable(ctx, { ...f, action: { ...f.action, mailbox: "INBOX" } }), false);
  assert.equal(autoApprovable(ctx, { ...f, action: { ...f.action, uid: "1" } }), false);
  assert.equal(autoApprovable(ctx, { ...f, action: { ...f.action, expunge: true } }), false);
  assert.equal(autoApprovable(ctx, { ...f, action: { ...f.action, expect: undefined } }), false);
  assert.equal(autoApprovable(ctx, { ...f, check: "mail-vs-accounts" }), false);
  ctx.config.inbox = { autoApprove: ["ball-line-sent"] };
  assert.equal(autoApprovable(ctx, f), false, "not listed → waits");
});

/** A mail connector that keeps its mailboxes in a JSON file and moves drafts with the real guards. */
function fakeTrashConnector(state) {
  const imapPath = join(dirname(fileURLToPath(import.meta.url)), "..", "connectors", "imap.mjs");
  mkdirSync(join(root, "connectors"), { recursive: true });
  writeFileSync(join(root, "mail-fixture.json"), JSON.stringify(state));
  writeFileSync(join(root, "connectors", "fakemail.mjs"), `import { readFileSync, writeFileSync } from "node:fs";
import { draftsOnly, trashCommands, sameDraft } from ${JSON.stringify(imapPath)};
export default { name: "fakemail", kind: "mail", volatile: true,
  async live(q, ctx) { const s = JSON.parse(readFileSync(ctx.path("mail-fixture.json"), "utf8")); return { items: s[q.mailbox] ?? [] }; },
  async act(action, p, ctx, o) {
    if (action !== "trashDraft") throw new Error("unknown");
    const { drafts, trash } = draftsOnly(p.mailbox, o);
    const plan = trashCommands("IMAP4rev1 MOVE", Number(p.uid), trash);
    const s = JSON.parse(readFileSync(ctx.path("mail-fixture.json"), "utf8"));
    const i = (s[drafts] ?? []).findIndex((m) => m.uid === p.uid);
    if (i < 0 || !sameDraft(s[drafts][i], p.expect)) throw new Error("refused: not the matched draft");
    const [m] = s[drafts].splice(i, 1); (s[trash] ??= []).push(m); (s.log ??= []).push(...plan.commands);
    writeFileSync(ctx.path("mail-fixture.json"), JSON.stringify(s));
    return { mailbox: drafts, trash, uid: m.uid, subject: m.subject, to: m.to, date: m.date, via: plan.via };
  } };`);
  ctx.config.connectors = { fakemail: {} };
}

test("end to end: cleanupDrafts + draft-cleanup listed → the old draft moves to Trash, the newer one stays, the run lists what went", async () => {
  setup({ mailFile: null, status: "# S\n\n**Ball with:** Jane.\n" });
  const old = S(1, "RE: build day in november", "<info@harper.example>", "2026-10-21T14:20:00Z");
  const newer = S(2, "Re: Build day in November", "<info@harper.example>", "2026-10-22T07:07:00Z");
  fakeTrashConnector({ Sent: [SENT], Drafts: [old, newer] });
  ctx.config.inbox = { ...(ctx.config.inbox ?? {}), autoApprove: ["draft-cleanup"] };
  ctx.config.checks = { ...(ctx.config.checks ?? {}), "drafts-vs-sent": { cleanupDrafts: true } };
  const r = await runChecks(ctx, db, { only: ["drafts-vs-sent"], job: "sent-watch", quiet: true });
  assert.equal(r.inbox.auto, 1);
  assert.deepEqual(r.inbox.trashed, [{ date: old.date, to: old.to, subject: old.subject }]);
  const s = JSON.parse(readFileSync(join(root, "mail-fixture.json"), "utf8"));
  assert.deepEqual(s.Drafts.map((m) => m.uid), [2]);
  assert.deepEqual(s.Trash.map((m) => m.uid), [1]);
  assert.deepEqual(s.log, ['UID MOVE 1 "Trash"']);
  assert.deepEqual(s.Sent, [SENT], "Sent is never touched");
  const item = (await listItems(ctx)).find((i) => i.where === "Drafts#1");
  assert.equal(item.status, "done");
  const st = JSON.parse(readFileSync(join(ctx.stateDir, "sent-watch-status.json"), "utf8"));
  assert.equal(st.drafts_trashed, 1);
  const again = await runChecks(ctx, db, { only: ["drafts-vs-sent"], job: "sent-watch", quiet: true });
  assert.equal(again.inbox.auto, 0);
});

test("end to end: cleanupDrafts on but draft-cleanup not listed → the proposal waits, Drafts untouched", async () => {
  setup({ mailFile: null, status: "# S\n\n**Ball with:** Jane.\n" });
  fakeTrashConnector({ Sent: [SENT], Drafts: [S(1, "RE: build day in november", "<info@harper.example>", "2026-10-21T14:20:00Z")] });
  ctx.config.checks = { ...(ctx.config.checks ?? {}), "drafts-vs-sent": { cleanupDrafts: true } };
  const r = await runChecks(ctx, db, { only: ["drafts-vs-sent"], job: "sent-watch", quiet: true });
  assert.equal(r.inbox.auto, 0);
  assert.equal(JSON.parse(readFileSync(join(root, "mail-fixture.json"), "utf8")).Drafts.length, 1);
  assert.equal((await listItems(ctx)).find((i) => i.where === "Drafts#1").status, "open");
});

// ---- draft files ↔ sent mail: strict matching ----

const TZ = "Europe/Amsterdam";
const D = (id, day, subject = null, to = ["ops@client.example"], cc = [], at = Date.parse("2026-10-10T08:00:00Z")) => ({ id, day, subject, to, cc, at });
const M = (subject, to, date, cc = null) => ({ subject, to, cc, date });

test("draft files: four separate drafts of early September never match one October mail (window, declared date beats a bumped mtime)", () => {
  const drafts = [D("a", "2026-09-01"), D("b", "2026-09-01"), D("c", "2026-09-02"), D("d", "2026-09-03")];
  const r = matchDraftFiles(drafts, [M("Follow-up", "<ops@client.example>", "2026-10-11T09:00:00Z")], { timeZone: TZ });
  assert.deepEqual(r.matched, []);
  assert.deepEqual(r.unclear, []);
});

test("draft files: each draft gets its own mail, the closest in time; one mail never closes two drafts", () => {
  const drafts = [D("a", "2026-09-01", "Part 1"), D("b", "2026-09-02", "Part 2"), D("c", "2026-09-03")];
  const sent = [M("Part 1", "<ops@client.example>", "2026-09-01T10:00:00Z"), M("Re: part 2", "<ops@client.example>", "2026-09-02T10:00:00Z"), M("Part 3", "<ops@client.example>", "2026-09-03T10:00:00Z")];
  const r = matchDraftFiles(drafts, sent, { timeZone: TZ });
  assert.deepEqual(r.matched.map((x) => [x.draft.id, x.sent.subject]), [["a", "Part 1"], ["b", "Re: part 2"], ["c", "Part 3"]]);
  // two untitled drafts of the same day, one mail: a tie is a question, not a guess
  const tie = matchDraftFiles([D("x", "2026-09-05"), D("y", "2026-09-05")], [M("Hello", "<ops@client.example>", "2026-09-05T12:00:00Z")], { timeZone: TZ });
  assert.deepEqual(tie.matched, []);
  assert.deepEqual(tie.unclear.map((u) => u.draft.id).sort(), ["x", "y"]);
  // an untitled draft with two mails of its own: a question listing both
  const two = matchDraftFiles([D("z", "2026-09-06")], [M("One", "<ops@client.example>", "2026-09-06T12:00:00Z"), M("Two", "<ops@client.example>", "2026-09-07T12:00:00Z")], { timeZone: TZ });
  assert.equal(two.matched.length, 0);
  assert.deepEqual(two.unclear[0].candidates.map((c) => c.sent.subject), ["One", "Two"]);
});

test("draft files: the subject must match when the draft has one; mail before the draft or past the window does not count", () => {
  const d = D("a", "2026-09-10", "Proposal");
  assert.deepEqual(matchDraftFiles([d], [M("Invoice", "<ops@client.example>", "2026-09-11T09:00:00Z")], { timeZone: TZ }).matched, []);
  assert.deepEqual(matchDraftFiles([d], [M("Proposal", "<ops@client.example>", "2026-09-09T09:00:00Z")], { timeZone: TZ }).matched, []);
  assert.deepEqual(matchDraftFiles([d], [M("Proposal", "<ops@client.example>", "2026-10-05T09:00:00Z")], { timeZone: TZ }).matched, []);
  assert.equal(matchDraftFiles([d], [M("Proposal", "<ops@client.example>", "2026-10-05T09:00:00Z")], { timeZone: TZ, windowDays: 30 }).matched.length, 1);
  assert.equal(matchDraftFiles([d], [M("Re: proposal", "<ops@client.example>", "2026-09-10T15:00:00Z")], { timeZone: TZ }).matched.length, 1);
});

test("draft files: a contact only in Cc counts with a matching subject, and is only a question without one", () => {
  const sent = [M("Recap of our session", "<lead@other.example>", "2026-10-20T15:00:00Z", "ops@client.example")];
  const titled = matchDraftFiles([D("a", "2026-10-20", "Recap of our session")], sent, { timeZone: TZ });
  assert.equal(titled.matched.length, 1);
  const untitled = matchDraftFiles([D("b", "2026-10-20")], sent, { timeZone: TZ });
  assert.deepEqual(untitled.matched, []);
  assert.equal(untitled.unclear.length, 1);
  assert.match(untitled.unclear[0].candidates[0].why, /only in Cc/);
  // a recap with another subject where the contact is only in Cc: nothing at all
  assert.deepEqual(matchDraftFiles([D("c", "2026-10-20", "Session notes")], sent, { timeZone: TZ }), { matched: [], unclear: [] });
});

test("check: a Cc-only mail and an untitled draft file → a question, no status edit and no ball-line change", async () => {
  setup({ mailFile: "---\nstatus: draft in Drafts, not sent yet\nto: info@harper.example\n---\n\nHi,\n" });
  mail = { Sent: [{ ...SENT, subject: "Recap", to: "<someone@else.example>", cc: "info@harper.example" }], Drafts: [] };
  const out = await check.run(ctx, h, { leftovers: false });
  assert.equal(out.length, 1);
  assert.equal(out[0].kind, "question");
  assert.equal(out[0].action, undefined);
  assert.match(out[0].what, /^not sure which sent mail belongs to "mail-2026-10-21-intake.md": 21-10 16:28 "Recap"/);
});

test("check: the ball line needs the subject when the draft file names one", async () => {
  setup();
  mail = { Sent: [{ ...SENT, subject: "Something else entirely" }], Drafts: [] };
  assert.deepEqual(await check.run(ctx, h, { leftovers: false }), []);
  mail = { Sent: [SENT], Drafts: [] };
  const out = await check.run(ctx, h, { leftovers: false });
  assert.ok(out.some((f) => f.auto === "ball-line-sent"));
});

test("mailFileMeta: declared to, cc and date (frontmatter, else the file name)", () => {
  const m = mailFileMeta("---\nstatus: concept\naan: a@b.example\ncc: c@d.example\ndatum: 2026-09-01\n---\n", "mail-2026-08-30-x.md");
  assert.deepEqual([m.to, m.cc, m.day], ["a@b.example", "c@d.example", "2026-09-01"]);
  assert.equal(mailFileMeta("---\nstatus: concept\n---\n", "mail-2026-08-30-x.md").day, "2026-08-30");
});

test("calendar mail: what the client sends by itself is skipped; a typed reply to an invite is not", () => {
  for (const s of ["Accepted: Build day", "Invitation: Build day @ Mon 2 Nov", "Updated invitation: Build day", "Geaccepteerd: Bouwdag", "Declined: Build day", "Tentative: Build day", "Cancellation: Build day", "Build day — accepted by Jane"]) assert.equal(isCalendarMail(s), true, s);
  for (const s of ["Re: Invitation: Build day @ Mon 2 Nov", "Fwd: Invitation: Build day", "Update on the build day", "Re: Accepted proposal", "Build day in November"]) assert.equal(isCalendarMail(s), false, s);
});

test("a typed reply to an invite closes the draft; Sent is read 120 days back, Drafts by days", async () => {
  setup({ mailFile: "---\nstatus: draft in Drafts, not sent yet\nto: info@harper.example\nsubject: \"Re: Invitation: Build day @ Mon 2 Nov\"\n---\n\nHi Jane,\n" });
  const asked = [];
  const live = h.live;
  h.live = async (kind, q) => { asked.push({ mailbox: q.mailbox, days: q.days }); return live(kind, q); };
  mail = { Sent: [{ ...SENT, subject: "Re: Invitation: Build day @ Mon 2 Nov" }, { ...SENT, uid: 10, subject: "Accepted: Build day @ Mon 2 Nov", date: "2026-10-21T14:30:00Z" }], Drafts: [] };
  const out = await check.run(ctx, h, {});
  const ball = out.find((f) => f.auto === "ball-line-sent");
  assert.ok(ball, JSON.stringify(out.map((f) => f.what)));
  assert.match(ball.what, /"Re: Invitation: Build day @ Mon 2 Nov"/);
  assert.deepEqual(asked, [{ mailbox: "Sent", days: 120 }, { mailbox: "Drafts", days: 14 }]);
  asked.length = 0;
  await check.run(ctx, h, { sentDays: 45, days: 7 });
  assert.deepEqual(asked, [{ mailbox: "Sent", days: 45 }, { mailbox: "Drafts", days: 7 }]);
});
