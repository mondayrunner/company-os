// Trello: one board of tasks, read live. Swappable with `tasks-markdown`:
// both answer live({ what: "cards" }) with the same item shape.
//
//   "trello": { "envFile": "~/.config/daily-planner/.env", "board": "67fc…", "doneLists": ["Done", "Klaar"] }
//
// live({ what: "cards" })  → { items: [{ id, title, list, due, overdue, url, updated, account? }] }
import { secret, fetchRetry } from "../core/env.mjs";

export function normalizeCard(c, listName, now = Date.now()) {
  return { id: c.id, title: c.name, list: listName, due: c.due ? c.due.slice(0, 10) : null, overdue: !!c.due && new Date(c.due).getTime() < now && !c.dueComplete, url: c.url ?? c.shortUrl ?? null, updated: c.dateLastActivity ?? null, labels: (c.labels ?? []).map((l) => l.name).filter(Boolean) };
}

async function api(options, path, params = {}) {
  const key = await secret(options, "TRELLO_KEY"), token = await secret(options, "TRELLO_TOKEN");
  const qs = new URLSearchParams({ key, token, ...params }).toString();
  const r = await fetchRetry(`https://api.trello.com/1${path}?${qs}`);
  if (!r.ok) throw new Error(`Trello ${r.status} on ${path}`);
  return r.json();
}

export default {
  name: "trello",
  kind: "tasks",
  volatile: true,
  location: "api.trello.com",
  async live(query, ctx, options) {
    const what = query?.what ?? "cards";
    const board = query?.board ?? options?.board ?? (await secret(options, "TRELLO_BOARD_ID", { required: false }));
    if (!board) throw new Error("trello: no board configured (options.board or TRELLO_BOARD_ID)");
    if (what !== "cards") throw new Error(`trello: unknown query "${what}"`);
    const [lists, cards] = await Promise.all([
      api(options, `/boards/${board}/lists`, { filter: "open", fields: "name,pos" }),
      api(options, `/boards/${board}/cards`, { filter: "open", fields: "name,due,dueComplete,idList,url,shortUrl,dateLastActivity,labels" }),
    ]);
    const name = Object.fromEntries(lists.map((l) => [l.id, l.name]));
    const done = new Set((options?.doneLists ?? ["Done", "Klaar", "Gedaan"]).map((s) => s.toLowerCase()));
    // Cards whose list is closed are archived in practice: skip them with the done lists.
    const items = cards.filter((c) => name[c.idList]).map((c) => normalizeCard(c, name[c.idList])).filter((c) => !done.has(c.list.toLowerCase()));
    return { items, lists: lists.sort((a, b) => a.pos - b.pos).map((l) => l.name), fetched: new Date().toISOString() };
  },
  async scan(ctx, options) {
    const date = new Date().toISOString().slice(0, 10);
    const { items } = await this.live({ what: "cards" }, ctx, options);
    return { metrics: [{ date, key: "tasks_open", value: items.length }, { date, key: "tasks_overdue", value: items.filter((i) => i.overdue).length }], count: items.length, message: `${items.length} open tasks` };
  },
};
