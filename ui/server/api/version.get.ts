import { readdir, stat } from "node:fs/promises"
import { join } from "node:path"
import { openDb } from "#core/db.mjs"

/**
 * One number that changes whenever anything happened: the newest event row,
 * the newest inbox file, the newest job status file. The dashboard polls this
 * every few seconds and refetches its panels when it moves. Cheaper than a
 * socket, and it works for actions that came in from anywhere — the CLI, an
 * MCP client, a cron job — because all of those leave one of these traces.
 */
export default defineEventHandler(async () =>
  source("Version", async () => {
    const c = ctx()
    const db = openDb(c)
    let events = ""
    try { events = db.prepare("SELECT max(ts) t FROM events").get()?.t ?? "" } finally { db.close() }
    const newest = async (dir: string) => {
      const names = await readdir(dir).catch(() => [] as string[])
      let m = 0
      for (const n of names) { const s = await stat(join(dir, n)).catch(() => null); if (s && s.mtimeMs > m) m = s.mtimeMs }
      return m
    }
    const [inbox, state] = await Promise.all([newest(c.path(c.config.inbox?.dir ?? "inbox")), newest(c.stateDir)])
    return { version: `${events}|${Math.round(inbox)}|${Math.round(state)}` }
  }),
)
