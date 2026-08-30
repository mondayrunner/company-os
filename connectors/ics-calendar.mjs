/**
 * Any calendar that publishes an ICS feed (Proton "share with anyone", Google
 * secret address, Fastmail…). Read live; zero-dependency parser with the
 * recurrence rules people actually use (DAILY/WEEKLY/MONTHLY/YEARLY, INTERVAL,
 * BYDAY, UNTIL, EXDATE). Local time zone = the machine's.
 *
 *   "ics-calendar": { "envFile": "~/.config/daily-planner/.env", "urlName": "PROTON_ICS_URL" }   // or "url": "https://…"
 *
 * live({ what: "today" })                      → { items: [{ start, end, summary, allDay }] }
 * live({ what: "range", from, to })            → { days: { "YYYY-MM-DD": [items] } }
 */
import { secret, fetchRetry } from "../core/env.mjs";

const DAY = 86400000;
const DAYCODE = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

export function unfold(raw) { return raw.replace(/\r\n/g, "\n").replace(/\n[ \t]/g, "").split("\n"); }

function parseDate(value, utc) {
  const m = value.match(/(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2}))?/);
  if (!m) return null;
  const [, y, mo, d, hh = "0", mm = "0", ss = "0"] = m;
  const n = [+y, +mo - 1, +d, +hh, +mm, +ss];
  return utc ? new Date(Date.UTC(...n)) : new Date(...n);
}

function parseRrule(s) {
  const r = { freq: null, interval: 1, byday: [], until: null };
  for (const part of s.split(";")) {
    const [k, v] = part.split("=");
    if (k === "FREQ") r.freq = v;
    else if (k === "INTERVAL") r.interval = parseInt(v, 10) || 1;
    else if (k === "BYDAY") r.byday = v.split(",").map((d) => DAYCODE[d.slice(-2)]).filter((n) => n !== undefined);
    else if (k === "UNTIL") r.until = parseDate(v, /Z$/.test(v));
  }
  return r;
}

export function parseEvents(lines) {
  const events = [];
  let cur = null;
  for (const line of lines) {
    if (line === "BEGIN:VEVENT") { cur = { exdates: [] }; continue; }
    if (line === "END:VEVENT") { if (cur?.start) events.push(cur); cur = null; continue; }
    if (!cur) continue;
    const ci = line.indexOf(":");
    if (ci === -1) continue;
    const [name, ...paramParts] = line.slice(0, ci).split(";");
    const value = line.slice(ci + 1);
    const params = Object.fromEntries(paramParts.map((p) => p.split("=")));
    const utc = /Z$/.test(value), dateOnly = params.VALUE === "DATE";
    if (name === "DTSTART") { cur.start = parseDate(value, utc); cur.allDay = dateOnly; }
    else if (name === "DTEND") cur.end = parseDate(value, utc);
    else if (name === "SUMMARY") cur.summary = value.replace(/\\,/g, ",").replace(/\\n/g, " ").replace(/\\\\/g, "\\").trim();
    else if (name === "RRULE") cur.rrule = parseRrule(value);
    else if (name === "EXDATE") { const d = parseDate(value, utc); if (d) cur.exdates.push(d); }
  }
  return events;
}

const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const midnight = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

export function occursOn(ev, target) {
  const start = ev.start;
  if (target < midnight(start)) return false;
  if (ev.exdates?.some((x) => sameDay(x, target))) return false;
  if (!ev.rrule) {
    if (!ev.end) return sameDay(start, target);
    const endDay = midnight(new Date(ev.end.getTime() - 1)); // DTEND is exclusive
    return target >= midnight(start) && target <= endDay;
  }
  const r = ev.rrule;
  if (r.until && target > r.until) return false;
  switch (r.freq) {
    case "DAILY": return Math.round((target - midnight(start)) / DAY) % r.interval === 0;
    case "WEEKLY": {
      const days = new Set(r.byday.length ? r.byday : [start.getDay()]);
      if (!days.has(target.getDay())) return false;
      const a = new Date(start.getFullYear(), start.getMonth(), start.getDate() - start.getDay());
      const t = new Date(target.getFullYear(), target.getMonth(), target.getDate() - target.getDay());
      return Math.round((t - a) / (7 * DAY)) % r.interval === 0;
    }
    case "MONTHLY": return target.getDate() === start.getDate() && ((target.getFullYear() - start.getFullYear()) * 12 + target.getMonth() - start.getMonth()) % r.interval === 0;
    case "YEARLY": return target.getMonth() === start.getMonth() && target.getDate() === start.getDate() && (target.getFullYear() - start.getFullYear()) % r.interval === 0;
    default: return false;
  }
}

export function eventsOn(all, target) {
  const seen = new Set();
  return all.filter((ev) => occursOn(ev, target)).map((ev) => {
    const s = new Date(target); s.setHours(ev.start.getHours(), ev.start.getMinutes(), 0, 0);
    const e = ev.end ? new Date(s.getTime() + (ev.end - ev.start)) : null;
    return { start: ev.allDay ? null : s.toISOString(), end: ev.allDay ? null : e?.toISOString() ?? null, summary: ev.summary || "(no title)", allDay: !!ev.allDay };
  }).sort((a, b) => (a.allDay ? -1 : b.allDay ? 1 : a.start < b.start ? -1 : 1))
    .filter((e) => { const k = `${e.allDay ? "all" : e.start}|${e.summary}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

async function feed(options) {
  const url = options?.url ?? (await secret(options, options?.urlName ?? "ICS_URL"));
  const r = await fetchRetry(url);
  if (!r.ok) throw new Error(`ICS ${r.status}`);
  return parseEvents(unfold(await r.text()));
}

const key = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export default {
  name: "ics-calendar",
  kind: "calendar",
  volatile: true,
  location: (ctx, o) => (o?.url ? new URL(o.url).host : o?.urlName ?? "ICS_URL"),
  async live(query, ctx, options) {
    const all = await feed(options);
    const what = query?.what ?? "today";
    if (what === "today") return { items: eventsOn(all, midnight(new Date())), fetched: new Date().toISOString() };
    if (what === "range") {
      const from = midnight(new Date(query.from)), to = midnight(new Date(query.to ?? query.from));
      const days = {};
      for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) days[key(d)] = eventsOn(all, new Date(d));
      return { days, fetched: new Date().toISOString() };
    }
    throw new Error(`ics-calendar: unknown query "${what}"`);
  },
  async scan(ctx, options) {
    const date = new Date().toISOString().slice(0, 10);
    const { items } = await this.live({ what: "today" }, ctx, options);
    return { metrics: [{ date, key: "events_today", value: items.length }], count: items.length, message: `${items.length} events today` };
  },
};
