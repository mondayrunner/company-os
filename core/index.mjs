/**
 * `company-os index`: run the connectors that read files and logs (not the
 * volatile, live ones), write documents, chunks, relations and events. Only
 * changed files are rewritten. Connectors that produce files (transcripts) run
 * before `markdown` so the scan picks them up. `company-os snapshot` runs the
 * volatile connectors (finance, tasks, calendar, mail, dashboard metrics) once
 * a day for history; nothing from them is ever copied into markdown.
 */
import { now, registerSource } from "./db.mjs";
import { loadConnectors } from "./connectors.mjs";
import { indexInbox } from "./inbox.mjs";
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { dirname } from "node:path";

export async function indexAll(ctx, db, { only = null } = {}) {
  const connectors = await loadConnectors(ctx, (c) => !isLive(c) && (!only || only.includes(c.name)));
  const report = {};
  // Two waves: connectors that write files (transcripts) first, so the markdown
  // scan sees what they produced. Within a wave nothing depends on anything, so
  // they scan at the same time; the database writes stay in order after them.
  for (const wave of [connectors.filter((c) => c.producesFiles), connectors.filter((c) => !c.producesFiles)]) {
    const results = await Promise.all(wave.map(async (c) => {
      if (c.error) return { c, r: { error: c.error }, own: true };
      try { return { c, r: await c.scan(ctx, c.options) }; } catch (e) { return { c, r: { error: e.message } }; }
    }));
    for (const { c, r, own } of results) {
      if (r?.error) { report[c.name] = { error: r.error }; if (!own) registerSource(db, c, { message: `error: ${r.error}` }); continue; }
      const out = { count: r.count ?? 0, added: r.added ?? 0 };
      if (r.documents) Object.assign(out, writeDocuments(db, r.documents));
      if (r.events) out.events = writeEvents(db, r.events);
      if (r.metrics) out.metrics = writeMetrics(db, r.metrics);
      registerSource(db, c, { count: out.count, added: r.added ?? out.changed ?? out.events ?? 0, message: r.message ?? summary(out) });
      report[c.name] = out;
    }
  }
  report.inbox = await indexInbox(ctx, db);
  const metrics = await readMetricsFile(ctx, db);
  if (metrics) report.metrics = { restoredFromFile: metrics };
  const runs = await readRunsFile(ctx, db);
  if (runs) report.runs = { restoredFromFile: runs };
  await writeRunsFile(ctx, db);
  return report;
}

function summary(o) {
  const parts = [];
  if (o.changed !== undefined) parts.push(`${o.changed} changed, ${o.removed} removed`);
  if (o.events !== undefined) parts.push(`${o.events} new runs`);
  if (o.metrics !== undefined) parts.push(`${o.metrics} metrics`);
  return parts.join("; ");
}

export function writeDocuments(db, documents) {
  const existing = new Map(db.prepare("SELECT path, hash FROM documents").all().map((r) => [r.path, r.hash]));
  const upsert = db.prepare(`INSERT INTO documents (path, kind, title, hash, mtime, bytes, status, last_verified, meta) VALUES (?,?,?,?,?,?,?,?,?)
    ON CONFLICT(path) DO UPDATE SET kind=excluded.kind, title=excluded.title, hash=excluded.hash, mtime=excluded.mtime, bytes=excluded.bytes, status=excluded.status, last_verified=excluded.last_verified, meta=excluded.meta`);
  const delChunks = db.prepare("DELETE FROM chunks WHERE path = ?");
  const insChunk = db.prepare("INSERT INTO chunks (path, heading, text) VALUES (?,?,?)");
  const delRel = db.prepare("DELETE FROM relations WHERE from_path = ? AND source IN ('frontmatter','body','path')");
  const insRel = db.prepare("INSERT OR REPLACE INTO relations (from_path, to_path, kind, source, confidence, ts) VALUES (?,?,?,?,?,?)");
  let changed = 0;
  db.exec("BEGIN");
  for (const d of documents) {
    if (existing.get(d.path) === d.hash) { existing.delete(d.path); continue; }
    upsert.run(d.path, d.kind, d.title, d.hash, d.mtime, d.bytes, d.status, d.last_verified, JSON.stringify(d.meta ?? {}));
    delChunks.run(d.path);
    for (const c of d.chunks ?? []) insChunk.run(d.path, c.heading, c.text);
    delRel.run(d.path);
    for (const r of d.relations ?? []) insRel.run(d.path, r.to, r.kind, r.source, r.confidence, now());
    existing.delete(d.path);
    changed++;
  }
  const delDoc = db.prepare("DELETE FROM documents WHERE path = ?");
  const delRelAll = db.prepare("DELETE FROM relations WHERE from_path = ? OR to_path = ?");
  for (const gone of existing.keys()) { delDoc.run(gone); delChunks.run(gone); delRelAll.run(gone, gone); }
  db.exec("COMMIT");
  return { changed, removed: existing.size };
}

