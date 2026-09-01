<script setup lang="ts">
/**
 * The inbox: what the brain wants to change and you have not seen yet. Four
 * kinds — a proposal (approve applies it), a finding (approve sends an agent to
 * fix what it names, reject silences it), a question from `link` (answer, then
 * approve) and a report (read it, or type what to do and approve).
 *
 * Split view like the rest of the app: the list on the left is for moving and
 * deciding, the pane on the right is the whole item with the one gesture —
 * say what should happen and press Enter. ✓ takes the item as proposed, ✕
 * says no. For a batch of findings: x to select, then approve or reject all.
 */
const { fmt } = useConfig()
const { data, status, refresh } = useLazyFetch<any>("/api/inbox", { server: false })
const content = computed(() => (data.value?.ok ? data.value.data : null))
const busy = computed(() => status.value === "pending")

const reply = reactive<Record<string, string>>({})
// What the server says is in flight. Not local state: a run survives this tab,
// so the page has to ask rather than remember.
const running = computed<any[]>(() => content.value?.running ?? [])
const isRunning = (id: string) => running.value.some((r) => r.item === id || r.item === "all")
const runningFor = (id: string) => running.value.find((r) => r.item === id || r.item === "all")?.seconds ?? 0
const elapsed = (s: number) => (s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`)
const working = ref<string | null>(null)
const checked = ref<Set<string>>(new Set())
const note = ref<string | null>(null)

const sections = computed(() => [
  { key: "open", head: "Open", items: content.value?.open ?? [] },
  { key: "approved", head: "Approved, not run yet", items: content.value?.approved ?? [] },
  { key: "closed", head: "Closed", items: content.value?.closed ?? [], dim: true },
].filter((s) => s.key !== "approved" || s.items.length))
const flat = computed(() => sections.value.flatMap((s) => s.items))

// The pane shows one item; the cursor and the pane are the same thing, so
// j/k reads the inbox the way j/k reads a mailbox.
const route = useRoute()
const router = useRouter()
const openId = ref<string | null>(null)
const current = computed(() => flat.value.find((i: any) => i.id === openId.value) ?? null)
// The URL owns the selection: clicking pushes a query, the watcher follows it,
// and the browser's back button walks the same trail in reverse.
function show(id: string) { if (id !== openId.value) router.push({ path: `/inbox/${id}`, query: route.query }) }
watch(() => route.params.id, (id) => { openId.value = typeof id === "string" && id ? id : null }, { immediate: true })
watch(() => flat.value[0]?.id, () => { if (!route.params.id && !openId.value && flat.value[0]) openId.value = flat.value[0].id })

const actionable = computed(() => flat.value.filter((i: any) => checked.value.has(i.id) && ["open", "approved"].includes(i.status) && i.kind !== "report"))
const doLabel: Record<string, string> = { drift: "fix it", proposal: "apply", question: "answer", report: "do it" }
const kindTone: Record<string, string> = { drift: "bg-orange/10 text-orange", proposal: "bg-success/10 text-success", question: "bg-info/10 text-info", report: "bg-ink-3/10 text-ink-3" }
const statusTone: Record<string, string> = { approved: "text-success", done: "text-success", failed: "text-red", rejected: "text-ink-3" }

async function act(action: string, id?: string, text?: string) {
  working.value = id ?? action
  note.value = null
  try {
    const r: any = await $fetch("/api/inbox", { method: "POST", body: { action, id, text } })
    if (!r?.ok) note.value = r?.error ?? "failed"
    if (id) reply[id] = ""
    if (action === "approve" && r?.ok) await $fetch("/api/inbox", { method: "POST", body: { action: "run", id } }).catch(() => null)
    await refresh()
  } catch (e: any) { note.value = e?.data?.error || e?.message || "failed" }
  finally { working.value = null }
}

let ticker: ReturnType<typeof setInterval> | null = null
function schedule(ms: number) {
  if (ticker) clearInterval(ticker)
  ticker = setInterval(() => refresh(), ms)
}
onMounted(() => watch(running, (r) => schedule(r.length ? 5000 : 15000), { immediate: true }))
onBeforeUnmount(() => { if (ticker) clearInterval(ticker) })

async function bulk(action: "approve" | "reject") {
  const ids = actionable.value.map((i: any) => i.id)
  working.value = "bulk"
  try {
    for (const id of ids) await $fetch("/api/inbox", { method: "POST", body: { action, id, text: reply[id] } })
    if (action === "approve" && ids.length) await $fetch("/api/inbox", { method: "POST", body: { action: "run" } }).catch(() => null)
    checked.value = new Set()
    await refresh()
  } finally { working.value = null }
}
function toggleCheck(id: string) {
  const s = new Set(checked.value)
  s.has(id) ? s.delete(id) : s.add(id)
  checked.value = s
}
function move(step: number) {
  if (!flat.value.length) return
  const i = Math.max(0, Math.min(flat.value.length - 1, flat.value.findIndex((x: any) => x.id === openId.value) + step))
  show(flat.value[i].id)
  nextTick(() => document.getElementById(`item-${openId.value}`)?.scrollIntoView({ block: "nearest" }))
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
  else if (k === "e" || e.key === "Enter") { e.preventDefault(); if (item.status === "open") document.getElementById("reply-box")?.focus() }
  else if (k === "x") { e.preventDefault(); toggleCheck(item.id) }
  else if (k === "a" && item.status === "open" && (item.kind !== "report" || reply[item.id])) { e.preventDefault(); act("approve", item.id, reply[item.id]) }
  else if (k === "r" && item.status === "open") { e.preventDefault(); act("reject", item.id, reply[item.id]) }
  else if (k === "u" && item.status === "approved") { e.preventDefault(); act("run", item.id) }
}
onMounted(() => window.addEventListener("keydown", keys))
onBeforeUnmount(() => window.removeEventListener("keydown", keys))
</script>

<template>
  <div class="h-full flex min-h-0">
    <aside class="w-96 shrink-0 border-r border-line flex flex-col min-h-0">
      <div class="h-9 shrink-0 flex items-center gap-2 px-4 bg-header border-b border-line">
        <span class="text-[12px] font-semibold text-ink leading-none">Inbox</span>
        <button class="text-ink-3 hover:text-red transition-colors text-[11px] px-1 disabled:opacity-40" :disabled="busy" title="fetch again now" @click="refresh()"><span :class="busy && 'inline-block animate-spin'">↻</span></button>
        <span v-if="note" class="text-[11px] text-red truncate">{{ note }}</span>
        <span v-if="content" class="ml-auto text-[10px] px-2 py-0.5 rounded-full tabular font-semibold" :class="content.open.length ? 'bg-red text-white' : 'bg-card text-ink-3 ring-1 ring-line'">{{ content.open.length }} open</span>
      </div>

      <!-- Findings arrive in batches; deciding over a batch is one gesture. -->
      <div v-if="actionable.length" class="shrink-0 flex items-center gap-2 px-4 py-2 bg-ink text-card text-[12px]">
        <span>{{ actionable.length }} selected</span>
        <button class="px-2.5 py-0.5 rounded-full bg-success text-white hover:opacity-80 disabled:opacity-40" :disabled="working === 'bulk'" @click="bulk('approve')">Approve</button>
        <button class="px-2.5 py-0.5 rounded-full ring-1 ring-card/40 hover:bg-card/10 disabled:opacity-40" :disabled="working === 'bulk'" @click="bulk('reject')">Reject</button>
        <button class="ml-auto opacity-70 hover:opacity-100" @click="checked = new Set()">clear</button>
      </div>

      <div class="overflow-y-auto grow min-h-0">
        <template v-for="s in sections" :key="s.key">
          <p class="sticky top-0 z-10 text-[10.5px] uppercase tracking-wider text-ink-3 bg-header px-4 py-1.5 border-b border-line-soft">{{ s.head }} · {{ s.items.length }}</p>
          <button
            v-for="i in s.items"
            :id="`item-${i.id}`"
            :key="i.id"
            class="w-full flex items-start gap-2 text-left py-2 px-3 border-l-2 transition-colors"
            :class="[checked.has(i.id) ? 'border-l-red' : 'border-l-transparent', openId === i.id ? 'bg-red-soft' : 'hover:bg-cream', s.dim && 'opacity-60']"
            @click="show(i.id)"
          >
            <span class="text-[9px] px-1.5 py-0.5 rounded-full shrink-0 mt-0.5" :class="kindTone[i.kind] || kindTone.report">{{ i.kind }}</span>
            <span class="min-w-0 grow">
              <span class="text-[12.5px] text-ink block truncate">{{ i.title }}</span>
              <span v-if="i.where" class="text-[10.5px] text-ink-3 font-mono block truncate">{{ i.where }}</span>
            </span>
            <span v-if="i.status === 'approved' && isRunning(i.id)" class="size-1.5 rounded-full bg-success animate-pulse shrink-0 mt-1.5" />
            <span v-else-if="i.status !== 'open'" class="text-[9px] shrink-0 uppercase tracking-wide mt-0.5" :class="statusTone[i.status] || 'text-ink-3'">{{ i.status }}</span>
            <span class="text-[10.5px] text-ink-3 shrink-0 tabular mt-0.5">{{ fmt.date(i.created) }}</span>
          </button>
        </template>
        <div v-if="content && !flat.length" class="px-4 py-4 text-[13px] text-ink-3">Nothing. The brain has no news.</div>
      </div>
    </aside>

    <section v-if="current" class="grow min-h-0 flex flex-col min-w-0">
      <div class="shrink-0 flex items-start gap-3 px-6 py-3 border-b border-line">
        <div class="min-w-0 grow">
          <h1 class="text-[15px] font-semibold text-ink leading-snug">{{ current.title }}</h1>
          <p class="text-[11.5px] text-ink-3 mt-0.5">
            {{ current.kind }} · from {{ current.from }} · {{ fmt.when(current.created) }}
            <span v-if="current.where" class="font-mono"> · {{ current.where }}</span>
            <span v-if="current.action" class="font-mono"> · action: {{ current.action.type }}</span>
          </p>
        </div>
        <span v-if="current.status === 'approved' && isRunning(current.id)" class="text-[11px] px-2 py-1 rounded-full bg-header text-ink-3 shrink-0 tabular flex items-center gap-1.5" title="running — this carries on if you navigate away">
          <span class="size-1.5 rounded-full bg-success animate-pulse" />{{ elapsed(runningFor(current.id)) }}
        </span>
        <button v-else-if="current.status === 'approved'" class="text-[12px] px-3 py-1 rounded-full bg-ink text-card hover:opacity-80 disabled:opacity-40 shrink-0" :disabled="!!working" title="run (u)" @click="act('run', current.id)">{{ working === current.id ? "…" : "run" }}</button>
        <span v-else-if="current.status !== 'open'" class="text-[10px] shrink-0 uppercase tracking-wide mt-1" :class="statusTone[current.status] || 'text-ink-3'">{{ current.status }}</span>
      </div>

      <div class="overflow-y-auto grow min-h-0 px-6 py-4 space-y-4">
        <pre class="whitespace-pre-wrap font-sans text-[13px] text-ink-2 leading-relaxed max-w-[72ch]">{{ current.description }}</pre>
        <pre v-if="current.reply" class="whitespace-pre-wrap font-sans text-[12.5px] text-ink-2 border-l-2 border-line pl-3 max-w-[72ch]">{{ current.reply }}</pre>
        <pre v-if="current.result" class="whitespace-pre-wrap font-mono text-[11.5px] text-ink-3 border-l-2 border-line pl-3 max-w-[72ch]">{{ current.result }}</pre>
      </div>

      <!-- The one gesture, pinned to the bottom like a composer. -->
      <div v-if="current.status === 'open'" class="shrink-0 flex items-center gap-2 px-6 py-3 border-t border-line bg-header">
        <input id="reply-box" v-model="reply[current.id]" type="text" :placeholder="current.kind === 'report' ? 'say what to do with it, Enter runs it…' : current.kind === 'question' ? 'answer, Enter runs it…' : 'say what to do instead, Enter runs it…'" class="grow bg-card ring-1 ring-line rounded-lg px-3 py-1.5 text-[13px] outline-none focus:ring-ink-3 placeholder:text-ink-3" :disabled="working === current.id" @keydown.enter.prevent="(reply[current.id] ?? '').trim() && act('approve', current.id, reply[current.id])" />
        <button v-if="(reply[current.id] ?? '').trim()" class="text-[12px] px-3 py-1.5 rounded-full bg-success text-white hover:opacity-80 disabled:opacity-40 shrink-0" :disabled="working === current.id" @click="act('approve', current.id, reply[current.id])">{{ working === current.id ? "…" : "run" }}</button>
        <button v-else-if="current.kind !== 'report'" class="text-[12px] px-3 py-1.5 rounded-full ring-1 ring-success/50 text-success hover:bg-success-bg disabled:opacity-40 shrink-0" :disabled="working === current.id" :title="`${doLabel[current.kind] ?? 'do it'} as proposed (a)`" @click="act('approve', current.id)">{{ working === current.id ? "…" : `✓ ${doLabel[current.kind] ?? "do it"}` }}</button>
        <button class="text-[12px] px-2.5 py-1.5 rounded-full text-ink-3 hover:bg-card hover:text-ink disabled:opacity-40 shrink-0" :disabled="working === current.id" :title="current.kind === 'report' ? 'close (r)' : 'reject and silence (r)'" @click="act('reject', current.id)">✕</button>
      </div>
      <div class="shrink-0 flex items-center gap-4 px-6 py-2 border-t border-line-soft bg-header text-[11px] text-ink-3">
        <span>Every item is a file in <code class="font-mono">inbox/</code>; rejecting silences that finding for good.</span>
        <span class="ml-auto font-mono shrink-0">j/k move · enter type · a ✓ · r ✕ · x select</span>
      </div>
    </section>
    <div v-else class="grow flex items-center justify-center text-[13px] text-ink-3">{{ busy ? "…" : "Nothing waiting." }}</div>
  </div>
</template>
