// The pipeline's "last update" line must not lag behind its newest log entry.
// Configure: pipeline = { file, updateLine: "Last update", logHeading: "## Log" }.
const DATE = /\b(20\d\d-\d\d-\d\d)\b/g;

export default {
  name: "pipeline-freshness",
  description: "pipeline 'last update' vs newest log entry",
  async run(ctx, h) {
    const p = ctx.config.pipeline;
    if (!p?.file || !(await h.exists(p.file))) return [];
    const text = await h.read(p.file);
    const lines = text.split("\n");
    const updRe = new RegExp(p.updateLine ?? "Last update", "i");
    const i = lines.findIndex((l) => updRe.test(l));
    if (i === -1) return [{ severity: "warn", where: p.file, what: `no '${p.updateLine ?? "Last update"}' line` }];
    const header = lines[i].match(DATE)?.[0];
    const logStart = lines.findIndex((l) => new RegExp(`^${p.logHeading ?? "## Log"}\\s*$`).test(l));
    if (!header || logStart === -1) return [];
    let newest = "";
    for (let j = logStart + 1; j < lines.length && !/^## /.test(lines[j]); j++) {
      const d = lines[j].match(/^\*\*(20\d\d-\d\d-\d\d)/)?.[1];
      if (d && d > newest) newest = d;
    }
    return newest > header ? [{ severity: "warn", where: p.file, line: i + 1, what: `last update says ${header} but the newest log entry is ${newest}`, text: lines[i],
      action: { type: "edit-markdown", file: p.file, replace: [{ from: lines[i], to: lines[i].replace(header, newest) }] } }] : [];
  },
};
