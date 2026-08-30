/**
 * Search in two passes: FTS5 finds candidates, then a rerank decides the order.
 *
 * BM25 on chunks alone puts chatty daily notes above the document that actually
 * owns the answer, because those notes repeat every name. So a word that lands
 * in the *path* or the *title* counts for much more than one in the body — a
 * folder called `.../harper-co-website/` is a stronger signal than ten
 * mentions of "Harper" in a daily plan — and each kind of document carries a
 * weight (a status file outranks a planner note). Both are config, not code.
 */
const FALLBACK_STOPWORDS = "de het een en of in op te van voor met aan bij is zijn was wat wie waar hoe dat die deze dit er ik mij me we wij je jij jou ons onze niet ook nog al als naar over the a an of to is are was what who where how and or in on at for with my me we it its this that these those not also still all as into over from".split(" ");
import { hashOf } from "./markdown.mjs";

const FALLBACK_WEIGHTS = { account: 1.4, knowledge: 1.35, pipeline: 1.3, contact: 1.0, other: 1.0, transcript: 0.85, advice: 0.8, planner: 0.6 };

export function contentWords(q, stopwords) {
  const stop = new Set((stopwords ?? FALLBACK_STOPWORDS).map((w) => w.toLowerCase()));
  const words = q.replace(/["'*:^()?!.,;]/g, " ").split(/\s+/).filter((w) => w.length >= 2);
  const content = words.filter((w) => !stop.has(w.toLowerCase()));
  return { words, content: content.length ? content : words };
}

const FALLBACK_RAW = ["transcript", "planner", "advice"];

/**
 * Two tiers. Canon first: status files, the pipeline, knowledge, contacts —
 * the documents that own an answer. Raw only on request (`raw: true`) or to
 * fill up when canon has too little: transcripts, daily plans, advice, the
 * mails and call notes inside an account folder. Raw decays with age; canon
 * does not, a price list from March is still the price list.
 *
 * The payload is deliberately thin: path, title, a short snippet, a date. The
 * chunk itself is not returned — read the file, that is what the path is for.
 */
export function search(db, q, n = 8, ctx = null, { raw = false } = {}) {
  const config = ctx?.config?.search ?? {};
  const { content } = contentWords(q, config.stopwords);
  if (!content.length) return [];
  const weights = { ...FALLBACK_WEIGHTS, ...(config.weights ?? {}) };
  const rawKinds = new Set(config.raw ?? FALLBACK_RAW);
  const statusFile = (ctx?.config?.accounts?.statusFile ?? "").toLowerCase();
  const sql = `SELECT c.path, c.heading, c.text, snippet(chunks_fts, 0, '«', '»', '…', 18) snippet, bm25(chunks_fts, 1.0, 2.0) score, d.kind, d.title, d.mtime
    FROM chunks_fts JOIN chunks c ON c.id = chunks_fts.rowid JOIN documents d ON d.path = c.path
    WHERE chunks_fts MATCH ? ORDER BY score LIMIT ?`;
  const ask = (match) => { try { return db.prepare(sql).all(match, n * 10); } catch { return null; } };
  // Precise first (every content word present), then permissive; bm25 sorts the rest out.
  const strict = ask(content.map((w, i) => (i === content.length - 1 ? `${w}*` : w)).join(" ")) ?? [];
  const loose = strict.length >= n * 3 ? [] : ask(content.map((w) => `"${w}"`).join(" OR ")) ?? [];
  const rows = [...strict, ...loose.filter((r) => !strict.some((s) => s.path === r.path && s.heading === r.heading))];
  const lower = content.map((w) => w.toLowerCase());
  const now = Date.now();
  const isRaw = (r, file) => rawKinds.has(r.kind) || (!!ctx?.accountOf?.(r.path) && /^(transcript|whatsapp|call|gesprek)/i.test(file));
  const scored = rows.map((r) => {
    const path = r.path.toLowerCase(), title = String(r.title ?? "").toLowerCase();
    const file = path.split("/").pop();
    const stem = file.replace(/\.[a-z]+$/, "");
    const inPath = lower.filter((w) => path.includes(w)).length;
    const inTitle = lower.filter((w) => title.includes(w)).length;
    let rel = -r.score;                                  // bm25 is negative; less negative is worse
    rel *= 1 + 0.9 * (inPath / lower.length) + 0.5 * (inTitle / lower.length);
    rel *= weights[r.kind] ?? 1;
    // Asking for a file by its name ("what is in my compass?") should return that file.
    if (lower.includes(stem)) rel *= 1.6;
    // Within an account, the status file is the answer and the attachments are the evidence.
    if (statusFile && file === statusFile) rel *= 1.3;
    const account = ctx?.accountOf?.(r.path);
    if (account && r.path.slice(account.length + 1).includes("/")) rel *= 0.8;
    const rawHit = isRaw(r, file);
    if (rawHit && r.mtime) {
      const ageDays = Math.max(0, (now - Date.parse(r.mtime)) / 86400000);
      rel *= Math.max(0.4, 1 / (1 + ageDays / 90));
    }
    return { ...r, raw: rawHit, relevance: Math.round(rel * 100) / 100 };
  }).sort((a, b) => b.relevance - a.relevance);
  // One hit per document, and one hit per text: seventy daily plans that repeat
  // the same block are one result, not seventy.
  // And at most three per account folder unless raw was asked for, so one
  // long-running deal does not fill the whole list.
  const seenPath = new Set(), seenText = new Set(), perAccount = new Map();
  const unique = [];
  for (const r of scored) {
    const key = hashOf(r.text.toLowerCase().replace(/\s+/g, " ").slice(0, 600));
    if (seenPath.has(r.path) || seenText.has(key)) continue;
    const account = ctx?.accountOf?.(r.path);
    if (account && !raw && (perAccount.get(account) ?? 0) >= 3) continue;
    if (account) perAccount.set(account, (perAccount.get(account) ?? 0) + 1);
    seenPath.add(r.path); seenText.add(key);
    unique.push(r);
  }
  const canon = unique.filter((r) => !r.raw), rest = unique.filter((r) => r.raw);
  const picked = raw ? unique : [...canon, ...rest.slice(0, Math.max(0, n - canon.length))];
  return picked.slice(0, n).map((r) => ({
    path: r.path, title: r.title, kind: r.kind, heading: r.heading, mtime: r.mtime,
    snippet: String(r.snippet ?? "").replace(/\s+/g, " ").slice(0, 200),
    relevance: r.relevance, ...(r.raw ? { raw: true } : {}),
  }));
}

/**
 * What is in the brain. One picture for the CLI, MCP and the dashboard.
 *
 * This used to exist twice, with two answers to the same question: `company-os
 * status` counted twenty waiting transcripts and the dashboard four hundred.
 * The caller picks the limit. The shape is decided here.
 */
export function status(db, ctx, { transcripts = 20 } = {}) {
  const count = (sql, ...args) => db.prepare(sql).get(...args).n;
  const inbox = ctx.config.transcripts?.inbox;
  // A transcript counts as linked once someone confirmed it, whether that
  // sits in the frontmatter or was recorded as a relation.
  const confirmed = new Set(db.prepare("SELECT from_path FROM relations WHERE kind='belongs-to' AND confidence='confirmed'").all().map((r) => r.from_path));
  const waiting = inbox
    ? db.prepare("SELECT path, title, meta, mtime FROM documents WHERE path LIKE ? ORDER BY path DESC LIMIT ?").all(`${inbox}/%`, transcripts).map((r) => {
        const meta = JSON.parse(r.meta || "{}");
        const account = ctx.fm(meta, "account");
        return { path: r.path, title: r.title, mtime: r.mtime, meta,
          date: meta.date ?? meta.datum ?? null, kind: meta.kind ?? meta.soort ?? null,
          seconds: Number(meta.duration_s ?? meta.duur_s) || 0,
          proposal: ctx.fm(meta, "proposal") ?? [],
          linked: !!(account && String(account).length) || confirmed.has(r.path) };
      })
    : [];
  return {
    documents: count("SELECT count(*) n FROM documents"), chunks: count("SELECT count(*) n FROM chunks"),
    relations: count("SELECT count(*) n FROM relations"), events: count("SELECT count(*) n FROM events"),
    metrics: count("SELECT count(DISTINCT date) n FROM metrics"),
    inboxOpen: count("SELECT count(*) n FROM inbox WHERE status='open'"),
    byKind: db.prepare("SELECT kind, count(*) n FROM documents GROUP BY kind ORDER BY n DESC").all(),
    sources: db.prepare("SELECT name, kind, location, last_scanned, count, added, message FROM sources ORDER BY name").all(),
    transcriptsWaiting: waiting,
    transcriptsTotal: inbox ? count("SELECT count(*) n FROM documents WHERE path LIKE ?", `${inbox}/%`) : 0,
    latestRuns: db.prepare("SELECT ts, job, result, message FROM events ORDER BY ts DESC LIMIT 12").all(),
  };
}
