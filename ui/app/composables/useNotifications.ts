/**
 * Browser notifications. The dashboard sits in a tab you do not look at; without
 * this you only notice a broken job when you happen to check. Only changes that
 * need you produce a notification, at most one per signal per day.
 */
type Signal = { key: string; title: string; text: string; urgent?: boolean }
const STORE = "notifications-seen"
const INTERVAL = 3 * 60_000

export function useNotifications() {
  const allowed = ref(false)
  const on = useState("notifications-on", () => true)

  async function ask() {
    if (!("Notification" in window)) return false
    if (Notification.permission === "granted") return (allowed.value = true)
    if (Notification.permission === "denied") return false
    return (allowed.value = (await Notification.requestPermission()) === "granted")
  }
  function seen(): Record<string, string> { try { return JSON.parse(localStorage.getItem(STORE) ?? "{}") } catch { return {} } }
  function send(signals: Signal[]) {
    if (!allowed.value || !on.value) return
    const known = seen(), now = new Date().toISOString(), today = now.slice(0, 10)
    let changed = false
    for (const s of signals) {
      if (known[s.key]?.slice(0, 10) === today) continue
      const n = new Notification(s.title, { body: s.text, tag: s.key, requireInteraction: s.urgent })
      n.onclick = () => { window.focus(); n.close() }
      known[s.key] = now; changed = true
    }
    if (changed) localStorage.setItem(STORE, JSON.stringify(known))
  }
  async function look() {
    const signals: Signal[] = []
    const sys = await $fetch<any>("/api/system").catch(() => null)
    if (sys?.ok) for (const j of sys.data.jobs) {
      if (j.state === "error") signals.push({ key: `job-${j.name}`, title: "Job failed", text: `${j.title} — ${j.message || "see the dashboard"}`, urgent: true })
      else if (j.state === "partial") signals.push({ key: `job-partial-${j.name}`, title: "Job partly done", text: `${j.title} — ${j.message || "see the dashboard"}` })
      if (j.stale) signals.push({ key: `job-stale-${j.name}`, title: "Job has not run", text: `${j.title} has not run for ${j.age} ${j.weekdays ? "weekdays" : "days"}`, urgent: true })
    }
    const inbox = await $fetch<any>("/api/inbox").catch(() => null)
    if (inbox?.ok && inbox.data.open.length) signals.push({ key: `inbox-${inbox.data.open.length}`, title: `${inbox.data.open.length} inbox items waiting`, text: inbox.data.open.slice(0, 3).map((i: any) => i.title).join(" · ") })
    send(signals)
  }
  onMounted(async () => {
    if ("Notification" in window && Notification.permission === "granted") allowed.value = true
    if (!allowed.value) return
    look()
    const t = setInterval(() => on.value && look(), INTERVAL)
    onUnmounted(() => clearInterval(t))
  })
  return { allowed, on, ask, look }
}
