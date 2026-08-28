// What the browser may know about this brain: name, language, nav, and which live kinds exist.
export default defineEventHandler(async () => source("Config", async () => ({ ...publicConfig(), kinds: await liveKinds() })))
