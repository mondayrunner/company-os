import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { join } from "node:path"
const exec = promisify(execFile)

/**
 * Run the brainlane CLI (same repo) for the commands that write or take long:
 * ask, inbox, jobs run. Output is JSON.
 */
export async function cli(args: string[], timeoutMs = 300000) {
  const bin = join(ctx().lib, "bin", "brainlane.mjs")
  const { stdout } = await exec(process.execPath, [bin, ...args], { cwd: ctx().root, timeout: timeoutMs, maxBuffer: 20 * 1024 * 1024, env: { ...process.env, BRAINLANE_ROOT: ctx().root } })
  const start = stdout.search(/[[{]/)
  return start >= 0 ? JSON.parse(stdout.slice(start)) : null
}
