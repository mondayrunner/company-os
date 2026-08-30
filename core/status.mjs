/**
 * The status contract every job honours: one JSON file per job in the state
 * folder, overwritten on every run, plus the same run appended to `events`.
 * A job that crashes still leaves a file (the shell wrapper's EXIT trap).
 */
import { mkdir, writeFile, rename, readFile } from "node:fs/promises";
import { join } from "node:path";
import { openDb } from "./db.mjs";
import { writeEvents } from "./index.mjs";
import { normalizeStatus } from "../connectors/status.mjs";

export async function writeStatus(ctx, job, { result = "ok", done = 0, failed = 0, message = "", ...extra } = {}) {
  await mkdir(ctx.stateDir, { recursive: true });
  const file = join(ctx.stateDir, `${job}-status.json`);
  const tmp = `${file}.tmp.${process.pid}`;
  const status = { job, last_run: new Date().toISOString(), date: new Date().toISOString().slice(0, 10), result, done, failed, message, ...extra };
  await writeFile(tmp, JSON.stringify(status, null, 2));
  await rename(tmp, file);
  try { const db = openDb(ctx); writeEvents(db, [normalizeStatus(status, job)]); db.close(); } catch {}
  return file;
}

/** `company-os event <status.json>`: record one job run (called by shell wrappers). */
export async function recordEvent(ctx, db, file) {
  const s = JSON.parse(await readFile(file, "utf8"));
  const e = normalizeStatus(s, file.split("/").pop().replace(/-status\.json$/, ""));
  if (!e) return { recorded: false, reason: "no last_run" };
  return { recorded: writeEvents(db, [e]) > 0, job: e.job, ts: e.ts };
}