export function writeEvents(db, events) {
  const ins = db.prepare("INSERT OR IGNORE INTO events (ts, job, result, done, failed, message, json) VALUES (?,?,?,?,?,?,?)");
  let n = 0;
  for (const e of events) n += ins.run(e.ts, e.job, e.result, e.done, e.failed, e.message, e.json ?? null).changes;
  return n;
}

export function writeMetrics(db, metrics) {
  const ins = db.prepare("INSERT OR REPLACE INTO metrics (date, key, value) VALUES (?,?,?)");
  for (const m of metrics) ins.run(m.date, m.key, m.value);
  return metrics.length;
}

// `volatile` in the contract is the whole rule: a source that is read live is
// never copied into markdown. The kind says nothing about it — `metrics` used
// to be an exception here, which meant a connector could be volatile by its
// name instead of by what it declares.
const isLive = (c) => c.volatile;

/**
 * Metrics are the one thing in the database that is NOT a cache: a daily number
 * cannot be recomputed from the markdown once the day has passed. So every
 * snapshot also writes the whole series to a plain CSV in the vault, which git
 * tracks and `index` reads back. Delete the database and you lose nothing.
 */
export async function writeMetricsFile(ctx, db) {
  const file = ctx.path(ctx.config.metricsFile ?? "metrics.csv");
  const rows = db.prepare("SELECT date, key, value FROM metrics ORDER BY date, key").all();
  if (!rows.length) return { file, rows: 0 };
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, "date,key,value\n" + rows.map((r) => `${r.date},${r.key},${r.value}`).join("\n") + "\n");
  return { file: ctx.short(file), rows: rows.length };
}

/**
 * The run history of the jobs. Not a cache either.
 *
 * A status file overwrites itself every run: only the last one is still in
 * there. The rest of the history — when a job went quiet, for how long, how
 * often it was "partial" — lived only in the database. So it is now also a
 * line per run in the vault, which git keeps and `index` reads back.
 */
export async function writeRunsFile(ctx, db) {
  const file = ctx.path(ctx.config.runsFile ?? "runs.jsonl");
  const rows = db.prepare("SELECT ts, job, result, done, failed, message FROM events ORDER BY ts, job").all();
  if (!rows.length) return { file, rows: 0 };
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
  return { file: ctx.short(file), rows: rows.length };
}

export async function readRunsFile(ctx, db) {
  const text = await readFile(ctx.path(ctx.config.runsFile ?? "runs.jsonl"), "utf8").catch(() => null);
  if (!text) return 0;
  const ins = db.prepare("INSERT OR IGNORE INTO events (ts, job, result, done, failed, message) VALUES (?,?,?,?,?,?)");
  let n = 0;
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line);
      if (r.ts && r.job) n += ins.run(r.ts, r.job, r.result ?? null, r.done ?? null, r.failed ?? null, r.message ?? null).changes;
    } catch {}   // one broken line must not take the rest with it
  }
  return n;
}

export async function readMetricsFile(ctx, db) {
  const file = ctx.path(ctx.config.metricsFile ?? "metrics.csv");
  const text = await readFile(file, "utf8").catch(() => null);
  if (!text) return 0;
  const ins = db.prepare("INSERT OR IGNORE INTO metrics (date, key, value) VALUES (?,?,?)");
  let n = 0;
  for (const line of text.split("\n").slice(1)) {
    const [date, key, value] = line.split(",");
    if (date && key && value !== undefined && Number.isFinite(Number(value))) n += ins.run(date, key, Number(value)).changes;
  }
  return n;
}

/** `company-os snapshot`: only the live connectors, one row of metrics per day. */
export async function snapshotAll(ctx, db) {
  const connectors = await loadConnectors(ctx, isLive);
  const report = {};
  // These are all network calls to different services — Stripe, Trello, a
  // calendar, a mailbox. One at a time made a snapshot take as long as the sum
  // of the slowest days of each of them.
  const results = await Promise.all(connectors.map(async (c) => {
    if (c.error) return { c, error: c.error, own: true };
    try { return { c, r: await c.scan(ctx, c.options) }; } catch (e) { return { c, error: e.message }; }
  }));
  for (const { c, r, error, own } of results) {
    if (error) { report[c.name] = { error }; if (!own) registerSource(db, c, { message: `error: ${error}` }); continue; }
    report[c.name] = { metrics: writeMetrics(db, r.metrics ?? []), message: r.message };
    registerSource(db, c, { count: r.count, added: r.metrics?.length ?? 0, message: r.message });
  }
  report.file = await writeMetricsFile(ctx, db);
  return report;
}
