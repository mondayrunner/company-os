/**
 * A mail from a known contact that the account folder has not seen yet.
 *
 * The brain answers "what is going on with Harper" from the folder. Mail is
 * live and never copied, so a reply that came in yesterday is invisible to
 * `account` until someone writes it into the status file. Nothing in the
 * folder goes stale, no link breaks; the folder simply says "waiting for
 * Jane" while Jane answered. This check closes that gap without a model:
 * addresses are read from the folder's own files, the mailbox is read once
 * per side (in and sent), and every mail newer than the folder's newest file
 * is a finding. Process the mail into the folder and the finding closes
 * itself on the next run.
 *
 * Needs a connector of kind "mail" with live({ what: "since", days, mailbox })
 * → { items: [{ uid, subject, from, address, to, date }] }.
 *
 * Configure: checks["mail-vs-accounts"] = {
 *   days: 30,                 // how far back to read the mailboxes
 *   sides: null,              // account sides to watch; default open + won sides
 *   mailboxes: { in: "INBOX", out: "Sent" },   // set out to null to skip sent mail
 *   ignore: ["@acme.example"],// own addresses/domains; connectors.<mail>.from is added by itself
 *   skip: ["^out of office"], // subjects (regex) that are traffic, not contact; the calendar's own notices are skipped by default
 *   max: 3,                   // mails named per folder, and read in full for the proposal
 *   bodies: true              // read those mails so approving the finding writes them into the folder
 * }
 *
 * The finding is a proposal: approve it and an agent writes what the mails
 * change into the status file (a dated log line, the ball, the next action).
 * The mails travel inside the item, so the agent needs no mailbox of its own;
 * it reads what the check read and edits one file.
 */
import { readdir } from "node:fs/promises";

const EMAIL = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
const GENERIC = /^(no-?reply|noreply|notifications?|mailer-daemon|postmaster|bounce|newsletter|info|support|hello|hallo|team)@/i;
const TEXT_FILES = /\.(md|txt|eml)$/i;
// The calendar mailing its own invitations, updates, acceptances and cancellations is not the contact writing.
const CALENDAR = /^(re: |fwd?: )*(invitation|uitnodiging|update|cancellation|annulering|accepted|geaccepteerd|declined|afgewezen|tentative|voorlopig)\b|\baccepted by\b/i;

/** Addresses mentioned anywhere in the folder's text files, lower-cased, minus our own and the generic ones. */
async function addressesOf(ctx, folder, files, ignore) {
  const out = new Set();
  for (const f of files.filter((n) => TEXT_FILES.test(n))) {
    const text = await ctx.read(`${folder}/${f}`).catch(() => "");
    for (const m of text.match(EMAIL) ?? []) {
      const a = m.toLowerCase();
      if (GENERIC.test(a)) continue;
      if (ignore.some((ig) => (ig.startsWith("@") ? a.endsWith(ig) : a === ig))) continue;
      out.add(a);
    }
  }
  return out;
}

const day = (iso) => (iso ?? "").slice(0, 10);
// Where a reply stops being the reply and starts quoting the thread.
const QUOTE = /\n(on .{5,120} wrote:|op .{5,120} schreef|-{3,} ?(original|forwarded) message|van: .+\nverzonden:|from: .+\nsent:|>\s)/i;
/** The body without the quoted thread under it, cut to a size an agent can read in one go. */
export function excerpt(body, max = 1500) {
  const own = String(body ?? "").replace(/\r/g, "").split(QUOTE)[0].trim();
  return own.length > max ? `${own.slice(0, max)}…` : own;
}
const addressesIn = (s) => (String(s ?? "").match(EMAIL) ?? []).map((a) => a.toLowerCase());

