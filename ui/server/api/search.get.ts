// Full-text search over the index. Instant (no agent), so the ask page can show
// what it is about to read while the answer is still being written.
import { search } from "#core/search.mjs"

export default defineEventHandler(async (event) =>
  source("Search", async () => {
    const q = String(getQuery(event).q ?? "").trim()
    const limit = Math.min(Number(getQuery(event).limit) || 10, 30)
    const d = brain()
    if (!d || q.length < 2) return { hits: [] }
    return { hits: search(d, q, limit, ctx()) }
  }),
)
