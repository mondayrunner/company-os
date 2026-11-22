/**
 * The job table in a README against the jobs that are actually scheduled.
 *
 * A README says "knowledge-compaction runs on Friday" long after the job left
 * `jobs`, and does not mention the three that were added since. The config is
 * what runs; the doc is what people (and agents) read.
 *
 * Looks at every doc in `checks.docs` for a markdown table whose first header
 * cell is "Job". Rows whose first cell is a name in backticks are compared with
 * `jobs` in the config, both ways. Docs without such a table are ignored.
 */
const cells = (line) => line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());

export function jobTables(text) {
  const lines = String(text).split("\n");
  const tables = [];
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].trim().startsWith("|") || !/^job$/i.test(cells(lines[i])[0] ?? "")) continue;
    const rows = [];
    let j = i + 1;
    if (j < lines.length && /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[j])) j++;
    for (; j < lines.length && lines[j].trim().startsWith("|"); j++) {
      const name = cells(lines[j])[0]?.match(/^`([^`]+)`$/)?.[1];
      if (name) rows.push({ name, line: j + 1 });
    }
    tables.push({ line: i + 1, rows });
    i = j;
  }
  return tables;
}

export default {
  name: "docs-vs-jobs",
  description: "job tables in the docs vs. jobs in the config",
  async run(ctx, h) {
    const jobs = (ctx.config.jobs ?? []).map((j) => j.name).filter(Boolean);
    if (!jobs.length) return [];
    const docs = ctx.config.checks?.docs ?? ["CLAUDE.md", "README.md"];
    const out = [];
    const listed = new Set();
    let first = null;
    for (const doc of docs) {
      const text = await h.read(doc).catch(() => null);
      if (!text) continue;
      for (const t of jobTables(text)) {
        first ??= { doc, line: t.line };
        for (const r of t.rows) {
          listed.add(r.name);
          if (!jobs.includes(r.name)) out.push({ severity: "warn", where: doc, line: r.line, what: `the job table lists \`${r.name}\`, which is not in \`jobs\` in the config: it does not run on a schedule` });
        }
      }
    }
    if (!first) return out;
    for (const name of jobs) {
      if (!listed.has(name)) out.push({ severity: "warn", where: first.doc, line: first.line, what: `job \`${name}\` runs (it is in \`jobs\`) but the job table does not mention it` });
    }
    return out;
  },
};
