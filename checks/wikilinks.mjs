// [[links]] inside the knowledge folder must point to an existing article.
export default {
  name: "wikilinks",
  description: "dead [[wikilinks]] in the knowledge folder",
  async run(ctx, h) {
    const dir = h.knowledgeDir();
    if (!dir || !(await h.isDir(dir))) return [];
    const files = (await h.list(dir)).filter((f) => f.endsWith(".md"));
    const articles = new Set(files.map((f) => f.replace(/\.md$/, "")));
    const out = [];
    for (const f of files) {
      const text = await h.read(`${dir}/${f}`);
      text.split("\n").forEach((line, i) => {
        for (const m of line.matchAll(/\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g)) {
          const target = m[1].trim();
          if (!articles.has(target) && !target.includes("/")) out.push({ severity: "error", where: `${dir}/${f}`, line: i + 1, what: `dead wikilink [[${target}]]`, text: line });
        }
      });
    }
    return out;
  },
};
