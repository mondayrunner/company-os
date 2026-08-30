import { readFile, writeFile, mkdir } from "node:fs/promises"
import { dirname } from "node:path"

/**
 * Answer from disk while a slow source refreshes behind the scenes.
 *
 * Some sources take a minute — a bookkeeping year, a year of invoices — and
 * their answer barely moves. Waiting for them on every visit is the difference
 * between a dashboard you open and one you avoid. So: fresh cache → return it;
 * stale cache → return it and refetch in the background; no cache → wait once.
 *
 * `key` is what the cache is *about* (a year, a currency). Changes it and the
 * old file is ignored rather than silently served for the wrong thing.
 */
const running = new Map<string, Promise<unknown>>()

export type Cached<T> = { data: T; fromCache: boolean; stale: boolean; refreshing: boolean; fetched: string; daysOld: number }

export async function cached<T>(file: string, ttlHours: number, fetcher: () => Promise<T>, opts: { force?: boolean; key?: string } = {}): Promise<Cached<T>> {
  if (!opts.force) {
    const hit = await readCache<T>(file, opts.key)
    if (hit) {
      const hours = (Date.now() - new Date(hit.fetched).getTime()) / 36e5
      const stale = hours > ttlHours
      // One refresh at a time per file: a page with three panels open must not
      // start three identical minute-long fetches.
      if (stale && !running.has(file)) running.set(file, write(file, fetcher(), opts.key).catch(() => {}).finally(() => running.delete(file)))
      return { data: hit.data, fromCache: true, stale, refreshing: stale, fetched: hit.fetched, daysOld: Math.floor(hours / 24) }
    }
  }
  const fresh = await write(file, fetcher(), opts.key)
  return { data: fresh.data, fromCache: false, stale: false, refreshing: false, fetched: fresh.fetched, daysOld: 0 }
}

async function readCache<T>(file: string, key?: string) {
  try {
    const c = JSON.parse(await readFile(file, "utf8"))
    if ((c.key ?? null) !== (key ?? null) || !c.fetched) return null
    return c as { data: T; fetched: string }
  } catch { return null }
}

async function write<T>(file: string, work: Promise<T>, key?: string) {
  const data = await work
  const fetched = new Date().toISOString()
  await mkdir(dirname(file), { recursive: true }).catch(() => {})
  await writeFile(file, JSON.stringify({ key: key ?? null, fetched, data }, null, 2)).catch(() => {})
  return { data, fetched }
}
