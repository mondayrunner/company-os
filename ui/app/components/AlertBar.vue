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

// Een rood lampje waar je niets mee kunt is een verwijt. Deze knop laat een
// agent de log en de status van precies die job lezen en het oplossen.
const fixing = ref<string | null>(null)
const result = ref<{ job: string; text: string; ok: boolean } | null>(null)
async function fix(job: string) {
  if (fixing.value) return
  fixing.value = job
  result.value = null
  try {
    const r: any = await $fetch("/api/fix", { method: "POST", body: { job } })
    result.value = { job, text: r?.ok ? r.answer : r?.error ?? "failed", ok: !!r?.fixed }
    refresh()
  } catch (e: any) {
    result.value = { job, text: e?.data?.error || e?.message || "failed", ok: false }
  } finally { fixing.value = null }
}
</script>
<template>
  <div v-if="problems.length || result" class="px-5 py-2 bg-red-soft border-b border-line">
    <div class="flex items-center gap-3 flex-wrap">
      <span class="size-2 rounded-full bg-red shrink-0" />
      <span class="text-[13px] text-red font-medium">{{ problems.length }} job{{ problems.length === 1 ? " needs" : "s need" }} attention</span>
      <span v-for="p in problems" :key="p.job" class="text-[12px] text-ink-2 flex items-center gap-1.5">
        · {{ p.text }}
        <button
          v-if="fixing !== p.job"
          class="text-[11px] px-2 py-0.5 rounded-full bg-red text-white hover:bg-red-hover transition-colors shrink-0"
          :disabled="!!fixing"
          title="let an agent read the log and fix the cause"
          @click="fix(p.job)"
        >✦ fix with AI</button>
        <Waiting v-else :active="true" small />
      </span>
      <NuxtLink to="/status" class="ml-auto text-[12px] text-red hover:underline shrink-0">see status</NuxtLink>
    </div>
    <div v-if="result" class="mt-2 pt-2 border-t border-line/60 flex items-start gap-2">
      <span class="text-[11px] shrink-0 mt-0.5" :class="result.ok ? 'text-success' : 'text-orange'">{{ result.ok ? "✓" : "!" }}</span>
      <pre class="text-[12px] text-ink-2 whitespace-pre-wrap font-sans leading-relaxed grow">{{ result.text }}</pre>
      <button class="text-[11px] text-ink-3 hover:text-ink shrink-0" @click="result = null">close</button>
    </div>
  </div>
</template>
