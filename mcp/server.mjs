// `brainlane serve`: the brain as an MCP server over stdio (newline-delimited
// JSON-RPC 2.0), so any agent can search, read context, ask, check live sources
// and post to the inbox. No dependency. Nothing here writes to a source; the
// only "writing" tool posts a question or proposal for a human.
import { createInterface } from "node:readline";
import { search, context, status } from "../core/search.mjs";
import { ask } from "../core/ask.mjs";
import { runChecks } from "../core/checks.mjs";
import { loadConnectors, byKind } from "../core/connectors.mjs";
import { postItem, listItems } from "../core/inbox.mjs";

export const TOOLS = [
  { name: "search", description: "Full-text search over the company brain (markdown index). Returns path, heading, snippet per hit. Read the file for the full context.", inputSchema: { type: "object", properties: { query: { type: "string" }, limit: { type: "number", default: 8 } }, required: ["query"] } },
  { name: "context", description: "Everything around one account folder: its files, contacts, transcripts, relations.", inputSchema: { type: "object", properties: { account: { type: "string", description: "account folder path relative to the root" } }, required: ["account"] } },
  { name: "ask", description: "Ask the brain a question in natural language; answers with [[source]] per claim and checks live sources when the fact can change. Costs an agent run — prefer `search` for lookups.", inputSchema: { type: "object", properties: { question: { type: "string" } }, required: ["question"] } },
  { name: "live", description: "Read a live source now: kind = tasks (what: cards) | finance (subscriptions, open-invoices) | calendar (today, range from/to) | mail (unread). Never copy these numbers into markdown.", inputSchema: { type: "object", properties: { kind: { type: "string" }, what: { type: "string" }, from: { type: "string" }, to: { type: "string" }, limit: { type: "number" } }, required: ["kind"] } },
  { name: "check", description: "Run the deterministic checks (stale pages, dead links, pipeline drift, copied figures, subscriptions vs accounts). Findings become inbox items.", inputSchema: { type: "object", properties: { live: { type: "boolean", default: true } } } },
  { name: "inbox_post", description: "Talk back to the human: post a question, proposal or finding to the inbox. The human replies there; approved items are executed by `brainlane inbox run`.", inputSchema: { type: "object", properties: { kind: { type: "string", enum: ["question", "proposal", "drift", "report"] }, title: { type: "string" }, body: { type: "string" }, action: { type: "object", description: "optional: {type: edit-markdown|set-frontmatter|move-file|agent, …}" } }, required: ["title", "body"] } },
  { name: "inbox_list", description: "List inbox items, optionally by status (open, approved, rejected, done, failed).", inputSchema: { type: "object", properties: { status: { type: "string" } } } },
  { name: "status", description: "What is in the brain: counts, sources, latest runs.", inputSchema: { type: "object", properties: {} } },
];

export async function callTool(ctx, db, name, args = {}) {
  switch (name) {
    case "search": return search(db, args.query, args.limit ?? 8);
    case "context": return context(db, ctx, args.account);
    case "ask": return ask(ctx, db, args.question, { askedBy: "agent" });
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
      if (method === "initialize") reply({ protocolVersion: params?.protocolVersion ?? "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "brainlane", version: "0.1.0" } });
      else if (method === "notifications/initialized" || method?.startsWith("notifications/")) { /* no reply */ }
      else if (method === "ping") reply({});
      else if (method === "tools/list") reply({ tools: TOOLS });
      else if (method === "tools/call") {
        try { reply({ content: [{ type: "text", text: JSON.stringify(await callTool(ctx, db, params.name, params.arguments ?? {}), null, 2) }] }); }
        catch (e) { reply({ content: [{ type: "text", text: `error: ${e.message}` }], isError: true }); }
      } else fail(-32601, `method not found: ${method}`);
    } catch (e) { fail(-32603, e.message); }
  });
  process.stderr.write(`brainlane mcp: serving ${ctx.root}\n`);
  return new Promise((resolve) => rl.on("close", resolve));
}
