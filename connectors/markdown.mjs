/**
 * Built-in: every markdown file under the root becomes a document with chunks
 * and the relations the text itself declares (frontmatter account, inline
 * account line on contact pages, knowledge sources, files inside an account
 * folder). Human decisions stay in the markdown; this only reads them.
 */
import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { frontmatter, titleOf, chunks, hashOf } from "../core/markdown.mjs";

// `ignore` entries are folder names ("node_modules") or root-relative paths ("knowledge/log").
async function* walk(dir, root, ignore) {
  for (const d of await readdir(dir, { withFileTypes: true })) {
    if (d.name.startsWith(".")) continue;
    const p = join(dir, d.name);
    if (ignore.has(d.name) || ignore.has(relative(root, p))) continue;
    if (d.isDirectory()) yield* walk(p, root, ignore);
    else if (d.name.endsWith(".md")) yield p;
  }
}

const base = (rel) => rel.split("/").pop().replace(/\.md$/, "");

export default {
  name: "markdown",
  kind: "files",
  location: (ctx) => ctx.root,
  async scan(ctx) {
    const ignore = new Set(ctx.config.ignore);
    const documents = [];
    for await (const abs of walk(ctx.root, ctx.root, ignore)) {
      const rel = relative(ctx.root, abs);
      const st = await stat(abs);
      const text = await readFile(abs, "utf8");
      const { meta, body } = frontmatter(text);
      const relations = [];
      const ownAccount = ctx.accountOf(rel);
      const linkedBy = String(ctx.fm(meta, "linkedBy") ?? "");
      const automatic = /company-os link|brain koppel/i.test(linkedBy);
      for (const a of [].concat(ctx.fm(meta, "account") ?? [])) {
        if (!a || a === "internal" || a === "intern" || a === "private" || a === "prive") continue;
        relations.push({ to: a, kind: "belongs-to", source: "frontmatter", confidence: automatic ? "automatic" : "confirmed" });
      }
      for (const label of ctx.config.accountLine) {
        const line = body.match(new RegExp(`${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*(.+)$`, "m"))?.[1];
        if (line) for (const m of line.matchAll(/`([^`]+)`/g)) relations.push({ to: m[1].replace(/^~\/[^/]+\//, "../"), kind: "belongs-to", source: "body", confidence: "automatic" });
      }
      for (const s of [].concat(ctx.fm(meta, "sources") ?? [])) relations.push({ to: String(s).replace(/^\.\.\//, ""), kind: "based-on", source: "frontmatter", confidence: "confirmed" });
      if (ownAccount && ownAccount !== rel) relations.push({ to: ownAccount, kind: "part-of", source: "path", confidence: "confirmed" });
      documents.push({
        path: rel, kind: ctx.kindOf(rel), title: titleOf(body, base(rel)), hash: hashOf(text),
        mtime: st.mtime.toISOString(), bytes: st.size,
        status: ctx.fm(meta, "status") ?? null, last_verified: ctx.fm(meta, "lastVerified") ?? null, meta,
        chunks: chunks(body), relations,
      });
    }
    return { documents, count: documents.length };
  },
};
