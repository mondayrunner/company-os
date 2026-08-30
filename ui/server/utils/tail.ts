import { open, stat } from "node:fs/promises"

/**
 * The last lines of a file, without reading the file.
 *
 * Job logs rotate at two megabytes, and the status page polls every few
 * seconds for five lines each. Reading them whole meant tens of megabytes per
 * minute for a few hundred bytes of output.
 */
export async function tailLines(file: string, lines = 5, bytes = 16 * 1024): Promise<string[]> {
  try {
    const size = (await stat(file)).size
    const from = Math.max(0, size - bytes)
    const fh = await open(file, "r")
    try {
      const buf = Buffer.alloc(size - from)
      await fh.read(buf, 0, buf.length, from)
      // A partial first line when the file is bigger than the window: drop it.
      const text = from > 0 ? buf.toString("utf8").slice(buf.indexOf(10) + 1) : buf.toString("utf8")
      return text.trimEnd().split("\n").filter(Boolean).slice(-lines)
    } finally { await fh.close() }
  } catch { return [] }
}
