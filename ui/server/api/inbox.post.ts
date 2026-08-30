import { spawn } from "node:child_process"
import { join } from "node:path"

// Reply, approve, reject or run. `run` executes approved items through the CLI
// (files under the root only; outward actions are refused by company-os itself).
//
// Running does not block the request. An agent run takes minutes, and a request
// that waits that long is a request the browser can lose: navigate away and the
// answer goes nowhere, even though the work carries on. So the child is started,
// the item is marked as running in the database, and the reply comes back at
// once. The page finds out it finished by asking again — which is also what it
// does after a reload, so both paths tell the same story.
export default defineEventHandler(async (event) => {
  const body = await readBody<any>(event)
  const { action, id, text } = body

  // Posting goes through the core, not the CLI: it is one write and the page
  // that sends it waits for it.
  if (action === "post") {
    const { postItem } = await import("#core/inbox.mjs")
    const { kind, from, title, where, body: itemBody, itemAction } = body
    if (!title) throw createError({ statusCode: 400, statusMessage: "title required" })
    return { ok: true, result: await postItem(ctx(), { kind, from, title, where, body: itemBody, action: itemAction }) }
  }

  if (!["reply", "approve", "reject", "run"].includes(action)) throw createError({ statusCode: 400, statusMessage: "unknown action" })

  if (action === "run") {
    const { start, finish, list, record } = await import("#core/running.mjs")
    const context = ctx()
    const key = id ?? "all"

    // Already going: say so instead of starting a second one on the same item.
    if (list(context).some((r: any) => r.item === key)) return { ok: true, running: true, already: true }

    const bin = join(context.lib, "bin", "company-os.mjs")
    const child = spawn(process.execPath, [bin, "inbox", "run", ...(id ? ["--id", String(id)] : [])], {
      cwd: context.root,
      env: { ...process.env, COMPANY_OS_ROOT: context.root },
      stdio: ["ignore", "pipe", "pipe"],
    })

    // Kept only to read the result off: the item's own file is where it lands.
    let out = ""
    child.stdout?.on("data", (b) => { out += b.toString().slice(0, 4000) })

    start(context, key, { pid: child.pid, what: id ? "inbox run" : "inbox run (all approved)" })
    child.on("exit", (code) => {
      finish(context, key)
      let done = 0, failed = 0, cost = null
      try {
        const rows = JSON.parse(out.slice(out.search(/[[{]/)))
        for (const r of [].concat(rows)) { r.ok ? done++ : failed++; if (r.cost) cost = (cost ?? 0) + r.cost }
      } catch { failed = code === 0 ? 0 : 1 }
      record(context, { job: "inbox run", result: failed ? (done ? "partial" : "error") : "ok", done, failed,
        message: id ? String(id) : "all approved", cost })
    })
    child.on("error", (e) => {
      finish(context, key)
      record(context, { job: "inbox run", result: "error", done: 0, failed: 1, message: e.message })
    })

    return { ok: true, running: true, pid: child.pid }
  }

  try {
    return { ok: true, result: await cli(["inbox", action, String(id), ...(text ? [text] : [])]) }
  } catch (e: any) {
    setResponseStatus(event, 500)
    return { ok: false, error: (e?.stderr || e?.message || "").toString().slice(0, 400) }
  }
})
