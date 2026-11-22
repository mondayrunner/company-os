import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { cpSync, rmSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync, utimesSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadContext } from "../core/config.mjs";
import { openDb } from "../core/db.mjs";
import { postItem, listItems, reply, runApproved, triageQueue, triageNext, triageAnswer } from "../core/inbox.mjs";
import { TOOLS, callTool } from "../mcp/server.mjs";

const fixture = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "company");
let root, ctx, db;
const LEAD = "accounts/leads/2026-01-15-acme-website";
const STATUS = `${LEAD}/STATUS.md`;

// The shapes the real posters use: a check item starts with its header line,
// a link question lists its candidates and points a set-frontmatter at the file.
const checkItem = (check, kind, what, action = null, where = STATUS) => postItem(ctx, {
  kind, from: "check", title: what, where, fingerprint: null, action,
  body: `**warn** · check \`${check}\` · \`${where}\`\n\n${what}\n\nReply with what to do (and approve), or reject to silence this finding.`,
});
function transcript(name) {
  const rel = `transcripts/_inbox/${name}.md`;
  mkdirSync(join(root, "transcripts/_inbox"), { recursive: true });
  writeFileSync(join(root, rel), `---\ndate: 2026-03-01\nduration_s: 1200\n---\n\n## Transcript\n\nWe talked about the website.\n`);
  return rel;
}
const linkItem = (rel, candidates) => postItem(ctx, {
  kind: "question", from: "link", title: "Which account does this transcript belong to?", where: rel, fingerprint: `l${rel.length}${rel.slice(-12, -3).replace(/\W/g, "")}`,
  body: `2026-03-01 · 20 min\n\n> We talked about the website.\n\n${candidates.length ? `Candidates: ${candidates.map((c) => `\`${c}\` (acme)`).join(", ")}` : "No account name recognised."}\n\nReply with the account path and approve.`,
  action: { type: "set-frontmatter", file: rel, field: "account" },
});

before(() => {
  root = mkdtempSync(join(tmpdir(), "company-os-triage-"));
  cpSync(fixture, root, { recursive: true });
  rmSync(join(root, ".company-os"), { recursive: true, force: true });
  ctx = loadContext({ root });
  db = openDb(ctx);
});
after(() => { db.close(); rmSync(root, { recursive: true, force: true }); });

test("the queue orders ready proposals, guesses, findings, replies, refused, reports — and groups the near-identical", async () => {
  const edit = (n) => ({ type: "edit-markdown", file: STATUS, log: { under: "Log", line: `- line ${n}` } });
  await checkItem("ball-check", "proposal", "status file one is behind", edit(1));
  await checkItem("ball-check", "proposal", "status file two is behind", edit(2));
  await linkItem(transcript("t1"), [LEAD, "accounts/customers/2026-02-01-globex-platform"]);
  await linkItem(transcript("t2"), [LEAD]);
  await linkItem(transcript("t3"), []);
  await checkItem("stale-pages", "drift", "a page is old");
  await checkItem("announce", "proposal", "send the newsletter to everyone", { type: "agent", instruction: "send the newsletter" });
  await postItem(ctx, { kind: "report", from: "check", title: "Check run: 3 new", body: "Ran 5 checks." });

  const { queue, counts } = await triageQueue(ctx);
  assert.deepEqual(queue.map((e) => [e.tier, e.size]), [["ready", 2], ["candidate", 2], ["finding", 1], ["reply", 1], ["refused", 1], ["report", 1]]);
  assert.equal(counts.items, 8); assert.equal(counts.questions, 6);

  const [ready, guess, finding, typed, refused, report] = queue;
  assert.ok(ready.group && ready.ref.startsWith("g-")); assert.equal(ready.default, "yes");
  assert.match(ready.yes, /for each of the 2: log/);
  assert.equal(guess.candidate, LEAD); assert.match(guess.question, /all `accounts\/leads\/2026-01-15-acme-website`\?/);
  assert.match(guess.yes, /set account: accounts\/leads/);
  assert.match(finding.yes, /an agent fixes/); assert.equal(finding.agent, true);
  assert.equal(typed.needsReply, true); assert.equal(typed.default, "later");
  assert.equal(refused.default, "later"); assert.match(refused.yes, /refuses/);
  assert.match(report.question, /Mark it read/);

  const skip = await triageQueue(ctx, { reports: false });
  assert.equal(skip.counts.reports, 1); assert.ok(!skip.queue.some((e) => e.tier === "report"));
});

