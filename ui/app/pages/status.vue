<script setup lang="ts">
// What is on: every connector and job from the config, with its state. The
// dashboard is a mirror of brainlane.config.json — turning something off is
// one line there, and it disappears here.
const { fmt } = useConfig()
const { data: sys, refresh: refreshSys, status: sysStatus } = useLazyFetch<any>("/api/system", { server: false })
const { data: mod } = useLazyFetch<any>("/api/modules", { server: false })
const jobs = computed(() => (sys.value?.ok ? sys.value.data.jobs : []))
const modules = computed(() => (mod.value?.ok ? mod.value.data : null))
const busy = computed(() => sysStatus.value === "pending")
const working = ref<string | null>(null)
const logOpen = ref<string | null>(null)
const note = ref<{ name: string; ok: boolean; text: string } | null>(null)
const broken = computed(() => jobs.value.filter((j: any) => j.state === "error" || j.stale).length)

const stateTone: Record<string, string> = { ok: "bg-success", partial: "bg-orange", error: "bg-red", unknown: "bg-ink-3" }

async function run(name: string) {
  working.value = name; note.value = null
  try {
    const r: any = await $fetch("/api/kickstart", { method: "POST", body: { name } })
    note.value = { name, ok: !!r?.ok, text: r?.ok ? "started" : r?.error || "failed" }
    setTimeout(() => refreshSys(), 4000)
  } catch (e: any) { note.value = { name, ok: false, text: e?.data?.error || "failed" } }
  finally { working.value = null; setTimeout(() => { if (note.value?.name === name) note.value = null }, 6000) }
}
</script>

<template>
  <div class="h-full overflow-y-auto">
    <div class="max-w-4xl mx-auto px-6 py-10">
      <div class="text-center mb-9">
        <div class="size-9 rounded-full mx-auto mb-4 flex items-center justify-center text-white text-[17px]" :class="busy && !jobs.length ? 'bg-ink-3 animate-pulse' : broken ? 'bg-red' : 'bg-success'">{{ busy && !jobs.length ? "" : broken ? "!" : "✓" }}</div>
        <h1 class="text-2xl font-semibold tracking-tight">
          <template v-if="busy && !jobs.length">Checking…</template>
          <template v-else-if="broken">{{ broken }} job{{ broken === 1 ? "" : "s" }} need attention</template>
          <template v-else>Everything is running</template>
        </h1>
        <p v-if="modules" class="text-[13px] text-ink-3 mt-1.5">
          {{ modules.connectors.filter((c: any) => !c.error).length }} connectors · {{ jobs.length }} jobs · {{ modules.language }}
          <button class="ml-2 text-red hover:underline" :disabled="busy" @click="refreshSys()">refresh</button>
        </p>
      </div>

      <div class="rounded-2xl ring-1 ring-line bg-card overflow-hidden mb-6">
        <div class="flex items-center gap-2.5 px-4 h-9 bg-header border-b border-line">
          <h2 class="text-[12px] font-semibold text-ink leading-none">Jobs</h2><span class="text-[11px] text-ink-3">from <code class="font-mono">brainlane.config.json</code></span>
        </div>
        <div v-for="j in jobs" :key="j.name" class="border-b border-line-soft last:border-0">
          <div class="flex items-center gap-2.5 px-4 py-2 text-[13px]">
            <span class="size-1.5 rounded-full shrink-0" :class="stateTone[j.state]" />
            <span class="text-ink truncate">{{ j.title }}</span>
            <span class="text-ink-3 text-[12px] shrink-0">{{ j.schedule }}</span>
            <span v-if="note?.name === j.name" class="text-[11px] shrink-0" :class="note.ok ? 'text-success' : 'text-red'">{{ note.text }}</span>
            <span v-else-if="j.state === 'error'" class="ml-auto text-red text-[11px] shrink-0">failed</span>
            <span v-else-if="j.state === 'partial'" class="ml-auto text-orange text-[11px] shrink-0">partly</span>
            <span v-else-if="j.state === 'unknown'" class="ml-auto text-ink-3 text-[11px] shrink-0">no status yet</span>
            <span v-else class="ml-auto text-[11px] shrink-0" :class="j.stale ? 'text-orange' : 'text-success'">{{ j.stale ? `${j.age}d quiet` : "ok" }}</span>
            <button v-if="!j.service" class="ml-1.5 text-ink-3 hover:text-red transition-colors text-[12px] px-1 shrink-0 disabled:opacity-40" :disabled="working === j.name" title="run now" @click="run(j.name)">{{ working === j.name ? "…" : "▶" }}</button>
            <button class="text-ink-3 hover:text-ink transition-colors text-[11px] px-1 shrink-0" title="last run and log tail" @click="logOpen = logOpen === j.name ? null : j.name">{{ logOpen === j.name ? "▾" : "▸" }}</button>
          </div>
          <p v-if="j.lastRun" class="text-[11px] text-ink-3 px-4 pb-1.5 pl-9 truncate">{{ fmt.when(j.lastRun) }}<span v-if="j.message"> · {{ j.message }}</span></p>
          <pre v-if="logOpen === j.name" class="mx-4 mb-2 ml-9 rounded-lg bg-header px-2.5 py-2 text-[10.5px] leading-snug text-ink-2 whitespace-pre-wrap break-all max-h-40 overflow-auto">{{ j.tail?.length ? j.tail.join("\n") : "no log yet" }}
<span class="text-ink-3">$ {{ j.run }}</span></pre>
        </div>
      </div>

      <div v-if="modules" class="rounded-2xl ring-1 ring-line bg-card overflow-hidden mb-6">
        <div class="flex items-center gap-2.5 px-4 h-9 bg-header border-b border-line">
          <h2 class="text-[12px] font-semibold text-ink leading-none">Connectors</h2><span class="text-[11px] text-ink-3">what this brain reads</span>
        </div>
        <div v-for="c in modules.connectors" :key="c.name" class="flex items-center gap-2.5 px-4 py-2 text-[13px] border-b border-line-soft last:border-0">
          <span class="size-1.5 rounded-full shrink-0" :class="c.error ? 'bg-red' : /error|not found/i.test(c.message || '') ? 'bg-orange' : 'bg-success'" />
          <span class="text-ink w-40 shrink-0 truncate">{{ c.name }}</span>
          <span class="text-[10px] px-1.5 py-px rounded-full bg-line-soft text-ink-3 shrink-0">{{ c.kind }}</span>
          <span v-if="c.volatile" class="text-[10px] px-1.5 py-px rounded-full bg-info/10 text-info shrink-0" title="read live, never copied into markdown">live</span>
          <span v-if="c.private" class="text-[10px] px-1.5 py-px rounded-full bg-line-soft text-ink-3 shrink-0" title="from your own connectors/ folder">private</span>
          <span class="text-[11px] text-ink-3 truncate">{{ c.error ?? c.message ?? c.location }}</span>
          <span class="ml-auto text-[11px] text-ink-3 tabular shrink-0">{{ fmt.when(c.lastScanned) }}</span>
        </div>
      </div>

      <p v-if="modules" class="text-[11px] text-ink-3 leading-relaxed">
        Root <code class="font-mono">{{ modules.root }}</code> · config <code class="font-mono">{{ modules.config }}</code> · index <code class="font-mono">{{ modules.db }}</code>.
        Add or remove a module by editing the config, then <code class="font-mono">brainlane jobs install</code>.
      </p>
    </div>
  </div>
</template>
