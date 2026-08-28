// Every row in the leads table has an account folder on an open side, and every
// folder on an open side has a row. Configure: pipeline.leads = { heading,
// columns, who }, accounts.openSides = ["acquisition"].
export default {
  name: "pipeline-accounts",
  description: "leads table rows ↔ account folders",
  async run(ctx, h) {
    const p = ctx.config.pipeline;
    if (!p?.leads) return [];
    const rows = await h.pipelineLeads();
    const folders = await h.accountFolders();
    const open = (ctx.config.accounts.openSides ?? []).flatMap((s) => folders[s] ?? []);
    const all = Object.values(folders).flat();
    if (!rows.length || !all.length) return [];
    const out = [];
    const matched = new Set();
    for (const r of rows) {
      const who = h.clean(r[p.leads.who ?? "who"]);
      const f = h.matchFolder(who, all);
      if (!f) out.push({ severity: "warn", where: p.file, line: r._line, what: `lead "${who}" has no account folder`, text: Object.values(r).join(" ") });
      else matched.add(f);
    }
    // A folder is covered when any table in the pipeline file names it (leads, wins, losses, commitments).
    const names = await h.pipelineNames();
    for (const f of open) if (!matched.has(f) && !names.some((n) => h.matchFolder(n, [f]))) out.push({ severity: "warn", where: f, what: "open account folder without a row in any pipeline table" });
    return out;
  },
};
