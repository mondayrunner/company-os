// The inbox: the one place agents talk back and the human answers.
//
// Every item is a markdown file in <root>/<config.inbox.dir> (git-visible,
// works without any tool); SQLite indexes them for the dashboard and MCP.
// A reply is the trigger: `brainlane inbox run` executes approved items and
// writes the result back into the same file. This is the only place the brain
// writes markdown, and only after a human said yes to that specific item.
// Outward actions (send, publish, invoice) are refused: those stay proposals
// a human executes.
//
//   ---
//   id: 2026-08-31-check-a1b2c3d4
//   kind: drift | proposal | link | question | report
//   from: check | compact | link | advisors | <agent>
//   created: 2026-08-31T08:00:00Z
//   status: open | approved | rejected | done | failed
//   title: …
//   fingerprint: a1b2c3d4            # same finding twice → one item
//   action: {"type":"edit-markdown","file":"…","replace":[{"from":"…","to":"…"}]}
//   ---
//   body … / ## Reply … / ## Result …
import { mkdir, readdir, readFile, writeFile, rename } from "node:fs/promises";
import { join, dirname } from "node:path";
import { frontmatter, setFrontmatter, hashOf } from "./markdown.mjs";
import { runAgent } from "./run.mjs";

const OUTWARD = /\b(send|mail|e-?mail|publish|post to|invoice|factuur|verstuur|verzend|publiceer|tweet|linkedin post|payment|betaling)\b/i;

export const inboxDir = (ctx) => ctx.path(ctx.config.inbox?.dir ?? "inbox");

