import { listJobs } from "#core/jobs.mjs"

/**
 * Are the automations still running? Per job: its own status file (the job
 * wrote it, or `company-os jobs run` did from the exit code), how old the last
 * run is in days that count for that job, and the tail of its log.
 */
function daysAgo(d: Date) { return Math.floor((Date.now() - d.getTime()) / 864e5) }
function weekdaysAgo(d: Date) {
  let n = 0
  const cursor = new Date(d); cursor.setHours(0, 0, 0, 0)
  const today = new Date(); today.setHours(0, 0, 0, 0)
  while (cursor < today) { cursor.setDate(cursor.getDate() + 1); const wd = cursor.getDay(); if (wd !== 0 && wd !== 6) n++ }
  return n
}

export default defineEventHandler(async () =>
  source("System", async () => {
    const jobs = await Promise.all((await listJobs(ctx())).map(async (j: any) => {
      const tail = await tailLines(j.log, 5)
      let age: number | null = null
      if (j.lastRun) age = j.weekdays ? weekdaysAgo(new Date(j.lastRun)) : daysAgo(new Date(j.lastRun))
      // listJobs() already normalises the state; this only classifies it.
      const state: "ok" | "partial" | "error" | "unknown" = j.service ? "ok" : j.result === "error" ? "error" : j.result === "partial" ? "partial" : j.result === "ok" ? "ok" : "unknown"
      const limit = j.monthly ? 33 : j.weekly ? 8 : j.weekdays ? 1 : 2
      return { ...j, state, age, stale: age !== null && age > limit && !j.service, tail }
    }))
    return { jobs }
  }),
)
