// Connectors are plugins with one interface:
//
//   export default {
//     name: "trello",
//     kind: "tasks",          // tasks | crm | finance | calendar | mail | transcripts | knowledge | files | events | metrics
//     volatile: true,         // true: never copied into markdown; read live, snapshotted daily
//     location: "...",        // shown in `brainlane status`
//     scan(ctx)  -> { documents?, events?, metrics?, count, added, message }
//     live(query, ctx) -> { items }        // optional, inference-time retrieval
//   }
//
// No write(): the brain never writes to a source. Proposals go to the inbox.
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
    const connector = { name, kind: c.kind ?? "files", volatile: !!c.volatile, location: typeof c.location === "function" ? c.location(ctx, options) : c.location, scan: c.scan, live: c.live, options: options ?? {}, file, producesFiles: !!c.producesFiles };
    if (filter(connector)) out.push(connector);
  }
  return out;
}

export function byKind(connectors, kind) {
  return connectors.filter((c) => !c.error && c.kind === kind);
}
