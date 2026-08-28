<script setup lang="ts">
// Each panel fetches its own data: sources run from 200 ms to a minute, and the
// fast ones should not wait for the slow ones.
const props = defineProps<{ title: string; api: string; span?: string; anchor?: string }>()
const { data, error, refresh, status } = useLazyFetch<any>(`/api/${props.api}`, { server: false, key: `panel-${props.api}` })
const busy = computed(() => status.value === "pending")
const fault = computed(() => error.value?.message || (data.value && !data.value.ok ? data.value.error : null))
const content = computed(() => (data.value?.ok ? data.value.data : null))
const took = computed(() => (data.value?.ms != null ? `${(data.value.ms / 1000).toFixed(1)}s` : null))
</script>

<template>
  <section :id="anchor" class="rounded-2xl ring-1 ring-line bg-card flex flex-col min-h-0 overflow-hidden" :class="span">
    <header class="flex items-center gap-2.5 px-4 h-9 shrink-0 bg-header border-b border-line">
      <h2 class="text-[12px] font-semibold tracking-tight text-ink leading-none">{{ title }}</h2>
      <slot name="head" :data="content" />
      <span v-if="busy" class="size-1.5 rounded-full bg-red animate-pulse" aria-label="loading" />
      <span v-else-if="fault" class="size-1.5 rounded-full bg-red" aria-label="error" />
      <button class="ml-auto text-ink-3 hover:text-red transition-colors text-[11px] px-2 py-1 -mr-2 rounded-full disabled:opacity-40" :disabled="busy" :title="took ? `last fetch took ${took}` : undefined" @click="refresh()">↻</button>
    </header>
    <div class="px-4 py-2.5 overflow-y-auto grow min-h-0">
      <div v-if="!content && !fault" class="space-y-1.5">
        <div v-for="i in 5" :key="i" class="h-6 rounded-lg bg-line-soft animate-pulse" :style="{ opacity: 1 - i * 0.15, animationDelay: `${i * 80}ms` }" />
      </div>
      <div v-else-if="fault" class="text-[13px]">
        <p class="text-red font-medium mb-1">Source not responding</p>
        <p class="text-ink-3 font-mono text-[11px] leading-relaxed break-words">{{ fault }}</p>
        <button class="mt-2 text-[12px] text-red hover:underline" @click="refresh()">try again</button>
      </div>
      <slot v-else :data="content" />
    </div>
  </section>
</template>
