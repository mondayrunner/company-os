import { status } from "#core/search.mjs"

// The state of the brain. The shape comes from the core, so `company-os
// status`, the MCP tool and this panel do not give three answers to one
// question.
export default defineEventHandler(async () =>
  source("Brain", async () => {
    const d = brain()
    if (!d) return { empty: true }
    const s = status(d, ctx(), { transcripts: 400 })
    const open = s.transcriptsWaiting.filter((t: any) => !t.linked)
    return {
      counts: {
        documents: s.documents, chunks: s.chunks, relations: s.relations, events: s.events,
        metricDays: s.metrics, inboxOpen: s.inboxOpen,
      },
      byKind: s.byKind,
      sources: s.sources,
      transcripts: { total: s.transcriptsTotal, open: open.length, recent: open.slice(0, 12) },
      runs: s.latestRuns,
    }
  }),
)
