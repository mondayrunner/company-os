/**
 * Mail over IMAP, read live: unread headers, a search with bodies, one mail by
 * uid — and one reversible write: a draft. Works with any IMAP server; with
 * Proton Mail Bridge it is 127.0.0.1:1143 without TLS verification (local,
 * self-signed). Minimal client on node:net/node:tls, no dependency: LOGIN,
 * EXAMINE, SEARCH, FETCH, APPEND, and SELECT + STORE/EXPUNGE only to replace
 * an earlier draft. Never marks anything as read, never sends. A draft lands in the Drafts folder and stays there until a human
 * sends it from the mail client.
 *
 *   "imap": { "envFile": "~/.config/mail/.env", "host": "127.0.0.1", "port": 1143,
 *             "secure": false, "userName": "BRIDGE_USER", "passName": "BRIDGE_PASS",
 *             "mailbox": "INBOX", "drafts": "Drafts", "from": "Jane <jane@example.com>" }
 *
 * live({ what: "unread", limit: 40 })           → { unread, items: [{ uid, subject, from, address, date }] }
 * live({ what: "since", days: 30, limit: 300 })  → { found, items: [{ uid, subject, from, address, to, date }] }  headers only
 * live({ what: "search", query, limit: 5 })     → { items: [{ uid, subject, from, address, to, date, body, attachments }] }
 * live({ what: "read", uid })                   → { item }
 * act("draft", { to, subject, body })           → { mailbox, subject, to, replaced }
 */
import { connect as tcp } from "node:net";
import { connect as tls } from "node:tls";
import { secret } from "../core/env.mjs";

const BODY_CHARS = 6000;

class Imap {
  constructor(socket) { this.s = socket; this.n = 0; this.buf = ""; this.waiters = []; socket.on("data", (d) => this.onData(d.toString("binary"))); }
  onData(chunk) {
    this.buf += chunk;
    const w = this.waiters[0];
    if (!w) return;
    if (w.continuation && /(^|\n)\+ /.test(this.buf)) { this.buf = this.buf.replace(/(^|\n)\+ [^\n]*\n?/, "$1"); w.continuation(); w.continuation = null; }
    const re = new RegExp(`(^|\\n)${w.tag} (OK|NO|BAD)[^\\n]*\\n`);
    const m = this.buf.match(re);
    if (m) { const end = m.index + m[0].length; const text = this.buf.slice(0, end); this.buf = this.buf.slice(end); this.waiters.shift(); m[2] === "OK" ? w.resolve(text) : w.reject(new Error(`IMAP ${w.cmd}: ${m[0].trim()}`)); }
  }
  cmd(line) {
    const tag = `A${++this.n}`;
    return new Promise((resolve, reject) => { this.waiters.push({ tag, cmd: line.split(" ")[0], resolve, reject }); this.s.write(`${tag} ${line}\r\n`); });
  }
  /** A command with a literal: send the header, wait for "+", send the bytes. */
  literal(line, data) {
    const tag = `A${++this.n}`;
    const bytes = Buffer.from(data, "utf8");
    return new Promise((resolve, reject) => {
      const w = { tag, cmd: line.split(" ")[0], resolve, reject, continuation: () => { this.s.write(bytes); this.s.write("\r\n"); } };
      this.waiters.push(w);
      this.s.write(`${tag} ${line} {${bytes.length}}\r\n`);
    });
  }
  async greeting() { await new Promise((r) => { const check = () => (/\n/.test(this.buf) ? (this.buf = "", r()) : setTimeout(check, 20)); check(); }); }
  end() { this.s.end(); }
}

export function parseHeaders(block) {
  const out = {};
  for (const line of block.replace(/\r\n[ \t]+/g, " ").replace(/\n[ \t]+/g, " ").split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z-]+):\s*(.*)$/);
    if (m) out[m[1].toLowerCase()] = decodeWords(m[2].trim());
  }
  return out;
}

