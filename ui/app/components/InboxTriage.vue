<script setup lang="ts">
/**
 * Triage: the inbox as one question at a time. The queue comes from the core
 * (triageQueue), already ordered so the first answers clear the most, and with
 * near-identical items folded into one card. Each card says what yes, no and
 * later do before you press anything.
 *
 * Keys: j or y = yes, n = no, l = later, Enter = the card's default, r = type
 * a reply first (on yes it is the value or steers the agent). Yes runs file
 * edits at once; agent runs start in the background like the ✓ button.
 */
const props = defineProps<{ triage: any; running: any[] }>()
const emit = defineEmits<{ (e: "answered"): void; (e: "close"): void }>()

const current = computed<any>(() => props.triage?.queue?.[0] ?? null)
const counts = computed<any>(() => props.triage?.counts ?? { questions: 0, items: 0, later: 0 })
const text = ref("")
const working = ref(false)
const last = ref<{ ok: boolean; line: string } | null>(null)
const showItems = ref(false)
watch(() => current.value?.ref, () => { text.value = ""; showItems.value = false })

const tierLabel: Record<string, string> = { ready: "ready to apply", candidate: "best guess", finding: "finding", reply: "needs your answer", refused: "refused", report: "report" }

async function answer(a: "yes" | "no" | "later") {
  const e = current.value
  if (!e || working.value) return
  if (a === "yes" && e.needsReply && !text.value.trim()) { document.getElementById("triage-reply")?.focus(); last.value = { ok: false, line: "type the answer first, then yes" }; return }
  working.value = true
  try {
    const r: any = await $fetch("/api/inbox", { method: "POST", body: { action: "answer", ref: e.ref, answer: a, text: text.value } })
    if (!r?.ok) last.value = { ok: false, line: r?.error ?? "failed" }
    else {
      const res: any[] = r.result.results
      const good = res.filter((x) => x.ok).length
      const started = r.result.run?.ok ? " · agent run started" : r.result.run ? ` · ${r.result.run.error}` : ""
      last.value = { ok: good === res.length, line: `${a}: ${good}/${res.length} ${a === "yes" ? "done" : a === "no" ? "rejected" : "left open"}${started}${good < res.length ? ` — ${res.find((x) => !x.ok)?.message ?? ""}` : ""}` }
    }
    emit("answered")
  } catch (err: any) { last.value = { ok: false, line: err?.data?.error || err?.message || "failed" } }
  finally { working.value = false }
}

function keys(e: KeyboardEvent) {
  const el = e.target as HTMLElement
  if (el?.tagName === "INPUT" || el?.tagName === "TEXTAREA") {
    if (e.key === "Escape") el.blur()
    else if (e.key === "Enter" && el.id === "triage-reply") { e.preventDefault(); answer("yes") }
    return
  }
  if (e.metaKey || e.ctrlKey || e.altKey || !current.value) return
  const k = e.key.toLowerCase()
  if (k === "j" || k === "y") { e.preventDefault(); answer("yes") }
  else if (k === "n") { e.preventDefault(); answer("no") }
  else if (k === "l") { e.preventDefault(); answer("later") }
  else if (e.key === "Enter") { e.preventDefault(); answer(current.value.default) }
  else if (k === "r" || k === "e") { e.preventDefault(); document.getElementById("triage-reply")?.focus() }
  else if (k === "d") { e.preventDefault(); showItems.value = !showItems.value }
  else if (e.key === "Escape") { e.preventDefault(); emit("close") }
}
onMounted(() => window.addEventListener("keydown", keys))
onBeforeUnmount(() => window.removeEventListener("keydown", keys))
</script>

