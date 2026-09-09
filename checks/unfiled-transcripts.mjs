/**
 * Recordings pile up in the transcript inbox until someone says who they were
 * with. That folder is the one place in the brain where doing nothing looks
 * exactly like being up to date: no page goes stale, no link breaks, the
 * recordings simply sit there unattached and out of every search that matters.
 *
 * So: a transcript in `transcripts.inbox` with no account in its frontmatter,
 * older than `afterDays`, is a finding. Younger ones are today's work and stay
 * quiet. Configure: checks["unfiled-transcripts"] = { afterDays: 7, max: 5 }.
 */
import { frontmatter } from "../core/markdown.mjs";

const DAY = 86400000;

export default {
  name: "unfiled-transcripts",
  description: "recordings waiting in the transcript inbox with no account",
  async run(ctx, h, options = {}) {
    const dir = ctx.config.transcripts?.inbox;
    if (!dir || !(await h.isDir(dir))) return [];
    const afterDays = options.afterDays ?? 7;
    const max = options.max ?? 5;
    const cutoff = Date.now() - afterDays * DAY;

    const open = [];
    for (const name of (await h.list(dir)).filter((n) => n.endsWith(".md"))) {
      const rel = `${dir}/${name}`;
      const text = await h.read(rel).catch(() => "");
      const { meta } = frontmatter(text);
      const account = ctx.fm(meta, "account");
      if (account && String(account).trim()) continue;
      // The date in the file name is the recording's, which is the one that
      // says how long this has been waiting; mtime moves when anything rewrites it.
      const named = name.match(/^(20\d\d-\d\d-\d\d)/)?.[1];
      const when = named ? Date.parse(named) : Date.now();
      if (when > cutoff) continue;
      open.push({ rel, date: named ?? "?", proposal: [].concat(ctx.fm(meta, "proposal") ?? []).filter(Boolean) });
    }
    open.sort((a, b) => a.date.localeCompare(b.date));

    // One finding for the pile, not one per recording: `link` already asks one
    // question per transcript, and this is the count that says the pile exists.
    if (!open.length) return [];
    const shown = open.slice(0, max).map((t) => `${t.date}${t.proposal.length ? ` (${t.proposal.join(", ")}?)` : ""}`).join(", ");
    return [{
      severity: "warn", where: dir,
      what: `${open.length} recording${open.length === 1 ? " is" : "s are"} waiting to be attached to an account, oldest ${shown}${open.length > max ? `, +${open.length - max} more` : ""}`,
      hint: "Each has its own question from `link` in this inbox: answer those (account path, `internal`, or `none` for a casual contact) and this closes by itself.",
    }];
  },
};
