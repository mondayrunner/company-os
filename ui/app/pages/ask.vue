<script setup lang="ts">
/**
 * Vragen aan het brein, als gesprekkenlijst.
 *
 * Een lang antwoord hoort niet in een overlay: je wilt terug kunnen bladeren,
 * herlezen zonder opnieuw te betalen, en wat je gehad hebt uit het zicht kunnen
 * schuiven. Links de vragen (nieuw bovenaan, gegroepeerd naar dag), rechts het
 * antwoord met zijn bronnen, onderaan het veld — zoals elke chat die werkt.
 */
const { cfg, fmt } = useConfig()
const { question, busy, error: fault, answer, reading, ask: run, show } = useAsk()

const showArchived = ref(false)
const search = ref("")
const { data: log, refresh: refreshLog } = useLazyFetch<any>("/api/questions", {
  server: false, key: "ask-log", query: computed(() => ({ limit: 100, archived: showArchived.value ? "1" : "0" })),
})
const all = computed<any[]>(() => (log.value?.ok ? log.value.data.questions : []))
const threads = computed(() => {
  const q = search.value.trim().toLowerCase()
  const list = q ? all.value.filter((x) => x.question.toLowerCase().includes(q) || (x.answer ?? "").toLowerCase().includes(q)) : all.value
  // Gegroepeerd naar wanneer, want "vandaag" en "vorige week" zijn de enige
  // twee dingen die je van een oude vraag nog weet.
  const today = new Date().toISOString().slice(0, 10)
  const week = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10)
  const groups: { head: string; items: any[] }[] = [
    { head: "Today", items: [] }, { head: "This week", items: [] }, { head: "Earlier", items: [] },
  ]
  for (const x of list) {
    const d = x.ts.slice(0, 10)
    groups[d === today ? 0 : d >= week ? 1 : 2].items.push(x)
  }
  return groups.filter((g) => g.items.length)
})

const openId = ref<number | null>(null)
const current = computed(() => all.value.find((x) => x.id === openId.value) ?? null)

function openThread(t: any) { openId.value = t.id; show(t) }
async function ask(v?: string) {
  const q = (v ?? question.value).trim()
  openId.value = null
  await run(q)
  await refreshLog()
  const fresh = all.value.find((x) => x.question === q)
  if (fresh) openId.value = fresh.id
}
async function archive(t: any, on: boolean) {
  await $fetch("/api/questions", { method: "POST", body: { id: t.id, archived: on } })
  if (openId.value === t.id) { openId.value = null; answer.value = null }
  refreshLog()
}
function newQuestion() { openId.value = null; answer.value = null; question.value = ""; fault.value = null }
</script>

