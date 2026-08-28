import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { listJobs } from "#core/jobs.mjs"
import { runAgent } from "#core/run.mjs"

/**
 * "Fix met AI" op een job die faalt.
 *
 * Een rood lampje waar je niets mee kunt is een verwijt, geen hulp. Deze route
 * geeft een agent de status, de logstaart en het commando van precies één job
 * uit de config, en laat hem in de eigen bestanden zoeken en repareren. Hij mag
 * niets versturen — dat is dezelfde grens als in de inbox.
 */
export default defineEventHandler(async (event) => {
  const { job: name } = await readBody<{ job: string }>(event)
  const c = ctx()
  const job: any = (await listJobs(c)).find((j: any) => j.name === name)
  if (!job) { setResponseStatus(event, 400); return { ok: false, error: `onbekende job: ${name}` } }

  const tail = await readFile(job.log, "utf8").then((t) => t.trimEnd().split("\n").slice(-60).join("\n")).catch(() => "(geen log)")
  const status = await readFile(join(c.stateDir, `${name}-status.json`), "utf8").catch(() => "(geen status)")
  const language = c.config.language === "nl" ? "Dutch" : "English"

  const prompt = [
    `A scheduled job in this company OS at ${c.root} is failing. Find out why and fix it if you can.`,
    "",
    `## The job`, `name: ${job.name}`, `runs: ${job.run}`, `schedule: ${job.schedule}`, `log: ${job.log}`,
    "", `## Its last status`, "```json", status.slice(0, 2000), "```",
    "", `## The tail of its log`, "```", tail.slice(0, 6000), "```",
    "",
    "Read whatever you need under the root. You may edit files there to fix the cause.",
    "Never send, publish or invoice anything, and never run the job's own destructive parts.",
    "If the cause is something only a human can decide or supply (a password, a choice, an external outage), do not guess: say exactly what is needed and stop.",
    `Answer in ${language}, at most eight lines: what was wrong, what you changed (with paths), and what is left for the human. End with one line starting "Opgelost:" or "Niet opgelost:".`,
  ].join("\n")

  try {
    const r = await runAgent(c, prompt, { allowedTools: "Read,Edit,Write,Grep,Glob,Bash", addDir: c.root, model: c.config.ask.agentModel ?? c.config.ask.model, timeoutMs: 600000 })
    return { ok: true, job: name, answer: r.result, cost: r.cost, fixed: !/^niet opgelost|^not fixed/im.test(r.result.split("\n").at(-1) ?? "") }
  } catch (e: any) {
    setResponseStatus(event, 500)
    return { ok: false, error: (e?.stderr || e?.message || "mislukt").toString().slice(0, 400) }
  }
})