export default {
  name: "mail-vs-accounts",
  description: "mail from a known contact newer than its account folder",
  needs: ["mail"],
  async run(ctx, h, options = {}) {
    const a = ctx.config.accounts;
    const days = options.days ?? 30;
    const max = options.max ?? 3;
    const bodies = options.bodies !== false;
    const boxes = { in: "INBOX", out: "Sent", ...(options.mailboxes ?? {}) };
    const mailConnector = Object.entries(ctx.config.connectors ?? {}).find(([n, o]) => n === "imap" || o?.kind === "mail")?.[1];
    const own = addressesIn(mailConnector?.from);
    const ignore = [...(options.ignore ?? []), ...own].map((s) => s.toLowerCase());
    const skip = [CALENDAR, ...(options.skip ?? []).map((re) => new RegExp(re, "i"))];
    const traffic = (m) => skip.some((re) => re.test(m.subject ?? ""));

    const folders = await h.openAccounts(options.sides ?? null);
    if (!folders.length) return [];

    // The folders first: their addresses decide whether the mail is worth reading at all.
    const known = [];
    for (const folder of folders) {
      const files = (await readdir(ctx.path(folder)).catch(() => [])).filter((n) => !n.startsWith("."));
      const addresses = await addressesOf({ read: h.read, path: ctx.path }, folder, files, ignore);
      if (!addresses.size) continue;
      known.push({ folder, addresses, touched: await h.touched(folder) });
    }
    if (!known.length) return [];

    // The mailboxes once each, headers only.
    const incoming = boxes.in ? (await h.live("mail", { what: "since", days, mailbox: boxes.in }))?.items ?? [] : [];
    const outgoing = boxes.out ? (await h.live("mail", { what: "since", days, mailbox: boxes.out }).catch(() => null))?.items ?? [] : [];

    const out = [];
    for (const k of known) {
      const hits = [];
      for (const m of incoming) if (m.date && Date.parse(m.date) > k.touched && !traffic(m) && k.addresses.has((m.address ?? "").toLowerCase())) hits.push({ dir: "from", who: m.from || m.address, ...m });
      for (const m of outgoing) if (m.date && Date.parse(m.date) > k.touched && !traffic(m) && addressesIn(m.to).some((t) => k.addresses.has(t))) hits.push({ dir: "to", who: addressesIn(m.to).find((t) => k.addresses.has(t)), ...m });
      if (!hits.length) continue;
      hits.sort((x, y) => (y.date ?? "").localeCompare(x.date ?? ""));
      const top = hits.slice(0, max);
      const shown = top.map((m) => `${m.dir} ${m.who} ${day(m.date)} "${m.subject}"`).join("; ");
      const statusRel = `${k.folder}/${a.statusFile}`;
      const finding = {
        severity: "warn",
        where: statusRel,
        what: `${hits.length} mail${hits.length === 1 ? "" : "s"} newer than the folder (last touched ${new Date(k.touched).toISOString().slice(0, 10)}): ${shown}${hits.length > max ? `; +${hits.length - max} more` : ""}`,
      };
      if (bodies) {
        // The mails themselves, so approving needs no second look-up: the
        // check has the connector, the executor deliberately has none.
        const read = [];
        for (const m of top) {
          const r = await h.live("mail", { what: "read", uid: m.uid, mailbox: m.dir === "from" ? boxes.in : boxes.out }).catch(() => null);
          read.push(`### ${m.dir === "from" ? "From" : "To"} ${m.who} · ${day(m.date)} · "${m.subject}"\n${excerpt(r?.item?.body) || "(no readable text)"}`);
        }
        finding.kind = "proposal";
        finding.hint = `Approve: an agent writes what these mails change into \`${statusRel}\` (dated log line, ball, next action) — nothing is sent. Reply first to steer it. Reject: silence.`;
        finding.action = { type: "agent", inward: true, instruction: [
          `Update \`${statusRel}\` with what the messages below change. Read the file first and keep its structure and language.`,
          `Add one dated log entry (${new Date().toISOString().slice(0, 10)}) that says what was said, decided or promised, and by whom. If the ball moved, update the line that starts with \`${a.ballLine ?? "**Ball:**"}\`; if the next action changed, update it. Do not invent: when the messages change nothing, add a one-line log entry saying so and stop.`,
          `Do not answer these messages, do not draft anything, only edit the status file.`,
          "", ...read,
        ].join("\n\n") };
      }
      out.push(finding);
    }
    return out;
  },
};