<template>
  <div class="h-full flex min-h-0">
    <!-- links: de vragen -->
    <aside class="w-72 shrink-0 border-r border-line flex flex-col min-h-0">
      <div class="h-9 shrink-0 flex items-center gap-2 px-3 bg-header border-b border-line">
        <button class="text-[12px] font-semibold text-ink hover:text-red transition-colors" @click="newQuestion">＋ New question</button>
        <button
          class="ml-auto text-[11px] transition-colors"
          :class="showArchived ? 'text-red' : 'text-ink-3 hover:text-ink'"
          @click="showArchived = !showArchived; openId = null"
        >{{ showArchived ? "archived" : "archive" }}</button>
      </div>
      <div class="px-3 py-2 border-b border-line-soft">
        <input v-model="search" type="search" placeholder="search questions and answers…" class="w-full text-[12px] bg-header rounded-full px-3 py-1 ring-1 ring-line text-ink placeholder:text-ink-3 focus:outline-none focus:ring-red" />
      </div>
      <div class="overflow-y-auto grow min-h-0">
        <p v-if="!threads.length" class="px-3 py-4 text-[12px] text-ink-3">{{ showArchived ? "Nothing archived." : "No questions yet." }}</p>
        <div v-for="g in threads" :key="g.head">
          <p class="sticky top-0 z-10 px-3 py-1.5 text-[10px] uppercase tracking-wider text-ink-3 bg-header border-y border-line">{{ g.head }}</p>
          <div
            v-for="t in g.items"
            :key="t.id"
            class="group flex items-start gap-2 px-3 py-2 border-b border-line-soft cursor-pointer transition-colors"
            :class="openId === t.id ? 'bg-red-soft' : 'hover:bg-header'"
            @click="openThread(t)"
          >
            <span class="shrink-0 mt-1 size-1.5 rounded-full" :class="t.found ? 'bg-success' : 'bg-orange'" />
            <span class="min-w-0 grow">
              <span class="text-[12.5px] block leading-snug line-clamp-2" :class="openId === t.id ? 'text-red' : 'text-ink'">{{ t.question }}</span>
              <span class="text-[10.5px] text-ink-3">{{ fmt.time(t.ts) }}<template v-if="t.askedBy === 'agent'"> · agent</template></span>
            </span>
            <button
              class="shrink-0 text-[11px] text-ink-3 opacity-0 group-hover:opacity-100 hover:text-red transition-opacity"
              :title="t.archived ? 'put back' : 'archive'"
              @click.stop="archive(t, !t.archived)"
            >{{ t.archived ? "↩" : "×" }}</button>
          </div>
        </div>
      </div>
    </aside>

    <!-- rechts: het gesprek -->
    <section class="grow min-h-0 flex flex-col">
      <div class="grow min-h-0 overflow-y-auto">
        <div class="max-w-2xl mx-auto px-8 py-8">
          <!-- niets open: uitleg en voorbeelden -->
          <template v-if="!answer && !busy">
            <h1 class="text-2xl font-semibold tracking-tight mb-2">Ask the brain</h1>
            <p class="text-[13.5px] text-ink-3 leading-relaxed mb-6">
              Answers from your own files, with a source per claim. Live sources are checked when a fact can change.
              Ten to twenty seconds, and you can walk away: every answer is saved on the left.
            </p>
            <div v-if="cfg.examples.length" class="flex flex-wrap gap-1.5">
              <button v-for="v in cfg.examples" :key="v" class="text-[11.5px] px-2.5 py-1 rounded-full ring-1 ring-line text-ink-3 hover:text-ink hover:ring-ink-3 transition-colors" @click="ask(v)">{{ v }}</button>
            </div>
          </template>

          <!-- de vraag -->
          <p v-if="answer || busy" class="text-[15px] font-semibold text-ink leading-snug mb-4">{{ question }}</p>

          <div v-if="busy" class="rounded-2xl ring-1 ring-line bg-card p-5"><AskProgress :reading="reading" /></div>
          <p v-if="fault" class="text-[13px] text-red">{{ fault }}</p>

          <article v-if="answer && !busy" class="rounded-2xl ring-1 ring-line bg-card p-6">
            <AnswerBody :text="answer.answer" />
            <AnswerSources :sources="answer.sources" :live="answer.live" />
            <div class="mt-3 pt-2 border-t border-line-soft flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-ink-3">
              <span :class="answer.found ? 'text-success' : 'text-orange'">{{ answer.found ? "found" : "not found in the brain" }}</span>
              <span v-if="answer.saved">saved answer, no new run</span>
              <span v-if="answer.duration">{{ (answer.duration / 1000).toFixed(0) }} s</span>
              <span v-if="answer.cost != null">${{ answer.cost.toFixed(3) }}</span>
              <button v-if="current" class="ml-auto hover:text-ink" @click="ask(current.question)">ask again ↻</button>
            </div>
          </article>
        </div>
      </div>

      <!-- onderaan: het veld, zoals in elke chat -->
      <form class="shrink-0 border-t border-line bg-header/60 px-8 py-3" @submit.prevent="ask()">
        <div class="max-w-2xl mx-auto flex gap-2">
          <input v-model="question" class="flex-1 text-[14px] bg-card ring-1 ring-line rounded-xl px-4 py-2.5 focus:outline-none focus:ring-ink-3" placeholder="Ask about customers, prices, strategy, pipeline…" :disabled="busy" />
          <button class="text-[13px] px-4 py-2 rounded-xl bg-red text-white disabled:opacity-50 hover:bg-red-hover transition-colors" :disabled="busy || question.trim().length < 3">{{ busy ? "…" : "Ask" }}</button>
        </div>
      </form>
    </section>
  </div>
</template>
