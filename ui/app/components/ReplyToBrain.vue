<script setup lang="ts">
/**
 * Terugpraten tegen het brein, vanaf elke pagina.
 *
 * Twee dingen wil je kwijt terwijl je leest: nieuws ("gesproken met Sandra, ze
 * gaat akkoord") en correcties ("de bal ligt niet meer bij mij"). Bewust één vak
 * voor allebei: welk van de twee het is, kun je uit de zin zelf lezen, en jou
 * laten kiezen is precies het denkwerk dat je wilde uitbesteden. Ook bewust één
 * bestemming: de inbox. Daar keur je het goed, en pas dán verandert er iets.
 */
const props = defineProps<{
  /** Waar dit over gaat, bijvoorbeeld "plan of 2026-08-28". Komt in het item te staan. */
  about: string
  /** Wat er te lezen was, zodat de agent de context heeft. Mag lang zijn. */
  context?: string
  placeholder?: string
}>()

const text = ref("")
const busy = ref(false)
const done = ref<string | null>(null)
const error = ref<string | null>(null)

async function send() {
  const t = text.value.trim()
  if (t.length < 3 || busy.value) return
  busy.value = true
  error.value = null
  try {
    const r: any = await $fetch("/api/inbox", {
      method: "POST",
      body: {
        action: "post",
        kind: "proposal",
        from: "you",
        title: t.slice(0, 110),
        where: props.about,
        body: [
          `Written while reading **${props.about}**:`, "", `> ${t.replace(/\n/g, "\n> ")}`, "",
          "This is either news (something happened) or a correction (something on the screen is wrong). Work out which, then update every file it touches — the account's status file, the ball, the pipeline log, the compass. One dated log entry, not an essay.",
          "",
          "Two rules: do not invent an outcome the sentence does not state, and if it needs a decision only a human can make, say what you need and stop. If it belongs in Trello, a mail or an invoice, name it and stop — those are done by hand.",
          props.context ? `\n---\n\nWhat was on the screen:\n\n${props.context.slice(0, 4000)}` : "",
        ].join("\n"),
        itemAction: { type: "agent" },
      },
    })
    if (r?.ok) { done.value = r.result?.id ?? "posted"; text.value = "" }
    else error.value = r?.error ?? "failed"
  } catch (e: any) {
    error.value = e?.data?.error || e?.message || "failed"
  } finally { busy.value = false }
}
</script>

<template>
  <div class="rounded-2xl ring-1 ring-line bg-card p-4">
    <p class="text-[11px] uppercase tracking-wider text-ink-3 mb-2">Tell the brain what happened</p>
    <div class="flex items-start gap-2">
      <textarea
        v-model="text"
        rows="2"
        :placeholder="placeholder ?? 'e.g. spoke to Sandra, she agrees to the build line — call moved to Tuesday'"
        class="grow bg-header ring-1 ring-line rounded-xl px-3 py-2 text-[13px] outline-none focus:ring-ink-3 resize-y"
        @keydown.meta.enter="send"
      />
      <button
        class="text-[12px] px-3 py-2 rounded-xl bg-red text-white hover:bg-red-hover disabled:opacity-40 shrink-0"
        :disabled="busy || text.trim().length < 3"
        @click="send"
      >{{ busy ? "…" : "To inbox" }}</button>
    </div>
    <p v-if="done" class="text-[12px] text-success mt-2">
      In your <NuxtLink to="/inbox" class="underline">inbox</NuxtLink> — approve it there and it changes the files.
    </p>
    <p v-else-if="error" class="text-[12px] text-red mt-2">{{ error }}</p>
    <p v-else class="text-[11px] text-ink-3 mt-2">News or a correction, either is fine. Goes to the inbox; nothing changes until you approve it. ⌘↵</p>
  </div>
</template>
