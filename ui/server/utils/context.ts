import { loadContext } from "#core/config.mjs"

/**
 * The company-os context (root, config, paths) for server routes. The root is
 * COMPANY_OS_ROOT or the nearest company-os.config.json upward from the cwd —
 * the same rule as the CLI, so the dashboard and the terminal never disagree.
 */
let cached: any = null
export function ctx() {
  if (!cached) cached = loadContext({ root: process.env.COMPANY_OS_ROOT })
  return cached
}

/** The public part of the config the browser may know. */
export function publicConfig() {
  const c = ctx()
  const ui = c.config.ui ?? {}
  return {
    name: c.config.name,
    language: c.config.language,
    locale: ({ nl: "nl-NL", en: "en-GB", de: "de-DE", fr: "fr-FR", es: "es-ES" } as Record<string, string>)[c.config.language] ?? "en-GB",
    title: ui.title ?? "company-os",
    logo: ui.logo ?? null,
    nav: ui.nav ?? [],
    // Which panels the overview shows, in this order. Empty: derive from the
    // live kinds — see usePanels().
    panels: ui.panels ?? [],
  }
}
