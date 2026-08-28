/**
 * Runs a fetcher and always answers, even when the source is down. One hanging
 * API must not blank the whole page. Every route wraps its work in this so the
 * browser gets the same envelope: { ok, data | error, ms, fetched }.
 */
export async function source<T>(name: string, fn: () => Promise<T>, timeoutMs = 20000) {
  const start = Date.now()
  try {
    const data = await Promise.race([
      fn(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`${name} did not answer within ${timeoutMs / 1000}s`)), timeoutMs)),
    ])
    return { ok: true as const, data, ms: Date.now() - start, fetched: new Date().toISOString() }
  } catch (err: any) {
    return { ok: false as const, error: err?.message ?? String(err), ms: Date.now() - start, fetched: new Date().toISOString() }
  }
}
