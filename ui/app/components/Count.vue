<script setup lang="ts">
// Small chip next to a panel title. Red as soon as it needs attention.
defineProps<{ value: number | string; tone?: "quiet" | "warn" | "good" }>()
</script>
<template>
  <span class="text-[11px] px-1.5 py-px rounded-full tabular leading-relaxed" :class="{ 'bg-line-soft text-ink-3': !tone || tone === 'quiet', 'bg-red-soft text-red': tone === 'warn', 'bg-success-bg text-success': tone === 'good' }">{{ value }}</span>
</template>
