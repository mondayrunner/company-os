/**
 * Search in two passes: FTS5 finds candidates, then a rerank decides the order.
 *
 * BM25 on chunks alone puts chatty daily notes above the document that actually
 * owns the answer, because those notes repeat every name. So a word that lands
 * in the *path* or the *title* counts for much more than one in the body — a
 * folder called `.../koos-service-design/` is a stronger signal than ten
 * mentions of "Koos" in a morning report — and each kind of document carries a
 * weight (a status file outranks a planner note). Both are config, not code.
 */
const FALLBACK_STOPWORDS = "de het een en of in op te van voor met aan bij is zijn was wat wie waar hoe dat die deze dit er ik mij me we wij je jij jou ons onze niet ook nog al als naar over the a an of to is are was what who where how and or in on at for with my me we it its this that these those not also still all as into over from".split(" ");
const FALLBACK_WEIGHTS = { account: 1.4, knowledge: 1.35, pipeline: 1.3, contact: 1.0, other: 1.0, transcript: 0.85, advice: 0.8, planner: 0.6 };

export function contentWords(q, stopwords) {
  const stop = new Set((stopwords ?? FALLBACK_STOPWORDS).map((w) => w.toLowerCase()));
  const words = q.replace(/["'*:^()?!.,;]/g, " ").split(/\s+/).filter((w) => w.length >= 2);
  const content = words.filter((w) => !stop.has(w.toLowerCase()));
  return { words, content: content.length ? content : words };
}

export function search(db, q, n = 8, ctx = null) {
  const config = ctx?.config?.search ?? {};
  const { content } = contentWords(q, config.stopwords);
  if (!content.length) return [];
  const weights = { ...FALLBACK_WEIGHTS, ...(config.weights ?? {}) };
  const statusFile = (ctx?.config?.accounts?.statusFile ?? "").toLowerCase();
  const sql = `SELECT c.path, c.heading, snippet(chunks_fts, 0, '«', '»', '…', 18) snippet, bm25(chunks_fts, 1.0, 2.0) score, d.kind, d.title
    FROM chunks_fts JOIN chunks c ON c.id = chunks_fts.rowid JOIN documents d ON d.path = c.path
    WHERE chunks_fts MATCH ? ORDER BY score LIMIT ?`;
  const ask = (match) => { try { return db.prepare(sql).all(match, n * 6); } catch { return null; } };
  // Precise first (every content word present), then permissive; bm25 sorts the rest out.
  const strict = ask(content.map((w, i) => (i === content.length - 1 ? `${w}*` : w)).join(" ")) ?? [];
  const loose = strict.length >= n ? [] : ask(content.map((w) => `"${w}"`).join(" OR ")) ?? [];
  const rows = strict.length >= n ? strict : [...strict, ...loose.filter((r) => !strict.some((s) => s.path === r.path && s.heading === r.heading))];
  const lower = content.map((w) => w.toLowerCase());
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
    return { ...r, relevance: Math.round(rel * 100) / 100 };
  });
  // One hit per document: the best chunk represents it, so ten notes cannot crowd out ten different files.
  const best = new Map();
  for (const r of scored.sort((a, b) => b.relevance - a.relevance)) if (!best.has(r.path)) best.set(r.path, r);
  return [...best.values()].slice(0, n);
}

/** Everything around one account: its files, contacts, transcripts, relations, and the latest runs. */
export function context(db, ctx, account) {
  const documents = db.prepare("SELECT path, kind, title, mtime FROM documents WHERE path LIKE ? ORDER BY mtime DESC").all(`${account}/%`);
  const relations = db.prepare("SELECT from_path, to_path, kind, source, confidence FROM relations WHERE to_path = ? OR from_path = ? ORDER BY kind").all(account, account);
  const kindOf = (p) => ctx.kindOf(p);
  return {
    account, documents,
    contacts: relations.filter((r) => kindOf(r.from_path) === "contact").map((r) => r.from_path),
    transcripts: relations.filter((r) => kindOf(r.from_path) === "transcript").map((r) => r.from_path),
    relations,
    latestRuns: db.prepare("SELECT ts, job, result, message FROM events ORDER BY ts DESC LIMIT 5").all(),
  };
}

export function status(db, ctx) {
  const count = (sql) => db.prepare(sql).get().n;
  const inbox = ctx.config.transcripts?.inbox;
  return {
    documents: count("SELECT count(*) n FROM documents"), chunks: count("SELECT count(*) n FROM chunks"),
    relations: count("SELECT count(*) n FROM relations"), events: count("SELECT count(*) n FROM events"),
    metrics: count("SELECT count(DISTINCT date) n FROM metrics"), questions: count("SELECT count(*) n FROM questions"),
    byKind: db.prepare("SELECT kind, count(*) n FROM documents GROUP BY kind ORDER BY n DESC").all(),
    sources: db.prepare("SELECT * FROM sources ORDER BY name").all(),
    transcriptsWaiting: inbox ? db.prepare("SELECT path, title, meta FROM documents WHERE path LIKE ? ORDER BY path DESC LIMIT 20").all(`${inbox}/%`).map((r) => ({ ...r, meta: JSON.parse(r.meta || "{}") })) : [],
    latestRuns: db.prepare("SELECT ts, job, result, message FROM events ORDER BY ts DESC LIMIT 10").all(),
  };
}
