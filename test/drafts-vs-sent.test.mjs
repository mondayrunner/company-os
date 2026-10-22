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
import check, { normSubject, nextHolder, mailFileMeta } from "../checks/drafts-vs-sent.mjs";

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
      { uid: 3, subject: "(no subject)", to: "<info@harper.example>", date: "2026-10-21T14:00:00Z" },
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
