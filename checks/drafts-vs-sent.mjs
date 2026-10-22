/**
 * A draft that already went out, while the brain still says "ball with you".
 *
 * The brain writes a mail into the folder and into the Drafts folder, and the
 * status file says: ball with you, send the draft. The human sends it from the
 * mail client. Nothing tells the folder, so the morning plan keeps listing the
 * mail as waiting. mail-vs-accounts notices the sent mail too, but it proposes
 * an agent run that waits for approval; until then the ball line is wrong.
 * This check reads Sent (and Drafts) headers only, no model, and says three
 * things:
 *
 *   1. ball line: the status file's ball line is with you and mentions a draft
 *      ("versturen", "in Drafts"), and a mail to an address of that folder
 *      went out after the draft was written. Proposal: replace that one ball
 *      line with "ball with <who comes next> — sent <when>: <subject>" and file
 *      one dated line under the log. `auto: "ball-line-sent"`: when the config
 *      lists that in `inbox.autoApprove`, the engine applies it without asking
 *      (see autoApprovable in core/checks.mjs for the exact shape allowed).
 *   2. concept file: a `mail-*` file in the folder whose frontmatter status
 *      says concept/draft, with a matching sent mail. Proposal (never auto):
 *      set its status to "verstuurd <when>".
 *   3. leftovers: drafts in the Drafts folder whose recipient and subject
 *      match a mail sent after them. One finding that lists them. Nothing is
 *      deleted, ever: the human cleans up Drafts in the mail client.
 *
 * When the mail server cannot be reached (Bridge not running, a timeout) the
 * check throws `{ skip: true }`: no finding, no crash, its open items stay.
 *
 * Configure: checks["drafts-vs-sent"] = {
 *   days: 14,                                  // how far back Sent and Drafts are read
 *   sides: null,                               // account sides; default open + won
 *   mailboxes: { sent: "Sent", drafts: "Drafts" },
 *   pending: "\\b(drafts?|concept\\w*|versturen|verstuur\\w*|sturen|send|sending)\\b",  // regex: a ball line waiting on a draft
 *   logUnder: "Log",                           // heading the dated line goes under
 *   timeZone: "Europe/Amsterdam",              // how times are written; default the machine's
 *   leftovers: true,                           // list drafts left behind after sending
 *   maxLeftovers: 20
 * }
 */
import { readdir, stat } from "node:fs/promises";
import { findBallLine, frontmatter } from "../core/markdown.mjs";
import { addressesOf, addressesIn, recipientsOf } from "./mail-vs-accounts.mjs";

const PENDING = "\\b(drafts?|concept\\w*|versturen|verstuur\\w*|sturen|send|sending)\\b";
const CALENDAR = /^(re: |fwd?: )*(invitation|uitnodiging|update|cancellation|annulering|accepted|geaccepteerd|declined|afgewezen|tentative|voorlopig)\b|\baccepted by\b/i;
const MAIL_FILE = /^mail-.*\.(md|txt|eml)$/i;
const NETWORK = /^(ECONNREFUSED|ETIMEDOUT|ECONNRESET|EHOSTUNREACH|ENETUNREACH|ENOTFOUND|EPIPE)$/;

/** Subject without reply/forward prefixes, quotes and case: what a draft and its sent copy share. */
export function normSubject(s) {
  let t = String(s ?? "").trim().replace(/^["'“”]+|["'“”]+$/g, "");
  for (let i = 0; i < 5; i++) t = t.replace(/^(re|fw|fwd|aw|antw|sv)\s*:\s*/i, "");
  return t.replace(/\s+/g, " ").trim().toLowerCase();
}

/** "21-10 16:28" in the given time zone. */
export function shortTime(iso, timeZone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date(iso)).map((p) => [p.type, p.value]));
  return `${parts.day}-${parts.month} ${parts.hour}:${parts.minute}`;
}

/** Who has the ball after you: "daarna bij Anna en Sanne (intake doen)" → "Anna en Sanne (intake doen)". */
export function nextHolder(holder) {
  return String(holder ?? "").match(/\b(?:daarna|dan|then|after that)\s+(?:bij|with)\s+(.+?)(?:\.\s|\.$|;|$)/i)?.[1]?.trim() ?? null;
}

