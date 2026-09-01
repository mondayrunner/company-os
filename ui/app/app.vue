<script setup lang="ts">
/**
 * The shell: a fixed sidebar on the left, the page on the right. The nav is
 * the config — pages the base ships plus whatever a private layer adds — and
 * reads top-down the way the day does: work first, Inbox with its count where
 * you cannot miss it, the system stuff (Activity, System, theme) at the
 * bottom, out of the way but never hidden behind a menu.
 */
const { cfg } = useConfig()
const now = useState("now", () => new Date())
onMounted(() => { const t = setInterval(() => (now.value = new Date()), 30_000); onUnmounted(() => clearInterval(t)) })
const today = computed(() => now.value.toLocaleDateString(cfg.value.locale, { weekday: "short", day: "numeric", month: "short" }))
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
useHead(() => ({ title: cfg.value.title || cfg.value.name || "company-os" }))

const live = useLive()

const links = computed(() => {
  const base = [
    { p: "/", t: "Overview" },
    { p: "/inbox", t: "Inbox", badge: () => live.inboxOpen.value },
  ]
  const own = cfg.value.nav.filter((l: any) => !base.some((b) => b.p === l.p) && !["/activity", "/status"].includes(l.p))
  return [...base, ...own]
})

const item = "flex items-center gap-2 text-[13px] px-2.5 py-2 rounded-lg transition-colors"
const idle = "text-ink-3 hover:text-ink hover:bg-card/60"
const active = "bg-card text-ink font-semibold ring-1 ring-line"
</script>

<template>
  <div class="h-dvh flex overflow-hidden">
    <aside class="w-52 shrink-0 hidden md:flex flex-col bg-header border-r border-line px-2.5 py-4 gap-0.5">
      <NuxtLink to="/" class="flex items-center gap-2 px-2.5 pb-4">
        <img v-if="cfg.logo" :src="cfg.logo" :alt="cfg.name" class="h-5 w-auto block" />
        <span v-else class="text-red text-[15px]">✦</span>
        <span class="font-display italic text-[15px] text-ink-2 leading-none truncate mt-1">{{ cfg.title }}</span>
      </NuxtLink>

      <NuxtLink v-for="l in links" :key="l.p" :to="l.p" :class="[item, $route.path === l.p ? active : idle]">
        {{ l.t }}
        <span
          v-if="l.badge && l.badge()"
          class="ml-auto text-[10px] leading-none px-1.5 py-0.5 rounded-full tabular font-semibold bg-red text-white transition-all"
          :class="live.fresh.value && l.p === '/inbox' && 'ring-2 ring-red/40 scale-110'"
        >{{ l.badge() }}</span>
      </NuxtLink>

      <div class="grow" />

      <NuxtLink to="/activity" :class="[item, $route.path === '/activity' ? active : idle]">Activity</NuxtLink>
      <NuxtLink to="/status" :class="[item, $route.path === '/status' ? active : idle]">
        System
        <span v-if="live.jobsBad.value" class="ml-auto text-[10px] leading-none px-1.5 py-0.5 rounded-full tabular font-semibold bg-red text-white">{{ live.jobsBad.value }}</span>
        <span v-else class="ml-auto size-1.5 rounded-full bg-success/60" />
      </NuxtLink>
      <button :class="[item, idle, 'w-full']" @click="cycle">Theme<span class="ml-auto text-[11px] text-ink-3">{{ theme === "system" ? "auto" : theme }}</span></button>

      <div class="flex items-center gap-2 px-2.5 pt-3 text-[11px] text-ink-3 tabular">
        <span
          class="size-1.5 rounded-full shrink-0 transition-colors"
          :class="live.fresh.value ? 'bg-red animate-ping' : 'bg-success/60'"
          :title="`last checked ${new Date(live.beat.value || Date.now()).toLocaleTimeString()}`"
        />
        <span class="first-letter:uppercase">{{ today }}</span>
        <span class="ml-auto">{{ clock }}</span>
      </div>
    </aside>

    <!-- Small screens: the sidebar folds into a slim top bar. -->
    <div class="grow min-h-0 flex flex-col min-w-0">
      <header class="md:hidden h-12 shrink-0 flex items-center gap-2 px-3 border-b border-line overflow-x-auto [scrollbar-width:none]">
        <span class="text-red text-[14px] shrink-0">✦</span>
        <nav class="flex gap-px rounded-full bg-header ring-1 ring-line shrink-0">
          <NuxtLink v-for="l in [...links, { p: '/activity', t: 'Activity' }, { p: '/status', t: 'System' }]" :key="l.p" :to="l.p" class="text-[12px] px-2.5 py-1 whitespace-nowrap" :class="$route.path === l.p ? 'bg-red text-white rounded-full' : 'text-ink-3'">{{ l.t }}</NuxtLink>
        </nav>
      </header>
      <AlertBar />
      <main class="grow min-h-0"><NuxtPage /></main>
    </div>
  </div>
</template>