/** RFC 2047 encoded words (=?utf-8?B?...?= / ?Q?) → text. */
export function decodeWords(s) {
  return s.replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (_, cs, enc, txt) => {
    try {
      const bytes = enc.toUpperCase() === "B" ? Buffer.from(txt, "base64") : Buffer.from(txt.replace(/_/g, " ").replace(/=([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16))), "binary");
      return new TextDecoder(cs.toLowerCase() === "utf-8" ? "utf-8" : "latin1").decode(bytes);
    } catch { return txt; }
  }).replace(/\?=\s+=\?/g, "?==?");
}

/** Text → RFC 2047 word when it is not plain ASCII. */
export const encodeWord = (s) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?utf-8?B?${Buffer.from(s, "utf8").toString("base64")}?=`);

function fromParts(v = "") {
  const m = v.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  return m ? { from: m[1].trim() || m[2], address: m[2] } : { from: v.trim(), address: v.replace(/[<>]/g, "").trim() };
}

const decodeBody = (text, encoding, charset) => {
  const enc = (encoding ?? "").toLowerCase();
  const bytes = enc === "base64" ? Buffer.from(text.replace(/\s+/g, ""), "base64")
    : enc === "quoted-printable" ? Buffer.from(text.replace(/=\r?\n/g, "").replace(/=([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16))), "binary")
    : Buffer.from(text, "binary");
  try { return new TextDecoder((charset ?? "utf-8").toLowerCase() === "utf-8" ? "utf-8" : "latin1").decode(bytes); } catch { return bytes.toString("latin1"); }
};

const stripHtml = (html) => html.replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, "").replace(/<br\s*\/?>|<\/p>|<\/div>|<\/tr>|<\/li>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/\n{3,}/g, "\n\n").trim();

/**
 * The readable text of a raw RFC 822 message and the names of its attachments.
 * Prefers text/plain, falls back to text/html stripped of tags, walks nested
 * multiparts. Exported so it can be tested without a server.
 */
export function bodyText(raw) {
  const split = raw.indexOf("\r\n\r\n") >= 0 ? "\r\n\r\n" : "\n\n";
  const at = raw.indexOf(split);
  const headers = parseHeaders(at >= 0 ? raw.slice(0, at) : raw);
  const body = at >= 0 ? raw.slice(at + split.length) : "";
  const ctype = headers["content-type"] ?? "text/plain";
  const type = ctype.toLowerCase();
  const charset = ctype.match(/charset="?([^";\s]+)"?/i)?.[1];
  const attachments = [];
  const name = (headers["content-disposition"] ?? "").match(/filename="?([^";]+)"?/i)?.[1] ?? ctype.match(/name="?([^";]+)"?/i)?.[1];
  if (/attachment/i.test(headers["content-disposition"] ?? "") && name) return { text: "", html: "", attachments: [name] };
  const boundary = ctype.match(/boundary="?([^";]+)"?/i)?.[1];
  if (boundary && type.startsWith("multipart/")) {
    let text = "", html = "";
    for (const part of body.split(`--${boundary}`).slice(1)) {
      if (part.startsWith("--")) break;
      const r = bodyText(part.replace(/^\r?\n/, ""));
      attachments.push(...r.attachments);
      if (r.text && !text) text = r.text;
      if (r.html && !html) html = r.html;
    }
    return { text, html, attachments };
  }
  const decoded = decodeBody(body, headers["content-transfer-encoding"], charset);
  if (type.startsWith("text/html")) return { text: "", html: decoded, attachments };
  if (type.startsWith("text/")) return { text: decoded, html: "", attachments };
  return { text: "", html: "", attachments: name ? [name] : [] };
}

/** One FETCH response with a `BODY[]` literal → the raw message, or null. */
function literalOf(res) {
  const m = res.match(/BODY\[\] \{(\d+)\}\r?\n/);
  if (!m) return null;
  const start = m.index + m[0].length;
  return res.slice(start, start + Number(m[1]));
}

function itemOf(uid, raw) {
  const at = raw.indexOf("\r\n\r\n") >= 0 ? raw.indexOf("\r\n\r\n") : raw.indexOf("\n\n");
  const h = parseHeaders(at >= 0 ? raw.slice(0, at) : raw);
  const { from, address } = fromParts(h.from);
  const { text, html, attachments } = bodyText(raw);
  const body = (text || stripHtml(html)).replace(/\r/g, "").trim();
  return { uid, subject: h.subject ?? "(no subject)", from, address, to: h.to ?? null, date: h.date ? new Date(h.date).toISOString() : null,
    body: body.length > BODY_CHARS ? body.slice(0, BODY_CHARS) + "\n…" : body, truncated: body.length > BODY_CHARS, attachments };
}

async function open(options) {
  const host = options?.host ?? "127.0.0.1", port = options?.port ?? 1143;
  const socket = options?.secure ? tls({ host, port, rejectUnauthorized: options?.rejectUnauthorized ?? false }) : tcp({ host, port });
  await new Promise((res, rej) => { socket.once(options?.secure ? "secureConnect" : "connect", res); socket.once("error", rej); });
  const imap = new Imap(socket);
  await imap.greeting();
  const user = await secret(options, options?.userName ?? "IMAP_USER"), pass = await secret(options, options?.passName ?? "IMAP_PASS");
  await imap.cmd(`LOGIN "${user.replace(/"/g, '\\"')}" "${pass.replace(/"/g, '\\"')}"`);
  return { imap, user };
}

const quote = (s) => `"${String(s).replace(/["\\]/g, "\\$&")}"`;

/** The date form IMAP SEARCH wants: 09-Sep-2026. */
export const imapDate = (d) => { const M = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]; return `${String(d.getUTCDate()).padStart(2, "0")}-${M[d.getUTCMonth()]}-${d.getUTCFullYear()}`; };