/** Subject and status a mail file declares about itself (frontmatter or a header block). */
export function mailFileMeta(text) {
  const head = String(text ?? "").split("\n").slice(0, 20).join("\n");
  const { meta } = frontmatter(text);
  const subject = meta.onderwerp ?? meta.subject ?? head.match(/^(?:onderwerp|subject)\s*:\s*(.+)$/im)?.[1] ?? null;
  return { subject: subject ? subject.trim().replace(/^["']|["']$/g, "") : null, status: meta.status ?? null, hasFrontmatter: /^---\n[\s\S]*?\n---/.test(text) };
}

/** A failure to reach the mail server is a skip, not a crash. */
function asSkip(e) {
  if (NETWORK.test(e?.code ?? "") || /timed out|connection closed/i.test(e?.message ?? "")) return Object.assign(new Error(`mail server not reachable (${e.code ?? e.message})`), { skip: true });
  return e;
}

const nl = (ctx) => (ctx.config.language ?? "en").startsWith("nl");

export default {
  name: "drafts-vs-sent",
  description: "a draft the folder still waits on that was already sent; drafts left behind after sending",
  needs: ["mail"],
  async run(ctx, h, options = {}) {
    const a = ctx.config.accounts;
    const days = options.days ?? 14;
    const boxes = { sent: "Sent", drafts: "Drafts", ...(options.mailboxes ?? {}) };
    const pending = new RegExp(options.pending ?? PENDING, "i");
    const self = new RegExp(`\\b(${(ctx.config.pipeline?.ballSelf ?? ["me", "us"]).join("|")})\\b`, "i");
    const tz = options.timeZone ?? ctx.config.timeZone ?? undefined;
    const cutoff = Date.now() - days * 864e5;
    const mailConnector = Object.entries(ctx.config.connectors ?? {}).find(([n, o]) => n === "imap" || o?.kind === "mail")?.[1];
    const ignore = [...(ctx.config.checks?.["mail-vs-accounts"]?.ignore ?? []), ...(options.ignore ?? []), ...addressesIn(mailConnector?.from)].map((s) => s.toLowerCase());
    const dutch = nl(ctx);

    // The folders first: only a folder that waits on a draft is worth a look.
    const waiting = [];
    for (const folder of await h.openAccounts(options.sides ?? null)) {
      const files = (await readdir(ctx.path(folder)).catch(() => [])).filter((n) => !n.startsWith("."));
      const statusRel = `${folder}/${a.statusFile}`;
      const status = files.includes(a.statusFile) ? await h.read(statusRel).catch(() => "") : "";
      const ball = findBallLine(status, a);
      const ballWaits = !!ball && self.test(ball.holder.split(/[—–(:,.;]/)[0]) && pending.test(ball.holder);
      const mails = [];
      for (const f of files.filter((n) => MAIL_FILE.test(n))) {
        const text = await h.read(`${folder}/${f}`).catch(() => "");
        const s = await stat(ctx.path(`${folder}/${f}`)).catch(() => null);
        mails.push({ file: `${folder}/${f}`, mtime: s?.mtimeMs ?? 0, ...mailFileMeta(text) });
      }
      const concepts = mails.filter((m) => m.hasFrontmatter && m.status && /concept|draft/i.test(m.status) && !/^\s*(verstuurd|sent)\b/i.test(m.status));
      if (!ballWaits && !concepts.length) continue;
      const addresses = (await addressesOf({ read: h.read, path: ctx.path }, folder, files, ignore)).outgoing;
      if (!addresses.size) continue;
      const statusMtime = (await stat(ctx.path(statusRel)).catch(() => null))?.mtimeMs ?? 0;
      waiting.push({ folder, statusRel, status, ball: ballWaits ? ball : null, mails, concepts, addresses, statusMtime });
    }
    const wantLeftovers = options.leftovers !== false;
    if (!waiting.length && !wantLeftovers) return [];

    let sent = [], drafts = [];
    try {
      sent = (await h.live("mail", { what: "since", days, mailbox: boxes.sent }))?.items ?? [];
      if (wantLeftovers && boxes.drafts) drafts = (await h.live("mail", { what: "since", days, mailbox: boxes.drafts }))?.items ?? [];
    } catch (e) { throw asSkip(e); }
    sent = sent.filter((m) => m.date && Date.parse(m.date) >= cutoff && !CALENDAR.test(m.subject ?? "")).sort((x, y) => x.date.localeCompare(y.date));

    const out = [];
    /** The first mail sent after `since` to an address of the folder, with one of `subjects` when the folder named any. */
    const firstSent = (w, since, subjects) => sent.find((m) => Date.parse(m.date) > since && recipientsOf(m).some((r) => w.addresses.has(r)) && (!subjects.length || subjects.includes(normSubject(m.subject))));

    for (const w of waiting) {
      const subjects = [...new Set(w.mails.map((m) => m.subject).filter(Boolean).map(normSubject))];
      if (w.ball) {
        // The draft was written when its mail file was; without one, when the status file last changed.
        const since = w.mails.length ? Math.max(...w.mails.map((m) => m.mtime)) : w.statusMtime;
        const m = firstSent(w, since, subjects);
        if (m) {
          const to = recipientsOf(m).filter((r) => w.addresses.has(r));
          const when = shortTime(m.date, tz);
          // Who is next: the ball line's own "daarna bij …", else the same phrase on a
          // to-do line of the status file that is also with you ("Bal bij Sam: draft
          // versturen. Daarna bij Anna en Sanne"), else the recipient's name.
          const todo = w.status.split("\n").find((l) => !/^\s*[-*]\s*\d{4}-\d\d-\d\d/.test(l) && self.test(l) && pending.test(l) && nextHolder(l));
          const next = nextHolder(w.ball.holder) ?? (todo ? nextHolder(todo) : null) ?? (String(m.to ?? "").replace(/<[^>]+>/g, "").replace(/"/g, "").replace(/\s+,/g, ",").trim() || to[0]);
          const raw = w.ball.line;
          const at = raw.indexOf(w.ball.label) + w.ball.label.length;
          const lead = /^[:\s]*(bij|with)\s/i.test(raw.slice(at)) ? `${raw.slice(at).match(/^[:\s]*(bij|with)\s/i)[1]} ` : "";
          const line = `${raw.slice(0, at)} ${lead}${next} — ${dutch ? "verstuurd" : "sent"} ${when}: "${m.subject}" ${dutch ? "aan" : "to"} ${to.join(", ")} (auto, drafts-vs-sent)`;
          const day = new Date().toISOString().slice(0, 10);
          const log = dutch
            ? `- ${day} — Verstuurd ${when}: "${m.subject}" aan ${to.join(", ")} (gezien in Sent). Bal-regel was: "${w.ball.holder}". Automatisch bijgewerkt door drafts-vs-sent.`
            : `- ${day} — Sent ${when}: "${m.subject}" to ${to.join(", ")} (seen in Sent). Ball line was: "${w.ball.holder}". Updated by drafts-vs-sent.`;
          out.push({
            severity: "warn", kind: "proposal", auto: "ball-line-sent", where: w.statusRel,
            what: dutch
              ? `verstuurd ${when}: "${m.subject}" aan ${to.join(", ")}; de bal-regel staat nog bij jou: "${w.ball.holder.slice(0, 90)}"`
              : `sent ${when}: "${m.subject}" to ${to.join(", ")}; the ball line still says it is with you: "${w.ball.holder.slice(0, 90)}"`,
            hint: dutch
              ? `Goedkeuren: de bal-regel wordt "${line.trim().slice(0, 160)}" en er komt één regel onder ## ${options.logUnder ?? "Log"}. Er wordt niets verstuurd. Staat \`ball-line-sent\` in inbox.autoApprove, dan gebeurt dit vanzelf.`
              : `Approve: the ball line becomes "${line.trim().slice(0, 160)}" and one line goes under ## ${options.logUnder ?? "Log"}. Nothing is sent. With \`ball-line-sent\` in inbox.autoApprove this happens by itself.`,
            action: { type: "edit-markdown", inward: true, file: w.statusRel, replace: [{ from: raw, to: line }], log: { under: options.logUnder ?? "Log", line: log } },
          });
        }
      }
      for (const c of w.concepts) {
        const m = firstSent(w, c.mtime, c.subject ? [normSubject(c.subject)] : []);
        if (!m) continue;
        const when = shortTime(m.date, tz);
        out.push({
          severity: "warn", kind: "proposal", where: c.file,
          what: dutch ? `concept is al verstuurd ${when}: "${m.subject}", het bestand zegt nog "${c.status}"` : `draft already sent ${when}: "${m.subject}", the file still says "${c.status}"`,
          hint: dutch ? `Goedkeuren: status in de frontmatter wordt "verstuurd ${when}". Er wordt niets verstuurd.` : `Approve: the frontmatter status becomes "sent ${when}". Nothing is sent.`,
          action: { type: "set-frontmatter", file: c.file, fields: { status: dutch ? `verstuurd ${when}` : `sent ${when}` } },
        });
      }
    }

    if (wantLeftovers) {
      const left = [];
      for (const d of drafts) {
        const subj = normSubject(d.subject);
        const rcpt = recipientsOf(d);
        if (!d.date || !subj || subj === "(no subject)" || !rcpt.length) continue;
        const m = sent.find((s) => Date.parse(s.date) > Date.parse(d.date) && normSubject(s.subject) === subj && recipientsOf(s).some((r) => rcpt.includes(r)));
        if (m) left.push({ d, m });
      }
      if (left.length) {
        const MAX = options.maxLeftovers ?? 20;
        const list = left.slice(0, MAX).map(({ d, m }) => `"${d.subject}" ${dutch ? "aan" : "to"} ${recipientsOf(d)[0]} (${dutch ? "concept" : "draft"} ${shortTime(d.date, tz)}, ${dutch ? "verstuurd" : "sent"} ${shortTime(m.date, tz)})`);
        out.push({
          severity: "info", kind: "question", where: boxes.drafts,
          what: dutch
            ? `${left.length} concept${left.length === 1 ? "" : "en"} in ${boxes.drafts} ${left.length === 1 ? "is" : "zijn"} al verstuurd: ${list.join("; ")}${left.length > MAX ? `; +${left.length - MAX} meer` : ""}`
            : `${left.length} draft${left.length === 1 ? "" : "s"} in ${boxes.drafts} already sent: ${list.join("; ")}${left.length > MAX ? `; +${left.length - MAX} more` : ""}`,
          hint: dutch
            ? `Ruim ze zelf op in je mailprogramma als ze weg mogen. Het brein verwijdert geen mail. Afwijzen = deze melding stil.`
            : `Clean them up in your mail client if they can go. The brain never deletes mail. Reject to silence.`,
        });
      }
    }
    return out;
  },
};
