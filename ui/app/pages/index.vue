<script setup lang="ts">
// The overview mirrors the config: a panel per live connector kind, then the
// brain itself. No kind configured, no panel — nothing to hide or stub.
const { cfg, fmt } = useConfig()
const has = (k: string) => cfg.value.kinds?.includes(k)
const monthName = (m: string) => new Date(`${m}-01`).toLocaleDateString(cfg.value.locale, { month: "short" })
const lists = useCollapsed("task-lists")
</script>

<template>
  <div class="h-full overflow-y-auto p-3 space-y-3">
    <StatStrip />
    <div class="grid gap-3 grid-cols-1 md:grid-cols-2 auto-rows-[20rem] xl:grid-cols-3">
    <Panel v-if="has('tasks')" title="Tasks" api="tasks">
      <template #head="{ data: d }">
        <Count v-if="d" :value="d.total" />
        <Count v-if="d?.overdue" :value="`${d.overdue} overdue`" tone="warn" />
      </template>
      <template #default="{ data }">
        <p v-if="!data.total" class="text-[13px] text-ink-3">Nothing open.</p>
        <div v-for="list in data.lists" :key="list.name" class="mb-3 last:mb-0">
          <button class="sticky top-0 z-10 w-full text-left text-[11px] uppercase tracking-wider text-ink-3 bg-header -mx-4 px-4 py-1.5 border-y border-line mb-1.5 flex items-center gap-1.5" @click="lists.toggle(list.name)">
            <span class="text-[9px] transition-transform" :class="lists.isClosed(list.name) ? '' : 'rotate-90'">▶</span>{{ list.name }}<Count :value="list.cards.length" />
          </button>
          <a v-for="c in (lists.isClosed(list.name) ? [] : list.cards)" :key="c.id" :href="c.url ?? undefined" target="_blank" class="flex items-baseline gap-2 text-[13px] py-1 px-2 -mx-2 rounded-lg hover:bg-cream transition-colors">
            <span class="truncate" :class="c.overdue ? 'text-red' : 'text-ink-2'">{{ c.title }}</span>
            <span v-if="c.due" class="ml-auto text-[11px] shrink-0 tabular" :class="c.overdue ? 'text-red' : 'text-ink-3'">{{ fmt.date(c.due) }}</span>
          </a>
        </div>
      </template>
    </Panel>

    <Panel v-if="has('calendar')" title="Calendar" api="calendar" v-slot="{ data }">
      <p class="text-[11px] uppercase tracking-wider text-ink-3 mb-1">Today</p>
      <p v-if="!data.today.length" class="text-[13px] text-ink-3 mb-2">Nothing in the calendar.</p>
      <div v-for="(e, i) in data.today" :key="i" class="flex gap-2.5 text-[13px] py-0.5">
        <span class="tabular text-ink-3 shrink-0 w-20 text-[12px]">{{ e.allDay ? "all day" : fmt.time(e.start) }}</span><span class="truncate text-ink">{{ e.summary }}</span>
      </div>
      <div v-for="d in data.upcoming" :key="d.date" class="mt-2">
        <p class="text-[11px] uppercase tracking-wider text-ink-3">{{ fmt.date(d.date, { weekday: "short", day: "numeric", month: "short" }) }}</p>
        <div v-for="(e, i) in d.events" :key="i" class="flex gap-2.5 text-[13px] py-0.5">
          <span class="tabular text-ink-3 shrink-0 w-20 text-[12px]">{{ e.allDay ? "all day" : fmt.time(e.start) }}</span><span class="truncate text-ink-2">{{ e.summary }}</span>
        </div>
      </div>
    </Panel>

    <Panel v-if="has('finance')" title="Finance" api="finance">
      <template #head="{ data: d }"><span v-if="d" class="text-[11px] text-ink-3 tabular">live · {{ fmt.time(d.fetched) }}</span></template>
      <template #default="{ data }">
        <div class="grid grid-cols-3 gap-2 mb-3">
          <div><p class="text-[10px] uppercase tracking-wider text-ink-3">MRR</p><p class="text-[17px] font-semibold tabular leading-tight">{{ fmt.money(data.mrr, data.currency) }}</p><p class="text-[10px] text-ink-3 tabular">{{ data.subscriptions }} subscriptions</p></div>
          <div><p class="text-[10px] uppercase tracking-wider text-ink-3">Open invoices</p><p class="text-[17px] font-semibold tabular leading-tight" :class="data.overdue ? 'text-orange' : ''">{{ fmt.money(data.openAmount, data.currency) }}</p><p class="text-[10px] text-ink-3 tabular">{{ data.openInvoices }} open · {{ data.overdue }} overdue</p></div>
          <div v-if="data.series?.length >= 2"><p class="text-[10px] uppercase tracking-wider text-ink-3">MRR, 90 days</p><Wave :points="data.series.map((r: any) => ({ label: '', value: r.value }))" :height="34" /></div>
        </div>
        <p class="text-[11px] uppercase tracking-wider text-ink-3 bg-header -mx-4 px-4 py-1.5 border-y border-line mb-1.5">Largest subscriptions</p>
        <div v-for="s in data.top" :key="s.id" class="flex text-[12.5px] py-px"><span class="truncate text-ink-2">{{ s.customer }}</span><span class="ml-auto tabular shrink-0 pl-2 text-ink-3">{{ fmt.money(s.monthly, s.currency) }}</span></div>
        <template v-if="data.invoices.length">
          <p class="text-[11px] uppercase tracking-wider text-ink-3 bg-header -mx-4 px-4 py-1.5 border-y border-line mt-3 mb-1.5">Open</p>
          <div v-for="f in data.invoices" :key="f.id" class="flex text-[12.5px] py-px"><span class="truncate" :class="f.overdue ? 'text-red' : 'text-ink-2'">{{ f.customer }}</span><span class="ml-auto tabular shrink-0 pl-2 text-ink-3">{{ fmt.money(f.amount, f.currency) }}</span></div>
        </template>
      </template>
    </Panel>

    <Panel v-if="has('mail')" title="Mail" api="mail">
      <template #head="{ data: d }"><Count v-if="d" :value="`${d.unread} unread`" :tone="d.unread > 50 ? 'warn' : 'quiet'" /></template>
      <template #default="{ data }">
        <div v-for="m in data.items" :key="m.uid" class="py-1 border-b border-line-soft last:border-0">
          <div class="flex items-baseline gap-2"><span class="text-[13px] text-ink truncate">{{ m.subject }}</span><span class="ml-auto text-[11px] text-ink-3 shrink-0 tabular">{{ fmt.date(m.date) }}</span></div>
          <p class="text-[11px] text-ink-3 truncate">{{ m.from }}</p>
        </div>
      </template>
    </Panel>

    <Panel title="Brain" api="brain" span="xl:col-span-2">
      <template #head="{ data: d }"><span v-if="d?.counts" class="text-[11px] text-ink-3 tabular">{{ d.counts.documents }} documents · {{ d.counts.relations }} relations · {{ d.counts.metricDays }} days of metrics</span></template>
      <template #default="{ data }">
        <div v-if="data.empty" class="text-[13px] text-ink-3">No database yet. Run <code class="font-mono text-[12px]">company-os index</code>.</div>
        <div v-else class="grid lg:grid-cols-[1fr_1.3fr] gap-5">
          <div>
            <p class="text-[11px] uppercase tracking-wider text-ink-3 mb-1.5">Sources</p>
            <div v-for="s in data.sources" :key="s.name" class="flex items-baseline gap-2 text-[12.5px] py-1 border-b border-line-soft last:border-0">
              <span class="size-1.5 rounded-full shrink-0 self-center" :class="/error|not found/i.test(s.message || '') ? 'bg-orange' : 'bg-success'" />
              <span class="text-ink">{{ s.name }}</span><span class="text-ink-3 text-[11px] truncate">{{ s.message }}</span>
              <span class="ml-auto text-[11px] text-ink-3 tabular shrink-0">{{ fmt.when(s.last_scanned) }}</span>
            </div>
            <div class="flex flex-wrap gap-1 mt-2"><Count v-for="k in data.byKind" :key="k.kind" :value="`${k.kind} ${k.n}`" /></div>
          </div>
          <div>
            <p class="text-[11px] uppercase tracking-wider text-ink-3 mb-1.5">
              Transcripts without an account
              <span class="normal-case tracking-normal" :class="data.transcripts.open ? 'text-orange' : 'text-success'">· {{ data.transcripts.open }} of {{ data.transcripts.total }}</span>
            </p>
            <div v-for="t in data.transcripts.recent.slice(0, 7)" :key="t.path" class="text-[12px] py-1 border-b border-line-soft last:border-0">
              <div class="flex items-baseline gap-2"><span class="text-ink truncate">{{ t.title.slice(0, 70) }}</span><span class="ml-auto text-[11px] text-ink-3 tabular shrink-0">{{ Math.round(t.seconds / 60) }} min</span></div>
              <p v-if="t.proposal?.length" class="text-[11px] text-ink-3 truncate">proposal: {{ t.proposal.map((v: string) => v.split("/").pop()).join(", ") }}</p>
            </div>
            <p class="text-[11px] text-ink-3 mt-2 leading-snug">Link them by answering in the <NuxtLink to="/inbox" class="text-red hover:underline">inbox</NuxtLink>, or set the account key in the file's frontmatter.</p>
          </div>
        </div>
      </template>
    </Panel>

    <Panel title="Inbox" api="inbox" anchor="inbox" to="/inbox" to-label="answer">
      <template #head="{ data: d }">
        <Count v-if="d" :value="`${d.open.length} open`" :tone="d.open.length ? 'warn' : 'good'" />
        <Count v-if="d?.approved.length" :value="`${d.approved.length} approved`" />
      </template>
      <template #default="{ data }">
        <p v-if="!data.open.length && !data.approved.length" class="text-[13px] text-ink-3">Nothing waiting.</p>
        <NuxtLink v-for="i in [...data.open, ...data.approved].slice(0, 12)" :key="i.id" to="/inbox" class="block py-1.5 border-b border-line-soft last:border-0 hover:bg-header -mx-2 px-2 rounded-lg transition-colors">
          <div class="flex items-baseline gap-2">
            <span class="text-[10px] px-1.5 py-px rounded-full shrink-0" :class="i.kind === 'drift' ? 'bg-orange/10 text-orange' : 'bg-line-soft text-ink-3'">{{ i.kind }}</span>
            <span class="text-[13px] text-ink truncate">{{ i.title }}</span>
            <span class="ml-auto text-[11px] text-ink-3 shrink-0 tabular">{{ fmt.date(i.created) }}</span>
          </div>
        </NuxtLink>
      </template>
    </Panel>
    </div>
  </div>
</template>
