/**
 * The inbox: the one place agents talk back and the human answers.
 *
 * Every item is a markdown file in <root>/<config.inbox.dir> (git-visible,
 * works without any tool); SQLite indexes them for the dashboard and MCP.
 * Approval is the trigger: the dashboard runs an approved item at once; from
 * the CLI or MCP, `company-os inbox run` executes what is approved. Either way
 * the result is written back into the same file. This is the only place the brain
 * writes markdown, and only after a human said yes to that specific item.
 * Outward actions (send, publish, invoice) are refused: those stay proposals
 * a human executes.
 *
 *   ---
 *   id: 2026-08-31-check-a1b2c3d4
 *   kind: drift | proposal | question | report
 *   from: check | compact | link | agent | cli | <role>
 *   where: sales-reviews/_pipeline/pipeline.md:3        # optional: what it is about
 *   created: 2026-08-31T08:00:00Z
 *   status: open | approved | rejected | done | failed
 *   title: …
 *   fingerprint: a1b2c3d4            # same finding twice → one item
 *   action: {"type":"edit-markdown","file":"…","replace":[{"from":"…","to":"…"}]}
 *   ---
 *   body … / ## Reply … / ## Result …
 */
import { mkdir, readdir, readFile, writeFile, rename } from "node:fs/promises";
import { join, dirname, basename, resolve, sep } from "node:path";
import { realpathSync } from "node:fs";
import { frontmatter, setFrontmatter, hashOf } from "./markdown.mjs";
import { runAgent } from "./run.mjs";
import { languageName } from "./config.mjs";

