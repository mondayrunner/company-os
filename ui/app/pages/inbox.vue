<script setup lang="ts">
// The inbox: what agents and jobs say back, and where you answer. Built for
// triage, because findings arrive in batches: move with j/k, open with e,
// approve with a, reject with r, select with x for bulk actions.
const { fmt } = useConfig()
const { data, status, refresh } = useLazyFetch<any>("/api/inbox", { server: false })
const content = computed(() => (data.value?.ok ? data.value.data : null))
const busy = computed(() => status.value === "pending")

const reply = reactive<Record<string, string>>({})
const working = ref<string | null>(null)
const expanded = reactive<Record<string, boolean>>({})
const selected = ref<Set<string>>(new Set())
const cursor = ref(0)
const note = ref<string | null>(null)

const sections = computed(() => [
  { key: "open", head: "Open", items: content.value?.open ?? [] },
  { key: "approved", head: "Approved, not yet run", items: content.value?.approved ?? [] },
  { key: "closed", head: "Closed", items: content.value?.closed ?? [], dim: true },
])
// One flat order for keyboard movement, in the order the sections are shown.
const flat = computed(() => sections.value.flatMap((s) => s.items))
const current = computed(() => flat.value[cursor.value] ?? null)
const actionable = computed(() => flat.value.filter((i: any) => selected.value.has(i.id) && ["open", "approved"].includes(i.status)))

const kindTone: Record<string, string> = { drift: "bg-orange/10 text-orange", proposal: "bg-success/10 text-success", question: "bg-info/10 text-info", report: "bg-ink-3/10 text-ink-3" }
const statusTone: Record<string, string> = { approved: "text-success", done: "text-success", failed: "text-red", rejected: "text-ink-3" }

async function act(action: string, id?: string, text?: string) {
  working.value = id ?? action
  note.value = null
  try {
    const r: any = await $fetch("/api/inbox", { method: "POST", body: { action, id, text } })
    if (!r?.ok) note.value = r?.error ?? "failed"
    if (id) reply[id] = ""
    await refresh()
  } catch (e: any) { note.value = e?.data?.error || e?.message || "failed" }
  finally { working.value = null }
}
async function bulk(action: "approve" | "reject") {
  const ids = actionable.value.map((i: any) => i.id)
  working.value = "bulk"
  try {
    for (const id of ids) await $fetch("/api/inbox", { method: "POST", body: { action, id, text: reply[id] } })
    selected.value = new Set()
    await refresh()
  } finally { working.value = null }
}
function toggleSelect(id: string) {
  const s = new Set(selected.value)
  s.has(id) ? s.delete(id) : s.add(id)
  selected.value = s
}
function move(step: number) {
  if (!flat.value.length) return
  cursor.value = Math.max(0, Math.min(flat.value.length - 1, cursor.value + step))
  nextTick(() => document.getElementById(`item-${current.value?.id}`)?.scrollIntoView({ block: "nearest" }))
}

function keys(e: KeyboardEvent) {
  const el = e.target as HTMLElement
  if (el?.tagName === "INPUT" || el?.tagName === "TEXTAREA") {
    if (e.key === "Escape") el.blur()
    return
  }
  if (e.metaKey || e.ctrlKey || e.altKey) return
  const item: any = current.value
  const k = e.key.toLowerCase()
  if (k === "j" || e.key === "ArrowDown") { e.preventDefault(); move(1) }
  else if (k === "k" || e.key === "ArrowUp") { e.preventDefault(); move(-1) }
  else if (!item) return
  else if (k === "e" || e.key === "Enter") { e.preventDefault(); expanded[item.id] = !expanded[item.id]; if (expanded[item.id]) nextTick(() => document.getElementById(`reply-${item.id}`)?.focus()) }
  else if (k === "x") { e.preventDefault(); toggleSelect(item.id) }
  else if (k === "a" && item.status === "open") { e.preventDefault(); act("approve", item.id, reply[item.id]) }
  else if (k === "r" && item.status === "open") { e.preventDefault(); act("reject", item.id, reply[item.id]) }
  else if (k === "u" && item.status === "approved") { e.preventDefault(); act("run", item.id) }
}
onMounted(() => window.addEventListener("keydown", keys))
onBeforeUnmount(() => window.removeEventListener("keydown", keys))
</script>

