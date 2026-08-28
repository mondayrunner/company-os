<script setup lang="ts">
// Wachten op een antwoord. Eerst het teken en de teller — dat is wat je wilt
// zien. Wát er gelezen wordt kun je openklappen als je nieuwsgierig bent, maar
// het is niet het hoofdgerecht.
const props = defineProps<{ reading: any[] }>()
const open = ref(false)
const detail = computed(() => (props.reading.length ? `${props.reading.length} bestanden gevonden` : "index doorzoeken"))
</script>

<template>
  <div>
    <Waiting :active="true" :detail="detail" />
    <button v-if="reading.length" class="block mt-2 text-[11px] text-ink-3 hover:text-ink transition-colors" @click="open = !open">
      {{ open ? "▾" : "▸" }} wat hij leest
    </button>
    <div v-if="open" class="mt-1.5">
      <div v-for="h in reading" :key="h.path + h.heading" class="text-[11.5px] py-0.5 border-b border-line-soft last:border-0">
        <span class="text-ink-2">{{ h.path.split("/").pop() }}</span>
        <span v-if="h.heading" class="text-ink-3"> · {{ h.heading }}</span>
      </div>
    </div>
  </div>
</template>