test("yes on a group of guesses files each transcript under the guess and runs it", async () => {
  const { next } = await triageNext(ctx);
  assert.equal(next.tier, "ready");
  const r = await triageAnswer(ctx, { ref: next.ref, answer: "yes" });
  assert.deepEqual(r.results.map((x) => x.status), ["done", "done"]);
  assert.match(readFileSync(join(root, STATUS), "utf8"), /- line 1[\s\S]*- line 2|- line 2[\s\S]*- line 1/);
  assert.equal(r.next.tier, "candidate");

  const g = await triageAnswer(ctx, { ref: r.next.ref, answer: "yes" });
  assert.ok(g.results.every((x) => x.ok && x.status === "done"));
  for (const t of ["t1", "t2"]) assert.match(readFileSync(join(root, `transcripts/_inbox/${t}.md`), "utf8"), new RegExp(`^account: ${LEAD}$`, "m"));
});

test("a group ref answers exactly what was shown: one more item and it refuses", async () => {
  await checkItem("dead-links", "drift", "link one is dead", null, "knowledge/pricing.md");
  await checkItem("dead-links", "drift", "link two is dead", null, "knowledge/pricing.md");
  const shown = (await triageQueue(ctx)).queue.find((e) => e.check === "dead-links");
  assert.equal(shown.size, 2);
  await checkItem("dead-links", "drift", "link three is dead", null, "knowledge/pricing.md");
  await assert.rejects(triageAnswer(ctx, { ref: shown.ref, answer: "no" }), /changed or is gone/);
  // One item of a group can still be answered on its own.
  const one = await triageAnswer(ctx, { ref: shown.ids[0], answer: "no" });
  assert.deepEqual(one.results.map((x) => x.status), ["rejected"]);
  const rest = (await triageQueue(ctx)).queue.find((e) => e.check === "dead-links");
  assert.equal(rest.size, 2);
  const no = await triageAnswer(ctx, { ref: rest.ref, answer: "no", reply: "known, ignore" });
  assert.ok(no.results.every((x) => x.status === "rejected"));
});

test("later leaves it open and out of the queue for a while", async () => {
  const typed = (await triageQueue(ctx)).queue.find((e) => e.tier === "reply");
  const r = await triageAnswer(ctx, { ref: typed.ref, answer: "later", reply: "ask the team" });
  assert.equal(r.results[0].status, "open");
  const after = await triageQueue(ctx);
  assert.ok(!after.queue.some((e) => e.ref === typed.ref)); assert.equal(after.counts.later, 1);
  assert.ok((await triageQueue(ctx, { includeLater: true })).queue.some((e) => e.ref === typed.ref));
  assert.ok((await triageQueue(ctx, { now: Date.now() + 13 * 36e5 })).queue.some((e) => e.ref === typed.ref));
  const item = (await listItems(ctx)).find((i) => i.id === typed.ref);
  assert.equal(item.status, "open"); assert.match(item.reply, /ask the team/);
});

test("yes on a question that needs a value does nothing without a reply, and files the reply with one", async () => {
  const typed = (await triageQueue(ctx, { includeLater: true })).queue.find((e) => e.tier === "reply");
  const bare = await triageAnswer(ctx, { ref: typed.ref, answer: "yes" });
  assert.equal(bare.results[0].ok, false); assert.equal(bare.results[0].status, "open"); assert.match(bare.results[0].message, /needs a reply/);
  const r = await triageAnswer(ctx, { ref: typed.ref, answer: "yes", reply: "internal" });
  assert.equal(r.results[0].status, "done");
  assert.match(readFileSync(join(root, "transcripts/_inbox/t3.md"), "utf8"), /^account: internal$/m);
});

test("an outward item stays refused: yes changes nothing, no closes it", async () => {
  const refused = (await triageQueue(ctx)).queue.find((e) => e.tier === "refused");
  const yes = await triageAnswer(ctx, { ref: refused.ref, answer: "yes" });
  assert.equal(yes.results[0].ok, false);
  assert.equal((await listItems(ctx)).find((i) => i.id === refused.ref).status, "open");
  const no = await triageAnswer(ctx, { ref: refused.ref, answer: "no" });
  assert.equal(no.results[0].status, "rejected");
});

