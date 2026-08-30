/**
 * Which panels the overview shows.
 *
 * A panel is a component in `app/components/panels/`, named `<Name>.global.vue`
 * — global because the page looks it up by name and Nuxt only bundles a
 * component it can see written out in a template. Adding a panel is adding a
 * file, in this repo or in a layer on top of it. A layer that drops its own
 * `panels/Finance.global.vue` next to ours replaces ours; nobody forks the page.
 *
 * The list comes from `ui.panels` in the config. Without it: a panel per live
 * connector kind, plus the brain and the inbox — the two that always exist.
 * No kind configured, no panel: nothing to hide or stub.
 *
 * `asked` separates the two cases. A name you wrote in `ui.panels` and that has
 * no component is a mistake worth showing; a kind that simply has no panel yet
 * is not, so a derived list stays quiet about it.
 */
export type PanelEntry = { name: string; component: string; asked: boolean }

export function usePanels() {
  const { cfg } = useConfig()
  return computed<PanelEntry[]>(() => {
    const asked = !!cfg.value.panels?.length
    const names: string[] = asked ? cfg.value.panels : [...(cfg.value.kinds ?? []), "brain", "inbox"]
    return names.map((name) => ({ name, component: `Panels${name[0]!.toUpperCase()}${name.slice(1)}`, asked }))
  })
}
