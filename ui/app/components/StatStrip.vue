<script setup lang="ts">
/**
 * One line that answers "how are we doing" before you read anything else.
 *
 * It reuses the panels' own fetch keys, so it costs no extra requests: the
 * strip and the panel below it are the same data, shown twice at two levels
 * of detail. Only stats whose connector exists are shown.
 */
const { cfg, fmt } = useConfig()
const has = (k: string) => cfg.value.kinds?.includes(k)
const q = (api: string) => useLazyFetch<any>(`/api/${api}`, { server: false, key: `panel-${api}` })
const d = (r: any) => (r.value?.ok ? r.value.data : null)

const { data: finance } = q("finance")
const { data: tasks } = q("tasks")
const { data: mail } = q("mail")
const { data: inbox } = q("inbox")
const { data: system } = q("system")

const stats = computed(() => {
  const out: { label: string; value: string; note?: string; tone?: string; to?: string; anchor?: string }[] = []
  const f = d(finance), t = d(tasks), m = d(mail), i = d(inbox), s = d(system)
  if (has("finance") && f) out.push({ label: "MRR", value: fmt.money(f.mrr, f.currency), note: `${f.subscriptions} subscriptions` })
  if (has("finance") && f?.openInvoices) out.push({ label: "Open invoices", value: fmt.money(f.openAmount, f.currency), note: `${f.overdue} overdue`, tone: f.overdue ? "warn" : undefined })
  if (has("tasks") && t) out.push({ label: "Tasks", value: String(t.total), note: t.overdue ? `${t.overdue} overdue` : "none overdue", tone: t.overdue ? "warn" : undefined })
  if (has("mail") && m) out.push({ label: "Unread", value: String(m.unread), tone: m.unread > 50 ? "warn" : undefined })
  if (i) out.push({ label: "Inbox", value: String(i.open.length), note: i.approved.length ? `${i.approved.length} approved` : "waiting for you", tone: i.open.length ? "warn" : "good", to: "/inbox" })
  if (s) {
    const bad = s.jobs.filter((j: any) => j.state === "error" || j.stale).length
    out.push({ label: "Jobs", value: bad ? String(bad) : "ok", note: bad ? "need attention" : `${s.jobs.length} running`, tone: bad ? "bad" : "good", to: "/status" })
  }
  return out
})
const tones: Record<string, string> = { warn: "text-orange", bad: "text-red", good: "text-success" }
</script>

<template>
  <div v-if="stats.length" class="flex flex-wrap gap-3">
    <component :is="s.to ? resolveComponent('NuxtLink') : 'div'" v-for="s in stats" :key="s.label" :to="s.to" class="rounded-2xl ring-1 ring-line bg-card px-4 py-3 block transition-colors grow basis-40" :class="s.to && 'hover:ring-ink-3'">
      <p class="text-[10px] uppercase tracking-wider text-ink-3">{{ s.label }}</p>
      <p class="text-[22px] font-semibold tabular leading-tight mt-0.5" :class="tones[s.tone ?? ''] ?? 'text-ink'">{{ s.value }}</p>
      <p v-if="s.note" class="text-[11px] text-ink-3 truncate">{{ s.note }}</p>
    </component>
  </div>
</template>
