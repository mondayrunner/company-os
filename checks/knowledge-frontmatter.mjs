// Knowledge articles need a status, a last_verified date within the SLA, and
// sources that still exist. Configure: checks.knowledge = { dir, slaDays }.
import { frontmatter } from "../core/markdown.mjs";

export default {
  name: "knowledge-frontmatter",
  description: "status, last_verified within SLA, existing sources",
  async run(ctx, h) {
    const cfg = ctx.config.checks.knowledge ?? {};
    const dir = h.knowledgeDir();
    if (!dir || !(await h.isDir(dir))) return [];
    const sla = cfg.slaDays ?? 60;
    const out = [];
    for (const f of (await h.list(dir)).filter((f) => f.endsWith(".md") && f !== "INDEX.md")) {
      const rel = `${dir}/${f}`;
      const { meta, raw } = frontmatter(await h.read(rel));
      if (raw === null) { out.push({ severity: "error", where: rel, what: "no frontmatter" }); continue; }
      const status = ctx.fm(meta, "status"), verified = ctx.fm(meta, "lastVerified");
      if (!status) out.push({ severity: "error", where: rel, what: "status missing" });
      if (!verified) out.push({ severity: "error", where: rel, what: "last_verified missing" });
      else {
        const days = Math.floor((Date.now() - new Date(verified).getTime()) / 864e5);
        if (days > sla && !/SUPERSEDED/i.test(String(status))) out.push({ severity: "warn", where: rel, what: `last_verified ${verified} is ${days} days old (SLA ${sla})` });
      }
      for (const s of [].concat(ctx.fm(meta, "sources") ?? [])) {
        let p = String(s).replace(/\s*\(.*\)\s*$/, "").trim();   // "folder/ (all files)" → "folder/"
        if (!p || /\s/.test(p) || /^https?:/.test(p)) continue;    // prose or a URL, not a path
        p = p.startsWith("~/") ? p.replace("~", ctx.home) : p.replace(/^\.\.\//, "");
        const candidates = p.startsWith("/") ? [p] : [ctx.path(p), ctx.path(`${dir}/${p}`), ctx.path(`../${p}`)];
        let found = false;
        for (const c of candidates) if (await h.exists(c)) { found = true; break; }
        if (!found) out.push({ severity: "error", where: rel, what: `source does not exist: ${s}` });
      }
    }
    return out;
  },
};
