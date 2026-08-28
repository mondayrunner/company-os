import { loadConnectors, byKind } from "../../../core/connectors.mjs"

/** Read one live source through its connector (tasks, finance, calendar, mail). */
export async function live(kind: string, query: Record<string, any> = {}) {
  const c = byKind(await loadConnectors(ctx()), kind).find((x: any) => x.live)
  if (!c) throw new Error(`no live connector of kind "${kind}" in the config`)
  return { connector: c.name, ...(await c.live(query, ctx(), c.options)) }
}

/** Which live kinds does the config provide? The overview shows a panel per kind. */
export async function liveKinds(): Promise<string[]> {
  const cs = await loadConnectors(ctx())
  return [...new Set(cs.filter((c: any) => !c.error && c.live).map((c: any) => c.kind))] as string[]
}