test("run: false only approves, run: files leaves agent runs approved; a report yes is read", async () => {
  await checkItem("tidy", "proposal", "rewrite the intro", { type: "agent", instruction: "Rewrite the intro of the pricing page." }, "knowledge/pricing.md");
  const agent = (await triageQueue(ctx)).queue.find((e) => e.check === "tidy");
  assert.equal(agent.agent, true);
  const r = await triageAnswer(ctx, { ref: agent.ref, answer: "yes", run: "files" });
  assert.equal(r.results[0].status, "approved"); assert.match(r.results[0].message, /inbox run/);

  await checkItem("tidy-2", "proposal", "log a line", { type: "edit-markdown", file: STATUS, log: { line: "- approved only" } });
  const file = (await triageQueue(ctx)).queue.find((e) => e.check === "tidy-2");
  const a = await triageAnswer(ctx, { ref: file.ref, answer: "yes", run: false });
  assert.equal(a.results[0].status, "approved");
  assert.doesNotMatch(readFileSync(join(root, STATUS), "utf8"), /approved only/);

  const report = (await triageQueue(ctx)).queue.find((e) => e.tier === "report");
  const read = await triageAnswer(ctx, { ref: report.ref, answer: "yes" });
  assert.equal(read.results[0].status, "done");
  await assert.rejects(triageAnswer(ctx, { ref: report.ref, answer: "maybe" }), /yes, no or later/);
});

test("MCP: inbox_next and inbox_answer run the round", async () => {
  assert.ok(TOOLS.some((t) => t.name === "inbox_next") && TOOLS.some((t) => t.name === "inbox_answer"));
  await checkItem("mcp-check", "proposal", "set the stage", { type: "set-frontmatter", file: "knowledge/pricing.md", fields: { stage: "won" } }, "knowledge/pricing.md");
  const first = await callTool(ctx, db, "inbox_next", { reports: false });
  assert.equal(first.next.check, "mcp-check"); assert.match(first.next.yes, /set stage: won in knowledge\/pricing\.md/);
  const r = await callTool(ctx, db, "inbox_answer", { ref: first.next.ref, answer: "yes" });
  assert.equal(r.results[0].status, "done");
  assert.match(readFileSync(join(root, "knowledge/pricing.md"), "utf8"), /^stage: won$/m);
  assert.equal(r.left.questions, (await triageQueue(ctx)).counts.questions);
});

test("a group with a member put off by its own id can still be answered", async () => {
  for (const n of [1, 2, 3]) await checkItem("old-notes", "drift", `note ${n} is old`, null, "knowledge/pricing.md");
  const full = (await triageQueue(ctx)).queue.find((e) => e.check === "old-notes");
  await triageAnswer(ctx, { ref: full.ids[0], answer: "later" });
  const shown = (await triageQueue(ctx)).queue.find((e) => e.check === "old-notes");
  assert.equal(shown.size, 2);
  const r = await triageAnswer(ctx, { ref: shown.ref, answer: "no" });
  assert.deepEqual(r.results.map((x) => x.id).sort(), shown.ids.slice().sort());
  assert.equal((await listItems(ctx)).find((i) => i.id === full.ids[0]).status, "open");
});

test("an approved item runs once, however many runners reach for it", async () => {
  const { id } = await checkItem("once", "proposal", "log once", { type: "edit-markdown", file: STATUS, log: { line: "- exactly once" } });
  await reply(ctx, id, "", { status: "approved" });
  const runs = await Promise.all([runApproved(ctx, { only: id }), runApproved(ctx, { only: id }), runApproved(ctx, { only: id })]);
  assert.equal(readFileSync(join(root, STATUS), "utf8").split("- exactly once").length - 1, 1);
  assert.equal(runs.flat().filter((r) => r.ok).length, 1);
  assert.equal((await listItems(ctx)).find((i) => i.id === id).status, "done");
  assert.ok(!existsSync(join(root, "inbox", ".claims", `${id}.claim`)));
});

test("a claim held by a live runner blocks; one left by a dead runner is taken over", async () => {
  const { id } = await checkItem("claimed", "proposal", "log claimed", { type: "edit-markdown", file: STATUS, log: { line: "- after the claim" } });
  await reply(ctx, id, "", { status: "approved" });
  const claimFile = join(root, "inbox", ".claims", `${id}.claim`);
  mkdirSync(dirname(claimFile), { recursive: true });
  writeFileSync(claimFile, "999 now\n");
  const [busy] = await runApproved(ctx, { only: id });
  assert.equal(busy.busy, true);
  assert.equal((await listItems(ctx)).find((i) => i.id === id).status, "approved");
  const old = new Date(Date.now() - 31 * 60e3);
  utimesSync(claimFile, old, old);
  const [ran] = await runApproved(ctx, { only: id });
  assert.equal(ran.ok, true);
  assert.match(readFileSync(join(root, STATUS), "utf8"), /- after the claim/);
});
