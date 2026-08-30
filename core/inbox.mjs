// The inbox: the one place agents talk back and the human answers.
//
// Every item is a markdown file in <root>/<config.inbox.dir> (git-visible,
// works without any tool); SQLite indexes them for the dashboard and MCP.
// A reply is the trigger: `company-os inbox run` executes approved items and
// writes the result back into the same file. This is the only place the brain
// writes markdown, and only after a human said yes to that specific item.
// Outward actions (send, publish, invoice) are refused: those stay proposals
// a human executes.
//
//   ---
//   id: 2026-08-31-check-a1b2c3d4
//   kind: drift | proposal | link | question | report
//   from: check | compact | link | advisors | <agent>
//   where: sales-reviews/_pipeline/pipeline.md:3        # optional: what it is about
//   created: 2026-08-31T08:00:00Z
//   status: open | approved | rejected | done | failed
//   title: …
//   fingerprint: a1b2c3d4            # same finding twice → one item
//   action: {"type":"edit-markdown","file":"…","replace":[{"from":"…","to":"…"}]}
//   ---
//   body … / ## Reply … / ## Result …
import { mkdir, readdir, readFile, writeFile, rename } from "node:fs/promises";
import { join, dirname, resolve, sep } from "node:path";
import { frontmatter, setFrontmatter, hashOf } from "./markdown.mjs";
import { runAgent } from "./run.mjs";
import { languageName } from "./config.mjs";

/**
 * Does this read like an action aimed at the outside world?
 *
 * Two lines of defence, and this is the softer one. The hard one is that the
 * executor has no way to reach outside: the four action types only edit files
 * under the root, and the agent runs with Read/Edit/Write/Grep/Glob — no shell,
 * no network. This word list catches the case where the *instruction* asks for
 * something the human should do themselves, and it says so instead of quietly
 * doing half of it. Words come from the config so another language can add
 * its own ("verstuur", "factuur") without editing the engine.
 */
function looksOutward(ctx, text) {
  const words = ctx.config.inbox?.refuseWords ?? [];
  if (!words.length) return false;
  return new RegExp(`\\b(${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b`, "i").test(text);
}

export const inboxDir = (ctx) => ctx.path(ctx.config.inbox?.dir ?? "inbox");

