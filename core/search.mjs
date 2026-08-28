// FTS5 over the chunks: AND the words, prefix-match the last one, and fall
// back to OR when the query has characters FTS dislikes.
export function search(db, q, n = 8) {
  const words = q.replace(/["'*:^()]/g, " ").split(/\s+/).filter((w) => w.length >= 2);
  if (!words.length) return [];
  const match = words.map((w, i) => (i === words.length - 1 ? `${w}*` : w)).join(" ");
  const sql = `SELECT c.path, c.heading, snippet(chunks_fts, 0, '«', '»', '…', 18) snippet, bm25(chunks_fts, 1.0, 2.0) score, d.kind, d.title
    FROM chunks_fts JOIN chunks c ON c.id = chunks_fts.rowid JOIN documents d ON d.path = c.path
    WHERE chunks_fts MATCH ? ORDER BY score LIMIT ?`;
  try { return db.prepare(sql).all(match, n); }
  catch { try { return db.prepare(sql).all(words.map((w) => `"${w}"`).join(" OR "), n); } catch { return []; } }
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
