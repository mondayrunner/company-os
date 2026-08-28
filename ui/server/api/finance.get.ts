// The finance kind, live: subscriptions and open invoices, plus the daily MRR series.
export default defineEventHandler(async () =>
  source("Finance", async () => {
    const [subs, open] = await Promise.all([live("finance", { what: "subscriptions" }), live("finance", { what: "open-invoices" }).catch(() => ({ items: [] }))])
    const items: any[] = subs.items ?? []
    const mrr = Math.round(items.reduce((s, x) => s + (x.monthly ?? 0), 0) * 100) / 100
    const invoices: any[] = open.items ?? []
    const d = brain()
    const series = d ? (d.prepare("SELECT date, value FROM metrics WHERE key='mrr' AND date >= ? ORDER BY date").all(new Date(Date.now() - 90 * 864e5).toISOString().slice(0, 10)) as any[]) : []
    return {
      connector: subs.connector, fetched: subs.fetched, currency: items[0]?.currency ?? "EUR",
      mrr, subscriptions: items.length, top: [...items].sort((a, b) => b.monthly - a.monthly).slice(0, 8),
      openInvoices: invoices.length, openAmount: Math.round(invoices.reduce((s, x) => s + (x.amount ?? 0), 0) * 100) / 100, overdue: invoices.filter((x) => x.overdue).length, invoices: invoices.slice(0, 8),
      series,
    }
  }, 60000),
)
