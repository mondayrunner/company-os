<script setup lang="ts">
// Ask the brain. One field, one answer with sources. The index picks the
// candidates, an agent reads them, live sources are fetched when the question
// touches one. Read-only.
const { cfg, fmt } = useConfig()
const { question, busy, error: fault, answer, reading, ask: run, show } = useAsk()
const { data: log, refresh: refreshLog } = useLazyFetch<any>("/api/questions", { server: false, key: "ask-log", query: { limit: 20 } })
const earlier = computed(() => (log.value?.ok ? log.value.data.questions : []))
const { data: brainData } = useLazyFetch<any>("/api/brain", { server: false, key: "ask-brain" })
const state = computed(() => (brainData.value?.ok ? brainData.value.data : null))

async function ask(v?: string) {
  await run((v ?? question.value).trim())
  refreshLog()
}
</script>

<template>
  <div class="h-full overflow-y-auto">
    <div class="max-w-3xl mx-auto px-6 py-8">
      <header class="mb-5">
        <h1 class="text-2xl font-semibold tracking-tight">
          Ask the brain
          <span v-if="state?.counts" class="font-henry italic font-normal text-ink-3 text-lg">{{ state.counts.documents }} documents · {{ state.counts.relations }} relations</span>
        </h1>
        <p class="text-[13px] text-ink-3 mt-1">
          Answers from your own files, with a source per claim. Live sources are checked when a fact can change.
          Usually ten to twenty seconds — and you can walk away: the answer is saved below either way.
        </p>
      </header>

      <form class="flex gap-2 mb-3" @submit.prevent="ask()">
        <input v-model="question" class="flex-1 text-[14px] bg-card ring-1 ring-line rounded-xl px-4 py-2.5 focus:outline-none focus:ring-ink-3" placeholder="Ask about customers, prices, strategy, pipeline…" :disabled="busy" />
        <button class="text-[13px] px-4 py-2 rounded-xl bg-red text-white disabled:opacity-50 hover:bg-red-hover transition-colors" :disabled="busy || question.trim().length < 3">{{ busy ? "thinking…" : "Ask" }}</button>
      </form>

      <div v-if="!answer && !busy && cfg.examples.length" class="flex flex-wrap gap-1.5 mb-6">
        <button v-for="v in cfg.examples" :key="v" class="text-[11px] px-2.5 py-1 rounded-full ring-1 ring-line text-ink-3 hover:text-ink hover:ring-ink-3 transition-colors" @click="ask(v)">{{ v }}</button>
      </div>

      <div v-if="busy" class="rounded-2xl ring-1 ring-line bg-card p-5 mb-6"><AskProgress :reading="reading" /></div>
      <p v-if="fault" class="text-[13px] text-red mb-4">{{ fault }}</p>

      <article v-if="answer" class="rounded-2xl ring-1 ring-line bg-card p-6 mb-4">
        <AnswerBody :text="answer.answer" />
        <AnswerSources :sources="answer.sources" :live="answer.live" />
        <div class="mt-3 pt-2 border-t border-line-soft flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-ink-3">
          <span :class="answer.found ? 'text-success' : 'text-orange'">{{ answer.found ? "found" : "not found in the brain" }}</span>
          <span v-if="answer.saved" class="text-ink-3">saved answer</span>
          <span v-if="answer.duration">{{ (answer.duration / 1000).toFixed(0) }} s</span><span v-if="answer.cost != null">${{ answer.cost.toFixed(3) }}</span>
        </div>
        <details v-if="answer.candidates?.length" class="mt-2">
          <summary class="text-[11px] text-ink-3 cursor-pointer">Candidates from the index ({{ answer.candidates.length }})</summary>
          <ul class="mt-1 text-[11px] text-ink-3 font-mono"><li v-for="k in answer.candidates" :key="k.path + k.heading">{{ k.path }} <span class="opacity-70">· {{ k.heading }}</span></li></ul>
        </details>
      </article>

      <div v-if="earlier.length" class="mb-6">
        <p class="text-[11px] uppercase tracking-wider text-ink-3 mb-1.5">Asked before <span class="normal-case tracking-normal">· click to read the saved answer, no new run</span></p>
        <div v-for="g in earlier" :key="g.ts" class="flex items-baseline gap-2 py-0.5 group">
          <span class="shrink-0" :class="g.found ? 'text-success' : 'text-orange'">●</span>
          <button class="text-left text-[12px] text-ink-2 hover:text-ink truncate grow" :disabled="!g.answer" @click="show(g)">{{ g.question }}</button>
          <span class="text-ink-3 text-[11px] shrink-0 tabular">{{ g.ts.slice(5, 10) }}<template v-if="g.askedBy === 'agent'"> · agent</template></span>
          <button class="text-[11px] text-ink-3 opacity-0 group-hover:opacity-100 hover:text-red shrink-0" title="ask again" @click="ask(g.question)">↻</button>
        </div>
      </div>
    </div>
  </div>
</template>