const uidsOf = (search) => (search.match(/\* SEARCH([^\r\n]*)/)?.[1] ?? "").trim().split(/\s+/).filter(Boolean).map(Number);

/** Headers only, newest first: what a listing needs without pulling bodies. */
async function fetchHeaders(imap, uids) {
  const items = [];
  if (!uids.length) return items;
  const res = await imap.cmd(`UID FETCH ${uids.join(",")} (UID BODY.PEEK[HEADER.FIELDS (FROM TO SUBJECT DATE)])`);
  for (const m of res.matchAll(/\* \d+ FETCH \(UID (\d+) BODY\[HEADER\.FIELDS \([^)]*\)\] \{(\d+)\}\r?\n([\s\S]*?)\r?\n\)/g)) {
    const h = parseHeaders(m[3]);
    const { from, address } = fromParts(h.from);
    items.push({ uid: Number(m[1]), subject: h.subject ?? "(no subject)", from, address, to: h.to ?? null, date: h.date ? new Date(h.date).toISOString() : null });
  }
  items.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
  return items;
}

async function fetchOne(imap, uid) {
  const res = await imap.cmd(`UID FETCH ${uid} (UID BODY.PEEK[])`);
  const raw = literalOf(res);
  return raw == null ? null : itemOf(uid, raw);
}

