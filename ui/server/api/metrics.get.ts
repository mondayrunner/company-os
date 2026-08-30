// Daily series from the brain: ?key=mrr,tasks_open&days=90
export default defineEventHandler(async (event) =>
  source("Metrics", async () => {
    const d = brain()
    if (!d) return { series: {}, keys: [] }
    const q = getQuery(event)
    const days = Math.min(Number(q.days) || 90, 730)
    const keys = String(q.key || "mrr,tasks_open,mail_unread").split(",").map((s) => s.trim()).filter(Boolean)
    const from = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10)
    const series: Record<string, { date: string; value: number }[]> = {}
    const st = d.prepare("SELECT date, value FROM metrics WHERE key = ? AND date >= ? ORDER BY date")
    for (const k of keys) series[k] = st.all(k, from) as any
    return { series, keys: (d.prepare("SELECT DISTINCT key FROM metrics ORDER BY key").all() as any[]).map((r) => r.key) }
  }),
)
