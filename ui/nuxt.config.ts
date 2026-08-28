import tailwindcss from "@tailwindcss/vite"

// The brainlane dashboard: a local Nuxt app that reads the vault, the brain
// database and the live connectors through the brainlane core. No key ever
// reaches the browser; every call to a source happens in a server route.
//
// This app is also a Nuxt layer: a private app can `extends` it, add pages,
// override routes and components, and bring its own brand (see README).
export default defineNuxtConfig({
  compatibilityDate: "2026-08-22",
  devtools: { enabled: false },
  css: ["~/assets/css/main.css"],
  vite: { plugins: [tailwindcss()] },
  app: { head: { title: "brainlane", meta: [{ name: "color-scheme", content: "light dark" }] } },
})
