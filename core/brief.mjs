/**
 * Answers, not pointers.
 *
 * `search` finds where something is mentioned. These functions say what is
 * going on: the status of one account in a few kilobytes, one line per open
 * account, or a canonical file by its short name. Nothing here calls a model —
 * every answer is read straight from the markdown and the index, so it comes
 * back in milliseconds and the agent that asked does the thinking.
 *
 * Sizes are capped on purpose. A status file can grow to twenty kilobytes over
 * a long deal; the first sections are what changed most recently, so those go
 * out by default and the headings of the rest say what else is there.
 */
import { readFile } from "node:fs/promises";
import { makeHelpers } from "./checks.mjs";
import { clean, frontmatter, sections, tableUnder, titleOf } from "./markdown.mjs";
import { slug } from "./markdown.mjs";

/** Files whose name says they are a contact moment, newest of which is "last contact". */
const CONTACT_PREFIXES = ["mail", "whatsapp", "transcript", "call", "gesprek", "review", "meeting", "notes"];

const folderName = (folder) => folder.split("/").pop();
const sideOf = (ctx, folder) => {
  const { root, sides } = ctx.config.accounts;
  const rest = folder.startsWith(root + "/") ? folder.slice(root.length + 1) : folder;
  const first = rest.split("/")[0];
  return sides.includes(first) ? first : null;
};

/** Every account folder the index knows about. */
export function accountFolders(ctx, db) {
  const seen = new Set();
  for (const r of db.prepare("SELECT path FROM documents WHERE kind = 'account'").all()) {
    const f = ctx.accountOf(r.path);
    if (f) seen.add(f);
  }
  return [...seen].sort();
}

/**
 * The folder for a loose reference: a full path, a folder name, or a few words
 * of the name ("harper", "northwind platform"). Every word must match; ties
 * go to the most recently touched folder. Returns null with candidates when
 * nothing matches, so the caller can say what it did find.
 */
export function resolveAccount(ctx, db, ref) {
  const folders = accountFolders(ctx, db);
  if (!ref) return { folder: null, candidates: [] };
  const rel = ref.replace(ctx.root + "/", "").replace(/\/$/, "");
  if (folders.includes(rel)) return { folder: rel, candidates: [] };
  const byName = folders.filter((f) => folderName(f) === rel);
  if (byName.length === 1) return { folder: byName[0], candidates: [] };
  const words = slug(rel).split("-").filter((w) => w.length >= 2 && !/^\d+$/.test(w));
  if (!words.length) return { folder: null, candidates: [] };
  const scored = folders
    .map((f) => ({ f, n: words.filter((w) => folderName(f).includes(w)).length }))
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n || touched(db, b.f) - touched(db, a.f));
  const top = scored[0];
  if (top && top.n === words.length) return { folder: top.f, candidates: [] };
  return { folder: null, candidates: scored.slice(0, 5).map((x) => x.f) };
}

function touched(db, folder) {
  const r = db.prepare("SELECT max(mtime) m FROM documents WHERE path LIKE ?").get(`${folder}/%`);
  return r?.m ? Date.parse(r.m) : 0;
}

/** The "ball with" line of a status file, without the label. */
export function ballOf(ctx, text) {
  const label = clean(ctx.config.accounts.ballLine ?? "");
  if (!label) return null;
  const line = text.split("\n").map(clean).find((l) => l.includes(label));
  if (!line) return null;
  return line.slice(line.indexOf(label) + label.length).replace(/^[:\s]+/, "").replace(/\*+$/, "").trim().slice(0, 160) || null;
}

/**
 * Leading sections of a body that fit in `maxChars`. The first always goes
 * whole; the section that does not fit is cut at a paragraph break rather than
 * skipped, because in a status file the newest section is the one that matters.
 */
