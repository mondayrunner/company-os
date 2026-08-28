import { listItems } from "#core/inbox.mjs"

// The inbox: where agents talk back and the human answers.
export default defineEventHandler(async () =>
  source("Inbox", async () => {
    const items: any[] = await listItems(ctx())
    const by = (s: string[]) => items.filter((i) => s.includes(i.status))
    return { open: by(["open"]), approved: by(["approved"]), closed: by(["done", "failed", "rejected"]).slice(0, 40), total: items.length }
  }),
)
