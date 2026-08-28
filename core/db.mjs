// The database is an index over the markdown plus a log of what the jobs did.
// Never the source of truth: delete it and `brainlane index` rebuilds it.
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS documents (
  path TEXT PRIMARY KEY,        -- relative to the root
  kind TEXT,                    -- knowledge | account | pipeline | contact | transcript | other (config.kinds)
  title TEXT, hash TEXT, mtime TEXT, bytes INTEGER,
  status TEXT, last_verified TEXT, meta TEXT   -- meta = frontmatter as JSON
);
CREATE TABLE IF NOT EXISTS chunks (
  id INTEGER PRIMARY KEY, path TEXT NOT NULL, heading TEXT, text TEXT NOT NULL
);
CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
  text, heading, path UNINDEXED, content='chunks', content_rowid='id', tokenize='unicode61'
);
CREATE TRIGGER IF NOT EXISTS chunks_ai AFTER INSERT ON chunks BEGIN
  INSERT INTO chunks_fts(rowid, text, heading, path) VALUES (new.id, new.text, new.heading, new.path);
END;
CREATE TRIGGER IF NOT EXISTS chunks_ad AFTER DELETE ON chunks BEGIN
  INSERT INTO chunks_fts(chunks_fts, rowid, text, heading, path) VALUES ('delete', old.id, old.text, old.heading, old.path);
END;
CREATE TABLE IF NOT EXISTS relations (
  from_path TEXT NOT NULL, to_path TEXT NOT NULL, kind TEXT NOT NULL,   -- e.g. contact → account "belongs-to"
  source TEXT, confidence TEXT, ts TEXT,
  PRIMARY KEY (from_path, to_path, kind)
);
CREATE TABLE IF NOT EXISTS sources (
  name TEXT PRIMARY KEY, kind TEXT, location TEXT,
  last_scanned TEXT, count INTEGER, added INTEGER, message TEXT
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY, ts TEXT NOT NULL, job TEXT NOT NULL, result TEXT,
  done INTEGER, failed INTEGER, message TEXT, json TEXT,
  UNIQUE (job, ts)
);
CREATE TABLE IF NOT EXISTS metrics (
  date TEXT NOT NULL, key TEXT NOT NULL, value REAL, PRIMARY KEY (date, key)
);
CREATE TABLE IF NOT EXISTS questions (
  id INTEGER PRIMARY KEY, ts TEXT NOT NULL, question TEXT NOT NULL, answer TEXT,
  sources TEXT, found INTEGER, cost_usd REAL, duration_ms INTEGER, asked_by TEXT
);
CREATE TABLE IF NOT EXISTS inbox (
  id TEXT PRIMARY KEY, path TEXT NOT NULL, kind TEXT, sender TEXT, created TEXT,
  status TEXT, title TEXT, action TEXT, updated TEXT
);
`;

export function openDb(ctx, { readonly = false } = {}) {
  mkdirSync(dirname(ctx.dbPath), { recursive: true });
  const db = new DatabaseSync(ctx.dbPath, { readOnly: readonly });
  if (!readonly) {
    db.exec("PRAGMA journal_mode=WAL");
    db.exec(SCHEMA);
  }
  return db;
}

export const now = () => new Date().toISOString();

export function registerSource(db, connector, r) {
  db.prepare(`INSERT INTO sources (name, kind, location, last_scanned, count, added, message) VALUES (?,?,?,?,?,?,?)
    ON CONFLICT(name) DO UPDATE SET kind=excluded.kind, location=excluded.location, last_scanned=excluded.last_scanned, count=excluded.count, added=excluded.added, message=excluded.message`)
    .run(connector.name, connector.kind, connector.location ?? null, now(), r?.count ?? 0, r?.added ?? 0, r?.message ?? null);
}

/** Copy history (events, metrics, questions) from a database with the pre-brainlane Dutch schema. */
export function importLegacy(db, legacyPath) {
  const old = new DatabaseSync(legacyPath, { readOnly: true });
  const has = (t) => !!old.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(t);
  const out = { events: 0, metrics: 0, questions: 0 };
  db.exec("BEGIN");
  if (has("events")) {
    const ins = db.prepare("INSERT OR IGNORE INTO events (ts, job, result, done, failed, message, json) VALUES (?,?,?,?,?,?,?)");
    for (const e of old.prepare("SELECT * FROM events").all()) out.events += ins.run(e.ts, e.job, e.resultaat, e.gedaan, e.mislukt, e.melding, e.json).changes;
  }
  if (has("metrics")) {
    const ins = db.prepare("INSERT OR IGNORE INTO metrics (date, key, value) VALUES (?,?,?)");
    for (const m of old.prepare("SELECT * FROM metrics").all()) out.metrics += ins.run(m.datum, m.sleutel, m.waarde).changes;
  }
  if (has("vragen")) {
    const ins = db.prepare("INSERT OR IGNORE INTO questions (ts, question, answer, sources, found, cost_usd, duration_ms) VALUES (?,?,?,?,?,?,?)");
    for (const q of old.prepare("SELECT * FROM vragen").all()) out.questions += ins.run(q.ts, q.vraag, q.antwoord, q.bronnen, q.gevonden, q.kosten_usd, q.duur_ms).changes;
  }
  db.exec("COMMIT");
  old.close();
  return out;
}
