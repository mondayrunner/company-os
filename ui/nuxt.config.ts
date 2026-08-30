import { fileURLToPath } from "node:url"
import tailwindcss from "@tailwindcss/vite"

// The core lives one level up. An absolute alias keeps it resolvable after
// Nitro bundles the server routes; without it the relative path is rewritten
// against the build output and breaks at runtime.
const core = fileURLToPath(new URL("../core/", import.meta.url))
const connectors = fileURLToPath(new URL("../connectors/", import.meta.url))

// The company-os dashboard: a local Nuxt app that reads the vault, the brain
// database and the live connectors through the company-os core. No key ever
// reaches the browser; every call to a source happens in a server route.
//
// This app is also a Nuxt layer: a private app can `extends` it, add pages,
// override routes and components, and bring its own brand (see README).
export default defineNuxtConfig({
  compatibilityDate: "2026-08-22",
  devtools: { enabled: false },
  css: ["~/assets/css/main.css"],
  vite: { plugins: [tailwindcss()] },
  alias: { "#core": core, "#connectors": connectors },
  nitro: { externals: { external: [core, connectors] } },
  app: { head: { title: "company-os", meta: [{ name: "color-scheme", content: "light dark" }] } },
})
