// Connectors are plugins with one interface:
//
//   export default {
//     name: "trello",
//     kind: "tasks",          // tasks | crm | finance | calendar | mail | transcripts | knowledge | files | events | metrics
//     volatile: true,         // true: never copied into markdown; read live, snapshotted daily
//     location: "...",        // shown in `company-os status`
//     scan(ctx)  -> { documents?, events?, metrics?, count, added, message }
//     live(query, ctx) -> { items }        // optional, inference-time retrieval
//     act(action, params, ctx) -> result   // optional, one reversible write per action
//   }
//
// act() is for what can be undone from the source itself: a card you can
// archive, a draft you can delete. Sending, paying, publishing never live
// here; those go through the inbox and a human. Every act is recorded in the
// events table by core/actions.mjs, so it shows up in the activity log.
// Resolution order: <root>/connectors/<name>.mjs, <root>/connectors/<name>/index.mjs,
// then the built-in ones next to this file. Private plugins need no fork.
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const BUILTIN = join(dirname(fileURLToPath(import.meta.url)), "..", "connectors");

export function resolveConnector(ctx, name) {
  for (const p of [join(ctx.root, "connectors", `${name}.mjs`), join(ctx.root, "connectors", name, "index.mjs"), join(BUILTIN, `${name}.mjs`)]) {
    if (existsSync(p)) return p;
  }
  return null;
}

export async function loadConnectors(ctx, filter = () => true) {
  const out = [];
  for (const [name, options] of Object.entries(ctx.config.connectors ?? {})) {
    if (options === false || options?.enabled === false) continue;
    const file = resolveConnector(ctx, name);
    if (!file) { out.push({ name, error: "not found" }); continue; }
    const mod = await import(pathToFileURL(file).href);
    const c = mod.default ?? mod;
    if (typeof c.scan !== "function" && typeof c.live !== "function") { out.push({ name, error: "no scan() or live()" }); continue; }
    const connector = { name, kind: c.kind ?? "files", volatile: !!c.volatile, location: typeof c.location === "function" ? c.location(ctx, options) : c.location, scan: c.scan, live: c.live, act: c.act, options: options ?? {}, file, producesFiles: !!c.producesFiles };
    if (filter(connector)) out.push(connector);
  }
  return out;
}

export function byKind(connectors, kind) {
  return connectors.filter((c) => !c.error && c.kind === kind);
}

/**
 * Read one live source. Null when no connector of that kind exists.
 *
 * This used to sit in five places (ask, checks, the CLI, MCP, the dashboard)
 * with the same three steps five times. That pinned the call shape of `live()`
 * five times over: one addition to the connector contract and four places
 * behave differently from the fifth. The error message stays with the caller,
 * which knows what is going wrong right now.
 */
export async function readLive(ctx, kind, query = {}) {
  const c = byKind(await loadConnectors(ctx), kind).find((x) => x.live);
  if (!c) return null;
  return { connector: c.name, ...(await c.live(query, ctx, c.options)) };
}

/** One reversible write on the first connector of that kind that can act. Throws when none can. */
export async function doAct(ctx, kind, action, params = {}) {
  const c = byKind(await loadConnectors(ctx), kind).find((x) => x.act);
  if (!c) throw new Error(`no connector of kind ${kind} can act`);
  return { connector: c.name, result: await c.act(action, params, ctx, c.options) };
}
