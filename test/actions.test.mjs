import { test, before } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadContext } from "../core/config.mjs";
import { openDb } from "../core/db.mjs";
import { finance, tasks, mail } from "../core/live.mjs";
import { todo, taskDone, mailDraft } from "../core/actions.mjs";
import { callTool, TOOLS } from "../mcp/server.mjs";

const fixture = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "company");
let root, ctx, db;

// Private connectors in <root>/connectors win over the built-ins, so a stub
// there stands in for Trello, Stripe and the mail server. Each stub writes what
// it was asked into a log file the tests read back.
const STUB = (name, kind, body) => `export default { name: "${name}", kind: "${kind}", volatile: true, location: "stub", ${body} };`;

before(() => {
  root = mkdtempSync(join(tmpdir(), "company-os-actions-"));
  cpSync(fixture, root, { recursive: true });
  mkdirSync(join(root, "connectors"), { recursive: true });
  writeFileSync(join(root, "connectors", "trello.mjs"), STUB("trello", "tasks", `
    async live() { return { items: [
      { id: "c1", title: "Pay taxes", list: "Now", due: "2020-01-01", overdue: true, url: "u1" },
      { id: "c2", title: "Call Acme", list: "Now", due: null, overdue: false, url: "u2" },
      { id: "c3", title: "Later thing", list: "Later", due: null, overdue: false, url: "u3" } ], lists: ["Now", "Later", "Done"] }; },
    async act(action, params, ctx, options) {
      if (action === "create") return { id: "new1", title: params.title, list: params.list ?? options.todoList, due: params.due, url: "https://trello.com/c/new1", body: params.body };
      if (action === "move") return { id: params.id, title: "moved", list: params.list ?? "Done" };
      throw new Error("nope");
    }`));
  writeFileSync(join(root, "connectors", "stripe.mjs"), STUB("stripe", "finance", `
    async live(q) {
      if (q.what === "subscriptions") return { items: [{ id: "s1", monthly: 250 }, { id: "s2", monthly: 550 }], fetched: "now" };
      if (q.what === "open-invoices") return { items: [{ id: "i1", amount: 100, overdue: true }, { id: "i2", amount: 50, overdue: false }] };
    }`));
  writeFileSync(join(root, "connectors", "imap.mjs"), STUB("imap", "mail", `
    async live(q) {
      if (q.what === "search") return { found: 1, items: [{ uid: 7, subject: "Payroll tax August", from: "Sam Ledger", body: "Amount due € 1,475" }] };
      if (q.what === "read") return { item: { uid: q.uid, subject: "one" } };
      return { unread: 0, items: [] };
    },
    async act(action, params) { if (action !== "draft") throw new Error("nope"); return { mailbox: "Drafts", to: params.to, subject: params.subject, replaced: 0 }; }`));
  const cfg = JSON.parse(require_fs().readFileSync(join(root, "company-os.config.json"), "utf8"));
  cfg.connectors = { markdown: {}, status: {}, trello: { todoList: "Later" }, stripe: {}, imap: {} };
  writeFileSync(join(root, "company-os.config.json"), JSON.stringify(cfg));
  ctx = loadContext({ root });
  db = openDb(ctx);
});

function require_fs() { return { readFileSync: (p, e) => Buffer.from(readFileSyncRaw(p)).toString(e) }; }
import { readFileSync as readFileSyncRaw } from "node:fs";

test("finance: MRR and open invoices in one answer", async () => {
  const f = await finance(ctx);
  assert.equal(f.mrr, 800);
  assert.equal(f.arr, 9600);
  assert.equal(f.subscriptions, 2);
  assert.equal(f.openInvoices, 2);
  assert.equal(f.openAmount, 150);
  assert.equal(f.overdueInvoices, 1);
  assert.equal(f.overdueAmount, 100);
});

test("tasks: grouped by list, overdue first", async () => {
  const t = await tasks(ctx);
  assert.equal(t.open, 3);
  assert.equal(t.overdue, 1);
  assert.deepEqual(Object.keys(t.lists), ["Now", "Later", "Done"]);
  assert.equal(t.lists.Now[0].id, "c1");
});

test("mail: a search returns the body; a uid reads one", async () => {
  const m = await mail(ctx, { query: "ledger" });
  assert.equal(m.items[0].body, "Amount due € 1,475");
  assert.equal((await mail(ctx, { uid: 7 })).item.uid, 7);
});

test("todo: creates a card on the todo list and leaves a trace", async () => {
  const r = await todo(ctx, { title: "Pay payroll tax", body: "from the bookkeeper's mail", due: "2026-09-30" });
  assert.equal(r.ok, true);
  assert.equal(r.card.list, "Later");
  assert.equal(r.card.due, "2026-09-30");
  const row = db.prepare("SELECT job, result, message FROM events ORDER BY id DESC LIMIT 1").get();
  assert.equal(row.job, "todo");
  assert.equal(row.result, "ok");
  assert.match(row.message, /payroll/);
});

test("task_done and mail_draft: reversible, traced; a failure is a row too", async () => {
  assert.equal((await taskDone(ctx, { id: "c1" })).card.list, "Done");
  const d = await mailDraft(ctx, { to: "a@b.c", subject: "Re: x", body: "hi" });
  assert.equal(d.ok, true);
  assert.equal(d.draft.mailbox, "Drafts");
  const rows = db.prepare("SELECT job FROM events ORDER BY id DESC LIMIT 2").all().map((r) => r.job);
  assert.deepEqual(rows, ["mail draft", "task done"]);
  await assert.rejects(() => todo(ctx, {}), /needs a title/);
});

test("mcp: the tools exist and dispatch", async () => {
  const names = TOOLS.map((t) => t.name);
  for (const n of ["account", "accounts", "canon", "search", "mail", "finance", "tasks", "calendar", "todo", "task_done", "mail_draft"]) assert.ok(names.includes(n), n);
  assert.equal((await callTool(ctx, db, "finance")).mrr, 800);
  assert.equal((await callTool(ctx, db, "todo", { title: "x" })).card.title, "x");
  assert.equal((await callTool(ctx, db, "canon", {})).keys.length, 1);
});
