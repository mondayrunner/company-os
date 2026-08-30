// The tasks kind, live: open cards grouped by list, overdue count.
export default defineEventHandler(async () =>
  source("Tasks", async () => {
    const r = await live("tasks", { what: "cards" })
    const items: any[] = r.items ?? []
    const order: string[] = r.lists ?? [...new Set(items.map((i) => i.list))]
    const lists = order.map((name) => ({ name, cards: items.filter((i) => i.list === name) })).filter((l) => l.cards.length)
    for (const i of items) if (!order.includes(i.list)) (lists.find((l) => l.name === i.list) ?? lists[lists.push({ name: i.list, cards: [] }) - 1]).cards.push(i)
    return { connector: r.connector, fetched: r.fetched, total: items.length, overdue: items.filter((i) => i.overdue).length, lists }
  }, 40000),
)
