import { openDb } from "#core/db.mjs"
import { list as running } from "#core/running.mjs"

/**
 * What the agents did, newest first.
 *
 * Not the inbox. The inbox is what is waiting for you, and it only works while
 * it stays short — an inbox that also carries "this finished" turns into a feed,
 * and the one item that needed you drowns in the twenty that did not. So a
 * finished run goes here and the artefact goes where artefacts go: a draft to
 * the mail client, an edit to the file, a finding to the inbox.
 *
 * Everything here comes from the `events` table, which jobs already write to.
 * `running` is bolted on top so "now" and "just then" read as one list.
 */
export default defineEventHandler(async (event) =>
  source("Activity", async () => {
    const limit = Math.min(Number(getQuery(event).limit ?? 60), 200)
    const db = openDb(ctx())
    try {
      const rows = db
        .prepare("SELECT ts, job, result, done, failed, message, json FROM events ORDER BY ts DESC LIMIT ?")
        .all(limit)
        .map((r: any) => {
          let cost = null
          try { cost = JSON.parse(r.json ?? "{}").cost_usd ?? null } catch {}
          return { ts: r.ts, job: r.job, result: r.result, done: r.done, failed: r.failed, message: r.message, cost }
        })

      // What today cost, over everything that reported a number.
      const today = new Date().toISOString().slice(0, 10)
      const spentToday = rows
        .filter((r) => r.ts.slice(0, 10) === today && typeof r.cost === "number")
        .reduce((n, r) => n + r.cost!, 0)

      return { rows, running: running(ctx()), spentToday, days: [...new Set(rows.map((r) => r.ts.slice(0, 10)))] }
    } finally {
      db.close()
    }
  }),
)