/**
 * Does this read like an action aimed at the outside world?
 *
 * Two lines of defence, and this is the softer one. The hard one is that the
 * executor has no way to reach outside: the four action types only edit files
 * under the root (`inside()` refuses any other path), and the agent runs with
 * Read/Edit/Write/Grep/Glob — no shell, no network. This word list catches the case where the *instruction* asks for
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
    if (it.fingerprint !== fp || !["open", "approved", "rejected"].includes(it.status)) continue;
    // The same finding, but the check learned to say what approving does: the
    // open item takes the new kind, action and text, and keeps its replies.
    if (it.status === "open" && (it.kind !== kind || JSON.stringify(it.action) !== JSON.stringify(action) || it.description !== body.trim())) {
      const text = await readFile(join(dir, f), "utf8");
      const tail = text.slice(text.search(/^## Reply\s*$/m));
      const head = ["---", `id: ${it.id}`, `kind: ${kind}`, `from: ${it.from}`, `created: ${it.created}`, "status: open", `title: ${String(title).replace(/\n/g, " ")}`,
        where ?? it.where ? `where: ${where ?? it.where}` : null, `fingerprint: ${fp}`, action ? `action: ${JSON.stringify(action)}` : null, "---", "", body.trim(), ""].filter((l) => l !== null).join("\n");
      await writeFile(join(dir, f), `${head}\n${tail.startsWith("## Reply") ? tail : `## Reply\n\n${tail}`}`);
      return { id: it.id, created: false, updated: true, status: "open" };
    }
    return { id: it.id, created: false, status: it.status };
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

/** The newest line of the human's reply, without its timestamp. */
function lastReplyLine(reply) {
  return String(reply ?? "").split("\n").map((l) => l.replace(/^_[^_]*_\s*/, "").trim()).filter(Boolean).pop() ?? "";
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

/**
 * A path from an action, resolved against the root; anything outside it is
 * refused. Real paths on both sides, because `resolve()` does not follow
 * symlinks: a link inside the vault pointing out of it would otherwise pass.
 */
function inside(ctx, rel) {
  const file = resolve(ctx.path(String(rel ?? "")));
  let real = file;
  try { real = realpathSync(file); } catch { try { real = join(realpathSync(dirname(file)), basename(file)); } catch {} }
  const root = realpathSync(ctx.root);
  if (real !== root && !real.startsWith(root + sep)) throw new Error(`refused: ${rel} is outside the root`);
  return file;
}

async function applyAction(ctx, item) {
  const a = item.action;
  const instruction = item.reply || a?.instruction || "";
  // `inward: true` is a check vouching for its own action: it reads a mail or a
  // recording and writes a status file, and the word "mail" in that sentence is
  // not a request to send one. The hard line stays: the executor cannot reach out.
  if (a?.outward || (!a?.inward && looksOutward(ctx, `${a?.type ?? ""} ${a?.instruction ?? ""} ${item.title}`)) || (!a && looksOutward(ctx, instruction))) {
    return { ok: false, message: "refused: this looks like an outward action (send, publish, invoice). Do it by hand; the brain only edits its own files." };
  }
  if (!a) {
    // A question with no action and no reply has nothing to run either.
    if (item.kind === "question" && !item.reply) {
      return { ok: false, skip: true, message: "a question waits for a reply — reply with the answer and approve that" };
    }
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
      const file = inside(ctx, a.file);
      let text = await readFile(file, "utf8").catch((e) => { if (e.code === "ENOENT" && a.create) return ""; throw e; });
      for (const r of a.replace ?? []) {
        if (!text.includes(r.from)) return { ok: false, message: `text to replace not found in ${a.file}: ${r.from.slice(0, 60)}` };
        text = text.replace(r.from, r.to);
      }
      if (a.append) text = text.trimEnd() + "\n" + a.append + "\n";
      // The human's reply is the line to write: "what came out of the call" goes
      // under the log heading as a dated entry, with whatever prefix the check
      // set ("- 2026-09-02 — Kickoff Harper: "). One sentence typed, one line filed.
      if (a.appendReply) {
        const line = lastReplyLine(item.reply);
        if (!line) return { ok: false, message: "no reply: reply with the line to write and approve" };
        text = appendUnder(text, a.under ?? "Log", `${a.prefix ?? `- ${new Date().toISOString().slice(0, 10)} — `}${line}`);
      }
      if (a.create) await mkdir(dirname(file), { recursive: true });
      await writeFile(file, text);
      return { ok: true, message: `edited ${a.file}` };
    }
    case "set-frontmatter": {
      const file = inside(ctx, a.file);
      const text = await readFile(file, "utf8");
      const fields = a.fields ?? { [a.field]: a.value ?? lastReplyLine(item.reply) };
      if (Object.values(fields).some((v) => !v)) return { ok: false, message: "no value: reply with the value to set" };
      const out = setFrontmatter(text, fields);
      if (!out) return { ok: false, message: `${a.file} has no frontmatter` };
      await writeFile(file, out);
      return { ok: true, message: `set ${Object.entries(fields).map(([k, v]) => `${k}: ${v}`).join(", ")} in ${a.file}` };
    }
    case "move-file": {
      const from = inside(ctx, a.from), to = inside(ctx, a.to);
      await mkdir(dirname(to), { recursive: true });
      await rename(from, to);
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
export async function resolveStale(ctx, from, liveFingerprints, { within = null } = {}) {
  const live = new Set(liveFingerprints);
  const closed = [];
  for (const item of await listItems(ctx, { status: "open,approved" })) {
    // A report is news, not a finding; it expires by itself (expireReports).
    if (item.from !== from || item.kind === "report" || !item.fingerprint || live.has(item.fingerprint)) continue;
    const { file, text } = await itemFile(ctx, item.id);
    // A partial run (`check --only a,b`) knows nothing about the findings of
    // the checks it did not run; those stay open until their own check runs.
    if (within && !within(item, text)) continue;
    const stamp = `_${new Date().toISOString().slice(0, 16).replace("T", " ")}_ ✓ the check no longer reports this; closed on its own.`;
    await writeFile(file, setFrontmatter(appendUnder(text, "Result", stamp), { status: "done" }));
    closed.push(item.id);
  }
  return closed;
}

/**
 * A report is something to read, and reading has a window. One that sat open
 * for a week was either seen and left, or not worth seeing; both mean closed.
 * Without this the inbox grows a tail of finished news and the count stops
 * meaning "waiting for you". Runs with the checks, like resolveStale.
 */
export async function expireReports(ctx, { days = 7 } = {}) {
  const cutoff = Date.now() - days * 864e5;
  const closed = [];
  for (const item of await listItems(ctx, { status: "open" })) {
    if (item.kind !== "report" || !item.created || new Date(item.created).getTime() > cutoff) continue;
    const { file, text } = await itemFile(ctx, item.id);
    const stamp = `_${new Date().toISOString().slice(0, 16).replace("T", " ")}_ ✓ open for ${days} days; a report expires on its own.`;
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
