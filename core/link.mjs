// `company-os link`: attach transcripts waiting in the inbox folder to an
// account without a human, where that is safe. Deliberately conservative:
//   1. Two or more distinct names from one account in the text, and that score
//      is at least twice the runner-up → set `account:` plus a marker.
//   1b. One hit is enough when it is a strong name (a company name from an
//      account folder or a system of record, 5+ chars): "andeweg" is
//      unambiguous, "david" is not.
//   2. No account name at all and it is a dictation into an editor/terminal →
//      `account: internal` (own thinking, no customer).
//   3. Everything in between stays open, with a proposal for the human.
// Reversible: the marker `linked_by: company-os link` sits in the frontmatter;
// a human simply overwrites the line.
//
// `--smart` adds one headless agent run over what is still open; only "high"
// confidence is applied, "medium" becomes a proposal.
//
// The name index comes from `config.link.namesModule`, a module exporting
// `names()` → Map<key, { name, accounts: Set<string>, sources: Set<string> }>.
import { readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { frontmatter, setFrontmatter, hashOf } from "./markdown.mjs";
const hashPart = (s) => hashOf(s).slice(0, 7);
import { runAgent, fill } from "./run.mjs";
import { languageName } from "./ask.mjs";
import { postItem } from "./inbox.mjs";

const PROMPTS = join(dirname(fileURLToPath(import.meta.url)), "..", "prompts");
const MARKER = "company-os link";
const STRONG_SOURCES = new Set(["account-folder", "finance", "tasks", "klantmap", "stripe", "trello"]);
const WEAK_ONLY = ["pipeline", "calendar", "pijplijn", "cal.com"];

export async function loadNames(ctx) {
  const mod = ctx.config.link.namesModule;
  if (!mod) return new Map();
  const m = await import(pathToFileURL(ctx.path(mod)).href);
  const fn = m.names ?? m.default;
  return (await fn(ctx)) ?? new Map();
}

function isLinked(meta, ctx) {
  const a = ctx.fm(meta, "account");
  return a && String(a).trim() && !(Array.isArray(a) && !a.length);
}

function scoreAccounts(text, index) {
  const t = text.toLowerCase();
  const per = new Map();
  for (const v of index.values()) {
    const n = String(v.name ?? "").toLowerCase().trim();
    if (n.length < 4 || !(v.accounts?.size)) continue;
    const sources = v.sources ?? new Set();
    const strong = n.length >= 5 && [...sources].some((s) => STRONG_SOURCES.has(s)) && !WEAK_ONLY.every((s) => sources.has(s));
    const re = new RegExp(`(^|[^a-z0-9])${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`, "i");
    if (!re.test(t)) continue;
    for (const a of v.accounts) {
      if (!per.has(a)) per.set(a, { names: new Set(), strong: false });
      per.get(a).names.add(n);
      if (strong) per.get(a).strong = true;
    }
  }
  return [...per.entries()].map(([account, x]) => ({ account, names: [...x.names], score: x.names.size, strong: x.strong })).sort((a, b) => b.score - a.score);
}

export async function link(ctx, { dryRun = false } = {}) {
  const inbox = ctx.path(ctx.config.transcripts.inbox);
  const keys = { account: ctx.config.frontmatter.account[0], linkedBy: ctx.config.frontmatter.linkedBy[0], proposal: ctx.config.frontmatter.proposal[0] };
  const editors = new RegExp(ctx.config.link.editors, "i");
  const index = await loadNames(ctx);
  const out = { auto: [], internal: [], open: [], seen: 0 };
  let files = [];
  try { files = (await readdir(inbox)).filter((b) => b.endsWith(".md")); } catch { return out; }
  for (const b of files) {
    const file = join(inbox, b);
    const text = await readFile(file, "utf8");
    const { meta, body } = frontmatter(text);
    if (isLinked(meta, ctx)) continue;
    out.seen++;
    const scores = scoreAccounts(body, index);
    const [top, second] = scores;
    const unambiguous = top && (!second || top.score >= 2 * second.score);
    const proposal = `[${scores.slice(0, 3).map((s) => s.account).join(", ")}]`;
    if (top && unambiguous && (top.score >= 2 || top.strong)) {
      if (!dryRun) await writeFile(file, setFrontmatter(text, { [keys.account]: top.account, [keys.linkedBy]: `${MARKER} (names: ${top.names.join(", ")})`, [keys.proposal]: proposal }));
      out.auto.push({ file: b, account: top.account, names: top.names });
      continue;
    }
    if (!scores.length && meta.kind !== "recording" && meta.soort !== "opname" && editors.test(String(meta.app ?? ""))) {
      if (!dryRun) await writeFile(file, setFrontmatter(text, { [keys.account]: "internal", [keys.linkedBy]: `${MARKER} (own dictation, no account name)` }));
      out.internal.push(b);
      continue;
    }
    if (!dryRun && scores.length) await writeFile(file, setFrontmatter(text, { [keys.proposal]: proposal }));
    out.open.push({ file: b, proposal: scores.slice(0, 3).map((s) => `${s.account} (${s.names.join("+")})`) });
    if (!dryRun && ctx.config.inbox?.fromLink !== false) {
      const rel = `${ctx.config.transcripts.inbox}/${b}`;
      await postItem(ctx, { kind: "question", from: "link", title: `Which account does this transcript belong to?`, where: rel, fingerprint: `l${hashPart(rel)}`,
        body: `Transcript \`${rel}\` is not linked to an account.${scores.length ? `\n\nCandidates: ${scores.slice(0, 3).map((s) => `\`${s.account}\` (${s.names.join(", ")})`).join(", ")}` : "\n\nNo account name recognised."}\n\nReply with the account path (or \`internal\`) and approve.`,
        action: { type: "set-frontmatter", file: rel, field: keys.account } });
    }
  }
  return out;
}

async function accountList(ctx) {
  const out = [];
  const { root, sides } = ctx.config.accounts;
  for (const side of sides.length ? sides : [""]) {
    const dir = ctx.path(side ? `${root}/${side}` : root);
    for (const m of await readdir(dir).catch(() => [])) if (!m.startsWith(".") && !m.startsWith("_")) out.push(side ? `${root}/${side}/${m}` : `${root}/${m}`);
  }
  for (const extra of ctx.config.link.extraAccountDirs ?? []) {
    for (const m of await readdir(ctx.path(extra)).catch(() => [])) if (!m.startsWith(".") && !m.startsWith("_")) out.push(`${extra.replace(/\/$/, "")}/${m}`);
  }
  return out;
}

export async function linkSmart(ctx, { dryRun = false, max = 200 } = {}) {
  const inbox = ctx.path(ctx.config.transcripts.inbox);
  const keys = { account: ctx.config.frontmatter.account[0], linkedBy: ctx.config.frontmatter.linkedBy[0], proposal: ctx.config.frontmatter.proposal[0] };
  const out = { seen: 0, high: [], medium: [], open: [], error: null, cost: null };
  let files = [];
  try { files = (await readdir(inbox)).filter((b) => b.endsWith(".md")); } catch { return out; }
  const items = [];
  for (const b of files) {
    const text = await readFile(join(inbox, b), "utf8");
    const { meta, body } = frontmatter(text);
    if (isLinked(meta, ctx)) continue;
    const transcript = body.split(/^## Transcript\s*$/m)[1] ?? body;
    items.push({ id: b.replace(/\.md$/, ""), date: String(meta.date ?? meta.datum ?? "").slice(0, 10), app: meta.app ?? "", kind: meta.kind ?? meta.soort ?? "", minutes: Math.round(Number(meta.duration_s ?? meta.duur_s ?? 0) / 60), head: transcript.replace(/\s+/g, " ").trim().slice(0, 1200) });
    if (items.length >= max) break;
  }
  out.seen = items.length;
  if (!items.length) return out;
  const accounts = await accountList(ctx);
  const template = await readFile(join(PROMPTS, "link.md"), "utf8");
  const prompt = fill(template, {
    company: ctx.config.name, language: languageName(ctx.config.language),
    accounts: accounts.map((a) => `- ${a}`).join("\n"),
    transcripts: items.map((i) => `### ${i.id} · ${i.date} · ${i.kind} · ${i.minutes} min · app: ${i.app}\n${i.head}`).join("\n"),
  });
  let parsed = [];
  try {
    const r = await runAgent(ctx, prompt, { timeoutMs: 600000 });
    parsed = JSON.parse(r.result.slice(r.result.indexOf("["), r.result.lastIndexOf("]") + 1));
    out.cost = r.cost;
  } catch (e) { out.error = e.message.slice(0, 300); return out; }
  const valid = new Set([...accounts, "internal"]);
  for (const r of parsed) {
    const file = join(inbox, `${r.id}.md`);
    let text; try { text = await readFile(file, "utf8"); } catch { continue; }
    const reason = String(r.reason ?? "").replace(/[:\n]/g, " ").slice(0, 80);
    if (r.confidence === "high" && valid.has(r.account)) {
      if (!dryRun) await writeFile(file, setFrontmatter(text, { [keys.account]: r.account, [keys.linkedBy]: `${MARKER} smart (${reason})` }));
      out.high.push({ id: r.id, account: r.account, reason: r.reason });
    } else if (r.confidence === "medium" && valid.has(r.account) && r.account !== "internal") {
      if (!dryRun) await writeFile(file, setFrontmatter(text, { [keys.proposal]: `[${r.account}]` }));
      out.medium.push({ id: r.id, account: r.account, reason: r.reason });
    } else out.open.push({ id: r.id, account: r.account, confidence: r.confidence });
  }
  return out;
}
