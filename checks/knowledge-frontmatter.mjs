// Knowledge articles need a status, a last_verified date within the SLA, and
// sources that still exist. Configure: checks.knowledge = { dir, slaDays }.
import { frontmatter } from "../core/markdown.mjs";

export default {
  name: "knowledge-frontmatter",
  description: "status, last_verified within SLA, existing sources",
  async run(ctx, h) {
    const cfg = ctx.config.checks.knowledge ?? {};
    const dir = cfg.dir ?? ctx.config.kinds.find((k) => k.kind === "knowledge")?.prefix?.replace(/\/$/, "");
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
        const p = String(s).startsWith("~/") ? String(s) : String(s).replace(/^\.\.\//, "");
        const abs = p.startsWith("~/") ? p.replace("~", ctx.home) : p.startsWith("/") ? p : ctx.path(p);
        if (!(await h.exists(abs)) && !(await h.exists(ctx.path(`${dir}/${p}`)))) out.push({ severity: "error", where: rel, what: `source does not exist: ${s}` });
      }
    }
    return out;
  },
};
