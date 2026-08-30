/**
 * The heartbeat of the dashboard.
 *
 * One poller for the whole screen. Every few seconds it asks `/api/version`
 * for one number: the newest thing that happened anywhere — an event row, an
 * inbox file, a job status. When that number moves, every panel refetches.
 * That is how a todo made from Claude Code shows up here within seconds
 * without a socket: the action left a trace, the trace has a time, the time
 * changed. The two counts the menu needs (inbox waiting, jobs down) ride on
 * the same tick.
 *
 * One interval and shared state, on purpose: ten components each starting
 * their own timer make a dashboard slow and the network traffic unreadable.
 */
const EVERY = 3_000
const COUNTS_EVERY = 20_000

export function useLive() {
  const inboxOpen = useState("live-inbox", () => 0)
  const jobsBad = useState("live-jobs", () => 0)
  const beat = useState("live-beat", () => 0)
  const fresh = useState("live-fresh", () => false)
  const started = useState("live-started", () => false)
  const version = useState("live-version", () => "")
  let lastCounts = 0

  // The cheap tick: one number. Changed → refresh everything on screen.
  async function tick() {
    const v = await $fetch<any>("/api/version").catch(() => null)
    if (!v?.ok) return
    const changed = version.value && v.data.version !== version.value
    version.value = v.data.version
    if (changed) { await refreshNuxtData(); fresh.value = true; setTimeout(() => (fresh.value = false), 3000) }
    if (changed || Date.now() - lastCounts > COUNTS_EVERY) { lastCounts = Date.now(); await poll() }
  }

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
    tick()
    const t = setInterval(tick, EVERY)
    // Back on screen? Look straight away, or the number sits there stale.
    const wake = () => document.visibilityState === "visible" && tick()
    document.addEventListener("visibilitychange", wake)
    onUnmounted(() => { clearInterval(t); document.removeEventListener("visibilitychange", wake); started.value = false })
  })

  return { inboxOpen, jobsBad, beat, fresh, version, poll }
}
