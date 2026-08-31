<script setup lang="ts">
// The overview is the panel list and nothing else: see usePanels().
const panels = usePanels()

// resolveComponent hands back the plain string when nothing is registered under
// that name. For a panel you asked for by name that is a config mistake and it
// says so; for a derived one it just means this kind has no panel yet.
const componentFor = (name: string) => {
  const c = resolveComponent(name)
  return typeof c === "string" ? null : c
}
</script>

<template>
  <div class="h-full overflow-y-auto p-3 space-y-3">
    <!-- StatStrip is off (31-08): the numbers repeat what the panels below
         already show, and the strip was not clickable. Put the line back to
         bring it back. -->
    <!-- <StatStrip /> -->
    <div class="grid gap-3 grid-cols-1 md:grid-cols-2 auto-rows-[18rem] xl:grid-cols-4">
      <template v-for="p in panels" :key="p.name">
        <component :is="componentFor(p.component)" v-if="componentFor(p.component)" />
        <section v-else-if="p.asked" class="rounded-2xl ring-1 ring-line bg-card p-4 text-[12px] text-ink-3 leading-relaxed">
          No panel component <code class="font-mono text-ink-2">{{ p.component }}</code>. Add
          <code class="font-mono text-ink-2">app/components/panels/{{ p.name }}.global.vue</code>, or remove
          <code class="font-mono text-ink-2">{{ p.name }}</code> from <code class="font-mono text-ink-2">ui.panels</code>.
        </section>
      </template>
    </div>
  </div>
</template>
