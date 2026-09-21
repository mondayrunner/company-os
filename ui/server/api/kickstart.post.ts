import { spawn } from "node:child_process"
import { join } from "node:path"
import { jobsOf } from "#core/jobs.mjs"

// Run one job now, in the background, through `company-os jobs run` — works on
// launchd, cron and systemd alike. Only names from the config are accepted;
// the config is all this needs, so no status is read to answer a click.
//
// force: the same --force a terminal run takes, for a job that skips itself
// when its work for today is already done. A run asked for by hand is not the
// schedule asking again, so the button passes it on.
export default defineEventHandler(async (event) => {
  const { name, force } = await readBody<{ name: string; force?: boolean }>(event)
  const job = jobsOf(ctx()).find((j: any) => j.name === name && !j.service)
  if (!job) { setResponseStatus(event, 400); return { ok: false, error: `unknown job: ${name}` } }
  const args = [join(ctx().lib, "bin", "company-os.mjs"), "jobs", "run", name, ...(force ? ["--force"] : [])]
  const p = spawn(process.execPath, args, { cwd: ctx().root, detached: true, stdio: "ignore", env: { ...process.env, COMPANY_OS_ROOT: ctx().root } })
  p.unref()
  return { ok: true, name, started: new Date().toISOString() }
})