<template>
  <div class="h-full overflow-y-auto">
    <div class="max-w-3xl mx-auto px-6 py-8">
      <div class="mb-4 flex items-end justify-between gap-4">
        <div>
          <h1 class="text-[22px] font-semibold text-ink tracking-tight">Inbox</h1>
          <p v-if="content" class="text-[13px] text-ink-3 mt-1.5">
            {{ content.open.length }} waiting for you · {{ content.total }} in total
            <button class="ml-2 text-red hover:underline" :disabled="busy" @click="refresh()">{{ busy ? "working…" : "refresh" }}</button>
            <span v-if="note" class="ml-2 text-red">{{ note }}</span>
          </p>
          <p v-else-if="data && !data.ok" class="text-[13px] text-red mt-1.5 font-mono">{{ data.error }}</p>
        </div>
        <button v-if="content?.approved.length" class="text-[12px] px-3 py-1.5 rounded-full bg-ink text-card hover:opacity-80 disabled:opacity-40 shrink-0" :disabled="working === 'run'" @click="act('run')">
          {{ working === "run" ? "running…" : `Run ${content.approved.length} approved` }}
        </button>
      </div>

      <!-- Bulk bar: findings arrive in batches, so dismissing or approving a
           batch has to be one gesture, not eight. -->
      <div v-if="actionable.length" class="sticky top-0 z-20 mb-3 flex items-center gap-3 rounded-xl bg-ink text-card px-4 py-2 text-[12.5px] shadow-lg">
        <span>{{ actionable.length }} selected</span>
        <button class="px-2.5 py-1 rounded-full bg-success text-white hover:opacity-80 disabled:opacity-40" :disabled="working === 'bulk'" @click="bulk('approve')">Approve</button>
        <button class="px-2.5 py-1 rounded-full ring-1 ring-card/40 hover:bg-card/10 disabled:opacity-40" :disabled="working === 'bulk'" @click="bulk('reject')">Reject</button>
        <button class="ml-auto opacity-70 hover:opacity-100" @click="selected = new Set()">clear</button>
      </div>

      <template v-if="content">
        <div v-for="s in sections" :key="s.key" class="rounded-2xl ring-1 ring-line bg-card overflow-hidden mb-5" :class="s.dim && 'opacity-70'">
          <div class="px-4 h-9 flex items-center gap-2 bg-header border-b border-line text-[11px] font-semibold uppercase tracking-wider text-ink-3">
            {{ s.head }} <Count :value="s.items.length" :tone="s.key === 'open' && s.items.length ? 'warn' : 'quiet'" />
          </div>
          <div v-if="!s.items.length" class="px-4 py-4 text-[13px] text-ink-3">Nothing.</div>
          <div v-for="i in s.items" :id="`item-${i.id}`" :key="i.id" class="border-b border-line-soft last:border-0" :class="current?.id === i.id && 'bg-header/60 ring-1 ring-inset ring-red/30'">
            <div class="flex items-start gap-3 px-4 py-2.5">
              <button class="shrink-0 mt-0.5 size-4 rounded border flex items-center justify-center text-[10px] transition-colors" :class="selected.has(i.id) ? 'bg-red border-red text-white' : 'border-line hover:border-ink-3'" :aria-label="`select ${i.title}`" @click.stop="toggleSelect(i.id)">{{ selected.has(i.id) ? "✓" : "" }}</button>
              <button class="flex items-start gap-3 min-w-0 grow text-left" @click="cursor = flat.indexOf(i); expanded[i.id] = !expanded[i.id]">
                <span class="text-[10px] px-2 py-0.5 rounded-full shrink-0 mt-0.5" :class="kindTone[i.kind] || kindTone.report">{{ i.kind }}</span>
                <span class="min-w-0 grow">
                  <span class="text-[13px] text-ink block truncate">{{ i.title }}</span>
                  <span v-if="i.where" class="text-[11px] text-ink-3 font-mono block truncate">{{ i.where }}</span>
                </span>
                <!-- Status alleen tonen als hij iets toevoegt: in de open-sectie is hij voor elke rij hetzelfde. -->
                <span v-if="i.status !== 'open'" class="text-[10px] shrink-0 uppercase tracking-wide mt-0.5" :class="statusTone[i.status] || 'text-ink-3'">{{ i.status }}</span>
                <span class="text-[11px] text-ink-3 shrink-0 tabular mt-0.5">{{ fmt.date(i.created) }}</span>
              </button>
              <!-- The two decisions live on the row itself; opening the item is for reading, not for acting. -->
              <div v-if="i.status === 'open'" class="flex gap-1 shrink-0 -mt-0.5">
                <button class="text-[11px] px-2 py-1 rounded-full text-success hover:bg-success-bg disabled:opacity-40" :disabled="working === i.id" title="approve (a)" @click.stop="act('approve', i.id, reply[i.id])">✓</button>
                <button class="text-[11px] px-2 py-1 rounded-full text-ink-3 hover:bg-header disabled:opacity-40" :disabled="working === i.id" title="reject (r)" @click.stop="act('reject', i.id)">✕</button>
              </div>
              <button v-else-if="i.status === 'approved'" class="text-[11px] px-2 py-1 rounded-full bg-ink text-card hover:opacity-80 disabled:opacity-40 shrink-0" :disabled="working === i.id" title="run (u)" @click.stop="act('run', i.id)">run</button>
            </div>

            <div v-if="expanded[i.id]" class="px-4 pb-4 pt-1 pl-11 text-[13px] text-ink space-y-3">
              <pre class="whitespace-pre-wrap font-sans text-[12.5px] text-ink-2 leading-relaxed">{{ i.description }}</pre>
              <p v-if="i.action" class="text-[11px] text-ink-3 font-mono">action: {{ i.action.type }}<template v-if="i.action.file"> · {{ i.action.file }}</template></p>
              <pre v-if="i.reply" class="whitespace-pre-wrap font-sans text-[12.5px] text-ink-2 border-l-2 border-line pl-3">{{ i.reply }}</pre>
              <pre v-if="i.result" class="whitespace-pre-wrap font-mono text-[11.5px] text-ink-3 border-l-2 border-line pl-3">{{ i.result }}</pre>
              <div v-if="['open', 'approved'].includes(i.status)" class="flex items-start gap-2">
                <input :id="`reply-${i.id}`" v-model="reply[i.id]" type="text" placeholder="answer or instruction, then approve…" class="grow bg-header ring-1 ring-line rounded-lg px-3 py-1.5 text-[13px] outline-none focus:ring-ink-3" @keydown.enter="act('reply', i.id, reply[i.id])" />
                <button class="text-[12px] px-3 py-1.5 rounded-full ring-1 ring-line hover:bg-header disabled:opacity-40 shrink-0" :disabled="working === i.id" @click="act('reply', i.id, reply[i.id])">reply</button>
              </div>
            </div>
          </div>
        </div>

        <p class="text-[11px] text-ink-3 flex flex-wrap gap-x-3 gap-y-1">
          <span><kbd class="font-mono">j</kbd>/<kbd class="font-mono">k</kbd> move</span>
          <span><kbd class="font-mono">e</kbd> open</span>
          <span><kbd class="font-mono">x</kbd> select</span>
          <span><kbd class="font-mono">a</kbd> approve</span>
          <span><kbd class="font-mono">r</kbd> reject</span>
          <span><kbd class="font-mono">u</kbd> run</span>
          <span class="ml-auto">Every item is a file in <code class="font-mono">inbox/</code>; rejecting one silences that finding for good.</span>
        </p>
      </template>
    </div>
  </div>
</template>
