import { loadConnectors } from "#core/connectors.mjs"
import { listJobs } from "#core/jobs.mjs"

// The dashboard mirrors the config: every connector and job is a module with a
// state. Turning one off is one line in company-os.config.json.
export default defineEventHandler(async () =>
  source("Modules", async () => {
    const c = ctx()
    const d = brain()
    const scanned = new Map<string, any>(d ? (d.prepare("SELECT * FROM sources").all() as any[]).map((s) => [s.name, s]) : [])
    const connectors = (await loadConnectors(c)).map((x: any) => ({
      name: x.name, kind: x.kind, volatile: x.volatile, live: !!x.live, location: x.location ?? null, error: x.error ?? null, private: x.file?.startsWith(c.root) ?? false,
      lastScanned: scanned.get(x.name)?.last_scanned ?? null, count: scanned.get(x.name)?.count ?? null, message: scanned.get(x.name)?.message ?? null,
      options: Object.fromEntries(Object.entries(x.options ?? {}).filter(([k]) => !/key|token|pass|secret/i.test(k))),
    }))
    const jobs = await listJobs(c)
    return { root: c.root, config: c.short(c.configFile), db: c.short(c.dbPath), language: c.config.language, connectors, jobs, checks: c.config.checks ?? {}, inbox: c.config.inbox ?? {} }
  }),
)
