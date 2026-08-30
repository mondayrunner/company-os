<script setup lang="ts">
const { fmt } = useConfig()
</script>

<template>
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
</template>
