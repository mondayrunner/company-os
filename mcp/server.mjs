/**
 * `company-os serve`: the brain as an MCP server over stdio (newline-delimited
 * JSON-RPC 2.0). No dependency.
 *
 * Every tool answers from the markdown, the index or a live source; none of
 * them calls a model. The agent on the other end does the thinking, so a call
 * comes back in milliseconds and the answer is a few kilobytes, not a list of
 * paths. The writing tools (todo, task_done, mail_draft) only do what can be
 * undone from the source itself and leave a row in the activity log; sending,
 * paying and publishing are not tools and will not be — they go through the
 * inbox and a human.
 */
import { createInterface } from "node:readline";
import { search, status } from "../core/search.mjs";
import { account, accounts, canon } from "../core/brief.mjs";
import { finance, tasks, calendar, mail } from "../core/live.mjs";
import { todo, taskDone, mailDraft } from "../core/actions.mjs";
import { runChecks } from "../core/checks.mjs";
import { loadConnectors, byKind } from "../core/connectors.mjs";
import { postItem, listItems } from "../core/inbox.mjs";

// Descriptions are written for an agent that has never seen this company:
// when to use the tool, what comes back, what to do next.
export const TOOLS = [
  { name: "account", description: "What is going on with one client, lead or partner. Give any part of the name (\"harper\", \"northwind\") or the folder path. Returns the status file (first sections, capped), who holds the ball, the pipeline row and recent log lines, open commitments, the last contact moment and the newest files. Use this before anything else about an account; use `full: true` only when the head is not enough.", inputSchema: { type: "object", properties: { account: { type: "string", description: "name fragment or folder path" }, full: { type: "boolean", default: false }, maxChars: { type: "number", default: 3000 } }, required: ["account"] } },
  { name: "accounts", description: "One line per open and won account: name, side, who holds the ball, stage, next action, last touch. Use it to see the whole pipeline at once or to find the right account before calling `account`.", inputSchema: { type: "object", properties: { side: { type: "string", description: "one side only, e.g. acquisition or clients" } } } },
  { name: "canon", description: "A canonical file by short name: the one place a fact lives (prices, positioning, strategy, company details). Call without a key to list the keys. Never quote a price or package from anywhere else.", inputSchema: { type: "object", properties: { key: { type: "string" }, section: { type: "string", description: "return one section whose heading contains this" } } } },
  { name: "search", description: "Full-text search over the markdown. Canon first (status files, pipeline, knowledge, contacts); transcripts, daily plans and advice only with raw: true or when canon has too little. Returns path, title, snippet, date per hit — read the file for the rest. Prefer `account` when the question is about one account.", inputSchema: { type: "object", properties: { query: { type: "string" }, limit: { type: "number", default: 8 }, raw: { type: "boolean", default: false, description: "include raw material: transcripts, daily plans, advice" } }, required: ["query"] } },
  { name: "mail", description: "Mail with the body. `query` searches sender, subject and text server-side (\"ledger\", \"invoice\") and returns the newest matches with body and attachment names; `uid` reads one; neither → the latest unread headers. Use this instead of grepping markdown for a mail: mail is live, not in the vault.", inputSchema: { type: "object", properties: { query: { type: "string" }, uid: { type: "number" }, limit: { type: "number", default: 5 }, mailbox: { type: "string", description: "INBOX by default; Sent for what was written" } } } },
  { name: "finance", description: "MRR, ARR, subscription count, open and overdue invoices with amounts, plus the rows. Live from the finance connector (Stripe). Never write these numbers into markdown.", inputSchema: { type: "object", properties: {} } },
  { name: "tasks", description: "Open cards on the task board grouped by list, overdue first. Live from Trello (or the markdown task list).", inputSchema: { type: "object", properties: { board: { type: "string", description: "another board id than the configured one" } } } },
  { name: "calendar", description: "Today's events, or a range with from/to (YYYY-MM-DD).", inputSchema: { type: "object", properties: { from: { type: "string" }, to: { type: "string" } } } },
  { name: "todo", description: "Create a card on the task board (default list: the configured todo list). Reversible — the card can be archived — so no approval is needed. Put the why and the source (a mail, a call) in `body`.", inputSchema: { type: "object", properties: { title: { type: "string" }, body: { type: "string" }, due: { type: "string", description: "YYYY-MM-DD" }, list: { type: "string" } }, required: ["title"] } },
  { name: "task_done", description: "Move a card to the done list (or another list by name). Reversible.", inputSchema: { type: "object", properties: { id: { type: "string" }, list: { type: "string" } }, required: ["id"] } },
  { name: "mail_draft", description: "File a draft in the mail client's Drafts folder: to, subject, body (plain text; you write it, this only files it). Replaces an earlier draft with the same subject to the same address. Never sends — the human does that from the mail client.", inputSchema: { type: "object", properties: { to: { type: "string" }, subject: { type: "string" }, body: { type: "string" } }, required: ["to", "subject", "body"] } },
  { name: "live", description: "Read a live source now: kind = tasks (what: cards) | finance (subscriptions, open-invoices) | calendar (today, range from/to) | mail (unread). Never copy these numbers into markdown.", inputSchema: { type: "object", properties: { kind: { type: "string" }, what: { type: "string" }, from: { type: "string" }, to: { type: "string" }, limit: { type: "number" } }, required: ["kind"] } },
  { name: "check", description: "Run the deterministic checks (stale pages, dead links, pipeline drift, copied figures, subscriptions vs accounts, silent jobs). Findings become inbox items.", inputSchema: { type: "object", properties: { live: { type: "boolean", default: true } } } },
  { name: "inbox_post", description: "Talk back to the human: post a question, proposal or finding to the inbox. The human replies there; approved items are executed by `company-os inbox run`.", inputSchema: { type: "object", properties: { kind: { type: "string", enum: ["question", "proposal", "drift", "report"] }, title: { type: "string" }, body: { type: "string" }, action: { type: "object", description: "optional: {type: edit-markdown|set-frontmatter|move-file|agent, …}" } }, required: ["title", "body"] } },
  { name: "inbox_list", description: "List inbox items, optionally by status (open, approved, rejected, done, failed).", inputSchema: { type: "object", properties: { status: { type: "string" } } } },
  { name: "status", description: "What is in the brain: counts, sources, latest runs.", inputSchema: { type: "object", properties: {} } },
];

