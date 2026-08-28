import { spawn } from "node:child_process"
import { join } from "node:path"
import { listJobs } from "../../../core/jobs.mjs"

// Run one job now, in the background, through `brainlane jobs run` — works on
// launchd, cron and systemd alike. Only names from the config are accepted.
export default defineEventHandler(async (event) => {
  const { name } = await readBody<{ name: string }>(event)
  const jobs: any[] = await listJobs(ctx())
  const job = jobs.find((j) => j.name === name && !j.service)
  if (!job) { setResponseStatus(event, 400); return { ok: false, error: `unknown job: ${name}` } }
  const p = spawn(process.execPath, [join(ctx().lib, "bin", "brainlane.mjs"), "jobs", "run", name], { cwd: ctx().root, detached: true, stdio: "ignore", env: { ...process.env, BRAINLANE_ROOT: ctx().root } })
  p.unref()
  return { ok: true, name, started: new Date().toISOString() }
})
