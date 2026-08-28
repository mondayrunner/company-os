<script setup lang="ts">
// What the answer stood on. A claim without a source is the thing this whole
// system exists to prevent, so the sources get their own block — full paths,
// click to copy, live sources marked with the moment they were read.
const props = defineProps<{ sources: string[]; live?: { kind: string; connector: string; fetched: string }[] }>()
const { fmt } = useConfig()
const copied = ref<string | null>(null)
function copy(p: string) {
  navigator.clipboard?.writeText(p)
  copied.value = p
  setTimeout(() => { if (copied.value === p) copied.value = null }, 1500)
}
const files = computed(() => props.sources.filter((s) => !s.startsWith("live:")))
</script>

<template>
  <div v-if="files.length || live?.length" class="mt-4 pt-3 border-t border-line-soft">
    <p class="text-[10px] uppercase tracking-wider text-ink-3 mb-1.5">Sources</p>
    <button v-for="s in files" :key="s" class="w-full flex items-baseline gap-2 text-left py-0.5 group" :title="`copy ${s}`" @click="copy(s)">
      <span class="text-[12.5px] text-ink truncate">{{ s.split("/").pop() }}</span>
      <span class="text-[11px] text-ink-3 truncate font-mono">{{ s.split("/").slice(0, -1).join("/") }}</span>
      <span class="ml-auto text-[10px] shrink-0" :class="copied === s ? 'text-success' : 'text-ink-3 opacity-0 group-hover:opacity-100'">{{ copied === s ? "copied" : "copy" }}</span>
    </button>
    <div v-for="l in live" :key="l.kind" class="flex items-baseline gap-2 py-0.5">
      <span class="text-[12.5px] text-info">{{ l.kind }}</span>
      <span class="text-[11px] text-ink-3">read live from {{ l.connector }} at {{ fmt.time(l.fetched) }}</span>
    </div>
  </div>
</template>