export async function callTool(ctx, db, name, args = {}) {
  switch (name) {
    case "account": return account(ctx, db, args.account, { full: !!args.full, maxChars: args.maxChars ?? 3000 });
    case "context": return account(ctx, db, args.account); // the old name, kept for callers that still use it
    case "accounts": return accounts(ctx, db, { side: args.side ?? null });
    case "canon": return canon(ctx, args.key ?? null, { section: args.section ?? null });
    case "search": return search(db, args.query, args.limit ?? 8, ctx, { raw: !!args.raw });
    case "mail": return mail(ctx, { query: args.query ?? null, uid: args.uid ?? null, limit: args.limit ?? 5, mailbox: args.mailbox ?? null });
    case "finance": return finance(ctx);
    case "tasks": return tasks(ctx, { board: args.board ?? null });
    case "calendar": return calendar(ctx, { from: args.from ?? null, to: args.to ?? null });
    case "todo": return todo(ctx, { title: args.title, body: args.body ?? "", due: args.due ?? null, list: args.list ?? null });
    case "task_done": return taskDone(ctx, { id: args.id, list: args.list ?? null });
    case "mail_draft": return mailDraft(ctx, { to: args.to, subject: args.subject, body: args.body });
    case "live": {
      const c = byKind(await loadConnectors(ctx), args.kind).find((x) => x.live);
      if (!c) throw new Error(`no live connector of kind ${args.kind}`);
      const { kind, ...query } = args;
      return { connector: c.name, ...(await c.live(query, ctx, c.options)) };
    }
    case "check": { const r = await runChecks(ctx, db, { live: args.live ?? true }); return { errors: r.errors, warnings: r.warnings, findings: r.findings, skipped: r.skipped, inbox: r.inbox }; }
    case "inbox_post": return postItem(ctx, { kind: args.kind ?? "question", from: "agent", title: args.title, body: args.body, action: args.action ?? null });
    case "inbox_list": return (await listItems(ctx, { status: args.status ?? null })).map(({ id, kind, from, created, status, title, action }) => ({ id, kind, from, created, status, title, action }));
    case "status": return status(db, ctx);
    default: throw new Error(`unknown tool ${name}`);
  }
}

export function serve(ctx, db) {
  const send = (msg) => process.stdout.write(JSON.stringify(msg) + "\n");
  const rl = createInterface({ input: process.stdin });
  rl.on("line", async (line) => {
    if (!line.trim()) return;
    let req;
    try { req = JSON.parse(line); } catch { return; }
    const { id, method, params } = req;
    const reply = (result) => id !== undefined && send({ jsonrpc: "2.0", id, result });
    const fail = (code, message) => id !== undefined && send({ jsonrpc: "2.0", id, error: { code, message } });
    try {
      if (method === "initialize") reply({ protocolVersion: params?.protocolVersion ?? "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "company-os", version: "0.2.0" } });
      else if (method === "notifications/initialized" || method?.startsWith("notifications/")) { /* no reply */ }
      else if (method === "ping") reply({});
      else if (method === "tools/list") reply({ tools: TOOLS });
      else if (method === "tools/call") {
        try { reply({ content: [{ type: "text", text: JSON.stringify(await callTool(ctx, db, params.name, params.arguments ?? {}), null, 2) }] }); }
        catch (e) { reply({ content: [{ type: "text", text: `error: ${e.message}` }], isError: true }); }
      } else fail(-32601, `method not found: ${method}`);
    } catch (e) { fail(-32603, e.message); }
  });
  process.stderr.write(`company-os mcp: serving ${ctx.root}\n`);
  return new Promise((resolve) => rl.on("close", resolve));
}
