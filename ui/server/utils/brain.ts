import { DatabaseSync } from "node:sqlite"
import { existsSync } from "node:fs"

/** Read access to the brain database. Writing is the CLI's job (index, snapshot, ask). */
let db: DatabaseSync | null = null
export function brain(): DatabaseSync | null {
  const path = ctx().dbPath
  if (!existsSync(path)) return null
  if (!db) db = new DatabaseSync(path, { readOnly: true })
  return db
}
