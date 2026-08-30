<script setup lang="ts">
// The only waiting state in the whole dashboard. The same everywhere: a sign
// that turns, a word that changes, and how long it has been going.
const props = defineProps<{ active: boolean; detail?: string | null; small?: boolean }>()
const { word, elapsed } = useWaiting(toRef(props, "active"))
</script>

<template>
  <span v-if="active" class="inline-flex items-baseline gap-2" :class="small ? 'text-[11.5px]' : 'text-[13px]'">
    <span class="text-red spin-slow leading-none">✳</span>
    <span class="text-ink-2">{{ word }}…</span>
    <span class="text-ink-3 tabular">({{ elapsed }}<template v-if="detail"> · {{ detail }}</template>)</span>
  </span>
</template>

<style scoped>
.spin-slow{display:inline-block;animation:sp 1.6s linear infinite}
@keyframes sp{to{transform:rotate(360deg)}}
</style>
