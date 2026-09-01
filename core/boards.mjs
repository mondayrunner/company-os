/**
 * `company-os boards`: the boards this brain expects, and whether they exist.
 *
 * The dashboard finds a client's open requests by looking for a column with a
 * particular name. That works right up until someone else installs this and
 * names their column something else. So the brain makes the boards: then the
 * name is an agreement instead of a hope, and "install this" is a command
 * rather than a description of somebody's setup.
 *
 * Shows before it acts. A board lands in a workspace other people can see, and
 * Trello has no delete, only close — so the default is a plan and `--create`
 * is the second step. Boards that already carry the name are left alone, which
 * is also what makes running it twice safe.
 */
import { readLive } from "./connectors.mjs";
import { createBoard } from "./actions.mjs";

/** The wanted boards from the config: the fixed ones, or one client board. */
export function wanted(config, client = null) {
  const t = config.boards ?? {};
  if (client) {
    const c = t.client;
    if (!c) return [];
    return [{ key: "client", title: (c.title ?? "{name}").replace("{name}", client), lists: c.lists ?? [] }];
  }
  return Object.entries(t).filter(([k]) => k !== "client").map(([key, b]) => ({ key, title: b.title ?? key, lists: b.lists ?? [] }));
}

export async function boards(ctx, { create = false, client = null } = {}) {
  const want = wanted(ctx.config, client);
  if (!want.length) return { error: client ? "no boards.client template in the config" : "no boards in the config" };
  const live = await readLive(ctx, "tasks", { what: "boards" });
  if (!live) return { error: "no live connector of kind tasks" };
  const have = new Map((live.items ?? []).map((b) => [b.title.toLowerCase(), b]));

  const plan = want.map((w) => ({ ...w, exists: have.get(w.title.toLowerCase()) ?? null }));
  if (!create) {
    return {
      dryRun: true, source: live.connector,
      boards: plan.map((b) => ({ key: b.key, title: b.title, lists: b.lists, status: b.exists ? "exists" : "would create", url: b.exists?.url ?? null })),
      next: plan.some((b) => !b.exists) ? "run again with --create" : "nothing to do",
    };
  }
  const made = [];
  for (const b of plan) {
    if (b.exists) { made.push({ key: b.key, title: b.title, status: "exists", url: b.exists.url }); continue; }
    const r = await createBoard(ctx, { title: b.title, lists: b.lists });
    made.push({ key: b.key, title: b.title, status: r.ok ? "created" : "failed", url: r.board?.url ?? null, error: r.error ?? null });
  }
  return { source: live.connector, boards: made };
}
