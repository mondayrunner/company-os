// The mail kind, live: unread count and the latest unread headers. Read-only.
export default defineEventHandler(async () =>
  source("Mail", async () => {
    const r = await live("mail", { what: "unread", limit: 40 })
    return { connector: r.connector, fetched: r.fetched, unread: r.unread ?? 0, items: r.items ?? [] }
  }, 30000),
)
