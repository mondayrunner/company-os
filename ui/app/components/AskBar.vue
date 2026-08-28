<script setup lang="ts">
// Ask the brain from anywhere: a bar in the header (⌘K) that opens an overlay
// with the answer and its sources. One field that both navigates and asks.
const { cfg } = useConfig()
const open = ref(false), question = ref(""), busy = ref(false), fault = ref<string | null>(null), answer = ref<any>(null)
const field = ref<HTMLInputElement | null>(null)
const router = useRouter()
const pages = computed(() => [{ p: "/", t: "Overview" }, ...cfg.value.nav, { p: "/inbox", t: "Inbox" }, { p: "/status", t: "Status" }, { p: "/ask", t: "All questions" }])
const { data: brainData, refresh: refreshBrain } = useLazyFetch<any>("/api/brain", { server: false, key: "askbar-brain" })
const earlier = computed(() => (brainData.value?.ok ? brainData.value.data.questions ?? [] : []))
const pageHits = computed(() => { const q = question.value.trim().toLowerCase(); return !q || q.length > 24 ? [] : pages.value.filter((p) => p.t.toLowerCase().includes(q)) })
function show() { open.value = true; nextTick(() => field.value?.focus()) }
function close() { open.value = false }
function go(p: string) { close(); router.push(p) }
async function ask(v?: string) {
  const q = (v ?? question.value).trim()
  if (q.length < 3 || busy.value) return
  question.value = q; busy.value = true; fault.value = null; answer.value = null
  try { answer.value = await $fetch<any>("/api/ask", { method: "POST", body: { question: q } }); refreshBrain() }
  catch (e: any) { fault.value = e?.data?.error || e?.message || "failed" }
  finally { busy.value = false }
}
function key(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); open.value ? close() : show() }
  else if (e.key === "Escape" && open.value) close()
}
onMounted(() => window.addEventListener("keydown", key))
onBeforeUnmount(() => window.removeEventListener("keydown", key))
</script>

<template>
  <button class="flex items-center gap-2 min-w-0 w-40 lg:w-auto lg:min-w-56 max-w-md flex-1 text-left text-[12px] px-3 py-1.5 rounded-full bg-card ring-1 ring-line text-ink-3 hover:ring-ink-3 hover:text-ink transition-colors" title="Ask the brain (⌘K)" @click="show">
    <span class="text-red">✦</span><span class="truncate">{{ answer ? question : "Ask the brain…" }}</span>
    <kbd class="ml-auto text-[10px] font-mono px-1.5 py-px rounded bg-header ring-1 ring-line text-ink-3">⌘K</kbd>
  </button>
  <Teleport to="body">
    <div v-if="open" class="fixed inset-0 z-50 bg-ink/30 backdrop-blur-[2px] flex items-start justify-center pt-[8vh] px-4" @mousedown.self="close">
      <div class="w-full max-w-2xl rounded-2xl bg-card ring-1 ring-line shadow-2xl overflow-hidden flex flex-col max-h-[84vh]">
        <form class="flex items-center gap-2 px-4 py-3 border-b border-line" @submit.prevent="ask()">
          <span class="text-red text-[14px]">✦</span>
          <input ref="field" v-model="question" class="flex-1 bg-transparent text-[15px] focus:outline-none placeholder:text-ink-3" placeholder="Ask about customers, prices, strategy, pipeline…" :disabled="busy" />
          <kbd v-if="!busy" class="text-[10px] font-mono px-1.5 py-px rounded bg-header ring-1 ring-line text-ink-3">↵</kbd><span v-else class="text-[11px] text-ink-3 animate-pulse">thinking…</span>
        </form>
        <div class="overflow-y-auto">
          <div v-if="pageHits.length && !answer" class="px-2 py-2 border-b border-line-soft">
            <p class="text-[10px] uppercase tracking-wider text-ink-3 px-2 mb-1">Go to</p>
            <button v-for="p in pageHits" :key="p.p" class="w-full text-left text-[13px] px-2 py-1 rounded-lg hover:bg-header" @click="go(p.p)">{{ p.t }} <span class="text-ink-3 text-[11px]">{{ p.p }}</span></button>
          </div>
          <div v-if="busy" class="px-5 py-5 space-y-2">
            <div v-for="i in 5" :key="i" class="h-3.5 rounded bg-line-soft animate-pulse" :style="{ width: `${100 - (i % 4) * 14}%` }" />
            <p class="text-[11px] text-ink-3 pt-1">Index searched, reading files and live sources. 20 to 90 seconds.</p>
          </div>
          <p v-else-if="fault" class="px-5 py-4 text-[13px] text-red">{{ fault }}</p>
          <div v-else-if="answer" class="px-5 py-4">
            <AnswerBody :text="answer.answer" />
            <div class="mt-3 pt-2 border-t border-line-soft flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-ink-3">
              <span :class="answer.found ? 'text-success' : 'text-orange'">{{ answer.found ? "found" : "not found in the brain" }}</span>
              <span>{{ answer.sources.length }} source{{ answer.sources.length === 1 ? "" : "s" }}</span>
              <span v-if="answer.live?.length" class="text-info">live: {{ answer.live.map((l: any) => l.kind).join(", ") }}</span>
              <span>{{ (answer.duration / 1000).toFixed(0) }} s</span><span v-if="answer.cost != null">${{ answer.cost.toFixed(2) }}</span>
              <button class="ml-auto hover:text-ink" @click="answer = null; question = ''; field?.focus()">new question</button>
            </div>
          </div>
          <div v-else class="px-2 py-2">
            <template v-if="cfg.examples.length"><p class="text-[10px] uppercase tracking-wider text-ink-3 px-2 mb-1">Try</p>
              <button v-for="v in cfg.examples" :key="v" class="w-full text-left text-[13px] px-2 py-1 rounded-lg hover:bg-header text-ink-2" @click="ask(v)">{{ v }}</button></template>
            <template v-if="earlier.length"><p class="text-[10px] uppercase tracking-wider text-ink-3 px-2 mt-3 mb-1">Asked before</p>
              <button v-for="g in earlier.slice(0, 6)" :key="g.ts" class="w-full text-left text-[13px] px-2 py-1 rounded-lg hover:bg-header text-ink-2 flex gap-2" @click="ask(g.question)"><span :class="g.found ? 'text-success' : 'text-orange'">●</span><span class="truncate">{{ g.question }}</span><span class="ml-auto text-[11px] text-ink-3 shrink-0">{{ g.ts.slice(5, 10) }}</span></button></template>
          </div>
        </div>
        <div class="px-4 py-2 border-t border-line text-[10px] text-ink-3 flex gap-3"><span><kbd class="font-mono">↵</kbd> ask</span><span><kbd class="font-mono">esc</kbd> close</span><NuxtLink to="/ask" class="ml-auto hover:text-ink" @click="close">all questions →</NuxtLink></div>
      </div>
    </div>
  </Teleport>
</template>
