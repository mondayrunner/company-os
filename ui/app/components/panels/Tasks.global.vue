<script setup lang="ts">
const { fmt } = useConfig()
const lists = useCollapsed("task-lists")
</script>

<template>
  <Panel title="Tasks" api="tasks">
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
</template>
