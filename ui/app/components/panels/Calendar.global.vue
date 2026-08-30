<script setup lang="ts">
const { fmt } = useConfig()
</script>

<template>
  <Panel title="Calendar" api="calendar" v-slot="{ data }">
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
</template>
