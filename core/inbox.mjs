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
import { mkdir, readdir, readFile, writeFile, rename, stat, unlink } from "node:fs/promises";
import { join, dirname, basename, resolve, sep } from "node:path";
import { realpathSync } from "node:fs";
import { frontmatter, setFrontmatter, hashOf } from "./markdown.mjs";
import { runAgent } from "./run.mjs";
import { trashDraft } from "./actions.mjs";
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

/**
 * Would applyAction refuse this item as outward? One function, so the triage
 * queue can say "refused" before the human says yes, with the same rule.
 * `inward: true` is a check vouching for its own action: it reads a mail or a
 * recording and writes a status file, and the word "mail" in that sentence is
 * not a request to send one. The hard line stays: the executor cannot reach out.
 */
function refusedOutward(ctx, item) {
  const a = item.action;
  return !!(a?.outward || (!a?.inward && looksOutward(ctx, `${a?.type ?? ""} ${a?.instruction ?? ""} ${item.title}`)) || (!a && looksOutward(ctx, item.reply || "")));
}

export const inboxDir = (ctx) => ctx.path(ctx.config.inbox?.dir ?? "inbox");

export function parseItem(text, path) {
  const { meta, body } = frontmatter(text);
  let action = null;
  try { action = meta.action ? JSON.parse(meta.action) : null; } catch { action = { type: "invalid", raw: meta.action }; }
  const reply = body.split(/^## Reply\s*$/m)[1]?.split(/^## Result\s*$/m)[0]?.trim() ?? "";
  const result = body.split(/^## Result\s*$/m)[1]?.trim() ?? "";
  const description = body.split(/^## Reply\s*$/m)[0].trim();
  return { id: meta.id, kind: meta.kind, from: meta.from, created: meta.created, status: meta.status ?? "open", title: meta.title, where: meta.where ?? null, fingerprint: meta.fingerprint, later: meta.later ?? null, action, description, reply, result, path };
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

/** A dated line as the newest entry under a heading (made at the end if missing), without extra blank lines. */
function logLine(text, heading, line) {
  const re = new RegExp(`^## ${heading}[ \\t]*\\n(?:[ \\t]*\\n)*`, "m");
  return re.test(text) ? text.replace(re, (m) => `${m.replace(/\n+$/, "")}\n\n${line}\n`) : `${text.trimEnd()}\n\n## ${heading}\n\n${line}\n`;
}

/**
 * The newest line of the human's reply, without its timestamp. `reply()` puts
 * a new line at the top of the section, so the bottom line is the oldest one:
 * taking it meant a second reply (a note, then the answer) filed the note.
 * Stamped lines go by their stamp; a hand-typed file without stamps by its last line.
 */
function lastReplyLine(reply) {
  const lines = String(reply ?? "").split("\n").map((l) => l.trim()).filter(Boolean)
    .map((l) => ({ stamp: l.match(/^_(\d{4}-\d{2}-\d{2} \d{2}:\d{2})_/)?.[1] ?? null, text: l.replace(/^_[^_]*_\s*/, "").trim() })).filter((l) => l.text);
  const stamped = lines.filter((l) => l.stamp);
  if (stamped.length) return stamped.reduce((a, b) => (b.stamp > a.stamp ? b : a)).text;
  return lines.pop()?.text ?? "";
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
  if (refusedOutward(ctx, item)) {
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
      // A log line aimed at a status file that does not exist yet (a dossier
      // that never got its status file) used to fail with ENOENT after the
      // human had already approved. The file is inside the root and the line
      // is the human's own words, so create it, with a heading that names the
      // dossier so the file is not a bare "## Log".
      let created = false;
      let text = await readFile(file, "utf8").catch((e) => {
        if (e.code !== "ENOENT" || !(a.create || a.appendReply)) throw e;
        created = true;
        return a.appendReply ? `# STATUS — ${basename(dirname(file))}\n` : "";
      });
      for (const r of a.replace ?? []) {
        if (!text.includes(r.from)) return { ok: false, message: `text to replace not found in ${a.file}: ${r.from.slice(0, 60)}` };
        text = text.replace(r.from, r.to);
      }
      if (a.append) text = text.trimEnd() + "\n" + a.append + "\n";
      // A dated line under a heading the action names (`log: { under, line }`),
      // for a check that knows exactly what to file: "sent on 21-10, subject X".
      if (a.log?.line) text = logLine(text, a.log.under ?? "Log", a.log.line);
      // The human's reply is the line to write: "what came out of the call" goes
      // under the log heading as a dated entry, with whatever prefix the check
      // set ("- 2026-09-02 — Kickoff Harper: "). One sentence typed, one line filed.
      if (a.appendReply) {
        const line = lastReplyLine(item.reply);
        if (!line) return { ok: false, message: "no reply: reply with the line to write and approve" };
        text = appendUnder(text, a.under ?? "Log", `${a.prefix ?? `- ${new Date().toISOString().slice(0, 10)} — `}${line}`);
      }
      if (created) await mkdir(dirname(file), { recursive: true });
      await writeFile(file, text);
      return { ok: true, message: `${created ? "created" : "edited"} ${a.file}` };
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
    case "trash-draft": {
      // A draft that a later sent mail made obsolete, to Trash. The mail
      // connector refuses any mailbox but Drafts; this is not a send.
      const r = await trashDraft(ctx, { uid: a.uid, mailbox: a.mailbox, expect: a.expect });
      if (!r.ok) return { ok: false, message: `draft not moved: ${r.error}` };
      return { ok: true, message: `moved to ${r.draft.trash}: draft ${r.draft.date?.slice(0, 16) ?? ""} to ${r.draft.to ?? "?"} · "${r.draft.subject}" (${r.draft.via})`, trashed: { date: r.draft.date, to: r.draft.to, subject: r.draft.subject } };
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

/**
 * Claim an approved item before running it, so two runners (the dashboard's
 * "run all", `inbox run`, a triage answer, a second MCP call) never execute
 * the same item twice. The claim is a file created with `wx`, which only one
 * process can win. A claim older than `staleMs` is from a runner that died
 * (agent runs time out after ten minutes) and is taken over.
 */
async function claim(ctx, id, { staleMs = 30 * 60e3 } = {}) {
  const dir = join(inboxDir(ctx), ".claims");
  await mkdir(dir, { recursive: true });
  const file = join(dir, `${id}.claim`);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await writeFile(file, `${process.pid} ${new Date().toISOString()}\n`, { flag: "wx" });
      return { release: () => unlink(file).catch(() => {}) };
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
      const age = Date.now() - ((await stat(file).catch(() => null))?.mtimeMs ?? Date.now());
      if (age < staleMs) return null;
      await unlink(file).catch(() => {});
    }
  }
  return null;
}

/** Execute every approved item; write the result into the item. */
export async function runApproved(ctx, { only = null } = {}) {
  const out = [];
  for (const listed of await listItems(ctx, { status: "approved" })) {
    if (only && listed.id !== only) continue;
    const held = await claim(ctx, listed.id);
    if (!held) { out.push({ id: listed.id, ok: false, busy: true, message: "already running elsewhere" }); continue; }
    try {
      // Read again under the claim: another runner may have finished it
      // between our listing and our claim, and then it is no longer ours.
      const { item } = await itemFile(ctx, listed.id);
      if (item.status !== "approved") continue;
      out.push(await runOne(ctx, item));
    } finally { await held.release(); }
  }
  return out;
}

async function runOne(ctx, item) {
  let r;
  try { r = await applyAction(ctx, item); } catch (e) { r = { ok: false, message: e.message }; }
  const { file, text } = await itemFile(ctx, item.id);
  const stamp = `_${new Date().toISOString().slice(0, 16).replace("T", " ")}_ ${r.ok ? "✓" : r.skip ? "·" : "✗"} ${r.message}${r.cost ? ` ($${r.cost.toFixed(2)})` : ""}`;
  // `skip` is "there was nothing here to run", not "the run failed". Marking
  // that as failed reads like something broke, and closes an item that is
  // still waiting to be read.
  const status = r.skip ? "open" : r.ok ? "done" : "failed";
  await writeFile(file, setFrontmatter(appendUnder(text, "Result", stamp), { status }));
  return { id: item.id, ...r };
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

/**
 * Move finished items out of the way: `done` items not written to for `days` go to
 * `<inbox>/_done/<yyyy-mm>/`. The inbox folder is what every listing, the
 * dashboard and the twin lookup in postItem read, and after a few months it is
 * mostly history: thousands of files in one folder, and the index full of them.
 *
 * Only `done`. A `rejected` item is what keeps a finding silent (postItem looks
 * for its twin in the flat folder), so it stays; `open`, `approved` and
 * `failed` are still somebody's business. A `done` fingerprint is free by
 * design, so moving it changes nothing about what gets posted next.
 * `listItems` does not descend into `_done/`. Nothing is deleted.
 */
export async function archiveDone(ctx, { days = 14, now = Date.now() } = {}) {
  const dir = inboxDir(ctx);
  const cutoff = now - days * 864e5;
  const moved = [];
  for (const item of await listItems(ctx, { status: "done" })) {
    const t = item.created ? Date.parse(item.created) : NaN;
    if (!Number.isFinite(t)) continue;
    // Closed recently counts as recent: the last write is when it was closed,
    // and the dashboard shows what closed lately.
    const last = Math.max(t, (await stat(item.path).catch(() => null))?.mtimeMs ?? 0);
    if (last > cutoff) continue;
    const month = new Date(t).toISOString().slice(0, 7);
    const to = join(dir, "_done", month, basename(item.path));
    await mkdir(dirname(to), { recursive: true });
    await rename(item.path, to);
    moved.push(item.id);
  }
  return moved;
}

/**
 * Empty the inbox by hand: every open item is closed as `done`.
 *
 * Not `rejected`: a rejected finding is silenced for good (postItem finds its
 * twin and posts nothing), and one button must not mute a hundred findings.
 * `done` leaves the fingerprint free, so what is still true comes back with
 * the next check and what was only news does not. Approved items stay: they
 * are waiting to run, or running, and that is not this button's to decide.
 */
export async function clearOpen(ctx, { kind = null } = {}) {
  const closed = [];
  for (const item of await listItems(ctx, { status: "open" })) {
    if (kind && item.kind !== kind) continue;
    const { file, text } = await itemFile(ctx, item.id);
    const stamp = `_${new Date().toISOString().slice(0, 16).replace("T", " ")}_ ✓ cleared by hand; not rejected, so it can come back if it is still true.`;
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

/*
 * Triage: the inbox as a yes/no conversation.
 *
 * A list of a hundred items is a list nobody opens. The queue asks one thing
 * at a time, in the order where one answer clears the most: proposals that are
 * ready to run, then questions with a best guess, then findings, then the ones
 * that need typing, then reports. Near-identical items (same check, same kind
 * of action, nothing per-item to type) are one entry, so one answer covers the
 * group. Every entry says what yes, no and later do before anyone answers.
 *
 *   yes   = approve, and run it through runApproved (same executor, same refusals)
 *   no    = reject: the finding is silenced, as a reject always is
 *   later = leave it open; it skips the queue for `laterHours`
 *
 * Nothing here can do more than approving in the dashboard: an outward item is
 * shown as refused and a yes on it does nothing.
 */

const TIERS = ["ready", "candidate", "finding", "reply", "refused", "report"];

const oneLine = (s, n = 160) => { const t = String(s ?? "").replace(/\s+/g, " ").trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

/** The check that posted a finding, from the header line every check item starts with. */
export const checkOf = (item) => item.description?.match(/check `([^`]+)`/)?.[1] ?? null;

/** The candidates a question lists ("Candidates: `a` (…), `b` (…)"), best first. */
export function candidatesOf(item) {
  const line = item.description?.match(/^Candidates?:(.*)$/m)?.[1] ?? "";
  return [...line.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
}

/** Does approving need a value the human has to give (the reply is the value)? */
function needsValue(item) {
  const a = item.action;
  if (!a) return item.kind === "question";
  if (a.type === "edit-markdown") return !!a.appendReply;
  if (a.type === "set-frontmatter") return !a.fields && (a.value == null || a.value === "");
  return false;
}

/** Approving this starts an agent run (minutes, costs money), not a file edit. */
export const runsAgent = (item) => item.kind !== "report" && (!item.action || item.action.type === "agent");

/** What the item says beyond its title: the first lines that are not the check header. */
function detailOf(item) {
  const lines = String(item.description ?? "").split("\n").map((l) => l.replace(/^>\s?/, "").trim())
    .filter((l) => l && !/^\*\*\w+\*\* · check `/.test(l) && !/^Candidates?:/.test(l) && !/^Reply with /.test(l))
    // A check's title is its finding cut at 120 characters: the same line twice says nothing.
    .filter((l) => !String(item.title ?? "").startsWith(l.slice(0, 60)));
  return oneLine(lines.slice(0, 2).join(" — "), 280);
}

/** In words, what a yes does to this item. `value` is what the reply would be. */
function yesEffect(item, value = null) {
  const a = item.action;
  if (item.kind === "report") return "mark it read (done)";
  if (!a) return item.kind === "question"
    ? "an agent acts on your reply (files under the root only)"
    : "an agent fixes what the finding describes (files under the root only, no shell, no network; it stops when a human has to decide)";
  switch (a.type) {
    case "set-frontmatter": {
      const fields = a.fields ?? { [a.field]: a.value || value || "<your reply>" };
      return `set ${Object.entries(fields).map(([k, v]) => `${k}: ${v}`).join(", ")} in ${a.file}`;
    }
    case "edit-markdown": {
      const parts = [];
      if (a.replace?.length) parts.push(`replace ${a.replace.length} passage${a.replace.length === 1 ? "" : "s"}`);
      if (a.log?.line) parts.push(`log "${oneLine(a.log.line, 80)}"`);
      if (a.appendReply) parts.push("file your reply as a dated line");
      if (a.append) parts.push("append a line");
      return `${parts.join(", ") || "edit"} in ${a.file}`;
    }
    case "move-file": return `move ${a.from} → ${a.to}`;
    case "trash-draft": return `move the draft${a.expect?.subject ? ` "${oneLine(a.expect.subject, 60)}"` : ""} to Trash (not deleted)`;
    case "agent": return `an agent does: ${oneLine(a.instruction, 160)}`;
    default: return `nothing: unknown action type ${a.type}, approving will fail`;
  }
}

function classify(ctx, item) {
  const candidates = candidatesOf(item);
  if (item.kind === "report") return { tier: "report", candidates };
  if (refusedOutward(ctx, item)) return { tier: "refused", candidates };
  if (needsValue(item)) return { tier: candidates.length && item.action ? "candidate" : "reply", candidates };
  // Ready: a proposal with an action, or any finding whose action is a file
  // edit the engine does itself (no agent, nothing to type).
  if (item.action && (item.kind === "proposal" || item.action.type !== "agent")) return { tier: "ready", candidates };
  return { tier: "finding", candidates };
}

/**
 * The key that makes items one entry. Only items whose yes does the same kind
 * of thing without anything per item to type: a question waiting for a typed
 * answer, or a refused item, stands alone. Questions with a best guess group
 * by that guess ("these 9 recordings → account X"), never across guesses.
 */
function groupKey(item, c) {
  const check = checkOf(item);
  if (c.tier === "reply" || c.tier === "refused") return `one|${item.id}`;
  if (c.tier === "report") return `report|${item.from}|${check ?? ""}`;
  if (c.tier === "candidate") return `cand|${item.from}|${item.action.type}|${item.action.field ?? ""}|${c.candidates[0]}`;
  if (!check && item.from !== "check") return `one|${item.id}`;
  return `${c.tier}|${item.from}|${check ?? ""}|${item.kind}|${item.action?.type ?? "none"}`;
}

function entryFor(members) {
  const [first] = members;
  const { tier, candidates } = first.c;
  const candidate = tier === "candidate" ? candidates[0] : null;
  const group = members.length > 1;
  const ids = members.map((m) => m.item.id);
  const check = checkOf(first.item);
  const source = check ? `check \`${check}\`` : first.item.from;
  const title = oneLine(first.item.title, 140);
  // The title is the finding as the check wrote it, often cut mid-quote, so the
  // ask goes after a dash instead of a question mark glued to its last word.
  const verb = first.item.action && first.item.action.type !== "agent" ? "apply" : "fix it";
  const ask = (t, v) => (/[?]$/.test(t) ? t : `${t} — ${v}?`);
  let question;
  if (tier === "report") question = group ? `${members.length} reports from ${source}, newest: ${title}. Mark them read?` : `Report: ${title}. Mark it read?`;
  else if (tier === "candidate") question = group ? `${members.length} × ${oneLine(first.item.title, 80).replace(/\?$/, "")} (${source}) — all \`${candidate}\`?` : `${oneLine(first.item.title, 100).replace(/\?$/, "")} — \`${candidate}\`?`;
  else if (tier === "refused") question = `${title} (refused: outward, do it by hand). Close it?`;
  else if (tier === "reply") question = ask(title, "your answer");
  else question = group ? `${members.length} similar from ${source}: ${title} (and ${members.length - 1} more) — ${verb === "apply" ? "apply all" : "yes to all"}?` : ask(title, verb);
  const yes = tier === "refused" ? "nothing: this looks outward (send, publish, invoice) and the brain refuses it; say no to close it"
    : tier === "reply" ? `needs a reply first: ${yesEffect(first.item)}`
    : group ? `for each of the ${members.length}: ${first.item.action?.file ? yesEffect(first.item, candidate).replaceAll(first.item.action.file, "its file") : yesEffect(first.item, candidate)}${runsAgent(first.item) ? ` (${members.length} agent runs)` : ""}`
    : yesEffect(first.item, candidate);
  const filing = first.item.kind === "question" && first.item.action?.type === "set-frontmatter";
  const no = tier === "report" ? "close it as rejected" : filing ? "reject: the question is silenced and the file stays unlinked; reply `none` with yes instead to file it as not an account" : "reject: silenced, the same finding does not come back";
  return {
    ref: group ? `g-${hashOf(ids.slice().sort().join("|")).slice(0, 10)}` : first.item.id,
    group, size: members.length, ids, tier, kind: first.item.kind, from: first.item.from, check,
    question, detail: group ? null : detailOf(first.item),
    candidate, candidates: group ? [] : candidates,
    default: ["reply", "refused"].includes(tier) ? "later" : "yes",
    needsReply: tier === "reply", agent: runsAgent(first.item),
    yes, no, later: "leave it open; it skips the queue for a while",
    items: members.map(({ item }) => ({ id: item.id, title: oneLine(item.title, 140), where: item.where, created: item.created, detail: group ? detailOf(item) : undefined })),
  };
}

/**
 * The open items as a queue of yes/no questions, the ones one answer clears
 * most of first. `reports: false` leaves reports out (they expire on their
 * own). An item answered `later` stays out for `laterHours` unless
 * `includeLater`. Returns the queue and the counts of what is left.
 */
export async function triageQueue(ctx, { reports = true, includeLater = false, laterHours = 12, now = Date.now(), items = null } = {}) {
  const open = (items ?? await listItems(ctx, { status: "open" })).filter((i) => i.status === "open");
  const snoozed = (i) => i.later && now - Date.parse(i.later) < laterHours * 36e5;
  const groups = new Map();
  let later = 0, skippedReports = 0;
  for (const item of open) {
    if (!includeLater && snoozed(item)) { later++; continue; }
    const c = classify(ctx, item);
    if (c.tier === "report" && !reports) { skippedReports++; continue; }
    const key = groupKey(item, c);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ item, c });
  }
  const queue = [...groups.values()].map((m) => entryFor(m.sort((a, b) => String(a.item.created).localeCompare(String(b.item.created)))));
  queue.sort((a, b) => (TIERS.indexOf(a.tier) - TIERS.indexOf(b.tier)) || (b.size - a.size) || String(a.items[0].created).localeCompare(String(b.items[0].created)));
  const byTier = Object.fromEntries(TIERS.map((t) => [t, queue.filter((e) => e.tier === t).reduce((n, e) => n + e.size, 0)]).filter(([, n]) => n));
  return { queue, counts: { questions: queue.length, items: queue.reduce((n, e) => n + e.size, 0), open: open.length, later, reports: skippedReports, byTier } };
}

/** The next question, and how many are left. */
export async function triageNext(ctx, opts = {}) {
  const { queue, counts } = await triageQueue(ctx, opts);
  return { next: queue[0] ?? null, left: counts };
}

/**
 * Answer one entry: `ref` is an item id or a group ref from the queue. A group
 * ref is the hash of exactly the ids that were shown, so if the group changed
 * since (a new item joined, one closed) the answer is refused rather than
 * applied to items nobody saw. An item id inside a group answers that item only.
 *
 * `reply` is optional text. On yes it is the value (an account path instead
 * of the guess, the line to file) or steers the agent; on no and later it is
 * kept as a note. `run`: true runs approved items now, "files" runs only the
 * ones that edit files and leaves agent runs approved, false only approves.
 */
export async function triageAnswer(ctx, { ref, answer, reply: text = "", run = true, now = Date.now() } = {}) {
  if (!["yes", "no", "later"].includes(answer)) throw new Error(`answer must be yes, no or later, not ${answer}`);
  if (!ref) throw new Error("ref required: an item id or a group ref from inbox_next");
  const open = await listItems(ctx, { status: "open" });
  // The queue as it was shown (without snoozed items) first, then with them:
  // a group whose member was put off by its own id hashes differently in each.
  let entry = null;
  for (const includeLater of [false, true]) {
    entry ??= (await triageQueue(ctx, { includeLater, items: open, now })).queue.find((e) => e.ref === ref) ?? null;
  }
  if (!entry && !String(ref).startsWith("g-")) {
    const item = open.find((i) => i.id === ref);
    if (item) entry = entryFor([{ item, c: classify(ctx, item) }]);
  }
  if (!entry) throw new Error(String(ref).startsWith("g-") ? `group ${ref} changed or is gone — ask for the next question again` : `no open item ${ref}`);
  text = String(text ?? "").trim();
  const results = [];
  for (const id of entry.ids) {
    const item = open.find((i) => i.id === id);
    if (answer === "later") {
      const { file, text: old } = await itemFile(ctx, id);
      let out = setFrontmatter(old, { later: new Date(now).toISOString() });
      if (text) out = appendUnder(out, "Reply", `_${new Date(now).toISOString().slice(0, 16).replace("T", " ")}_ ${text}`);
      await writeFile(file, out);
      results.push({ id, status: "open", ok: true, message: "left open" });
    } else if (answer === "no") {
      const r = await reply(ctx, id, text, { status: "rejected" });
      results.push({ id, status: r.status, ok: true, message: "rejected" });
    } else if (entry.tier === "report") {
      const r = await reply(ctx, id, text, { status: "done" });
      results.push({ id, status: r.status, ok: true, message: "read" });
    } else if (entry.tier === "refused") {
      results.push({ id, status: "open", ok: false, message: "refused: this looks outward; do it by hand, or answer no to close it" });
    } else {
      const value = text || entry.candidate || "";
      if (entry.needsReply && !value) { results.push({ id, status: "open", ok: false, message: `needs a reply: ${yesEffect(item)}` }); continue; }
      await reply(ctx, id, value, { status: "approved" });
      if (run === true || (run === "files" && !runsAgent(item))) {
        const [r] = await runApproved(ctx, { only: id });
        if (!r || r.busy) { const now2 = (await itemFile(ctx, id)).item.status; results.push({ id, status: now2, ok: true, message: r?.message ?? `already ${now2}` }); continue; }
        const status = r.skip ? "open" : r.ok ? "done" : "failed";
        results.push({ id, status, ok: !!r.ok, message: r.message ?? "nothing ran", ...(r.cost ? { cost: r.cost } : {}) });
      } else results.push({ id, status: "approved", ok: true, message: runsAgent(item) ? "approved; the agent run is left for `inbox run`" : "approved, not run yet" });
    }
  }
  const { queue, counts } = await triageQueue(ctx, { now });
  return { ref, answer, results, next: queue[0] ?? null, left: counts };
}
