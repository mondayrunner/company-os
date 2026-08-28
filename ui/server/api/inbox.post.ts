// Reply, approve, reject or run. `run` executes approved items through the CLI
// (files under the root only; outward actions are refused by company-os itself).
export default defineEventHandler(async (event) => {
  const body = await readBody<any>(event)
  const { action, id, text } = body

  // Posten gaat door de core, niet door de CLI: het is één schrijfactie en de
  // pagina die hem stuurt wacht erop.
  if (action === "post") {
    const { postItem } = await import("#core/inbox.mjs")
    const { kind, from, title, where, body: itemBody, itemAction } = body
    if (!title) throw createError({ statusCode: 400, statusMessage: "title required" })
    return { ok: true, result: await postItem(ctx(), { kind, from, title, where, body: itemBody, action: itemAction }) }
  }

  if (!["reply", "approve", "reject", "run"].includes(action)) throw createError({ statusCode: 400, statusMessage: "unknown action" })
  const args = action === "run" ? ["inbox", "run", ...(id ? ["--id", id] : [])] : ["inbox", action, String(id), ...(text ? [text] : [])]
  try {
    return { ok: true, result: await cli(args, 660000) }
  } catch (e: any) {
    setResponseStatus(event, 500)
    return { ok: false, error: (e?.stderr || e?.message || "").toString().slice(0, 400) }
  }
})
