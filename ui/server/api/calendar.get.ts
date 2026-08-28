// The calendar kind, live: today and the next seven days.
export default defineEventHandler(async () =>
  source("Calendar", async () => {
    const today = new Date().toISOString().slice(0, 10)
    const to = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10)
    const r = await live("calendar", { what: "range", from: today, to })
    const days = Object.entries(r.days ?? {}).sort(([a], [b]) => a.localeCompare(b)).map(([date, events]) => ({ date, events }))
    return { connector: r.connector, fetched: r.fetched, today: (r.days ?? {})[today] ?? [], upcoming: days.filter((d) => d.date > today && (d.events as any[]).length) }
  }, 30000),
)
