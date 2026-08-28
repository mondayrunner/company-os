import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { cpSync, rmSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadContext } from "../core/config.mjs";
import { openDb } from "../core/db.mjs";
import { indexAll } from "../core/index.mjs";
import { postItem, listItems, reply, runApproved, indexInbox } from "../core/inbox.mjs";
import { runChecks } from "../core/checks.mjs";
import { TOOLS, callTool } from "../mcp/server.mjs";
import { liveKinds } from "../core/ask.mjs";

const fixture = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "company");
let root, ctx, db;

before(async () => {
  root = mkdtempSync(join(tmpdir(), "company-os-"));
  cpSync(fixture, root, { recursive: true });
  rmSync(join(root, ".company-os"), { recursive: true, force: true });
  ctx = loadContext({ root });
  db = openDb(ctx);
  await indexAll(ctx, db);
});
after(() => { db.close(); rmSync(root, { recursive: true, force: true }); });

test("post, dedupe by fingerprint, list", async () => {
  const a = await postItem(ctx, { kind: "question", from: "test", title: "Which account?", body: "hello" });
  const b = await postItem(ctx, { kind: "question", from: "test", title: "Which account?", body: "hello again" });
  assert.ok(a.created); assert.equal(b.created, false); assert.equal(b.id, a.id);
  assert.equal((await listItems(ctx, { status: "open" })).length, 1);
});

test("checks post drift items with a fingerprint; pipeline-freshness carries an action", async () => {
  const r = await runChecks(ctx, db, { live: false });
  assert.ok(r.inbox.posted >= 5);
  const items = await listItems(ctx, { status: "open" });
  // De titel is nu de bevinding zelf; de plek staat in `where`.
  const fresh = items.find((i) => i.action?.type === "edit-markdown");
  assert.match(fresh.title, /last update says/);
  assert.match(fresh.where, /pipeline\.md/);
  const again = await runChecks(ctx, db, { live: false });
  assert.equal(again.inbox.posted, 0);
});

test("approve + run applies edit-markdown and writes the result", async () => {
  const fresh = (await listItems(ctx)).find((i) => i.action?.type === "edit-markdown" && i.status === "open");
  await reply(ctx, fresh.id, "ok, fix it", { status: "approved" });
  const r = await runApproved(ctx);
  assert.equal(r.length, 1); assert.ok(r[0].ok);
  assert.match(readFileSync(join(root, "pipeline/pipeline.md"), "utf8"), /\*\*Last update:\*\* 2026-01-20/);
  const done = (await listItems(ctx)).find((i) => i.id === fresh.id);
  assert.equal(done.status, "done"); assert.match(done.result, /✓ edited/);
});

test("set-frontmatter takes the value from the reply", async () => {
  const { id } = await postItem(ctx, { kind: "question", from: "link", title: "Which account for t1?", body: "…", action: { type: "set-frontmatter", file: "knowledge/pricing.md", field: "account" } });
  await reply(ctx, id, "accounts/customers/2026-02-01-globex-platform", { status: "approved" });
  const r = await runApproved(ctx, { only: id });
  assert.ok(r[0].ok, r[0].message);
  assert.match(readFileSync(join(root, "knowledge/pricing.md"), "utf8"), /^account: accounts\/customers\/2026-02-01-globex-platform$/m);
});

test("outward actions are refused", async () => {
  const { id } = await postItem(ctx, { kind: "proposal", from: "agent", title: "Send the invoice to Acme", body: "…" });
  await reply(ctx, id, "yes", { status: "approved" });
  const r = await runApproved(ctx, { only: id });
  assert.equal(r[0].ok, false); assert.match(r[0].message, /refused/);
  assert.equal((await listItems(ctx)).find((i) => i.id === id).status, "failed");
});

test("rejected items silence the same finding", async () => {
  const item = (await listItems(ctx, { status: "open" })).find((i) => /dead wikilink/.test(i.title));
  await reply(ctx, item.id, "", { status: "rejected" });
  await runChecks(ctx, db, { live: false });
  assert.equal((await listItems(ctx)).filter((i) => i.fingerprint === item.fingerprint).length, 1);
});

test("inbox table mirrors the folder", async () => {
  const r = await indexInbox(ctx, db);
  assert.equal(r.items, (await listItems(ctx)).length);
  assert.equal(db.prepare("SELECT count(*) n FROM inbox").get().n, r.items);
});

test("mcp: tools and a search call", async () => {
  assert.ok(TOOLS.map((t) => t.name).includes("inbox_post"));
  const hits = await callTool(ctx, db, "search", { query: "proposal" });
  assert.ok(hits.some((h) => h.path === "pipeline/pipeline.md"));
  const posted = await callTool(ctx, db, "inbox_post", { title: "From an agent", body: "question" });
  assert.ok(posted.created);
});

test("ask: live hints detect volatile kinds", () => {
  assert.deepEqual(liveKinds(ctx, "Wat is onze MRR en welke taken staan open?"), ["finance", "tasks"]);
  assert.deepEqual(liveKinds(ctx, "What did we promise Acme?"), []);
});
