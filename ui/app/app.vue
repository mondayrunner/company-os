<script setup lang="ts">
const { cfg, fmt } = useConfig()
const now = useState("now", () => new Date())
onMounted(() => { const t = setInterval(() => (now.value = new Date()), 30_000); onUnmounted(() => clearInterval(t)) })
const today = computed(() => now.value.toLocaleDateString(cfg.value.locale, { weekday: "long", day: "numeric", month: "long" }))
const clock = computed(() => now.value.toLocaleTimeString(cfg.value.locale, { hour: "2-digit", minute: "2-digit" }))

// Three states: follow the system, or force light/dark. The choice survives reloads.
const theme = ref<"system" | "light" | "dark">("system")
onMounted(() => { theme.value = (localStorage.getItem("theme") as any) ?? "system"; apply() })
function apply() {
  const el = document.documentElement
  if (theme.value === "system") el.removeAttribute("data-theme")
  else el.setAttribute("data-theme", theme.value)
  localStorage.setItem("theme", theme.value)
}
function cycle() { theme.value = theme.value === "system" ? "light" : theme.value === "light" ? "dark" : "system"; apply() }

// The browser tab says what your config says, not what this repo is called.
// Logo and name come from the same place: `name` and `ui.{title,logo}`.
useHead(() => ({ title: cfg.value.title || cfg.value.name || "company-os" }))

const live = useLive()

// The nav is the config: pages the base ships, plus whatever a private layer
// adds. Inbox sits second, because that is the one page that asks something of
// you — and it carries the count, so you see it from any other page.
const links = computed(() => {
  // Activity and Status live in the settings menu (top right), not here:
  // they are about the system, the nav is about the work.
  const base = [
    { p: "/", t: "Overview" },
    { p: "/inbox", t: "Inbox", badge: () => live.inboxOpen.value },
  ]
  const own = cfg.value.nav.filter((l: any) => !base.some((b) => b.p === l.p) && !["/activity", "/status"].includes(l.p))
  return [...base, ...own]
})
const menuOpen = ref(false)
</script>

<template>
  <div class="h-dvh flex flex-col overflow-hidden">
    <header class="h-14 shrink-0 flex items-center gap-3 lg:gap-4 px-4 lg:px-5 border-b border-line min-w-0">
      <NuxtLink to="/" title="To the overview" class="shrink-0 flex items-center gap-2">
        <img v-if="cfg.logo" :src="cfg.logo" :alt="cfg.name" class="h-5 w-auto block" />
        <span v-else class="text-red text-[15px]">✦</span>
      </NuxtLink>
      <span class="font-display italic text-[17px] text-ink-2 shrink-0 leading-none self-center hidden xl:inline">{{ cfg.title }}</span>
      <nav class="flex gap-px rounded-full bg-header ring-1 ring-line overflow-x-auto shrink-0 max-w-[46vw] lg:max-w-none [scrollbar-width:none]">
        <NuxtLink
          v-for="l in links"
          :key="l.p"
          :to="l.p"
          class="text-[12px] px-2.5 lg:px-3 py-1 transition-colors whitespace-nowrap flex items-center gap-1.5"
          :class="$route.path === l.p ? 'bg-red text-white' : 'text-ink-3 hover:text-ink'"
        >
          {{ l.t }}
          <span
            v-if="l.badge && l.badge()"
            class="text-[10px] leading-none px-1.5 py-0.5 rounded-full tabular font-semibold transition-all"
            :class="[
              $route.path === l.p ? 'bg-white/20 text-white' : 'bg-red text-white',
              live.fresh.value && l.p === '/inbox' && 'ring-2 ring-red/40 scale-110',
            ]"
          >{{ l.badge() }}</span>
        </NuxtLink>
      </nav>
      <p class="text-[13px] text-ink-3 first-letter:uppercase hidden 2xl:block whitespace-nowrap">{{ today }}</p>
      <div class="ml-auto relative">
        <button class="text-[13px] px-2.5 py-1 rounded-full ring-1 ring-line text-ink-3 hover:text-ink hover:ring-ink-3 transition-colors relative" title="settings, activity and modules" @click="menuOpen = !menuOpen">
          ⚙<span v-if="live.jobsBad.value" class="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-red" />
        </button>
        <div v-if="menuOpen" class="absolute right-0 top-9 z-50 w-48 rounded-xl bg-card ring-1 ring-line shadow-xl py-1.5 text-[13px]" @click="menuOpen = false">
          <NuxtLink to="/activity" class="flex items-center gap-2 px-3.5 py-2 text-ink hover:bg-header">Activity</NuxtLink>
          <NuxtLink to="/status" class="flex items-center gap-2 px-3.5 py-2 text-ink hover:bg-header">System<span v-if="live.jobsBad.value" class="ml-auto text-[11px] px-1.5 rounded-full bg-red text-white">{{ live.jobsBad.value }}</span></NuxtLink>
          <button class="w-full flex items-center gap-2 px-3.5 py-2 text-ink hover:bg-header" @click.stop="cycle">Theme<span class="ml-auto text-[11px] text-ink-3">{{ theme === "system" ? "auto" : theme }}</span></button>
        </div>
      </div>
      <span
        class="size-1.5 rounded-full shrink-0 transition-colors"
        :class="live.fresh.value ? 'bg-red animate-ping' : 'bg-success/60'"
        :title="`last checked ${new Date(live.beat.value || Date.now()).toLocaleTimeString()}`"
      />
      <p class="text-[13px] text-ink-3 tabular shrink-0">{{ clock }}</p>
    </header>
    <AlertBar />
    <main class="grow min-h-0"><NuxtPage /></main>
  </div>
</template>
