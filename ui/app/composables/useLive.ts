/**
 * De hartslag van het dashboard.
 *
 * Eén poller voor het hele scherm: hij haalt de twee tellingen op die kunnen
 * veranderen terwijl je ergens anders kijkt (wat wacht er op je, en valt er
 * iets om) en onthoudt of het getal net veranderd is. Daar hangt de badge in
 * het menu aan, en het bolletje dat even oplicht als er iets nieuws is.
 *
 * Bewust één interval en gedeelde state: tien componenten die elk hun eigen
 * timer starten maken een dashboard traag en het netwerkverkeer onleesbaar.
 */
const EVERY = 20_000

export function useLive() {
  const inboxOpen = useState("live-inbox", () => 0)
  const jobsBad = useState("live-jobs", () => 0)
  const beat = useState("live-beat", () => 0)
  const fresh = useState("live-fresh", () => false)
  const started = useState("live-started", () => false)

  async function poll() {
    const [inbox, system] = await Promise.all([
      $fetch<any>("/api/inbox").catch(() => null),
      $fetch<any>("/api/system").catch(() => null),
    ])
    if (inbox?.ok) {
      const n = inbox.data.open.length
      if (n > inboxOpen.value) { fresh.value = true; setTimeout(() => (fresh.value = false), 6000) }
      inboxOpen.value = n
    }
    if (system?.ok) jobsBad.value = system.data.jobs.filter((j: any) => j.state === "error" || j.stale).length
    beat.value = Date.now()
  }

  onMounted(() => {
    if (started.value) return
    started.value = true
    poll()
    const t = setInterval(poll, EVERY)
    // Terug op het scherm? Meteen kijken; anders staat er een oud getal.
    const wake = () => document.visibilityState === "visible" && poll()
    document.addEventListener("visibilitychange", wake)
    onUnmounted(() => { clearInterval(t); document.removeEventListener("visibilitychange", wake); started.value = false })
  })

  return { inboxOpen, jobsBad, beat, fresh, poll }
}
