/**
 * Trello: one board of tasks, read live, plus reversible writes. Swappable with
 * `tasks-markdown`: both answer live({ what: "cards" }) with the same item shape.
 *
 *   "trello": { "envFile": "~/.config/daily-planner/.env", "board": "67fc…",
 *               "doneLists": ["Done", "Klaar"], "todoList": "Later" }
 *
 * live({ what: "cards" })                         → { items: [{ id, title, list, due, overdue, url, updated, labels }], lists }
 * live({ what: "card", id, files })               → one whole card: description, checklists, comments, attachments
 * live({ what: "boards" })                        → the open boards this token can see
 * act("create", { title, body, due, list })       → the new card, same shape
 * act("move", { id, list })                       → the moved card; list defaults to the first done list
 * act("create-board", { title, lists })           → a new board with those lists, in that order
 *
 * `files` on a card query is a folder: uploads are written there and come back
 * with a `path`. An attachment URL is private — it needs the same key and token
 * as the API — so a bare URL is useless to whoever reads the card next.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { secret, fetchRetry } from "../core/env.mjs";

export function normalizeCard(c, listName, now = Date.now()) {
  return { id: c.id, title: c.name, list: listName, due: c.due ? c.due.slice(0, 10) : null, overdue: !!c.due && new Date(c.due).getTime() < now && !c.dueComplete, url: c.url ?? c.shortUrl ?? null, updated: c.dateLastActivity ?? null, labels: (c.labels ?? []).map((l) => l.name).filter(Boolean) };
}

async function api(options, path, params = {}, init = {}) {
  const key = await secret(options, "TRELLO_KEY"), token = await secret(options, "TRELLO_TOKEN");
  const qs = new URLSearchParams({ key, token, ...params }).toString();
  const r = await fetchRetry(`https://api.trello.com/1${path}?${qs}`, init);
  if (!r.ok) throw new Error(`Trello ${r.status} on ${path}`);
  return r.json();
}

const boardOf = async (query, options) => {
  const board = query?.board ?? options?.board ?? (await secret(options, "TRELLO_BOARD_ID", { required: false }));
  if (!board) throw new Error("trello: no board configured (options.board or TRELLO_BOARD_ID)");
  return board;
};

/** The list on the board whose name matches, case-insensitive; the first list when no name is given. */
async function listNamed(options, board, name) {
  const lists = await api(options, `/boards/${board}/lists`, { filter: "open", fields: "name,pos" });
  lists.sort((a, b) => a.pos - b.pos);
  if (!name) return lists[0];
  const l = lists.find((x) => x.name.toLowerCase() === String(name).toLowerCase());
  if (!l) throw new Error(`trello: no list "${name}" on the board (have: ${lists.map((x) => x.name).join(", ")})`);
  return l;
}

/** One card, everything on it, in a shape that says nothing about Trello. */
export function normalizeFullCard(c) {
  return {
    id: c.id,
    title: c.name,
    url: c.shortUrl ?? c.url ?? null,
    desc: c.desc ?? "",
    due: c.due ? c.due.slice(0, 10) : null,
    labels: (c.labels ?? []).map((l) => l.name).filter(Boolean),
    checklists: (c.checklists ?? []).map((cl) => ({ name: cl.name, items: (cl.checkItems ?? []).map((i) => ({ name: i.name, done: i.state === "complete" })) })),
    comments: (c.actions ?? []).filter((a) => a.type === "commentCard").reverse().map((a) => ({ date: String(a.date).slice(0, 10), who: a.memberCreator?.fullName ?? "?", text: String(a.data?.text ?? "") })),
    attachments: (c.attachments ?? []).map((a) => ({ name: a.name, url: a.url, upload: !!a.isUpload, bytes: a.bytes ?? null, fileName: a.fileName ?? null })),
  };
}

/**
 * Download the uploads to `dir` and hand back the attachments with a path.
 * Ten files and 25 MB each is the ceiling: a brief is meant to be read, and a
 * file that will not come is skipped rather than fatal.
 */