export function parseItem(text, path) {
  const { meta, body } = frontmatter(text);
  let action = null;
  try { action = meta.action ? JSON.parse(meta.action) : null; } catch { action = { type: "invalid", raw: meta.action }; }
  const reply = body.split(/^## Reply\s*$/m)[1]?.split(/^## Result\s*$/m)[0]?.trim() ?? "";
  const result = body.split(/^## Result\s*$/m)[1]?.trim() ?? "";
  const description = body.split(/^## Reply\s*$/m)[0].trim();
  return { id: meta.id, kind: meta.kind, from: meta.from, created: meta.created, status: meta.status ?? "open", title: meta.title, fingerprint: meta.fingerprint, action, description, reply, result, path };
}

export async function listItems(ctx, { status = null } = {}) {
  const dir = inboxDir(ctx);
  let files = [];
  try { files = (await readdir(dir)).filter((f) => f.endsWith(".md")).sort().reverse(); } catch { return []; }
  const items = [];
  for (const f of files) {
    const it = parseItem(await readFile(join(dir, f), "utf8"), join(dir, f));
    if (!status || status.split(",").includes(it.status)) items.push(it);
  }
  return items;
}

/** Post an item. Same fingerprint already open, approved or rejected → not posted again. */
export async function postItem(ctx, { kind = "report", from = "agent", title, body = "", action = null, fingerprint = null }) {
  if (!title) throw new Error("inbox: title required");
  const fp = fingerprint ?? hashOf(`${kind}|${from}|${title}`).slice(0, 8);
  const existing = (await listItems(ctx)).find((i) => i.fingerprint === fp && ["open", "approved", "rejected"].includes(i.status));
  if (existing) return { id: existing.id, created: false, status: existing.status };
  const dir = inboxDir(ctx);
  await mkdir(dir, { recursive: true });
  const created = new Date().toISOString();
  const id = `${created.slice(0, 10)}-${from.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-${fp}`;
  const text = ["---", `id: ${id}`, `kind: ${kind}`, `from: ${from}`, `created: ${created}`, "status: open", `title: ${String(title).replace(/\n/g, " ")}`, `fingerprint: ${fp}`,
    action ? `action: ${JSON.stringify(action)}` : null, "---", "", body.trim(), "", "## Reply", "", ""].filter((l) => l !== null).join("\n");
  await writeFile(join(dir, `${id}.md`), text);
  return { id, created: true, status: "open" };
}

async function itemFile(ctx, id) {
  const file = join(inboxDir(ctx), `${id}.md`);
  const text = await readFile(file, "utf8");
  return { file, text, item: parseItem(text, file) };
}

/** Add a reply and/or change the status. */
export async function reply(ctx, id, text = "", { status = null } = {}) {
  const { file, text: old } = await itemFile(ctx, id);
  let out = old;
  if (text) {
    const stamp = `_${new Date().toISOString().slice(0, 16).replace("T", " ")}_ ${text.trim()}`;
    out = /^## Reply\s*$/m.test(out) ? out.replace(/(^## Reply\s*\n)/m, `$1\n${stamp}\n`) : `${out.trimEnd()}\n\n## Reply\n\n${stamp}\n`;
  }
  if (status) out = setFrontmatter(out, { status });
  await writeFile(file, out);
  return parseItem(out, file);
}

async function applyAction(ctx, item) {
  const a = item.action;
  const instruction = item.reply || a?.instruction || "";
  if (a?.outward || OUTWARD.test(`${a?.type ?? ""} ${a?.instruction ?? ""} ${item.title}`) || (!a && OUTWARD.test(instruction))) {
    return { ok: false, message: "refused: this looks like an outward action (send, publish, invoice). Do it by hand; the brain only edits its own files." };
  }
  if (!a) {
    if (!instruction) return { ok: false, message: "no action and no reply to act on" };
    return agentAction(ctx, item, instruction);
  }
  switch (a.type) {
    case "edit-markdown": {
      const file = ctx.path(a.file);
      let text = await readFile(file, "utf8");
      for (const r of a.replace ?? []) {
        if (!text.includes(r.from)) return { ok: false, message: `text to replace not found in ${a.file}: ${r.from.slice(0, 60)}` };
        text = text.replace(r.from, r.to);
      }
      if (a.append) text = text.trimEnd() + "\n" + a.append + "\n";
      await writeFile(file, text);
      return { ok: true, message: `edited ${a.file}` };
    }
    case "set-frontmatter": {
      const file = ctx.path(a.file);
      const text = await readFile(file, "utf8");
      const fields = a.fields ?? { [a.field]: a.value ?? item.reply.split("\n").pop().replace(/^_[^_]*_\s*/, "").trim() };
      if (Object.values(fields).some((v) => !v)) return { ok: false, message: "no value: reply with the value to set" };
      const out = setFrontmatter(text, fields);
      if (!out) return { ok: false, message: `${a.file} has no frontmatter` };
      await writeFile(file, out);
      return { ok: true, message: `set ${Object.entries(fields).map(([k, v]) => `${k}: ${v}`).join(", ")} in ${a.file}` };
    }
    case "move-file": {
      await mkdir(dirname(ctx.path(a.to)), { recursive: true });
      await rename(ctx.path(a.from), ctx.path(a.to));
      return { ok: true, message: `moved ${a.from} → ${a.to}` };
    }
    case "agent": return agentAction(ctx, item, [a.instruction, item.reply].filter(Boolean).join("\n\nReply from the human:\n"));
    default: return { ok: false, message: `unknown action type ${a.type}` };
  }
}

async function agentAction(ctx, item, instruction) {
  const prompt = [
    `You execute one approved inbox item inside the company brain at ${ctx.root}. Do exactly what the item and the human's reply ask, nothing more. You may read and edit files under the root. Never send, publish or invoice anything; if the task needs that, stop and say so.`,
    `Write in ${ctx.config.language === "nl" ? "Dutch" : "English"}. End with one line starting with "Done:" or "Not done:" and what changed, with file paths.`,
    "", `## Item: ${item.title}`, "", item.description, "", "## Instruction", "", instruction,
  ].join("\n");
  const r = await runAgent(ctx, prompt, { allowedTools: "Read,Edit,Write,Grep,Glob", addDir: ctx.root, model: ctx.config.ask.agentModel ?? ctx.config.ask.model, timeoutMs: 600000 });
  return { ok: !/^not done/im.test(r.result.slice(-400)), message: r.result.slice(-1200), cost: r.cost };
}

/** Execute every approved item; write the result into the item. */
export async function runApproved(ctx, { only = null } = {}) {
  const out = [];
  for (const item of await listItems(ctx, { status: "approved" })) {
    if (only && item.id !== only) continue;
    let r;
    try { r = await applyAction(ctx, item); } catch (e) { r = { ok: false, message: e.message }; }
    const { file, text } = await itemFile(ctx, item.id);
    const stamp = `_${new Date().toISOString().slice(0, 16).replace("T", " ")}_ ${r.ok ? "✓" : "✗"} ${r.message}${r.cost ? ` ($${r.cost.toFixed(2)})` : ""}`;
    const withResult = /^## Result\s*$/m.test(text) ? text.replace(/(^## Result\s*\n)/m, `$1\n${stamp}\n`) : `${text.trimEnd()}\n\n## Result\n\n${stamp}\n`;
    await writeFile(file, setFrontmatter(withResult, { status: r.ok ? "done" : "failed" }));
    out.push({ id: item.id, ...r });
  }
  return out;
}

/** Mirror the inbox folder into the `inbox` table. */
export async function indexInbox(ctx, db) {
  const items = await listItems(ctx);
  const up = db.prepare(`INSERT INTO inbox (id, path, kind, sender, created, status, title, action, updated) VALUES (?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET status=excluded.status, title=excluded.title, action=excluded.action, updated=excluded.updated`);
  const seen = new Set();
  for (const i of items) { up.run(i.id, ctx.short(i.path), i.kind, i.from, i.created, i.status, i.title, i.action ? JSON.stringify(i.action) : null, new Date().toISOString()); seen.add(i.id); }
  for (const r of db.prepare("SELECT id FROM inbox").all()) if (!seen.has(r.id)) db.prepare("DELETE FROM inbox WHERE id = ?").run(r.id);
  return { items: items.length, open: items.filter((i) => i.status === "open").length };
}
