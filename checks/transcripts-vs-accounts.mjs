/**
 * A recording that is attached to an account but never made it into the
 * status file.
 *
 * `link` and `unfiled-transcripts` get a recording to the right folder. That
 * is where the trail went cold: the transcript sits next to the status file,
 * the search finds it, and the status file still describes the situation
 * from before the call. So: every transcript that belongs to an account
 * (frontmatter, or a `transcript-*` file in the folder) whose recording date
 * is later than the last change to the status file is a finding. Write the
 * call into the status file and it closes.
 *
 * Short recordings are dictation, not a conversation: under `minSeconds`
 * (three minutes) they are skipped when the frontmatter says how long they
 * ran. The finding names the file in full, with its title and length, so the
 * reader knows which call it was before opening anything.
 *
 * Configure: checks["transcripts-vs-accounts"] = { days: 60, max: 10, minSeconds: 180 }.
 */
import { stat } from "node:fs/promises";
import { frontmatter, titleOf } from "../core/markdown.mjs";

const DURATION_KEYS = ["duration_s", "duur_s", "duration", "seconds"];
const durationOf = (meta) => { for (const k of DURATION_KEYS) if (meta?.[k] != null && !Number.isNaN(Number(meta[k]))) return Number(meta[k]); return null; };
const minutes = (s) => (s == null ? "" : `${Math.round(s / 60)} min`);

const DAY = 86400000;
const nameOf = (p) => p.split("/").pop();

/**
 * When the recording happened: the frontmatter's date (with a time, if the
 * recorder wrote one), else the date in the file name at end of that day, so
 * a status file written that afternoon counts as after the call. No date at
 * all → not a recording we can place in time; skip it.
 */
function recordedAt(path, meta) {
  const fm = meta?.date ?? meta?.datum ?? null;
  if (fm) { const t = Date.parse(String(fm)); if (!Number.isNaN(t)) return { at: /T\d\d:\d\d/.test(String(fm)) ? t : t + DAY, day: String(fm).slice(0, 10) }; }
  const named = nameOf(path).match(/(20\d\d-\d\d-\d\d)/)?.[1];
  return named ? { at: Date.parse(named) + DAY, day: named } : null;
}

export default {
  name: "transcripts-vs-accounts",
  description: "recordings attached to an account but not written into its status file",
  async run(ctx, h, options = {}) {
    const a = ctx.config.accounts;
    const days = options.days ?? 60;
    const max = options.max ?? 10;
    const minSeconds = options.minSeconds ?? 180;
    const cutoff = Date.now() - days * DAY;

    // Attached by frontmatter (the index keeps that as a relation) …
    const linked = h.db.prepare("SELECT d.path, d.mtime, r.to_path AS folder FROM relations r JOIN documents d ON d.path = r.from_path WHERE r.kind = 'belongs-to' AND d.kind = 'transcript'").all();
    // … or by living in the folder under a transcript name.
    const inside = h.db.prepare("SELECT path, mtime FROM documents WHERE kind = 'account'").all()
      .filter((d) => /^transcript/i.test(nameOf(d.path)))
      .map((d) => ({ ...d, folder: ctx.accountOf(d.path) }))
      .filter((d) => d.folder);

    const seen = new Set();
    const out = [];
    for (const t of [...linked, ...inside]) {
      if (seen.has(t.path)) continue;
      seen.add(t.path);
      const { meta, body } = frontmatter(await h.read(t.path).catch(() => ""));
      const seconds = durationOf(meta);
      if (seconds != null && seconds < minSeconds) continue;
      const rec = recordedAt(t.path, meta);
      if (!rec || !(rec.at > cutoff)) continue;
      const statusRel = `${t.folder}/${a.statusFile}`;
      const s = await stat(ctx.path(statusRel)).catch(() => null);
      if (!s) continue;
      if (s.mtimeMs >= rec.at) continue;
      const label = [minutes(seconds), meta?.app].filter(Boolean).join(", ");
      out.push({ when: rec.at, day: rec.day, path: t.path, title: titleOf(body, "").replace(/^\S+\s+\d{4}-\d\d-\d\d\s+[\d:]+\s*·\s*/, "").slice(0, 80), label, folder: t.folder, statusRel, written: s.mtimeMs });
    }
    out.sort((x, y) => y.when - x.when);

    // A proposal, not a question: the transcript is a file the executor can
    // read, so approving is enough — an agent writes the call into the status file.
    const findings = out.slice(0, max).map((t) => ({
      severity: "warn",
      kind: "proposal",
      where: t.statusRel,
      what: `recording \`${t.path}\` (${t.day}${t.label ? `, ${t.label}` : ""})${t.title ? ` "${t.title}"` : ""} is newer than the status file (last written ${new Date(t.written).toISOString().slice(0, 10)}) — the call is not in it yet`,
      hint: `Approve: an agent reads the recording and writes the call into \`${t.statusRel}\` (what was discussed, decided, promised; ball; next action). Reply first to steer it. Reject: silence.`,
      action: { type: "agent", inward: true, instruction: [
        `Read \`${t.path}\`, a transcript of a call on ${t.day}${t.label ? ` (${t.label})` : ""}. Then update \`${t.statusRel}\`: read it first and keep its structure and language.`,
        `Add one dated log entry (${t.day}) that names the transcript and says what was discussed, what was decided, what was promised and by whom, and which questions stayed open. If the ball moved, update the line that starts with \`${a.ballLine ?? "**Ball:**"}\`; if the next action changed, update it. Do not invent what the transcript does not say.`,
        `Only edit the status file; do not draft or send anything.`,
      ].join("\n\n") },
    }));
    if (out.length > max) findings.push({ severity: "warn", where: a.root, what: `${out.length} recordings are not written into their status file, ${out.length - max} more than shown` });
    return findings;
  },
};
