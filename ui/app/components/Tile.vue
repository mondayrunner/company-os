<script setup lang="ts">
defineProps<{ label: string; value: string | number; note?: string; tone?: "normal" | "good" | "warn" | "bad" }>()
const tones = { normal: "text-ink", good: "text-success", warn: "text-orange", bad: "text-red" }
</script>
<template>
  <div class="rounded-2xl ring-1 ring-line bg-card px-4 py-3">
    <p class="text-[11px] uppercase tracking-wider text-ink-3">{{ label }}</p>
    <p class="text-2xl font-semibold tabular mt-1.5" :class="tones[tone ?? 'normal']">{{ value }}</p>
    <p v-if="note" class="text-[11px] text-ink-3 mt-0.5 truncate">{{ note }}</p>
  </div>
</template>
