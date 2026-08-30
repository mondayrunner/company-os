import { listItems } from "#core/inbox.mjs"
import { list as running } from "#core/running.mjs"

// The inbox: where agents talk back and the human answers.
//
// `running` is what is in flight right now, straight from the database. The
// page needs it because an item that is being worked on looks exactly like one
// that is waiting: both sit at `approved`. Runs that did not survive a restart
// are swept here, so this never reports a spinner that will not stop.
export default defineEventHandler(async () =>
  source("Inbox", async () => {
    const items: any[] = await listItems(ctx())
    const by = (s: string[]) => items.filter((i) => s.includes(i.status))
    return {
      open: by(["open"]),
      approved: by(["approved"]),
      closed: by(["done", "failed", "rejected"]).slice(0, 40),
      total: items.length,
      running: running(ctx()),
    }
  }),
)
