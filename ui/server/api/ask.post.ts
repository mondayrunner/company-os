// Ask the brain: `brainlane ask --json`. Index candidates, a headless agent reads
// the real files, live sources when the question touches one, sources per claim.
export default defineEventHandler(async (event) => {
  const { question } = await readBody<{ question: string }>(event)
  const q = String(question ?? "").trim()
  if (q.length < 3 || q.length > 800) throw createError({ statusCode: 400, statusMessage: "question too short or too long" })
  try {
    const r = await cli(["ask", q, "--json"], 320000)
    return { ok: true, ...r }
  } catch (e: any) {
    setResponseStatus(event, 500)
    return { ok: false, error: "the brain did not answer: " + (e?.stderr || e?.message || "").toString().slice(0, 300) }
  }
})