/** Plain text → the HTML mail clients expect: one div per line, blank lines kept. */
export function toHtml(text) {
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<div>${text.replace(/\r/g, "").split("\n").map((l) => (l.trim() ? `<div>${esc(l)}</div>` : "<div><br></div>")).join("")}</div>`;
}

export default {
  name: "imap",
  kind: "mail",
  volatile: true,
  location: (ctx, o) => `${o?.host ?? "127.0.0.1"}:${o?.port ?? 1143}`,
  async live(query, ctx, options) {
    const what = query?.what ?? "unread";
    const { imap } = await open(options);
    try {
      await imap.cmd(`EXAMINE ${quote(query?.mailbox ?? options?.mailbox ?? "INBOX")}`);
      if (what === "unread") {
        const uids = uidsOf(await imap.cmd("UID SEARCH UNSEEN"));
        const items = await fetchHeaders(imap, uids.slice(-(query.limit ?? 40)));
        return { unread: uids.length, items, fetched: new Date().toISOString() };
      }
      if (what === "since") {
        // Everything that arrived in the last N days, headers only. One round
        // trip per mailbox, so a check can match hundreds of mails against the
        // folders locally instead of searching the server once per address.
        const days = Number(query.days ?? 30);
        const since = new Date(Date.now() - days * 86400000);
        const uids = uidsOf(await imap.cmd(`UID SEARCH SINCE ${imapDate(since)}`)).sort((a, b) => b - a);
        const items = await fetchHeaders(imap, uids.slice(0, query.limit ?? 300));
        return { found: uids.length, items, fetched: new Date().toISOString() };
      }
      if (what === "read") {
        if (!query.uid) throw new Error("imap: read needs a uid");
        return { item: await fetchOne(imap, Number(query.uid)), fetched: new Date().toISOString() };
      }
      if (what === "search") {
        if (!query.query) throw new Error("imap: search needs a query");
        const uids = uidsOf(await imap.cmd(`UID SEARCH TEXT ${quote(query.query)}`)).sort((a, b) => b - a);
        const items = [];
        for (const uid of uids.slice(0, query.limit ?? 5)) { const it = await fetchOne(imap, uid); if (it) items.push(it); }
        return { found: uids.length, items, fetched: new Date().toISOString() };
      }
      throw new Error(`imap: unknown query "${what}"`);
    } finally { imap.cmd("LOGOUT").catch(() => {}); imap.end(); }
  },
  /**
   * The one write: a draft. It replaces an earlier draft with the same subject
   * to the same address, so asking twice does not leave two. Sending is not
   * here and will not be.
   */
  async act(action, params, ctx, options) {
    if (action !== "draft") throw new Error(`imap: unknown action "${action}"`);
    const { to, subject, body } = params ?? {};
    if (!to || !subject || !body) throw new Error("imap: draft needs to, subject and body");
    const { imap, user } = await open(options);
    const mailbox = options?.drafts ?? "Drafts";
    try {
      await imap.cmd(`SELECT ${quote(mailbox)}`);
      let replaced = 0;
      const old = await imap.cmd(`UID SEARCH SUBJECT ${quote(subject)} TO ${quote(to.replace(/^.*<|>.*$/g, ""))}`).catch(() => "");
      const uids = (old.match(/\* SEARCH([^\r\n]*)/)?.[1] ?? "").trim().split(/\s+/).filter(Boolean);
      if (uids.length) { await imap.cmd(`UID STORE ${uids.join(",")} +FLAGS (\\Deleted)`); await imap.cmd("EXPUNGE"); replaced = uids.length; }
      const from = options?.from ?? user;
      const msg = [
        `From: ${from}`, `To: ${to}`, `Subject: ${encodeWord(subject)}`, `Date: ${new Date().toUTCString()}`,
        "MIME-Version: 1.0", "Content-Type: text/html; charset=utf-8", "Content-Transfer-Encoding: base64", "",
        Buffer.from(toHtml(body), "utf8").toString("base64").replace(/(.{76})/g, "$1\r\n"),
      ].join("\r\n");
      await imap.literal(`APPEND ${quote(mailbox)} (\\Draft)`, msg);
      return { mailbox, to, subject, replaced, chars: body.length };
    } finally { imap.cmd("LOGOUT").catch(() => {}); imap.end(); }
  },
  async scan(ctx, options) {
    const date = new Date().toISOString().slice(0, 10);
    const { unread } = await this.live({ what: "unread", limit: 1 }, ctx, options);
    return { metrics: [{ date, key: "mail_unread", value: unread }], count: unread, message: `${unread} unread` };
  },
};
