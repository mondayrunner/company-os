<script setup lang="ts">
// The inbox: what agents and jobs say back (drift, proposals, questions) and
// where you answer. Answering plus approving is the trigger; `run` executes.
const { fmt } = useConfig()
const { data, status, refresh } = useLazyFetch<any>("/api/inbox", { server: false })
const content = computed(() => (data.value?.ok ? data.value.data : null))
const busy = computed(() => status.value === "pending")
const text = reactive<Record<string, string>>({})
const working = ref<string | null>(null)
const open = reactive<Record<string, boolean>>({})

const kindTone: Record<string, string> = { drift: "bg-orange/10 text-orange", proposal: "bg-success/10 text-success", question: "bg-info/10 text-info", report: "bg-ink-3/10 text-ink-3" }
const statusTone: Record<string, string> = { approved: "text-success", done: "text-success", failed: "text-red", rejected: "text-ink-3" }

async function act(action: string, id?: string) {
  working.value = id ?? action
  try { await $fetch("/api/inbox", { method: "POST", body: { action, id, text: id ? text[id] : undefined } }); if (id) text[id] = ""; await refresh() }
  finally { working.value = null }
}
</script>

<template>
  <div class="h-full overflow-y-auto">
    <div class="max-w-3xl mx-auto px-6 py-8">
      <div class="mb-5 flex items-end justify-between gap-4">
        <div>
          <h1 class="text-[22px] font-semibold text-ink tracking-tight">Inbox</h1>
          <p v-if="content" class="text-[13px] text-ink-3 mt-1.5">
            {{ content.open.length }} open · {{ content.approved.length }} approved · {{ content.total }} total
            <button class="ml-2 text-red hover:underline" :disabled="busy" @click="refresh()">{{ busy ? "working…" : "refresh" }}</button>
          </p>
          <p v-else-if="data && !data.ok" class="text-[13px] text-red mt-1.5 font-mono">{{ data.error }}</p>
        </div>
        <button v-if="content?.approved.length" class="text-[12px] px-3 py-1.5 rounded-full bg-ink text-card hover:opacity-80 disabled:opacity-40" :disabled="working === 'run'" @click="act('run')">
          {{ working === "run" ? "running…" : `Run ${content.approved.length} approved` }}
        </button>
      </div>

      <template v-if="content">
        <div v-for="[head, list] in [['Open', content.open], ['Approved, not yet run', content.approved], ['Closed', content.closed]]" :key="head" class="rounded-2xl ring-1 ring-line bg-card overflow-hidden mb-6" :class="head === 'Closed' && 'opacity-70'">
          <div class="px-4 h-9 flex items-center bg-header border-b border-line text-[11px] font-semibold uppercase tracking-wider text-ink-3">{{ head }}</div>
          <div v-if="!list.length" class="px-4 py-4 text-[13px] text-ink-3">Nothing.</div>
          <div v-for="i in list" :key="i.id" class="border-b border-line-soft last:border-0">
            <button class="w-full text-left flex items-center gap-3 px-4 py-2.5 hover:bg-header transition-colors" @click="open[i.id] = !open[i.id]">
              <span class="w-12 shrink-0 text-[11px] text-ink-3 tabular">{{ fmt.date(i.created) }}</span>
              <span class="text-[10px] px-2 py-0.5 rounded-full shrink-0" :class="kindTone[i.kind] || kindTone.report">{{ i.kind }}</span>
              <span class="min-w-0 grow text-[13px] text-ink truncate">{{ i.title }}</span>
              <span class="text-[10px] shrink-0 uppercase tracking-wide" :class="statusTone[i.status] || 'text-ink-3'">{{ i.status }}</span>
              <span class="text-[10px] text-ink-3 shrink-0">{{ i.from }}</span>
            </button>
            <div v-if="open[i.id]" class="px-4 pb-4 pt-1 text-[13px] text-ink space-y-3">
              <pre class="whitespace-pre-wrap font-sans text-[12.5px] text-ink-2 leading-relaxed">{{ i.description }}</pre>
              <p v-if="i.action" class="text-[11px] text-ink-3 font-mono">action: {{ i.action.type }}<template v-if="i.action.file"> · {{ i.action.file }}</template></p>
              <pre v-if="i.reply" class="whitespace-pre-wrap font-sans text-[12.5px] text-ink-2 border-l-2 border-line pl-3">{{ i.reply }}</pre>
              <pre v-if="i.result" class="whitespace-pre-wrap font-mono text-[11.5px] text-ink-3 border-l-2 border-line pl-3">{{ i.result }}</pre>
              <div v-if="['open', 'approved'].includes(i.status)" class="flex items-start gap-2">
                <input v-model="text[i.id]" type="text" placeholder="answer or instruction…" class="grow bg-header ring-1 ring-line rounded-lg px-3 py-1.5 text-[13px] outline-none focus:ring-ink-3" @keydown.enter="act('reply', i.id)" />
                <button class="text-[12px] px-3 py-1.5 rounded-full ring-1 ring-line hover:bg-header disabled:opacity-40" :disabled="working === i.id" @click="act('reply', i.id)">reply</button>
                <button v-if="i.status === 'open'" class="text-[12px] px-3 py-1.5 rounded-full bg-success text-white hover:opacity-80 disabled:opacity-40" :disabled="working === i.id" @click="act('approve', i.id)">approve</button>
                <button v-if="i.status === 'open'" class="text-[12px] px-3 py-1.5 rounded-full ring-1 ring-line text-ink-3 hover:bg-header disabled:opacity-40" :disabled="working === i.id" @click="act('reject', i.id)">reject</button>
                <button v-if="i.status === 'approved'" class="text-[12px] px-3 py-1.5 rounded-full bg-ink text-card hover:opacity-80 disabled:opacity-40" :disabled="working === i.id" @click="act('run', i.id)">run</button>
              </div>
            </div>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>
