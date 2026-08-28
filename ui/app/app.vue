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

const notify = useNotifications()
const refreshing = ref(false)
async function refreshAll() { refreshing.value = true; try { await refreshNuxtData() } finally { refreshing.value = false } }

// The nav is the config: pages the base ships, plus whatever a private layer adds.
const links = computed(() => [{ p: "/", t: "Overview" }, ...cfg.value.nav, { p: "/inbox", t: "Inbox" }, { p: "/status", t: "Status" }])
</script>

<template>
  <div class="h-dvh flex flex-col overflow-hidden">
    <header class="h-14 shrink-0 flex items-center gap-3 lg:gap-4 px-4 lg:px-5 border-b border-line min-w-0">
      <NuxtLink to="/" title="To the overview" class="shrink-0 flex items-center gap-2">
        <img v-if="cfg.logo" :src="cfg.logo" :alt="cfg.name" class="h-5 w-auto block" />
        <span v-else class="text-red text-[15px]">✦</span>
      </NuxtLink>
      <span class="font-henry italic text-[17px] text-ink-2 shrink-0 leading-none self-center hidden xl:inline">{{ cfg.title }}</span>
      <nav class="flex gap-px rounded-full bg-header ring-1 ring-line overflow-x-auto shrink-0 max-w-[46vw] lg:max-w-none [scrollbar-width:none]">
        <NuxtLink v-for="l in links" :key="l.p" :to="l.p" class="text-[12px] px-2.5 lg:px-3 py-1 transition-colors whitespace-nowrap" :class="$route.path === l.p ? 'bg-red text-white' : 'text-ink-3 hover:text-ink'">{{ l.t }}</NuxtLink>
      </nav>
      <AskBar />
      <p class="text-[13px] text-ink-3 first-letter:uppercase hidden 2xl:block whitespace-nowrap">{{ today }}</p>
      <button class="ml-auto text-[11px] px-2.5 py-1 rounded-full ring-1 ring-line text-ink-3 hover:text-ink hover:ring-ink-3 transition-colors disabled:opacity-40 flex items-center gap-1.5" :disabled="refreshing" title="refresh every panel" @click="refreshAll()">
        <span :class="refreshing ? 'inline-block animate-spin' : 'inline-block'">↻</span><span class="hidden lg:inline"> All</span>
      </button>
      <button v-if="!notify.allowed.value" class="text-[11px] px-2.5 py-1 rounded-full bg-red text-white hover:bg-red-hover transition-colors whitespace-nowrap shrink-0" title="the dashboard may then warn you when something breaks" @click="notify.ask()">
        <span class="hidden lg:inline">enable notifications</span><span class="lg:hidden">🔔</span>
      </button>
      <button v-else class="text-[11px] px-2.5 py-1 rounded-full ring-1 ring-line transition-colors" :class="notify.on.value ? 'text-ink-2 hover:text-ink' : 'text-ink-3 hover:text-ink'" @click="notify.on.value = !notify.on.value">{{ notify.on.value ? "🔔" : "🔕" }}</button>
      <button class="text-[11px] px-2.5 py-1 rounded-full ring-1 ring-line text-ink-3 hover:text-ink hover:ring-ink-3 transition-colors" :title="`Theme: ${theme}`" @click="cycle">{{ theme === "system" ? "auto" : theme }}</button>
      <p class="text-[13px] text-ink-3 tabular shrink-0">{{ clock }}</p>
    </header>
    <AlertBar />
    <main class="grow min-h-0"><NuxtPage /></main>
  </div>
</template>
