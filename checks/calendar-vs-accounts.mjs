/**
 * An appointment with a known account that came and went without the folder
 * noticing.
 *
 * The calendar is read live and never copied, so "kickoff with Harper" on
 * Tuesday is in the calendar and nowhere else. If nobody touched the folder
 * after the meeting, the status file still says "kickoff planned". So: every
 * event of the last `days` days whose title names an account, ending after
 * the folder's newest file, is a finding. Future events are not: they are
 * plans, not history.
 *
 * Needs a connector of kind "calendar" with live({ what: "range", from, to })
 * → { days: { "YYYY-MM-DD": [{ start, end, summary, allDay }] } }.
 *
 * Configure: checks["calendar-vs-accounts"] = { days: 14, skip: ["^blok"], max: 10 }.
 */
import { slug } from "../core/markdown.mjs";

const STOP = new Set(["with", "call", "meet", "meeting", "bellen", "overleg", "teams", "zoom", "online", "update", "vervolg", "kickoff", "intro", "kennismaking", "afspraak", "sessie", "werksessie", "workshop", "between", "and", "van", "den", "der", "het", "een", "voor", "team", "studio", "lead", "leads", "client", "klant"]);
/** Words of a title that could name an account: 4+ letters, not the meeting vocabulary. */
const wordsOf = (s) => slug(s).split("-").filter((w) => w.length >= 4 && !/^\d+$/.test(w) && !STOP.has(w));
/** A word names a folder when it is one of the folder's own segments ("lead" must not hit "leadmind"). */
const names = (w, folder) => folder.toLowerCase().split(/[\/-]/).some((seg) => seg === w || (w.length >= 6 && seg.startsWith(w)));

const DAY = 86400000;
const iso = (d) => new Date(d).toISOString().slice(0, 10);
// Things people put in a calendar that are not a meeting with anyone.
const NOISE = /^(blok|block|focus|deep work|lunch|reis|travel|vrij|holiday|vakantie|verjaardag|birthday)\b/i;

export default {
  name: "calendar-vs-accounts",
  description: "past appointments with an account that the folder does not reflect",
  needs: ["calendar"],
  async run(ctx, h, options = {}) {
    const a = ctx.config.accounts;
    const days = options.days ?? 14;
    const max = options.max ?? 10;
    const skip = [NOISE, ...(options.skip ?? []).map((re) => new RegExp(re, "i"))];

    const folders = await h.openAccounts(options.sides ?? null);
    if (!folders.length) return [];
    const now = Date.now();
    const r = await h.live("calendar", { what: "range", from: iso(now - days * DAY), to: iso(now) });
    const events = Object.entries(r?.days ?? {}).flatMap(([day, items]) => (items ?? []).map((e) => ({ ...e, day })));

    const out = [];
    for (const e of events) {
      if (!e.summary || skip.some((re) => re.test(e.summary))) continue;
      const ended = e.end ? Date.parse(e.end) : Date.parse(e.day) + DAY;
      if (!(ended < now)) continue;
      // A word of the title that is a segment of the folder name: "Kickoff Harper"
      // hits harper-co-website; "Lunch with a friend" hits nothing. Among equals
      // the folder touched last wins, the same tie-break `account` uses.
      const words = wordsOf(e.summary);
      let best = null, bestN = 0, bestT = 0;
      for (const f of folders) {
        const n = words.filter((w) => names(w, f)).length;
        if (!n) continue;
        const t = await h.touched(f);
        if (n > bestN || (n === bestN && t > bestT)) { best = f; bestN = n; bestT = t; }
      }
      if (!best) continue;
      if (ended <= (await h.touched(best))) continue;
      out.push({ ended, folder: best, e });
    }
    out.sort((x, y) => y.ended - x.ended);

    // The calendar knows the meeting happened, not what came out of it; that
    // is one sentence only the human has. The reply is that sentence, and
    // approving files it as a dated log line in the status file.
    const findings = out.slice(0, max).map(({ ended, folder, e }) => ({
      severity: "warn",
      kind: "question",
      where: `${folder}/${a.statusFile}`,
      what: `appointment "${e.summary}" on ${e.day} is newer than anything in the folder — what came out of it is not written down`,
      hint: `Reply with one line on what came out of it and approve: it lands in the log of \`${folder}/${a.statusFile}\`. Reject if nothing worth noting happened.`,
      action: { type: "edit-markdown", inward: true, file: `${folder}/${a.statusFile}`, appendReply: true, under: options.logHeading ?? "Log", prefix: `- ${e.day} — ${e.summary.replace(/\s+/g, " ").trim()}: ` },
    }));
    if (out.length > max) findings.push({ severity: "warn", where: a.root, what: `${out.length} past appointments are not reflected in their folder, ${out.length - max} more than shown` });
    return findings;
  },
};
