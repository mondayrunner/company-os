// State of the brain: what is in it, which sources were scanned, what waits for a human, latest runs.
export default defineEventHandler(async () =>
  source("Brain", async () => {
    const d = brain()
    if (!d) return { empty: true }
    const c = ctx()
    const count = (sql: string) => (d.prepare(sql).get() as any).n as number
    const inboxDir = c.config.transcripts?.inbox
    const waiting = inboxDir
      ? (d.prepare("SELECT path, title, meta, mtime FROM documents WHERE path LIKE ? ORDER BY path DESC LIMIT 400").all(`${inboxDir}/%`) as any[]).map((r) => {
          const m = JSON.parse(r.meta || "{}")
          const account = c.fm(m, "account"), proposal = c.fm(m, "proposal")
          return { path: r.path, title: r.title, date: m.date ?? m.datum, kind: m.kind ?? m.soort, seconds: Number(m.duration_s ?? m.duur_s) || 0, proposal: proposal ?? [], linked: !!(account && String(account).length) }
        })
      : []
    const confirmed = new Set((d.prepare("SELECT from_path FROM relations WHERE kind='belongs-to' AND confidence='confirmed'").all() as any[]).map((r) => r.from_path))
    for (const w of waiting) if (confirmed.has(w.path)) w.linked = true
    return {
      counts: { documents: count("SELECT count(*) n FROM documents"), chunks: count("SELECT count(*) n FROM chunks"), relations: count("SELECT count(*) n FROM relations"), events: count("SELECT count(*) n FROM events"), metricDays: count("SELECT count(DISTINCT date) n FROM metrics"), questions: count("SELECT count(*) n FROM questions"), inboxOpen: count("SELECT count(*) n FROM inbox WHERE status='open'") },
      byKind: d.prepare("SELECT kind, count(*) n FROM documents GROUP BY kind ORDER BY n DESC").all(),
      sources: d.prepare("SELECT name, kind, location, last_scanned, count, added, message FROM sources ORDER BY name").all(),
      transcripts: { total: waiting.length, open: waiting.filter((w) => !w.linked).length, recent: waiting.filter((w) => !w.linked).slice(0, 12) },
      runs: d.prepare("SELECT ts, job, result, message FROM events ORDER BY ts DESC LIMIT 12").all(),
      questions: d.prepare("SELECT ts, question, found, cost_usd, duration_ms, asked_by FROM questions ORDER BY ts DESC LIMIT 8").all(),
    }
  }),
)
