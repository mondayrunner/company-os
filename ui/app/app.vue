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

const notify = useNotifications()
const live = useLive()

// The nav is the config: pages the base ships, plus whatever a private layer
// adds. Inbox sits second, because that is the one page that asks something of
// you — and it carries the count, so you see it from any other page.
const links = computed(() => [
  { p: "/", t: "Overview" },
  { p: "/inbox", t: "Inbox", badge: () => live.inboxOpen.value },
  ...cfg.value.nav,
  { p: "/activity", t: "Activity" },
  { p: "/status", t: "Status", badge: () => live.jobsBad.value },
])
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
      <button v-if="!notify.allowed.value" class="ml-auto text-[11px] px-2.5 py-1 rounded-full bg-red text-white hover:bg-red-hover transition-colors whitespace-nowrap shrink-0" title="the dashboard may then warn you when something breaks" @click="notify.ask()">
        <span class="hidden lg:inline">enable notifications</span><span class="lg:hidden">🔔</span>
      </button>
      <button v-else class="ml-auto text-[11px] px-2.5 py-1 rounded-full ring-1 ring-line transition-colors" :class="notify.on.value ? 'text-ink-2 hover:text-ink' : 'text-ink-3 hover:text-ink'" @click="notify.on.value = !notify.on.value">{{ notify.on.value ? "🔔" : "🔕" }}</button>
      <button class="text-[11px] px-2.5 py-1 rounded-full ring-1 ring-line text-ink-3 hover:text-ink hover:ring-ink-3 transition-colors" :title="`Theme: ${theme}`" @click="cycle">{{ theme === "system" ? "auto" : theme }}</button>
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
