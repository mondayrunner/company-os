/**
 * A date the brain treats as an appointment that the calendar does not know,
 * and an appointment the calendar dropped or moved while the brain still
 * names its old date.
 *
 * Dates reach a status file from mail ("ideally on the 26th"), from a call,
 * from a card. From then on the morning plan repeats them as fact, while the
 * calendar, the one place that says what you will actually be doing, is read
 * live and never compared. So, two things:
 *
 *   1. not in the calendar: a future date (within `days`, default 21) on a
 *      current-state line of an open account (the ball line, a "next action"
 *      line, a line under a planning heading; `scope: "all"` reads every
 *      line outside the log), in a sentence with an appointment word (day,
 *      session, call, meeting, workshop, kick-off…), with no calendar event
 *      that day whose title shares a word with that sentence or names the
 *      folder. Question: reply with what the date really is, approving files
 *      the reply as a dated log line. With a tasks connector, a card whose
 *      title has an appointment word and whose due date has no such event is
 *      asked about the same way.
 *   2. removed or moved: each run keeps the next `snapshotDays` (30) of the
 *      calendar in `<stateDir>/calendar-snapshot.json` (uid, title, day,
 *      start). The next run compares: an event that is gone (by uid), or whose
 *      single occurrence moved to another day, is a finding when a status file
 *      still names the old day in a sentence that shares a word with the
 *      event's title or folder. A calendar change nobody wrote down is fine.
 *
 * Dates read: 2026-10-26, 26-10, 26/10, 26-10-2026, "26 oktober", "26 Oct"
 * (Dutch and English months). A date without a year is the one closest to
 * today. Not asked about: a deadline ("voor 30-10", "before", "uiterlijk",
 * "after") and candidates ("ma 2-11 of do 5-11", "proposed", "kiezen"). Dated log lines ("- 2026-10-21 — …") and the log section are
 * history and are skipped.
 *
 * Needs a connector of kind "calendar" with live({ what: "range", from, to })
 * → { days: { "YYYY-MM-DD": [{ start, summary, allDay, uid }] } }; `uid` is
 * optional (without it an event is known by title and start, so a move reads
 * as a removal).
 *
 * Configure: checks["dates-vs-calendar"] = {
 *   days: 21,                    // how far ahead dates are checked
 *   sides: null,                 // account sides; default the open ones
 *   scope: "focus",              // "focus": ball/next-action/planning lines; "all": every non-log line
 *   sections: "^(volgende acties?|next (actions?|steps)|planning|agenda|afspraken|appointments)\\b",
 *   nextLabels: ["**Volgende actie", "**Next action"],
 *   appointment: "…",            // regex over one word; default below
 *   logHeading: "Log",           // the section skipped, and where replies go
 *   tasks: true,                 // also ask about card due dates (needs kind "tasks")
 *   snapshot: true,              // keep and compare the calendar snapshot
 *   snapshotDays: 30,
 *   max: 10
 * }
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { slug, ballLabels } from "../core/markdown.mjs";

const DAY = 86400000;
const STOP = new Set(["with", "call", "meet", "meeting", "bellen", "overleg", "teams", "zoom", "online", "update", "vervolg", "kickoff", "intro", "kennismaking", "afspraak", "sessie", "werksessie", "workshop", "between", "and", "van", "den", "der", "het", "een", "voor", "team", "studio", "lead", "leads", "client", "klant", "deze", "door", "naar", "over", "maar", "niet", "nog", "wordt", "worden", "this", "that", "from", "will", "have", "after", "before", "date", "datum"]);
const MONTHS = { jan: 1, januari: 1, january: 1, feb: 2, februari: 2, february: 2, mrt: 3, maart: 3, mar: 3, march: 3, apr: 4, april: 4, mei: 5, may: 5, jun: 6, juni: 6, june: 6, jul: 7, juli: 7, july: 7, aug: 8, augustus: 8, august: 8, sep: 9, sept: 9, september: 9, okt: 10, oktober: 10, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12 };
const WEEKDAYS = new Set(["maandag", "dinsdag", "woensdag", "donderdag", "vrijdag", "zaterdag", "zondag", "vandaag", "gisteren", "werkdag", "werkdagen", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday", "today", "workday", "workdays"]);
// One word that makes a sentence an appointment rather than a deadline.
const APPOINTMENT = "^(\\w*dag|\\w*days?|sessie\\w*|session\\w*|call|calls|meeting\\w*|workshop\\w*|kick|kickoff|afspraak|afspraken|appointment|demo|presentatie|presentation|pitch|training\\w*|hackathon\\w*|event|evenement|offsite|bezoek|visit|interview|intake|lunch|diner|dinner|borrel|congres|conference|summit|livestream|webinar)$";
const DATED_LOG = /^\s*[-*]\s*(\*\*)?\d{4}-\d\d-\d\d\b/;

/** Words that can tie a sentence to an event: 4+ letters, no meeting vocabulary. */
export const wordsOf = (s) => slug(s).split("-").filter((w) => w.length >= 4 && !/^\d+$/.test(w) && !STOP.has(w) && !WEEKDAYS.has(w) && !MONTHS[w]);
const names = (w, folder) => folder.toLowerCase().split(/[\/-]/).some((seg) => seg === w || (w.length >= 6 && seg.startsWith(w)) || (seg.length >= 6 && w.startsWith(seg)));
// "voor 30-10", "uiterlijk 30-10", "before 10/30": a deadline, not a day out.
const DEADLINE = /\b(voor|vóór|uiterlijk|tot|na|vanaf|before|by|until|after|from|deadline|due)\s*(\w{2,3}\.?\s+)?$/i;
// "ma 2-11 of do 5-11", "kies een dag": candidates, not a date that was set.
// "verplaatst van 22-10", "the old date": history kept on a current line.
const HISTORY = /\b(vervallen|vervalt|geannuleerd|annuleerde|verplaatst van|oude datum|was gepland|moved from|cancell?ed|old date|no longer)\b/i;
const OPTIONS = /\b(kiezen|kies|keuze|voorgesteld|voorstel|opties?|choose|choice|proposed|options?|tbd|n\.?t\.?b\.?)\b/i;
/** Local YYYY-MM-DD. */
export const dayKey = (d) => { const x = new Date(d); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`; };
const valid = (y, m, d) => { const t = new Date(y, m - 1, d); return t.getFullYear() === y && t.getMonth() === m - 1 && t.getDate() === d; };

/**
 * Every date in a piece of text, as local YYYY-MM-DD, with where it was found.
 * A date without a year is put in the year that brings it closest to `today`.
 */
export function datesIn(text, today = new Date()) {
  const s = String(text ?? "");
  const out = [];
  const year = (m, d) => {
    const y0 = today.getFullYear();
    return [y0 - 1, y0, y0 + 1].filter((y) => valid(y, m, d)).sort((a, b) => Math.abs(new Date(a, m - 1, d) - today) - Math.abs(new Date(b, m - 1, d) - today))[0];
  };
  const add = (y, m, d, index, raw) => { if (y && valid(y, m, d)) out.push({ day: `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`, index, raw }); };
  for (const m of s.matchAll(/(?<![\d\w])(20\d\d)-(\d\d)-(\d\d)(?![\d])/g)) add(+m[1], +m[2], +m[3], m.index, m[0]);
  for (const m of s.matchAll(/(?<![\d\w.\/-])(\d{1,2})[-\/](\d{1,2})(?:[-\/](20\d\d|\d\d))?(?![\d\/]|-\d|\.\d)/g)) {
    const d = +m[1], mo = +m[2];
    if (mo < 1 || mo > 12 || d < 1 || d > 31) continue;
    const y = m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : year(mo, d);
    add(y, mo, d, m.index, m[0]);
  }
  for (const m of s.matchAll(/(?<![\d\w])(\d{1,2})\s+([a-z]{3,9})\.?(?:\s+(20\d\d))?(?![\w])/gi)) {
    const mo = MONTHS[m[2].toLowerCase()];
    if (!mo) continue;
    const d = +m[1];
    add(m[3] ? +m[3] : year(mo, d), mo, d, m.index, m[0]);
  }
  return out.sort((a, b) => a.index - b.index);
}

/** The sentence of `line` around position `at`. */
function sentenceAt(line, at) {
  const cut = /[.;!?](?=\s|$)|\s[—–]\s/g;
  let start = 0, end = line.length, m;
  while ((m = cut.exec(line))) { if (m.index < at) start = m.index + m[0].length; else { end = m.index; break; } }
  return line.slice(start, end).replace(/\*\*/g, "").trim();
}

/** The current-state lines of a status file: not the log, not dated log lines. */
export function currentLines(text, { accounts, scope = "focus", sections, nextLabels, logHeading = "Log" } = {}) {
  const lines = String(text ?? "").split("\n");
  const labels = [...ballLabels(accounts), ...(nextLabels ?? ["**Volgende actie", "**Next action"])].map((l) => l.toLowerCase());
  const sectionRe = new RegExp(sections ?? "^(volgende acties?|next (actions?|steps)|planning|agenda|afspraken|appointments)\\b", "i");
  const logRe = new RegExp(`^${logHeading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b|^(log|logboek|history|historie)\\b`, "i");
  const out = [];
  let inLog = false, inSection = false, level = 0;
  for (const line of lines) {
    const hm = line.match(/^(#{1,6})\s+(.*)$/);
    if (hm) {
      const l = hm[1].length, title = hm[2].trim();
      if (inLog && l > level) continue;
      inLog = logRe.test(title);
      if (inLog) { level = l; inSection = false; continue; }
      if (inSection && l > level) continue;
      inSection = sectionRe.test(title);
      level = l;
      continue;
    }
    if (inLog || DATED_LOG.test(line) || /~~/.test(line) || !line.trim()) continue;
    const t = line.trim().replace(/^[-*]\s+/, "").toLowerCase();
    if (scope === "all" || inSection || labels.some((l) => t.startsWith(l))) out.push(line);
  }
  return out;
}

/** Calendar items of a range answer, flattened, noise kept (a title is a title). */
const flatten = (r) => Object.entries(r?.days ?? {}).flatMap(([day, items]) => (items ?? []).map((e) => ({ ...e, day })));
const shareWord = (words, summary, folder) => {
  const ev = wordsOf(summary);
  return ev.some((w) => words.includes(w) || (folder && names(w, folder))) || words.some((w) => w.length >= 6 && ev.some((e) => e.startsWith(w) || w.startsWith(e)));
};
const nl = (ctx) => (ctx.config.language ?? "en").startsWith("nl");
const short = (day) => `${+day.slice(8, 10)}-${+day.slice(5, 7)}`;

export default {
  name: "dates-vs-calendar",
  description: "appointment dates in the brain that the calendar does not have, and calendar changes the brain missed",
  needs: ["calendar"],
  async run(ctx, h, options = {}) {
    const a = ctx.config.accounts;
    const dutch = nl(ctx);
    const ahead = options.days ?? 21;
    const max = options.max ?? 10;
    const appt = new RegExp(options.appointment ?? APPOINTMENT, "i");
    const logHeading = options.logHeading ?? "Log";
    const now = new Date();
    const today = dayKey(now);
    const last = dayKey(now.getTime() + ahead * DAY);
    const snapDays = options.snapshotDays ?? 30;
    const range = await h.live("calendar", { what: "range", from: today, to: dayKey(now.getTime() + Math.max(ahead, snapDays) * DAY) });
    if (!range?.days) return [];
    const events = flatten(range);
    const byDay = new Map();
    for (const e of events) byDay.set(e.day, [...(byDay.get(e.day) ?? []), e]);

    // Every dated sentence on a current-state line of an open folder.
    const mentions = [];
    for (const folder of await h.openAccounts(options.sides ?? null)) {
      const file = `${folder}/${a.statusFile}`;
      const text = await h.read(file).catch(() => null);
      if (!text) continue;
      const lines = currentLines(text, { accounts: a, scope: options.scope, sections: options.sections, nextLabels: options.nextLabels, logHeading });
      const all = options.scope === "all" ? lines : currentLines(text, { accounts: a, scope: "all", logHeading });
      for (const line of all) {
        const focus = lines.includes(line);
        for (const d of datesIn(line, now)) {
          const sentence = sentenceAt(line, d.index);
          const many = datesIn(sentence, now).length > 1;
          const tentative = OPTIONS.test(sentence) || HISTORY.test(sentence) || (many && /\s(of|or)\s/i.test(sentence)) || DEADLINE.test(line.slice(Math.max(0, d.index - 24), d.index));
          mentions.push({ tentative, folder, file, day: d.day, raw: d.raw, sentence, words: wordsOf(sentence), focus, appointment: slug(sentence).split("-").some((w) => appt.test(w) && !WEEKDAYS.has(w)) });
        }
      }
    }

    const out = [];
    // 1. Appointments the calendar does not have.
    const asked = new Set();
    for (const m of mentions) {
      if (!m.focus || !m.appointment || m.tentative || m.day < today || m.day > last) continue;
      const that = byDay.get(m.day) ?? [];
      if (that.some((e) => shareWord(m.words, e.summary, m.folder))) continue;
      const key = `${m.file}|${m.day}`;
      if (asked.has(key)) continue;
      asked.add(key);
      const other = that.filter((e) => e.summary).slice(0, 3).map((e) => `"${e.summary}"`).join(", ");
      out.push({
        severity: "warn", kind: "question", where: m.file,
        what: dutch
          ? `"${m.sentence.slice(0, 120)}" noemt ${short(m.day)} als afspraak, maar de agenda heeft die dag niets dat erbij past${other ? ` (wel: ${other})` : ""}`
          : `"${m.sentence.slice(0, 120)}" names ${short(m.day)} as an appointment, but the calendar has nothing that matches that day${other ? ` (it has: ${other})` : ""}`,
        hint: dutch
          ? `Staat het wel vast, zet het dan in de agenda. Zo niet: antwoord met één regel wat die datum is (bijv. "interne datum van de klant, geen afspraak voor mij") en keur goed: die komt onder ## ${logHeading} van \`${m.file}\`. Pas de regel zelf aan als hij niet klopt. Afwijzen als het goed is zo.`
          : `If it is fixed, put it in the calendar. If not, reply with one line on what the date is (e.g. "the client's internal date, not an appointment for me") and approve: it lands under ## ${logHeading} of \`${m.file}\`. Fix the line itself if it is wrong. Reject if all is well.`,
        action: { type: "edit-markdown", inward: true, file: m.file, appendReply: true, under: logHeading, prefix: `- ${today} — ${short(m.day)} ${dutch ? "staat niet in de agenda" : "not in the calendar"}: ` },
      });
    }

    // Cards with an appointment title and a due date the calendar does not have.
    if (options.tasks !== false) {
      let cards = [];
      try { cards = (await h.live("tasks", { what: "cards" }))?.items ?? []; } catch { cards = []; }
      for (const c of cards) {
        const due = c.due ? String(c.due).slice(0, 10) : null;
        if (!due || due < today || due > last || !c.title) continue;
        if (!slug(c.title).split("-").some((w) => appt.test(w) && !WEEKDAYS.has(w))) continue;
        const words = wordsOf(c.title);
        if ((byDay.get(due) ?? []).some((e) => shareWord(words, e.summary, null))) continue;
        out.push({
          severity: "info", kind: "question", where: c.url ?? `tasks:${c.id}`,
          what: dutch ? `kaart "${c.title}" is due ${short(due)}, maar de agenda heeft die dag niets dat erbij past` : `card "${c.title}" is due ${short(due)}, but the calendar has nothing that matches that day`,
          hint: dutch ? "Een deadline mag; een afspraak hoort in de agenda. Klopt de due-datum niet, pas hem aan op de kaart. Afwijzen als het goed is zo." : "A deadline is fine; an appointment belongs in the calendar. If the due date is wrong, change it on the card. Reject if all is well.",
        });
      }
    }

    // 2. Events removed or moved since the last run.
    if (options.snapshot !== false && ctx.stateDir) {
      const file = join(ctx.stateDir, "calendar-snapshot.json");
      const prev = JSON.parse(await readFile(file, "utf8").catch(() => "null"));
      const idOf = (e) => e.uid ?? `${e.summary}|${e.allDay ? "all" : e.start}`;
      const snapTo = dayKey(now.getTime() + snapDays * DAY);
      const current = events.filter((e) => e.day <= snapTo).map((e) => ({ uid: idOf(e), summary: e.summary, day: e.day, start: e.start ?? null }));
      if (prev?.events?.length) {
        const nowBy = new Map();
        for (const e of current) nowBy.set(e.uid, [...(nowBy.get(e.uid) ?? []), e]);
        const prevBy = new Map();
        for (const e of prev.events) prevBy.set(e.uid, [...(prevBy.get(e.uid) ?? []), e]);
        // Only days both snapshots cover and that are still ahead.
        const covered = (d) => d >= today && d <= snapTo && d <= (prev.to ?? d);
        const changes = [];
        for (const [uid, was] of prevBy) {
          const is = nowBy.get(uid) ?? [];
          if (was.length === 1 && is.length === 1) {
            const [w, n] = [was[0], is[0]];
            if (w.day !== n.day && covered(w.day)) changes.push({ type: "moved", e: w, to: n.day });
            continue;
          }
          for (const w of was) if (covered(w.day) && !is.some((n) => n.day === w.day)) changes.push({ type: "removed", e: w });
        }
        for (const ch of changes) {
          const hits = mentions.filter((m) => m.day === ch.e.day && shareWord(m.words, ch.e.summary, m.folder));
          const seen = new Set();
          for (const m of hits) {
            if (seen.has(m.file)) continue;
            seen.add(m.file);
            const was = short(ch.e.day);
            out.push({
              severity: "warn", kind: "question", where: m.file,
              what: ch.type === "moved"
                ? (dutch ? `afspraak "${ch.e.summary}" is in de agenda verplaatst van ${was} naar ${short(ch.to)}; het dossier noemt nog ${was}: "${m.sentence.slice(0, 100)}"` : `appointment "${ch.e.summary}" moved in the calendar from ${was} to ${short(ch.to)}; the file still says ${was}: "${m.sentence.slice(0, 100)}"`)
                : (dutch ? `afspraak "${ch.e.summary}" op ${was} is uit de agenda verdwenen; het dossier noemt die dag nog: "${m.sentence.slice(0, 100)}"` : `appointment "${ch.e.summary}" on ${was} is gone from the calendar; the file still names that day: "${m.sentence.slice(0, 100)}"`),
              hint: dutch
                ? `Antwoord met één regel wat er veranderd is en keur goed: die komt onder ## ${logHeading} van \`${m.file}\`. Pas de regel met de oude datum zelf aan. Afwijzen als de agenda fout is.`
                : `Reply with one line on what changed and approve: it lands under ## ${logHeading} of \`${m.file}\`. Fix the line with the old date yourself. Reject if the calendar is wrong.`,
              action: { type: "edit-markdown", inward: true, file: m.file, appendReply: true, under: logHeading, prefix: `- ${today} — ${ch.e.summary.replace(/\s+/g, " ").trim()} (${ch.type === "moved" ? `${was} → ${short(ch.to)}` : `${was}, ${dutch ? "uit de agenda" : "removed"}`}): ` },
            });
          }
        }
      }
      await mkdir(ctx.stateDir, { recursive: true });
      await writeFile(file, JSON.stringify({ taken: now.toISOString(), from: today, to: snapTo, events: current }, null, 2) + "\n");
    }

    if (out.length > max) {
      const more = out.length - max;
      return [...out.slice(0, max), { severity: "warn", where: a.root, what: dutch ? `${out.length} datums wijken af van de agenda, ${more} meer dan getoond` : `${out.length} dates disagree with the calendar, ${more} more than shown` }];
    }
    return out;
  },
};