async function download(options, attachments, dir) {
  const uploads = attachments.filter((a) => a.upload && a.url && !(a.bytes > 25_000_000)).slice(0, 10);
  if (!uploads.length) return attachments;
  await mkdir(dir, { recursive: true });
  const key = await secret(options, "TRELLO_KEY"), token = await secret(options, "TRELLO_TOKEN");
  for (const a of uploads) {
    const safe = String(a.fileName || a.name || "attachment").replace(/[^A-Za-z0-9._-]+/g, "-").slice(-60);
    try {
      const r = await fetchRetry(a.url, { headers: { Authorization: `OAuth oauth_consumer_key="${key}", oauth_token="${token}"` } });
      if (!r.ok) continue;
      const file = join(dir, safe);
      await writeFile(file, Buffer.from(await r.arrayBuffer()));
      a.path = file;
    } catch { /* one attachment short is no reason to drop the card */ }
  }
  return attachments;
}

export default {
  name: "trello",
  kind: "tasks",
  volatile: true,
  location: "api.trello.com",
  async live(query, ctx, options) {
    const what = query?.what ?? "cards";
    if (what === "card") {
      if (!query?.id) throw new Error("trello: card needs an id");
      const raw = await api(options, `/cards/${query.id}`, { fields: "name,desc,due,labels,shortUrl,url,idShort", checklists: "all", checklist_fields: "name", checkItems: "all", attachments: "true", attachment_fields: "name,url,fileName,isUpload,bytes", actions: "commentCard", actions_limit: "50" });
      const card = normalizeFullCard(raw);
      if (query.files) card.attachments = await download(options, card.attachments, query.files);
      return { card };
    }
    if (what === "boards") {
      const items = await api(options, "/members/me/boards", { filter: "open", fields: "name,url,shortUrl" });
      return { items: items.map((b) => ({ id: b.id, title: b.name, url: b.shortUrl ?? b.url })) };
    }
    const board = await boardOf(query, options);
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
  async act(action, params, ctx, options) {
    if (action === "create-board") {
      // Reversible the way Trello means it: a board you no longer want is
      // closed, and a closed board can be reopened. Nothing is destroyed here.
      if (!params?.title) throw new Error("trello: create-board needs a title");
      const b = await api(options, "/boards", { name: params.title, defaultLists: "false", ...(params.desc ? { desc: params.desc } : {}), ...(options?.workspace ? { idOrganization: options.workspace } : {}) }, { method: "POST" });
      const lists = [];
      // Sequential on purpose: Trello orders new lists by arrival, so parallel
      // creation gives you the right lists in the wrong order.
      for (const name of params.lists ?? []) lists.push((await api(options, "/lists", { name, idBoard: b.id, pos: "bottom" }, { method: "POST" })).name);
      return { id: b.id, title: b.name, url: b.shortUrl ?? b.url, lists };
    }
    const board = await boardOf(params, options);
    if (action === "create") {
      if (!params?.title) throw new Error("trello: create needs a title");
      const list = await listNamed(options, board, params.list ?? options?.todoList);
      const card = await api(options, "/cards", { idList: list.id, name: params.title, desc: params.body ?? "", ...(params.due ? { due: params.due } : {}), pos: "top" }, { method: "POST" });
      return normalizeCard(card, list.name);
    }
    if (action === "move") {
      if (!params?.id) throw new Error("trello: move needs a card id");
      const list = await listNamed(options, board, params.list ?? (options?.doneLists ?? ["Done"])[0]);
      const card = await api(options, `/cards/${params.id}`, { idList: list.id }, { method: "PUT" });
      return normalizeCard(card, list.name);
    }
    throw new Error(`trello: unknown action "${action}"`);
  },
  async scan(ctx, options) {
    const date = new Date().toISOString().slice(0, 10);
    const { items } = await this.live({ what: "cards" }, ctx, options);
    return { metrics: [{ date, key: "tasks_open", value: items.length }, { date, key: "tasks_overdue", value: items.filter((i) => i.overdue).length }], count: items.length, message: `${items.length} open tasks` };
  },
};
