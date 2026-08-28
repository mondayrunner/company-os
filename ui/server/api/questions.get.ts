// Every question and its answer, straight from the brain. Asking costs money and
// half a minute; reading it back should cost neither. This is also what makes it
// safe to walk away mid-question: the run finishes on the server and the answer
// lands here.
export default defineEventHandler(async (event) =>
  source("Questions", async () => {
    const d = brain()
    if (!d) return { questions: [] }
    const limit = Math.min(Number(getQuery(event).limit) || 20, 100)
    const rows = d.prepare(
      "SELECT ts, question, answer, sources, found, cost_usd, duration_ms, asked_by FROM questions ORDER BY ts DESC LIMIT ?",
    ).all(limit) as any[]
    return {
      questions: rows.map((r) => ({
        ts: r.ts, question: r.question, answer: r.answer, found: !!r.found,
        sources: JSON.parse(r.sources || "[]"), cost: r.cost_usd, duration: r.duration_ms, askedBy: r.asked_by,
      })),
    }
  }),
)