function head(body, maxChars) {
  const secs = sections(body);
  const out = [];
  let used = 0, cut = false;
  for (const s of secs) {
    const text = s.lines.join("\n").trim();
    if (!text) continue;
    if (out.length && used + text.length > maxChars) {
      const room = maxChars - used;
      if (room > 200) {
        const slice = text.slice(0, room);
        const at = slice.lastIndexOf("\n\n");
        out.push((at > room / 2 ? slice.slice(0, at) : slice) + "\n…");
      }
      cut = true;
      break;
    }
    out.push(text);
    used += text.length + 1;
  }
  return { text: out.join("\n\n"), truncated: cut || out.length < secs.filter((s) => s.lines.join("").trim()).length };
}

/** "Status — Acme" and "STATUS: Acme" are titles; the label is not the name. */
const nameOf = (title) => title.replace(/^(status|stand)\s*[—–:-]\s*/i, "").trim();

/** Paragraphs under the log heading that name this account, newest first, trimmed. */
function logEntries(text, logHeading, needles, limit = 3) {
  if (!logHeading) return [];
  const sec = sections(text).find((s) => `${"#".repeat(s.level)} ${s.heading}` === logHeading);
  if (!sec) return [];
  const paras = sec.lines.join("\n").split(/\n\s*\n/).map((p) => p.trim()).filter((p) => /^\*\*\d{4}-\d\d-\d\d/.test(p));
  return paras.filter((p) => needles.some((n) => p.toLowerCase().includes(n))).slice(0, limit).map((p) => clean(p).slice(0, 320));
}

/** Words from a folder name that identify it in prose: "harper", "globex", not "2026" or "website". */
function needlesOf(folder) {
  return folderName(folder).split("-").filter((w) => w.length >= 4 && !/^\d+$/.test(w));
}

/**
 * What is going on with one account. Reads the status file, the pipeline row
 * and log lines about it, the open commitments, and the newest files in the
 * folder. One call, one answer, a few kilobytes.
 */
export async function account(ctx, db, ref, { maxChars = 3000, full = false } = {}) {
  const { folder, candidates } = resolveAccount(ctx, db, ref);
  if (!folder) return { error: `no account matching "${ref}"`, candidates };
  const a = ctx.config.accounts, p = ctx.config.pipeline;
  const statusPath = `${folder}/${a.statusFile}`;
  const raw = await readFile(ctx.path(statusPath), "utf8").catch(() => null);
  const { meta, body } = frontmatter(raw ?? "");
  const name = nameOf(raw ? titleOf(body, folderName(folder)) : folderName(folder));
  const status = raw
    ? (full ? { path: statusPath, text: body.trim(), truncated: false } : { path: statusPath, ...head(body, maxChars) })
    : { path: statusPath, text: null, truncated: false, missing: true };
  status.headings = raw ? sections(body).filter((s) => s.level >= 2).map((s) => ({ heading: s.heading, level: s.level, line: s.start })) : [];
  status.chars = raw ? body.length : 0;

  const docs = db.prepare("SELECT path, title, mtime FROM documents WHERE path LIKE ? ORDER BY mtime DESC").all(`${folder}/%`);
  const linked = db.prepare("SELECT d.path, d.title, d.mtime FROM relations r JOIN documents d ON d.path = r.from_path WHERE r.to_path = ? AND r.kind = 'belongs-to' ORDER BY d.mtime DESC").all(folder);
  const contacts = [...docs.filter((d) => CONTACT_PREFIXES.some((pfx) => folderName(d.path).toLowerCase().startsWith(pfx))), ...linked]
    .sort((x, y) => Date.parse(y.mtime) - Date.parse(x.mtime));
  const last = contacts[0] ?? null;

  const h = makeHelpers(ctx, db, []);
  const needles = needlesOf(folder).map((w) => w.toLowerCase());
  const leads = p?.leads ? await h.pipelineLeads() : [];
  const leadRow = leads.find((r) => h.matchFolder(clean(r[p.leads.who ?? "who"]), [folder]));
  const pipelineText = p?.file ? await h.read(p.file).catch(() => "") : "";
  const commitments = p?.commitments
    ? tableUnder(pipelineText, new RegExp(`^${p.commitments.heading}`, "i"), p.commitments.columns).filter((r) => h.matchFolder(clean(r[p.commitments.who ?? "who"]), [folder])).map((r) => Object.fromEntries(p.commitments.columns.map((c) => [c, clean(r[c])])))
    : [];

  return {
    account: folder,
    name,
    side: sideOf(ctx, folder),
    ball: raw ? ballOf(ctx, body) : null,
    status,
    pipeline: {
      lead: leadRow ? Object.fromEntries(p.leads.columns.map((c) => [c, clean(leadRow[c])])) : null,
      log: logEntries(pipelineText, p?.logHeading, needles),
    },
    commitments,
    lastContact: last ? { when: last.mtime, path: last.path, title: last.title } : null,
    recent: docs.slice(0, 5).map((d) => ({ title: d.title, path: d.path, mtime: d.mtime })),
    files: docs.length,
    transcripts: linked.length + docs.filter((d) => folderName(d.path).toLowerCase().startsWith("transcript")).length,
    meta,
  };
}

