import { openDb } from "#core/db.mjs"

// Archiveren en terughalen. Een vragenlijst die alleen groeit wordt een archief
// dat je niet meer doorzoekt; weggooien wil je ook niet, want het antwoord kostte
// geld. Dus: uit het zicht, terug te halen.
export default defineEventHandler(async (event) => {
  const { id, archived } = await readBody<{ id: number; archived: boolean }>(event)
  if (!Number.isInteger(id)) throw createError({ statusCode: 400, statusMessage: "id required" })
  const db = openDb(ctx())
  try {
    db.prepare("UPDATE questions SET archived = ? WHERE id = ?").run(archived ? 1 : 0, id)
    return { ok: true, id, archived: !!archived }
  } finally { db.close() }
})
