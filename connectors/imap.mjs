// Mail over IMAP, read live: unread count and the latest unread headers. Works
// with any IMAP server; with Proton Mail Bridge it is 127.0.0.1:1143 without
// TLS verification (local, self-signed). Minimal client on node:net/node:tls,
// no dependency: LOGIN, SELECT, SEARCH UNSEEN, FETCH headers. Never marks
// anything as read, never moves or sends.
//
//   "imap": { "envFile": "~/.config/sitelane-mail/.env", "host": "127.0.0.1", "port": 1143,
//             "secure": false, "userName": "BRIDGE_USER", "passName": "BRIDGE_PASS", "mailbox": "INBOX" }
//
// live({ what: "unread", limit: 40 })  → { unread, items: [{ uid, subject, from, address, date }] }
import { connect as tcp } from "node:net";
import { connect as tls } from "node:tls";
import { secret } from "../core/env.mjs";

class Imap {
  constructor(socket) { this.s = socket; this.n = 0; this.buf = ""; this.waiters = []; socket.on("data", (d) => this.onData(d.toString("binary"))); }
  onData(chunk) {
    this.buf += chunk;
    const w = this.waiters[0];
    if (!w) return;
    const re = new RegExp(`(^|\\n)${w.tag} (OK|NO|BAD)[^\\n]*\\n`);
    const m = this.buf.match(re);
    if (m) { const end = m.index + m[0].length; const text = this.buf.slice(0, end); this.buf = this.buf.slice(end); this.waiters.shift(); m[2] === "OK" ? w.resolve(text) : w.reject(new Error(`IMAP ${w.cmd}: ${m[0].trim()}`)); }
  }
  cmd(line) {
    const tag = `A${++this.n}`;
    return new Promise((resolve, reject) => { this.waiters.push({ tag, cmd: line.split(" ")[0], resolve, reject }); this.s.write(`${tag} ${line}\r\n`); });
  }
  async greeting() { await new Promise((r) => { const check = () => (/\n/.test(this.buf) ? (this.buf = "", r()) : setTimeout(check, 20)); check(); }); }
  end() { this.s.end(); }
}

export function parseHeaders(block) {
  const out = {};
  for (const line of block.replace(/\r\n[ \t]+/g, " ").split(/\r?\n/)) {
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

function fromParts(v = "") {
  const m = v.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  return m ? { from: m[1].trim() || m[2], address: m[2] } : { from: v.trim(), address: v.replace(/[<>]/g, "").trim() };
}

async function open(options) {
  const host = options?.host ?? "127.0.0.1", port = options?.port ?? 1143;
  const socket = options?.secure ? tls({ host, port, rejectUnauthorized: options?.rejectUnauthorized ?? false }) : tcp({ host, port });
  await new Promise((res, rej) => { socket.once(options?.secure ? "secureConnect" : "connect", res); socket.once("error", rej); });
  const imap = new Imap(socket);
  await imap.greeting();
  const user = await secret(options, options?.userName ?? "IMAP_USER"), pass = await secret(options, options?.passName ?? "IMAP_PASS");
  await imap.cmd(`LOGIN "${user.replace(/"/g, '\\"')}" "${pass.replace(/"/g, '\\"')}"`);
  return imap;
}

export default {
  name: "imap",
  kind: "mail",
  volatile: true,
  location: (ctx, o) => `${o?.host ?? "127.0.0.1"}:${o?.port ?? 1143}`,
  async live(query, ctx, options) {
    const what = query?.what ?? "unread";
    if (what !== "unread") throw new Error(`imap: unknown query "${what}"`);
    const imap = await open(options);
    try {
      await imap.cmd(`EXAMINE "${options?.mailbox ?? "INBOX"}"`);
      const search = await imap.cmd("UID SEARCH UNSEEN");
      const uids = (search.match(/\* SEARCH([^\r\n]*)/)?.[1] ?? "").trim().split(/\s+/).filter(Boolean).map(Number);
      const latest = uids.slice(-(query.limit ?? 40));
      const items = [];
      if (latest.length) {
        const res = await imap.cmd(`UID FETCH ${latest.join(",")} (UID BODY.PEEK[HEADER.FIELDS (FROM SUBJECT DATE)])`);
        for (const m of res.matchAll(/\* \d+ FETCH \(UID (\d+) BODY\[HEADER\.FIELDS \([^)]*\)\] \{(\d+)\}\r?\n([\s\S]*?)\r?\n\)/g)) {
          const h = parseHeaders(m[3]);
          const { from, address } = fromParts(h.from);
          items.push({ uid: Number(m[1]), subject: h.subject ?? "(no subject)", from, address, date: h.date ? new Date(h.date).toISOString() : null });
        }
      }
      items.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
      return { unread: uids.length, items, fetched: new Date().toISOString() };
    } finally { imap.cmd("LOGOUT").catch(() => {}); imap.end(); }
  },
  async scan(ctx, options) {
    const date = new Date().toISOString().slice(0, 10);
    const { unread } = await this.live({ what: "unread", limit: 1 }, ctx, options);
    return { metrics: [{ date, key: "mail_unread", value: unread }], count: unread, message: `${unread} unread` };
  },
};
