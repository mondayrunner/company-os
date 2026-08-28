<script setup lang="ts">
// While the agent reads: show the files the index already found. Honest
// progress beats a spinner — you can see whether it is looking in the right place.
defineProps<{ reading: any[] }>()
</script>

<template>
  <div class="space-y-2">
    <div class="flex items-center gap-2 text-[12px] text-ink-3">
      <span class="size-1.5 rounded-full bg-red animate-pulse" />
      <span v-if="!reading.length">Searching the index…</span>
      <span v-else>Reading {{ reading.length }} files and checking live sources…</span>
    </div>
    <div v-for="h in reading" :key="h.path + h.heading" class="text-[11.5px] py-0.5 border-b border-line-soft last:border-0">
      <span class="text-ink-2">{{ h.path.split("/").pop() }}</span>
      <span v-if="h.heading" class="text-ink-3"> · {{ h.heading }}</span>
      <span class="text-ink-3 font-mono block truncate opacity-70">{{ h.path }}</span>
    </div>
  </div>
</template>