<template>
  <div class="h-full overflow-y-auto">
    <div class="max-w-[680px] mx-auto px-6 py-10">
      <div class="flex items-baseline gap-3 text-[11.5px] text-ink-3 tabular">
        <span><b class="text-ink font-semibold">{{ counts.questions }}</b> question{{ counts.questions === 1 ? "" : "s" }} · {{ counts.items }} item{{ counts.items === 1 ? "" : "s" }} left</span>
        <span v-if="counts.later">· {{ counts.later }} for later</span>
        <span v-if="running.length" class="flex items-center gap-1.5">· <span class="size-1.5 rounded-full bg-success animate-pulse" />{{ running.length }} running</span>
        <button class="ml-auto hover:text-ink" title="back to the list (Esc)" @click="emit('close')">list view</button>
      </div>

      <div v-if="current" class="mt-3 bg-card ring-1 ring-line rounded-xl overflow-hidden">
        <div class="px-6 pt-5 pb-4">
          <p class="text-[10.5px] uppercase tracking-wider text-ink-3">
            {{ tierLabel[current.tier] ?? current.tier }}<template v-if="current.group"> · {{ current.size }} items</template> · {{ current.check ? `check ${current.check}` : `from ${current.from}` }}
          </p>
          <h2 class="mt-1.5 text-[17px] font-semibold text-ink leading-snug break-words">{{ current.question }}</h2>
          <p v-if="current.detail" class="mt-2 text-[12.5px] text-ink-2 leading-relaxed break-words">{{ current.detail }}</p>
          <button v-if="current.group || current.items[0]?.where" class="mt-2 text-[11.5px] text-ink-3 hover:text-ink" @click="showItems = !showItems">{{ showItems ? "hide" : current.group ? `show the ${current.size}` : "show where" }} (d)</button>
          <ul v-if="showItems" class="mt-2 space-y-1.5 max-h-64 overflow-y-auto">
            <li v-for="i in current.items" :key="i.id" class="text-[12px] text-ink-2">
              <NuxtLink :to="`/inbox/${i.id}`" class="hover:text-red">{{ i.title }}</NuxtLink>
              <span v-if="i.where" class="block font-mono text-[10.5px] text-ink-3 truncate">{{ i.where }}</span>
              <span v-if="i.detail" class="block text-[11.5px] text-ink-3">{{ i.detail }}</span>
            </li>
          </ul>
        </div>

        <dl class="px-6 py-3 border-t border-line-soft bg-header text-[12.5px] space-y-1.5">
          <div class="flex gap-3"><dt class="w-14 shrink-0 font-semibold text-success">yes</dt><dd class="text-ink-2 break-words min-w-0">{{ current.yes }}</dd></div>
          <div class="flex gap-3"><dt class="w-14 shrink-0 font-semibold text-red">no</dt><dd class="text-ink-2 break-words min-w-0">{{ current.no }}</dd></div>
          <div class="flex gap-3"><dt class="w-14 shrink-0 font-semibold text-ink-3">later</dt><dd class="text-ink-2 break-words min-w-0">{{ current.later }}</dd></div>
        </dl>

        <div class="px-6 py-3 border-t border-line flex items-center gap-2">
          <input id="triage-reply" v-model="text" type="text" :placeholder="current.needsReply ? 'type the answer, Enter = yes…' : current.candidate ? `another account than ${current.candidate}? (optional)` : 'reply (optional), Enter = yes…'" class="grow min-w-0 bg-card ring-1 ring-line rounded-lg px-3 py-1.5 text-[13px] outline-none focus:ring-ink-3 placeholder:text-ink-3" :disabled="working" />
          <button class="shrink-0 text-[12.5px] px-3.5 py-1.5 rounded-full bg-success text-white hover:opacity-85 disabled:opacity-40" :class="current.default === 'yes' && 'ring-2 ring-success/30'" :disabled="working || current.tier === 'refused'" title="yes (j / y)" @click="answer('yes')">{{ working ? "…" : "yes" }} <span class="opacity-70 font-mono text-[10.5px]">j</span></button>
          <button class="shrink-0 text-[12.5px] px-3.5 py-1.5 rounded-full ring-1 ring-line text-ink hover:bg-cream disabled:opacity-40" :disabled="working" title="no (n)" @click="answer('no')">no <span class="opacity-60 font-mono text-[10.5px]">n</span></button>
          <button class="shrink-0 text-[12.5px] px-3.5 py-1.5 rounded-full text-ink-3 hover:bg-cream hover:text-ink disabled:opacity-40" :class="current.default === 'later' && 'ring-1 ring-line'" :disabled="working" title="later (l)" @click="answer('later')">later <span class="opacity-60 font-mono text-[10.5px]">l</span></button>
        </div>
      </div>

      <div v-else class="mt-3 bg-card ring-1 ring-line rounded-xl px-6 py-8 text-center">
        <p class="text-[15px] font-semibold text-ink">Inbox clear.</p>
        <p class="text-[12.5px] text-ink-3 mt-1">{{ counts.later ? `${counts.later} left for later; they come back in a few hours.` : "Nothing waits for an answer." }}</p>
      </div>

      <p v-if="last" class="mt-3 text-[12px] break-words" :class="last.ok ? 'text-ink-3' : 'text-red'">{{ last.line }}</p>
      <p class="mt-6 text-[11px] text-ink-3 font-mono">j/y yes · n no · l later · enter default · r reply · d items · esc list</p>
    </div>
  </div>
</template>
