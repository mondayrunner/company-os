/**
 * Asking the brain, shared by the ask page and the ⌘K bar.
 *
 * The index answers in milliseconds and the agent takes half a minute, so we
 * show what it is about to read the moment you press enter. Waiting without a
 * signal is the thing that makes a slow answer feel broken.
 */
export function useAsk() {
  // Gedeelde state: stel je een vraag in de ⌘K-balk en klap je hem dicht, dan
  // loopt hij door en staat het antwoord er als je hem weer opent.
  const question = useState("ask-q", () => "")
  const busy = useState("ask-busy", () => false)
  const error = useState<string | null>("ask-err", () => null)
  const answer = useState<any>("ask-a", () => null)
  const reading = useState<any[]>("ask-reading", () => [])

  async function ask(v?: string) {
    const q = (v ?? question.value).trim()
    if (q.length < 3 || busy.value) return
    question.value = q
    busy.value = true
    error.value = null
    answer.value = null
    reading.value = []
    $fetch<any>("/api/search", { query: { q, limit: 8 } }).then((r) => { if (busy.value && r?.ok) reading.value = r.data.hits }).catch(() => {})
    try {
      answer.value = await $fetch<any>("/api/ask", { method: "POST", body: { question: q } })
    } catch (e: any) {
      // De agent draait op de server en gaat door, ook als deze verbinding sneuvelt.
      // Dus voor we "mislukt" zeggen, kijken we of het antwoord al opgeslagen is.
      const saved = await recall(q)
      if (saved) answer.value = saved
      else error.value = e?.data?.error || e?.message || "failed"
    } finally { busy.value = false }
  }

  /** Het opgeslagen antwoord op een eerdere vraag. Leest, vraagt niet opnieuw. */
  async function recall(q: string) {
    const r = await $fetch<any>("/api/questions", { query: { limit: 50 } }).catch(() => null)
    const hit = r?.ok ? r.data.questions.find((x: any) => x.question === q && x.answer) : null
    return hit ? { question: hit.question, answer: hit.answer, sources: hit.sources, found: hit.found, cost: hit.cost, duration: hit.duration, live: [], candidates: [], saved: true } : null
  }
  function show(saved: any) { answer.value = { ...saved, saved: true }; question.value = saved.question; error.value = null }
  function reset() { answer.value = null; question.value = ""; error.value = null; reading.value = [] }
  return { question, busy, error, answer, reading, ask, reset, recall, show }
}
