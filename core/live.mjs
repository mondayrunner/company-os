/**
 * Live sources, answer-shaped.
 *
 * `live(kind, query)` hands back whatever the connector returns. These wrap
 * that into the answer an agent actually wants: not eighteen subscription rows
 * but the MRR and the count with the rows underneath; not a mail listing but
 * the mail with its body. Still no model, still milliseconds plus the round
 * trip to the source. Numbers here are never written into markdown.
 */
import { readLive } from "./connectors.mjs";

const round = (n) => Math.round(n * 100) / 100;

/** Subscriptions and open invoices in one picture. */
export async function finance(ctx) {
  const subs = await readLive(ctx, "finance", { what: "subscriptions" });
  if (!subs) return { error: "no live finance connector" };
  const open = (await readLive(ctx, "finance", { what: "open-invoices" }).catch((e) => ({ items: [], error: e.message }))) ?? { items: [] };
  const mrr = subs.items.reduce((s, x) => s + (x.monthly ?? 0), 0);
  const overdue = open.items.filter((i) => i.overdue);
  return {
    mrr: round(mrr), arr: round(mrr * 12), subscriptions: subs.items.length,
    openInvoices: open.items.length, openAmount: round(open.items.reduce((s, i) => s + (i.amount ?? 0), 0)),
    overdueInvoices: overdue.length, overdueAmount: round(overdue.reduce((s, i) => s + (i.amount ?? 0), 0)),
    items: { subscriptions: subs.items, openInvoices: open.items },
    fetched: subs.fetched ?? new Date().toISOString(), source: subs.connector,
  };
}

/** Open cards grouped by list, overdue first within a list. */
export async function tasks(ctx, { board = null } = {}) {
  const r = await readLive(ctx, "tasks", { what: "cards", ...(board ? { board } : {}) });
  if (!r) return { error: "no live tasks connector" };
  const byList = {};
  for (const name of r.lists ?? []) byList[name] = [];
  for (const c of r.items) (byList[c.list] ??= []).push(c);
  for (const l of Object.values(byList)) l.sort((a, b) => Number(b.overdue) - Number(a.overdue) || (a.due ?? "9").localeCompare(b.due ?? "9"));
  return { open: r.items.length, overdue: r.items.filter((c) => c.overdue).length, lists: byList, fetched: r.fetched, source: r.connector };
}

/** Today, or a range of days. */
export async function calendar(ctx, { from = null, to = null } = {}) {
  const r = from ? await readLive(ctx, "calendar", { what: "range", from, to: to ?? from }) : await readLive(ctx, "calendar", { what: "today" });
  if (!r) return { error: "no live calendar connector" };
  return r;
}

/**
 * Mail with the body: by uid, by a search over the mailbox (server-side, so
 * "ledger" finds the sender, the subject and the text), or the latest unread
 * headers when nothing is asked for. The body is capped by the connector.
 */
export async function mail(ctx, { query = null, uid = null, limit = 5, mailbox = null } = {}) {
  const extra = mailbox ? { mailbox } : {};
  const r = uid ? await readLive(ctx, "mail", { what: "read", uid, ...extra })
    : query ? await readLive(ctx, "mail", { what: "search", query, limit, ...extra })
    : await readLive(ctx, "mail", { what: "unread", limit: limit ?? 40, ...extra });
  if (!r) return { error: "no live mail connector" };
  return r;
}
