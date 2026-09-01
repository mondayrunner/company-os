/**
 * `company-os check`: deterministic checks over the markdown and, when a live
 * source is configured, against reality. No AI: these are the controls you
 * want debuggable and free. Findings carry a severity, a place and a line;
 * a finding on a line a human already marked (config.markers) is dropped.
 *
 * A check is a module:  export default { name, description, needs?: ["finance"], run(ctx, h, options) -> findings[] }
 * `options` is `config.checks.<name>` — its own settings, handed to it instead
 * of every check reaching into the whole config for its own corner of it.
 * Built-ins live in ../checks; private ones in <root>/checks/*.mjs.
 */
import { readdir, readFile, stat, mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadConnectors, byKind, readLive } from "./connectors.mjs";
import { clean, slug, tableUnder, hashOf } from "./markdown.mjs";
import { writeStatus } from "./status.mjs";
import { postItem, resolveStale, expireReports } from "./inbox.mjs";

const BUILTIN = join(dirname(fileURLToPath(import.meta.url)), "..", "checks");

async function loadChecks(ctx, only) {
  const out = [];
  for (const dir of [BUILTIN, join(ctx.root, "checks")]) {
    if (!existsSync(dir)) continue;
    for (const f of (await readdir(dir)).filter((f) => f.endsWith(".mjs")).sort()) {
      const mod = await import(pathToFileURL(join(dir, f)).href);
      const c = mod.default;
      if (!c?.run) continue;
      if (only && !only.includes(c.name)) continue;
      const enabled = ctx.config.checks?.[c.name];
      if (enabled === false) continue;
      out.push(c);
    }
  }
  return out;
}

const STOP = new Set(["the", "and", "van", "der", "den", "de", "het", "een", "voor", "with", "from", "team", "studio", "unknown", "onbekend"]);