/**
 * One line per account: who, which side, who holds the ball, the next action
 * from the pipeline, when it was last touched. Open and won sides by default.
 * This is the index a reader scans before opening anything.
 */
export async function accounts(ctx, db, { side = null } = {}) {
  const a = ctx.config.accounts, p = ctx.config.pipeline;
  const wanted = side ? [side] : [...(a.openSides ?? []), ...(a.wonSides ?? [])];
  const folders = accountFolders(ctx, db).filter((f) => !wanted.length || wanted.includes(sideOf(ctx, f)));
  const h = makeHelpers(ctx, db, []);
  const leads = p?.leads ? await h.pipelineLeads() : [];
  const out = [];
  for (const folder of folders) {
    const raw = await readFile(ctx.path(`${folder}/${a.statusFile}`), "utf8").catch(() => null);
    const body = raw ? frontmatter(raw).body : "";
    const lead = leads.find((r) => h.matchFolder(clean(r[p.leads.who ?? "who"]), [folder]));
    const t = touched(db, folder);
    out.push({
      account: folder,
      name: nameOf(raw ? titleOf(body, folderName(folder)) : folderName(folder)).slice(0, 80),
      side: sideOf(ctx, folder),
      ball: raw ? (ballOf(ctx, body) ?? "").slice(0, 100) || null : null,
      stage: lead ? clean(lead.stage ?? "").slice(0, 80) : null,
      next: lead ? clean(lead[p.leads.action ?? "action"]).slice(0, 120) : null,
      lastTouch: t ? new Date(t).toISOString().slice(0, 10) : null,
    });
  }
  return out.sort((x, y) => (y.lastTouch ?? "").localeCompare(x.lastTouch ?? ""));
}

/**
 * A canonical file by its short name (`config.canon`: { pricing: "knowledge/pricing.md" }).
 * The one place a fact lives, returned whole or one section of it. No key
 * lists what there is, so an agent never has to guess a path.
 */
export async function canon(ctx, key, { section = null, maxChars = 12000 } = {}) {
  const map = ctx.config.canon ?? {};
  if (!key) return { keys: Object.entries(map).map(([k, v]) => ({ key: k, path: v })) };
  const rel = map[key];
  if (!rel) return { error: `no canon entry "${key}"`, keys: Object.keys(map) };
  const raw = await readFile(ctx.path(rel), "utf8").catch(() => null);
  if (raw == null) return { error: `${rel} not found`, key, path: rel };
  const { body } = frontmatter(raw);
  const secs = sections(body);
  let text = body.trim();
  let found = null;
  if (section) {
    const s = secs.find((x) => x.level && x.heading.toLowerCase().includes(section.toLowerCase()));
    if (!s) return { error: `no section matching "${section}" in ${rel}`, key, path: rel, headings: secs.filter((x) => x.level).map((x) => x.heading) };
    found = s.heading;
    text = s.lines.join("\n").trim();
  }
  const truncated = text.length > maxChars;
  return { key, path: rel, section: found, text: truncated ? text.slice(0, maxChars) + "\n…" : text, truncated, chars: text.length, headings: secs.filter((x) => x.level >= 2).map((x) => ({ heading: x.heading, level: x.level })) };
}
