<script setup lang="ts">
const { fmt } = useConfig()
</script>

<template>
  <Panel title="Mail" api="mail">
    <template #head="{ data: d }"><Count v-if="d" :value="`${d.unread} unread`" :tone="d.unread > 50 ? 'warn' : 'quiet'" /></template>
    <template #default="{ data }">
      <div v-for="m in data.items" :key="m.uid" class="py-1 border-b border-line-soft last:border-0">
        <div class="flex items-baseline gap-2"><span class="text-[13px] text-ink truncate">{{ m.subject }}</span><span class="ml-auto text-[11px] text-ink-3 shrink-0 tabular">{{ fmt.date(m.date) }}</span></div>
        <p class="text-[11px] text-ink-3 truncate">{{ m.from }}</p>
      </div>
    </template>
  </Panel>
</template>
