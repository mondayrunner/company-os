<script setup lang="ts">
// A silent failure must not stay invisible: broken or stale jobs show up here, at the top.
const { data, refresh } = useLazyFetch<any>("/api/system", { server: false, key: "alert-system" })
const problems = computed(() => {
  const d = data.value?.ok ? data.value.data : null
  if (!d) return []
  return d.jobs
    .filter((j: any) => j.state === "error" || j.state === "partial" || j.stale)
    .map((j: any) => ({
      job: j.name,
      text: `${j.title}: ${j.state === "error" ? "last run failed" : j.state === "partial" ? "partly done" : `no run for ${j.age} ${j.weekdays ? "weekdays" : "days"}`}${j.message ? ` (${j.message})` : ""}`,
    }))
})

</script>
<template>
  <div v-if="problems.length" class="px-5 py-2 bg-red-soft border-b border-line">
    <div class="flex items-center gap-3 flex-wrap">
      <span class="size-2 rounded-full bg-red shrink-0" />
      <span class="text-[13px] text-red font-medium">{{ problems.length }} job{{ problems.length === 1 ? " needs" : "s need" }} attention</span>
      <span v-for="p in problems" :key="p.job" class="text-[12px] text-ink-2 flex items-center gap-1.5">
        · {{ p.text }}
      </span>
      <NuxtLink to="/status" class="ml-auto text-[12px] text-red hover:underline shrink-0">see status</NuxtLink>
    </div>
  </div>
</template>