export function parseItem(text, path) {
  const { meta, body } = frontmatter(text);
  let action = null;
  try { action = meta.action ? JSON.parse(meta.action) : null; } catch { action = { type: "invalid", raw: meta.action }; }
  const reply = body.split(/^## Reply\s*$/m)[1]?.split(/^## Result\s*$/m)[0]?.trim() ?? "";
  const result = body.split(/^## Result\s*$/m)[1]?.trim() ?? "";
  const description = body.split(/^## Reply\s*$/m)[0].trim();
  return { id: meta.id, kind: meta.kind, from: meta.from, created: meta.created, status: meta.status ?? "open", title: meta.title, where: meta.where ?? null, fingerprint: meta.fingerprint, action, description, reply, result, path };
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
export async function postItem(ctx, { kind = "report", from = "agent", title, body = "", action = null, fingerprint = null, where = null }) {
  if (!title) throw new Error("inbox: title required");
  const fp = fingerprint ?? hashOf(`${kind}|${from}|${title}`).slice(0, 8);
  const dir = inboxDir(ctx);
  await mkdir(dir, { recursive: true });
  // Every id ends in its fingerprint, so looking for the twin is a directory
  // listing plus at most one parse — not a read of the whole inbox per finding.
  for (const f of (await readdir(dir).catch(() => [])).filter((f) => f.endsWith(`-${fp}.md`))) {
    const it = parseItem(await readFile(join(dir, f), "utf8"), join(dir, f));
    if (it.fingerprint === fp && ["open", "approved", "rejected"].includes(it.status)) return { id: it.id, created: false, status: it.status };
  }
  const created = new Date().toISOString();
  const id = `${created.slice(0, 10)}-${from.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-${fp}`;
  const text = ["---", `id: ${id}`, `kind: ${kind}`, `from: ${from}`, `created: ${created}`, "status: open", `title: ${String(title).replace(/\n/g, " ")}`,
    where ? `where: ${where}` : null, `fingerprint: ${fp}`,
    action ? `action: ${JSON.stringify(action)}` : null, "---", "", body.trim(), "", "## Reply", "", ""].filter((l) => l !== null).join("\n");
  await writeFile(join(dir, `${id}.md`), text);
  return { id, created: true, status: "open" };
}

/**
 * Put a line under a heading, and make the heading if it is not there yet.
 * This existed three times in this file: twice for `## Result`, once for
 * `## Reply`, and that third one had already drifted on whitespace.
 */
function appendUnder(text, heading, line) {
  const re = new RegExp(`^## ${heading}\\s*$`, "m");
  return re.test(text)
    ? text.replace(new RegExp(`(^## ${heading}\\s*\\n)`, "m"), `$1\n${line}\n`)
    : `${text.trimEnd()}\n\n## ${heading}\n\n${line}\n`;
}

// An id comes from a URL or a tool argument. It names a file under inbox/ and
// nothing else: no slashes, no dots to climb with. The check is on the id and
// on the resolved path, so a clever encoding still cannot leave the folder.
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

async function itemFile(ctx, id) {
  const dir = resolve(inboxDir(ctx));
  const file = resolve(dir, `${id}.md`);
  if (!SAFE_ID.test(String(id)) || !file.startsWith(dir + sep)) throw new Error(`invalid inbox id: ${id}`);
  const text = await readFile(file, "utf8");
  return { file, text, item: parseItem(text, file) };
}

/** Add a reply and/or change the status. */
export async function reply(ctx, id, text = "", { status = null } = {}) {
  const { file, text: old } = await itemFile(ctx, id);
  let out = old;
  if (text) out = appendUnder(out, "Reply", `_${new Date().toISOString().slice(0, 16).replace("T", " ")}_ ${text.trim()}`);
  if (status) out = setFrontmatter(out, { status });
  await writeFile(file, out);
  return parseItem(out, file);
}

async function applyAction(ctx, item) {
  const a = item.action;
  const instruction = item.reply || a?.instruction || "";
  if (a?.outward || looksOutward(ctx, `${a?.type ?? ""} ${a?.instruction ?? ""} ${item.title}`) || (!a && looksOutward(ctx, instruction))) {
    return { ok: false, message: "refused: this looks like an outward action (send, publish, invoice). Do it by hand; the brain only edits its own files." };
  }
  if (!a) {
    // A report is what an agent found out, not something to carry out. Running
    // one used to fall through to "fix what this finding describes", which sent
    // an agent off to execute a summary — it refused, correctly, and the item
    // landed on failed after paying for the attempt. Say what to do instead.
    if (item.kind === "report" && !item.reply) {
      return { ok: false, skip: true, message: "a report is something to read, not to run — reply with what you want done and approve that, or reject to close it" };
    }
    // Approving a finding without typing anything means "yes, fix this". The
    // finding itself says what is wrong and where, so that is the instruction.
    return agentAction(ctx, item, instruction || `Fix what this finding describes. If it needs a decision only a human can make (which customer, which price, whether a lead is still alive), do not guess: say what you would need and stop.`);
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
    `Write in ${languageName(ctx.config.language)}. End with one line starting with "Done:" or "Not done:" and what changed, with file paths.`,
    "", `## Item: ${item.title}`, "", item.description, "", "## Instruction", "", instruction,
  ].join("\n");
  const r = await runAgent(ctx, prompt, { allowedTools: "Read,Edit,Write,Grep,Glob", addDir: ctx.root, model: ctx.config.agent.model, timeoutMs: 600000 });
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
    const stamp = `_${new Date().toISOString().slice(0, 16).replace("T", " ")}_ ${r.ok ? "✓" : r.skip ? "·" : "✗"} ${r.message}${r.cost ? ` ($${r.cost.toFixed(2)})` : ""}`;
    // `skip` is "there was nothing here to run", not "the run failed". Marking
    // that as failed reads like something broke, and closes an item that is
    // still waiting to be read.
    const status = r.skip ? "open" : r.ok ? "done" : "failed";
    await writeFile(file, setFrontmatter(appendUnder(text, "Result", stamp), { status }));
    out.push({ id: item.id, ...r });
  }
  return out;
}

/**
 * Close items whose finding no longer exists.
 *
 * A check that stops reporting something has answered its own item: the file
 * was fixed, the folder was made, the number was removed. Leaving it open makes
 * the inbox a graveyard, and you stop trusting the count.
 */
export async function resolveStale(ctx, from, liveFingerprints) {
  const live = new Set(liveFingerprints);
  const closed = [];
  for (const item of await listItems(ctx, { status: "open,approved" })) {
    if (item.from !== from || !item.fingerprint || live.has(item.fingerprint)) continue;
    const { file, text } = await itemFile(ctx, item.id);
    const stamp = `_${new Date().toISOString().slice(0, 16).replace("T", " ")}_ ✓ the check no longer reports this; closed on its own.`;
    await writeFile(file, setFrontmatter(appendUnder(text, "Result", stamp), { status: "done" }));
    closed.push(item.id);
  }
  return closed;
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
