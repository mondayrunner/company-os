<script setup lang="ts">
// What the agents did, newest first. The inbox answers "what needs me"; this
// answers "what happened". Keeping those apart is the whole point: an inbox
// that also carries finished work stops being a to-do list and becomes a feed.
const { fmt } = useConfig()
const { data, status, refresh } = useLazyFetch<any>("/api/activity", { server: false })

const content = computed(() => (data.value?.ok ? data.value.data : null))
const busy = computed(() => status.value === "pending")
const running = computed<any[]>(() => content.value?.running ?? [])

// Group by day, in the order they came back (already newest first).
const days = computed(() => {
  const out: { day: string; rows: any[] }[] = []
  for (const r of content.value?.rows ?? []) {
    const day = r.ts.slice(0, 10)
    ;(out.find((d) => d.day === day) ?? out[out.push({ day, rows: [] }) - 1]).rows.push(r)
  }
  return out
})

const tone: Record<string, string> = { ok: "bg-success", partial: "bg-orange", error: "bg-red" }
const time = (iso: string) => iso.slice(11, 16)
const elapsed = (s: number) => (s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`)
const money = (n: number) => `$${n.toFixed(2)}`

// While something runs, keep asking — same cadence as the inbox.
let ticker: ReturnType<typeof setInterval> | null = null
watch(running, (r) => {
  if (r.length && !ticker) ticker = setInterval(() => refresh(), 5000)
  else if (!r.length && ticker) { clearInterval(ticker); ticker = null }
}, { immediate: true })
onBeforeUnmount(() => { if (ticker) clearInterval(ticker) })
</script>

<template>
  <div class="h-full overflow-y-auto">
    <div class="max-w-4xl mx-auto px-6 py-10">
      <div class="mb-8">
        <h1 class="text-2xl font-semibold tracking-tight">Activity</h1>
        <p class="text-[13px] text-ink-3 mt-1.5">
          <template v-if="busy && !content">Reading…</template>
          <template v-else-if="content">
            {{ content.rows.length }} runs
            <template v-if="content.spentToday"> · {{ money(content.spentToday) }} today</template>
            <template v-if="running.length"> · <span class="text-success">{{ running.length }} running now</span></template>
          </template>
          <button class="ml-2 text-red hover:underline" :disabled="busy" @click="refresh()">refresh</button>
        </p>
      </div>

      <!-- Now, before then. A run in flight is the only row you cannot read the
           outcome of yet, so it sits on top rather than in the day it started. -->
      <div v-if="running.length" class="rounded-2xl ring-1 ring-line bg-card overflow-hidden mb-5">
        <div class="flex items-center gap-2.5 px-4 h-9 bg-header border-b border-line">
          <h2 class="text-[12px] font-semibold text-ink leading-none">Running now</h2>
          <span class="text-[11px] text-ink-3">carries on if you close the tab</span>
        </div>
        <div v-for="r in running" :key="r.item" class="flex items-center gap-3 px-4 py-2 border-b border-line-soft last:border-0">
          <span class="size-2 rounded-full bg-success animate-pulse shrink-0" />
          <span class="text-[13px] text-ink truncate">{{ r.what || r.item }}</span>
          <span class="text-[11px] text-ink-3 font-mono truncate">{{ r.item }}</span>
          <span class="ml-auto text-[11px] text-ink-3 tabular shrink-0">{{ elapsed(r.seconds) }}</span>
        </div>
      </div>

      <div v-for="d in days" :key="d.day" class="rounded-2xl ring-1 ring-line bg-card overflow-hidden mb-4">
        <div class="flex items-center gap-2.5 px-4 h-9 bg-header border-b border-line">
          <h2 class="text-[12px] font-semibold text-ink leading-none">{{ fmt.date(d.day) }}</h2>
          <span class="text-[11px] text-ink-3 tabular">{{ d.rows.length }} runs</span>
        </div>
        <div v-for="(r, n) in d.rows" :key="n" class="flex items-baseline gap-3 px-4 py-2 border-b border-line-soft last:border-0">
          <span class="size-2 rounded-full shrink-0 self-center" :class="tone[r.result] ?? 'bg-ink-3'" />
          <span class="text-[11px] text-ink-3 tabular shrink-0 w-10">{{ time(r.ts) }}</span>
          <span class="text-[13px] text-ink shrink-0 w-40 truncate">{{ r.job }}</span>
          <span class="text-[12px] text-ink-3 truncate">{{ r.message }}</span>
          <span v-if="r.cost" class="ml-auto text-[11px] text-ink-3 tabular shrink-0">{{ money(r.cost) }}</span>
        </div>
      </div>

      <div v-if="content && !content.rows.length" class="rounded-2xl ring-1 ring-line bg-card p-4 text-[13px] text-ink-3">
        Nothing yet. Runs land here as jobs and agents finish.
      </div>

      <p class="text-[11px] text-ink-3 mt-4 leading-relaxed">
        Every job writes a row here through its status file; runs you start yourself — an inbox item, a role on a card, a
        draft — write one too. Cost is what the run reported, so a row without a number is one that does not talk to a
        model. Things that need a decision from you are in the
        <NuxtLink to="/inbox" class="underline">inbox</NuxtLink>, not here.
      </p>
    </div>
  </div>
</template>
