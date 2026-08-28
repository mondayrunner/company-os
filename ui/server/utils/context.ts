import { loadContext } from "../../../core/config.mjs"

/**
 * The brainlane context (root, config, paths) for server routes. The root is
 * BRAINLANE_ROOT or the nearest brainlane.config.json upward from the cwd —
 * the same rule as the CLI, so the dashboard and the terminal never disagree.
 */
let cached: any = null
export function ctx() {
  if (!cached) cached = loadContext({ root: process.env.BRAINLANE_ROOT })
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
    title: ui.title ?? "brainlane",
    logo: ui.logo ?? null,
    nav: ui.nav ?? [],
    examples: ui.examples ?? [],
  }
}
