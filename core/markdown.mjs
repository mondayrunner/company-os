/**
 * Markdown the way a knowledge base writes it: YAML-ish frontmatter, a title,
 * sections per heading, and the occasional table. No YAML library: the subset
 * people actually write (scalars, inline lists, dash lists) is enough.
 */
import { createHash } from "node:crypto";

export function frontmatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!m) return { meta: {}, body: text, raw: null };
  const meta = {};
  let list = null;
  for (const line of m[1].split("\n")) {
    const kv = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (kv) {
      const [, k, v] = kv;
      if (v === "" || v === "[]") { meta[k] = []; list = k; continue; }
      list = null;
      const arr = v.match(/^\[(.*)\]$/);
      meta[k] = arr ? arr[1].split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean) : v.trim().replace(/^["']|["']$/g, "");
      continue;
    }
    const li = line.match(/^\s+-\s+(.*)$/);
    if (li && list) meta[list].push(li[1].trim().replace(/^["']|["']$/g, ""));
  }
  return { meta, body: text.slice(m[0].length), raw: m[1] };
}

/** Replace or add keys inside an existing frontmatter block. Returns null if there is none. */
export function setFrontmatter(text, fields) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!m) return null;
  let fm = m[1];
  for (const [k, v] of Object.entries(fields)) {
    const line = `${k}: ${v}`;
    const re = new RegExp(`^${k}:.*$`, "m");
    fm = re.test(fm) ? fm.replace(re, line) : fm + "\n" + line;
  }
  return `---\n${fm}\n---\n` + text.slice(m[0].length);
}

/** First H1, else the fallback. */
export function titleOf(body, fallback) {
  return body.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? fallback;
}

/** Split on headings (#..###), keep chunks under ~1800 characters. */
export function chunks(body, maxLen = 1800) {
  const out = [];
  let heading = "";
  let buf = [];
  const flush = () => {
    const text = buf.join("\n").trim();
    if (!text) return;
    for (let i = 0; i < text.length; i += maxLen) out.push({ heading, text: text.slice(i, i + maxLen) });
    buf = [];
  };
  for (const line of body.split("\n")) {
    const h = line.match(/^(#{1,3})\s+(.+)$/);
    if (h) { flush(); heading = h[2].trim(); buf.push(line); continue; }
    buf.push(line);
  }
  flush();
  return out;
}

/** Sections: [{ heading, level, start, end, lines }] over the whole document (line numbers 1-based). */
export function sections(text) {
  const lines = text.split("\n");
  const out = [];
  let cur = { heading: "", level: 0, start: 1, lines: [] };
  lines.forEach((line, i) => {
    const h = line.match(/^(#{1,6})\s+(.+)$/);
    if (h) { cur.end = i; out.push(cur); cur = { heading: h[2].trim(), level: h[1].length, start: i + 1, lines: [] }; }
    cur.lines.push(line);
  });
  cur.end = lines.length; out.push(cur);
  return out;
}

/** Strip emphasis and collapse whitespace. */
export const clean = (s) => (s || "").replace(/\*\*/g, "").replace(/`/g, "").replace(/\s+/g, " ").trim();

/** Parse the first markdown table under a heading; rows become objects keyed by `keys`. */
export function tableUnder(text, headingRe, keys) {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => headingRe.test(l));
  if (start === -1) return [];
  let i = start + 1;
  while (i < lines.length && !lines[i].trim().startsWith("|")) {
    if (/^#{1,6}\s/.test(lines[i])) return [];
    i++;
  }
  if (i >= lines.length) return [];
  i++;
  if (i < lines.length && /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i])) i++;
  const rows = [];
  for (; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim().startsWith("|")) break;
    const cells = line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|");
    const row = { _line: i + 1 };
    keys.forEach((k, idx) => { row[k] = cells[idx] !== undefined ? cells[idx].trim() : ""; });
    rows.push(row);
  }
  return rows;
}

export const hashOf = (s) => createHash("sha1").update(s).digest("hex").slice(0, 16);

export const slug = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
