// Built-in: the status files every job writes (<stateDir>/<job>-status.json).
// Each new run becomes a row in `events`; that is the history the status
// files themselves do not keep, since they overwrite themselves.
// Accepts both the English keys and the legacy Dutch ones.
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

export function normalizeStatus(s, fallbackJob) {
  const ts = s.last_run ?? s.laatste_run;
  if (!ts) return null;
  const { last_run, laatste_run, job, result, resultaat, done, gedaan, failed, mislukt, message, melding, date, datum, ...rest } = s;
  const r = result ?? resultaat ?? null;
  return {
    ts, job: job ?? fallbackJob,
    result: r === "fout" ? "error" : r === "deels" ? "partial" : r,
    done: done ?? gedaan ?? 0, failed: failed ?? mislukt ?? 0, message: message ?? melding ?? "", json: JSON.stringify(rest),
  };
}

export default {
  name: "status",
  kind: "events",
  location: (ctx) => ctx.short(ctx.stateDir),
  async scan(ctx) {
    let files = [];
    try { files = (await readdir(ctx.stateDir)).filter((b) => b.endsWith("-status.json")); } catch {}
    const events = [];
    for (const b of files) {
      try {
        const e = normalizeStatus(JSON.parse(await readFile(join(ctx.stateDir, b), "utf8")), b.replace(/-status\.json$/, ""));
        if (e) events.push(e);
      } catch {}
    }
    return { events, count: files.length };
  },
};
