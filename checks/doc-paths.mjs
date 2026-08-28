// Paths in backticks inside the rule documents (CLAUDE.md, READMEs) must
// exist. Configure: checks.docs = ["CLAUDE.md", "knowledge/CLAUDE.md", "../CLAUDE.md"].
import { dirname, join } from "node:path";
import { stat, readdir } from "node:fs/promises";

const exists = async (p) => !!(await stat(p).catch(() => null));

export default {
  name: "doc-paths",
  description: "paths mentioned in rule documents exist",
  async run(ctx, h) {
    const docs = ctx.config.checks.docs ?? ["CLAUDE.md", "README.md"];
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
          if (!/[\/.]/.test(raw) || /\s/.test(raw) || /^https?:/.test(raw) || /[{*<>]|YYYY|<[a-z]+>/i.test(raw)) continue;
          if (/^(npm|node|bash|git|launchctl|curl|cd|ls|cp|ln|npx|claude|python3|source|brainlane)\b/.test(raw)) continue;
          let p = raw.replace(/[),.;:]+$/, "").replace(/:\d+(-\d+)?$/, "");
          let target = null, absolute = false;
          if (p.startsWith("~/")) { target = join(ctx.home, p.slice(2)); absolute = true; }
          else if (p.startsWith("/")) { target = p; absolute = true; }
          else if (p.startsWith("./")) target = join(dirname(abs), p.slice(2));
          else {
            const head = p.split("/")[0];
            if (rootDirs.has(head)) target = join(ctx.root, p);
            else if (parentDirs.has(head)) target = join(ctx.root, "..", p);
            else if (await exists(join(dirname(abs), p)) || await exists(join(ctx.root, p))) continue;
            else if (p.includes("/")) target = join(ctx.root, p); // unknown top-level folder: a dead path
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
