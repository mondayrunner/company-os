import { DatabaseSync } from "node:sqlite"
import { existsSync } from "node:fs"

/** The brain database for the panels. The index is the CLI's job; the only rows written from here are `running`/`events` for runs started on this page, through core/running.mjs. */
let db: DatabaseSync | null = null
export function brain(): DatabaseSync | null {
  const path = ctx().dbPath
  if (!existsSync(path)) return null
  if (!db) db = new DatabaseSync(path, { readOnly: true })
  return db
}
