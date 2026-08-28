<script setup lang="ts">
// A silent failure must not stay invisible: broken or stale jobs show up here, at the top.
const { data } = useLazyFetch<any>("/api/system", { server: false, key: "alert-system" })
const problems = computed(() => {
  const d = data.value?.ok ? data.value.data : null
  if (!d) return []
  const out: string[] = []
  for (const j of d.jobs) {
    if (j.state === "error") out.push(`${j.title}: last run failed${j.message ? ` (${j.message})` : ""}`)
    else if (j.state === "partial") out.push(`${j.title}: partly done${j.message ? ` (${j.message})` : ""}`)
    if (j.stale) out.push(`${j.title}: no run for ${j.age} ${j.weekdays ? "weekdays" : "days"}`)
  }
  return out
})
</script>
<template>
  <div v-if="problems.length" class="px-5 py-2 bg-red-soft border-b border-line flex items-center gap-3 flex-wrap">
    <span class="size-2 rounded-full bg-red shrink-0" />
    <span class="text-[13px] text-red font-medium">{{ problems.length }} job{{ problems.length === 1 ? "" : "s" }} need attention</span>
    <span v-for="p in problems" :key="p" class="text-[12px] text-ink-2">· {{ p }}</span>
    <NuxtLink to="/status" class="ml-auto text-[12px] text-red hover:underline shrink-0">see status</NuxtLink>
  </div>
</template>
