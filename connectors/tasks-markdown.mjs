/**
 * Tasks in a markdown file, for people without a task tool. Same item shape as
 * `trello`, so `tasks: "tasks-markdown"` and `tasks: "trello"` are interchangeable.
 *
 *   "tasks-markdown": { "file": "tasks.md" }
 *
 * Format, one task per line, anywhere in the file:
 *   - [ ] Send the proposal to Acme (due: 2026-09-01) @accounts/leads/2026-01-15-acme
 *   - [x] Done tasks are ignored
 * A `## Heading` above the task becomes its list.
 */
import { readFile } from "node:fs/promises";

export function parseTasks(text, now = Date.now()) {
  const items = [];
  let list = "";
  text.split("\n").forEach((line, i) => {
    const h = line.match(/^#{1,6}\s+(.+)$/);
    if (h) { list = h[1].trim(); return; }
    const m = line.match(/^\s*[-*]\s+\[( |x|X)\]\s+(.+)$/);
    if (!m || m[1] !== " ") return;
    let title = m[2].trim();
    const due = title.match(/\(due:\s*(\d{4}-\d\d-\d\d)\)/)?.[1] ?? null;
    const account = title.match(/@(\S+)/)?.[1] ?? null;
    title = title.replace(/\(due:[^)]*\)/, "").replace(/@\S+/, "").replace(/\s+/g, " ").trim();
    items.push({ id: `L${i + 1}`, title, list, due, overdue: !!due && new Date(due).getTime() < now, url: null, updated: null, labels: [], account, line: i + 1 });
  });
  return items;
}

export default {
  name: "tasks-markdown",
  kind: "tasks",
  volatile: false,
  location: (ctx, o) => o?.file ?? "tasks.md",
  async live(query, ctx, options) {
    const text = await readFile(ctx.path(options?.file ?? "tasks.md"), "utf8").catch(() => "");
    return { items: parseTasks(text), fetched: new Date().toISOString() };
  },
  async scan(ctx, options) {
    const date = new Date().toISOString().slice(0, 10);
    const { items } = await this.live({ what: "cards" }, ctx, options);
    return { metrics: [{ date, key: "tasks_open", value: items.length }, { date, key: "tasks_overdue", value: items.filter((i) => i.overdue).length }], count: items.length, message: `${items.length} open tasks` };
  },
};
