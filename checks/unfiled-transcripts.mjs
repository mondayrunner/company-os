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

    const findings = open.slice(0, max).map((t) => ({
      severity: "warn", where: t.rel,
      what: `recording from ${t.date} is not attached to an account${t.proposal.length ? ` (proposed: ${t.proposal.join(", ")})` : ""}`,
    }));
    if (open.length > max) findings.push({ severity: "warn", where: dir, what: `${open.length} recordings are waiting to be attached, ${open.length - max} more than shown; \`company-os link\` attaches what it is sure about` });
    return findings;
  },
};
