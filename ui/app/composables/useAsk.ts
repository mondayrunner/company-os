/**
 * Asking the brain, shared by the ask page and the ⌘K bar.
 *
 * The index answers in milliseconds and the agent takes half a minute, so we
 * show what it is about to read the moment you press enter. Waiting without a
 * signal is the thing that makes a slow answer feel broken.
 */
export function useAsk() {
  const question = ref("")
  const busy = ref(false)
  const error = ref<string | null>(null)
  const answer = ref<any>(null)
  const reading = ref<any[]>([])

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
      error.value = e?.data?.error || e?.message || "failed"
    } finally { busy.value = false }
  }
  function reset() { answer.value = null; question.value = ""; error.value = null; reading.value = [] }
  return { question, busy, error, answer, reading, ask, reset }
}
