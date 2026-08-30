<script setup lang="ts">
// Smooth area chart for a series. Bars suggest separate measurements; a series runs on.
const props = defineProps<{ points: { label: string; value: number }[]; height?: number }>()
const W = 300
const H = computed(() => props.height ?? 64)
const path = computed(() => {
  const p = props.points
  if (p.length < 2) return { line: "", area: "" }
  const max = Math.max(...p.map((x) => x.value), 1)
  const xy = p.map((x, i) => [(i / (p.length - 1)) * W, H.value - (x.value / max) * (H.value - 6) - 3])
  let d = `M ${xy[0][0]},${xy[0][1]}`
  for (let i = 0; i < xy.length - 1; i++) {
    const p0 = xy[i - 1] ?? xy[i], p1 = xy[i], p2 = xy[i + 1], p3 = xy[i + 2] ?? p2
    d += ` C ${p1[0] + (p2[0] - p0[0]) / 6},${p1[1] + (p2[1] - p0[1]) / 6} ${p2[0] - (p3[0] - p1[0]) / 6},${p2[1] - (p3[1] - p1[1]) / 6} ${p2[0]},${p2[1]}`
  }
  return { line: d, area: `${d} L ${W},${H.value} L 0,${H.value} Z` }
})
</script>
<template>
  <div>
    <svg :viewBox="`0 0 ${W} ${H}`" class="w-full" :style="{ height: `${H}px` }" preserveAspectRatio="none">
      <defs><linearGradient id="wavefill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="var(--color-red)" stop-opacity="0.28" /><stop offset="100%" stop-color="var(--color-red)" stop-opacity="0" /></linearGradient></defs>
      <path :d="path.area" fill="url(#wavefill)" />
      <path :d="path.line" fill="none" stroke="var(--color-red)" stroke-width="1.75" vector-effect="non-scaling-stroke" stroke-linecap="round" />
    </svg>
    <div class="flex justify-between mt-1"><span v-for="p in points" :key="p.label" class="text-[10px] text-ink-3 first-letter:uppercase">{{ p.label }}</span></div>
  </div>
</template>
