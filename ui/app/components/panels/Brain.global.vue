<script setup lang="ts">
const { fmt } = useConfig()

// A title that starts with its own kind, next to a column that says the kind,
// is the same thing twice. Drop the prefix when it repeats. It compares the
// title against the data, so it works in any language.
const withoutKind = (title: string, kind: string) => (kind ? title.replace(new RegExp(`^${kind}\\s+`, "i"), "") : title)
</script>

<template>
  <Panel title="Brain" api="brain" span="xl:col-span-2">
    <template #head="{ data: d }">
      <span v-if="d?.counts" class="text-[11px] text-ink-3 tabular">{{ d.counts.documents }} documents · {{ d.counts.relations }} relations · {{ d.counts.metricDays }} days of metrics</span>
      <Count v-if="d?.counts?.inboxOpen" :value="`${d.counts.inboxOpen} in the inbox`" tone="warn" />
    </template>
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
            <div class="flex items-baseline gap-2"><span class="text-ink truncate">{{ withoutKind(t.title, t.kind).slice(0, 70) }}</span><span class="ml-auto text-[11px] text-ink-3 tabular shrink-0">{{ t.kind }} · {{ Math.round(t.seconds / 60) }} min</span></div>
            <p v-if="t.proposal?.length" class="text-[11px] text-ink-3 truncate">proposal: {{ t.proposal.map((v: string) => v.split("/").pop()).join(", ") }}</p>
          </div>
          <p class="text-[11px] text-ink-3 mt-2 leading-snug">Link them by answering in the <NuxtLink to="/inbox" class="text-red hover:underline">inbox</NuxtLink>, or set the account key in the file's frontmatter.</p>
        </div>
      </div>
    </template>
  </Panel>
</template>
