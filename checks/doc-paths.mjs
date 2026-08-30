/**
 * Paths in backticks inside the rule documents (CLAUDE.md, READMEs) must
 * exist. Configure: checks.docs = ["CLAUDE.md", "knowledge/CLAUDE.md", "../CLAUDE.md"].
 */
import { dirname, join } from "node:path";
import { stat, readdir } from "node:fs/promises";

const exists = async (p) => !!(await stat(p).catch(() => null));

// The subdirectory listing is cached per run, not per process: under the
// long-lived dashboard a module-level cache would never see a new folder, so
// `check` would keep reporting a path that was created an hour ago.
async function existsInSubdir(cache, dir, p) {
  if (!cache.has(dir)) cache.set(dir, (await readdir(dir, { withFileTypes: true }).catch(() => [])).filter((d) => d.isDirectory() && !d.name.startsWith(".")).map((d) => d.name));
  for (const sub of cache.get(dir)) if (await exists(join(dir, sub, p))) return true;
  return false;
}

export default {
  name: "doc-paths",
  description: "paths mentioned in rule documents exist",
  async run(ctx, h) {
    const docs = ctx.config.checks.docs ?? ["CLAUDE.md", "README.md"];
    const subdirs = new Map();
    const rootDirs = new Set(await readdir(ctx.root).catch(() => []));
    const parentDirs = new Set(await readdir(join(ctx.root, "..")).catch(() => []));
    const out = [];
    for (const doc of docs) {
      const abs = ctx.path(doc);
      if (!(await exists(abs))) continue;
      const text = await h.read(abs);
      const seen = new Set();
      const lines = text.split("\n");
      for (let i = 0; i < lines.length; i++) {
        for (const m of lines[i].matchAll(/`([^`\n]+)`/g)) {
          const raw = m[1];
          if (!/[\/.]/.test(raw) || /\s/.test(raw) || /^https?:/.test(raw) || /^\[\[/.test(raw) || /[{*<>]|YYYY|<[a-z]+>/i.test(raw)) continue;
          if (/^[a-z0-9-]+\.[a-z]{2,}\//i.test(raw)) continue; // domain/path, not a file
          if (/^(npm|node|bash|git|launchctl|curl|cd|ls|cp|ln|npx|claude|python3|source|company-os)\b/.test(raw)) continue;
          let p = raw.replace(/[),.;:]+$/, "").replace(/:\d+(-\d+)?$/, "");
          let target = null, absolute = false;
          if (p.startsWith("~/")) { target = join(ctx.home, p.slice(2)); absolute = true; }
          else if (p.startsWith("/")) { if (!/^\/(Users|home|opt|etc|var|tmp|usr|Volumes)\//.test(p)) continue; target = p; absolute = true; }
          else if (p.startsWith("./")) target = join(dirname(abs), p.slice(2));
          else {
            const head = p.split("/")[0];
            if (rootDirs.has(head)) target = join(ctx.root, p);
            else if (parentDirs.has(head)) target = join(ctx.root, "..", p);
            else if (await exists(join(dirname(abs), p)) || await exists(join(ctx.root, p))) continue;
            else if (await existsInSubdir(subdirs, dirname(abs), p) || await existsInSubdir(subdirs, ctx.root, p)) continue; // one level down, contextual
            else if (p.includes("/") && /\.[a-z0-9]+$|\/$/i.test(p)) target = join(ctx.root, p); // file-like under an unknown folder: dead
            else continue;
          }
          if (seen.has(target)) continue;
          seen.add(target);
          if (!(await exists(target))) out.push({ severity: absolute ? "error" : "warn", where: ctx.short(abs), line: i + 1, what: `path does not exist: ${raw}`, text: lines[i] });
        }
      }
    }
    return out;
  },
};
