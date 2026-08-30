// What is running right now.
//
// An item's status lives in its markdown, because that is a fact about the item
// and git should keep it. "Someone is working on this" is not that: it is a
// fact about this machine at this moment, it is meaningless after a restart,
// and it must not survive `company-os index`. So it lives in the database,
// which is allowed to be thrown away.
//
// Without it the dashboard cannot tell the difference between a run that is
// still going and one that never started: the item sits at `approved` either
// way. Press run, navigate away, come back — the work continued (the child
// process is not tied to the request), but the screen had no way of saying so.
import { openDb } from "./db.mjs";

/** Is this process still alive? Signal 0 asks without sending anything. */
function alive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // EPERM means it exists but belongs to someone else — alive enough.
    return e.code === "EPERM";
  }
}

/**
 * Rows whose process is gone were killed by a restart or a crash. They are not
 * running, so they are removed rather than reported: a spinner that never stops
 * is worse than no spinner.
 */
export function sweep(db) {
  const stale = db.prepare("SELECT item, pid FROM running").all().filter((r) => !alive(r.pid));
  for (const r of stale) db.prepare("DELETE FROM running WHERE item = ?").run(r.item);
  return stale.length;
}

export function start(ctx, item, { pid = null, what = null } = {}) {
  const db = openDb(ctx);
  try {
    sweep(db);
    db.prepare("INSERT OR REPLACE INTO running (item, started, pid, what) VALUES (?, ?, ?, ?)")
      .run(item, new Date().toISOString(), pid, what);
  } finally {
    db.close();
  }
}

export function finish(ctx, item) {
  const db = openDb(ctx);
  try {
    db.prepare("DELETE FROM running WHERE item = ?").run(item);
  } finally {
    db.close();
  }
}

/**
 * Write a finished run into the event log. Jobs already do this through
 * `company-os event`; this is the same row for work that has no job behind it —
 * an inbox item you ran, a role you pointed at a card, a draft you asked for.
 * Without it those runs happen and leave no trace anywhere you can look.
 */
export function record(ctx, { job, result = "ok", done = 1, failed = 0, message = "", cost = null } = {}) {
  const db = openDb(ctx);
  try {
    db.prepare("INSERT INTO events (ts, job, result, done, failed, message, json) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(new Date().toISOString(), job, result, done, failed, String(message).slice(0, 400),
           cost == null ? null : JSON.stringify({ cost_usd: cost }));
  } finally {
    db.close();
  }
}

/** Everything in flight, oldest first, with how long it has been going. */
export function list(ctx) {
  const db = openDb(ctx);
  try {
    sweep(db);
    return db.prepare("SELECT item, started, pid, what FROM running ORDER BY started").all()
      .map((r) => ({ ...r, seconds: Math.round((Date.now() - new Date(r.started).getTime()) / 1000) }));
  } finally {
    db.close();
  }
}
