import { test } from "node:test";
import assert from "node:assert/strict";
import { frontmatter, setFrontmatter, chunks, tableUnder, sections } from "../core/markdown.mjs";

test("frontmatter parses scalars, inline lists and dash lists", () => {
  const { meta, body } = frontmatter("---\nstatus: ACTIVE\ntags: [a, b]\nsources:\n  - x.md\n  - y.md\naccount:\n---\n# Hi\n");
  assert.equal(meta.status, "ACTIVE");
  assert.deepEqual(meta.tags, ["a", "b"]);
  assert.deepEqual(meta.sources, ["x.md", "y.md"]);
  assert.deepEqual(meta.account, []);
  assert.equal(body, "# Hi\n");
});

test("setFrontmatter replaces and appends", () => {
  const t = setFrontmatter("---\na: 1\n---\nbody", { a: 2, b: 3 });
  assert.equal(t, "---\na: 2\nb: 3\n---\nbody");
  assert.equal(setFrontmatter("no frontmatter", { a: 1 }), null);
});

test("chunks split on headings and cap length", () => {
  const c = chunks("intro\n## A\n" + "x".repeat(2000) + "\n## B\nshort");
  assert.equal(c[0].heading, "");
  assert.equal(c.filter((x) => x.heading === "A").length, 2);
  assert.equal(c.at(-1).heading, "B");
});

test("tableUnder reads rows with line numbers", () => {
  const rows = tableUnder("## Leads\n\n| A | B |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |\n\n## Next", /^## Leads/, ["a", "b"]);
  assert.equal(rows.length, 2);
  assert.equal(rows[1].b, "4");
  assert.equal(rows[0]._line, 5);
});

test("sections carry heading and start line", () => {
  const s = sections("top\n## Log\nl1\n## Figures\nf1");
  assert.deepEqual(s.map((x) => [x.heading, x.start]), [["", 1], ["Log", 2], ["Figures", 4]]);
});