/** Words (4+ chars) from a display name that could identify a folder. */
export function nameWords(s) {
  return slug(clean(s).split(/[(—–-]/)[0]).split("-").filter((w) => w.length >= 4 && !STOP.has(w));
}

/** Folder whose slug contains a word from the name; prefers the most words matched. */
export function matchFolder(name, folders) {
  const words = nameWords(name);
  let best = null, bestN = 0;
  for (const f of folders) {
    const n = words.filter((w) => f.toLowerCase().includes(w)).length;
    if (n > bestN) { best = f; bestN = n; }
  }
  return best;
}

export function makeHelpers(ctx, db, connectors) {
  const cache = new Map();
  const h = {
    db,
    // Checks read the same handful of files: the pipeline, every status file.
    // One run, one read per file — the cache lives exactly as long as the run.
    read: (rel) => {
      const key = `read:${rel}`;
      if (!cache.has(key)) cache.set(key, readFile(ctx.path(rel), "utf8"));
      return cache.get(key);
    },
    exists: async (rel) => !!(await stat(ctx.path(rel)).catch(() => null)),
    isDir: async (rel) => !!(await stat(ctx.path(rel)).catch(() => null))?.isDirectory(),
    list: async (rel) => (await readdir(ctx.path(rel)).catch(() => [])).filter((n) => !n.startsWith(".") && !n.startsWith("_")),
    suppressed: (line) => ctx.config.markers.some((m) => line.includes(m)),
    matchFolder, clean,
    /** Account folders, grouped per side. */
    accountFolders: async () => {
      if (cache.has("accounts")) return cache.get("accounts");
      const { root, sides } = ctx.config.accounts;
      const out = {};
      for (const side of sides.length ? sides : [""]) out[side] = (await h.list(side ? `${root}/${side}` : root)).map((m) => (side ? `${root}/${side}/${m}` : `${root}/${m}`));
      cache.set("accounts", out);
      return out;
    },
    /** Rows of the leads table in the pipeline file, per config.pipeline.leads. */
    pipelineLeads: async () => {
      if (cache.has("leads")) return cache.get("leads");
      const p = ctx.config.pipeline;
      if (!p?.file || !p.leads) return [];
      const text = await h.read(p.file).catch(() => "");
      const rows = tableUnder(text, new RegExp(`^${p.leads.heading}`, "i"), p.leads.columns).filter((r) => clean(r[p.leads.who ?? "who"]));
      cache.set("leads", rows);
      return rows;
    },
    /** The knowledge folder: from the checks config, else from the `knowledge` kind. */
    knowledgeDir: () => ctx.config.checks?.knowledge?.dir ?? ctx.config.kinds.find((k) => k.kind === "knowledge")?.prefix?.replace(/\/$/, "") ?? null,
    /** First cell of every table row in the pipeline file: who each row is about. */
    pipelineNames: async () => {
      if (cache.has("names")) return cache.get("names");
      const p = ctx.config.pipeline;
      const text = p?.file ? await h.read(p.file).catch(() => "") : "";
      const names = [];
      for (const line of text.split("\n")) {
        if (!line.trim().startsWith("|") || /^\s*\|?[\s:|-]+\|?\s*$/.test(line)) continue;
        const cells = line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map(clean);
        // the "who" cell is the first one that is not a date or a number
        const who = cells.find((c) => c && !/^\d{4}-\d\d(-\d\d)?$/.test(c) && !/^[\d.,€ ]+$/.test(c));
        if (who) names.push(who);
      }
      cache.set("names", names);
      return names;
    },
    live: (kind, query) => readLive(ctx, kind, query),
  };
  return h;
}

export async function runChecks(ctx, db, { live = true, only = null } = {}) {
  const connectors = live ? await loadConnectors(ctx) : [];
  const checks = await loadChecks(ctx, only);
  const h = makeHelpers(ctx, db, connectors);
  const findings = [];
  const skipped = [];
  for (const c of checks) {
    const missing = (c.needs ?? []).filter((k) => !byKind(connectors, k).some((x) => x.live));
    if (missing.length) { skipped.push({ check: c.name, reason: `needs a live connector of kind ${missing.join(", ")}` }); continue; }
    try {
      const options = ctx.config.checks?.[c.name];
      for (const f of (await c.run(ctx, h, options && typeof options === "object" ? options : {})) ?? []) {
        if (f.text && h.suppressed(f.text)) continue;
        findings.push({ check: c.name, severity: f.severity ?? "warn", where: f.where, line: f.line ?? null, what: f.what, action: f.action ?? null });
      }
    } catch (e) { findings.push({ check: c.name, severity: "error", where: c.name, what: `check crashed: ${e.message}` }); }
  }
  findings.sort((a, b) => (a.severity === b.severity ? a.where.localeCompare(b.where) : a.severity === "error" ? -1 : 1));
  const errors = findings.filter((f) => f.severity === "error").length;
  const date = new Date().toISOString().slice(0, 10);
  const report = renderReport(ctx, { date, checks, findings, skipped, errors });
  await mkdir(ctx.outputs, { recursive: true });
  const file = join(ctx.outputs, `check-${date}.md`);
  await writeFile(file, report);
  // Every finding becomes an inbox item once: same finding next week → same fingerprint → no new item.
  // And a finding that stopped appearing closes its own item.
  let posted = 0;
  let closed = [];
  if (ctx.config.inbox?.fromChecks !== false) {
    // One fingerprint per finding: the same value decides whether an old item
    // closes and whether a new one is posted.
    const stamped = findings.map((f) => ({ ...f, fingerprint: hashOf(`${f.check}|${f.where}|${f.what}`).slice(0, 8) }));
    closed = await resolveStale(ctx, "check", stamped.map((f) => f.fingerprint));
    closed = closed.concat(await expireReports(ctx));
    for (const f of stamped) {
      const r = await postItem(ctx, { kind: "drift", from: "check", title: f.what.replace(/\n/g, " ").slice(0, 120), where: `${f.where}${f.line ? `:${f.line}` : ""}`, fingerprint: f.fingerprint,
        body: `**${f.severity}** · check \`${f.check}\` · \`${f.where}${f.line ? `:${f.line}` : ""}\`\n\n${f.what}\n\nReply with what to do (and approve), or reject to silence this finding.`, action: f.action ?? null });
      if (r.created) posted++;
    }
  }
  await writeStatus(ctx, "check", { result: errors ? "partial" : "ok", done: checks.length - skipped.length, failed: errors, message: `${errors} errors, ${findings.length - errors} warnings, ${posted} new in inbox${closed.length ? `, ${closed.length} closed` : ""}`, findings: findings.length, inbox_new: posted, inbox_closed: closed.length, report: ctx.short(file) });
  return { findings, skipped, errors, warnings: findings.length - errors, report: file, checks: checks.map((c) => c.name), inbox: { posted, closed: closed.length } };
}

function renderReport(ctx, { date, checks, findings, skipped, errors }) {
  const lines = [`# Check — ${date}`, "", `Ran ${checks.length - skipped.length} checks${skipped.length ? ` (${skipped.length} skipped)` : ""}. Result: **${errors} errors**, ${findings.length - errors} warnings.`, ""];
  if (!findings.length) lines.push("Nothing found.");
  else {
    lines.push("| Severity | Check | Where | What |", "|---|---|---|---|");
    for (const f of findings) lines.push(`| ${f.severity} | ${f.check} | \`${f.where}${f.line ? `:${f.line}` : ""}\` | ${f.what.replace(/\|/g, "\\|")} |`);
  }
  for (const s of skipped) lines.push("", `Skipped \`${s.check}\`: ${s.reason}.`);
  lines.push("", "Generated by `company-os check`.", "");
  return lines.join("\n");
}
