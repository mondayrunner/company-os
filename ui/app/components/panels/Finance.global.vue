<script setup lang="ts">
const { fmt } = useConfig()
</script>

<template>
  <Panel title="Finance" api="finance">
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
</template>
