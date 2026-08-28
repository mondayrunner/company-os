// Reply, approve, reject or run. `run` executes approved items through the CLI
// (files under the root only; outward actions are refused by company-os itself).
export default defineEventHandler(async (event) => {
  const { action, id, text } = await readBody<{ action: "reply" | "approve" | "reject" | "run"; id?: string; text?: string }>(event)
  if (!["reply", "approve", "reject", "run"].includes(action)) throw createError({ statusCode: 400, statusMessage: "unknown action" })
  const args = action === "run" ? ["inbox", "run", ...(id ? ["--id", id] : [])] : ["inbox", action, String(id), ...(text ? [text] : [])]
  try {
    return { ok: true, result: await cli(args, 660000) }
  } catch (e: any) {
    setResponseStatus(event, 500)
    return { ok: false, error: (e?.stderr || e?.message || "").toString().slice(0, 400) }
  }
})
