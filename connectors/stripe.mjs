/**
 * Stripe: subscriptions and invoices, read live. Never copied into markdown;
 * `scan()` only snapshots a few numbers per day for history.
 *
 *   "stripe": { "envFile": "~/.config/finance/.env", "keyName": "STRIPE_RESTRICTED_KEY" }
 *
 * live({ what: "subscriptions" })  → { items: [{ id, customer, email, monthly, currency, status, since, interval }] }
 * live({ what: "open-invoices" })  → { items: [{ id, number, customer, amount, currency, due, overdue }] }
 * live({ what: "revenue", days }) → { items: [{ month, net }] }  — paid invoices per month, net of VAT
 */
import { secret, fetchRetry } from "../core/env.mjs";

/** Monthly amount of a subscription in major units, across intervals. */
export function monthlyOf(sub) {
  let total = 0;
  for (const item of sub.items?.data ?? []) {
    const amount = (item.price?.unit_amount ?? 0) * (item.quantity ?? 1);
    const interval = item.price?.recurring?.interval;
    const per = item.price?.recurring?.interval_count || 1;
    total += interval === "year" ? amount / (12 * per) : interval === "week" ? (amount * 4.33) / per : interval === "day" ? (amount * 30.4) / per : amount / per;
  }
  return Math.round(total) / 100;
}

export function normalizeSubscription(s) {
  return {
    id: s.id, customer: s.customer?.name ?? s.customer?.email ?? (typeof s.customer === "string" ? s.customer : "unknown"),
    email: s.customer?.email ?? null, monthly: monthlyOf(s), currency: (s.currency ?? s.items?.data?.[0]?.price?.currency ?? "eur").toUpperCase(),
    status: s.status, since: s.start_date ? new Date(s.start_date * 1000).toISOString().slice(0, 10) : null,
    interval: s.items?.data?.[0]?.price?.recurring?.interval ?? null,
  };
}

async function api(options, path) {
  const key = await secret(options, options?.keyName ?? "STRIPE_RESTRICTED_KEY");
  const out = [];
  let after;
  for (let page = 0; page < 20; page++) {
    const r = await fetchRetry(`https://api.stripe.com/v1/${path}${path.includes("?") ? "&" : "?"}limit=100${after ? `&starting_after=${after}` : ""}`, { headers: { Authorization: `Bearer ${key}` } });
    if (!r.ok) throw new Error(`Stripe ${r.status} on ${path.split("?")[0]}`);
    const j = await r.json();
    out.push(...(j.data ?? []));
    if (!j.has_more || !j.data?.length) break;
    after = j.data[j.data.length - 1].id;
  }
  return out;
}

export default {
  name: "stripe",
  kind: "finance",
  volatile: true,
  location: "api.stripe.com",
  async live(query, ctx, options) {
    const what = query?.what ?? "subscriptions";
    if (what === "subscriptions") {
      const status = query.status ?? "active";
      const subs = await api(options, `subscriptions?status=${status}&expand[]=data.customer`);
      return { items: subs.map(normalizeSubscription), fetched: new Date().toISOString() };
    }
    if (what === "revenue") {
      // Paid invoices per month, net of VAT — gross would show revenue the tax
      // office never sees. Walking a year costs a dozen calls, so callers are
      // expected to cache this: a month that has closed does not change.
      const days = Number(query.days ?? 400);
      const inv = await api(options, `invoices?status=paid&created[gte]=${Math.floor((Date.now() - days * 864e5) / 1000)}`);
      const per = new Map();
      for (const f of inv) {
        const month = new Date((f.status_transitions?.paid_at ?? f.created) * 1000).toISOString().slice(0, 7);
        per.set(month, (per.get(month) ?? 0) + (f.total_excluding_tax ?? f.total ?? 0) / 100);
      }
      return { items: [...per.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([month, net]) => ({ month, net: Math.round(net * 100) / 100 })), fetched: new Date().toISOString() };
    }
    if (what === "open-invoices") {
      const inv = await api(options, "invoices?status=open");
      const now = Date.now();
      return { items: inv.map((f) => ({ id: f.id, number: f.number, customer: f.customer_name ?? f.customer_email ?? "unknown", amount: (f.amount_remaining ?? 0) / 100, currency: (f.currency ?? "eur").toUpperCase(), due: f.due_date ? new Date(f.due_date * 1000).toISOString().slice(0, 10) : null, overdue: !!f.due_date && f.due_date * 1000 < now })).sort((a, b) => (a.due ?? "") < (b.due ?? "") ? -1 : 1), fetched: new Date().toISOString() };
    }
    throw new Error(`stripe: unknown query "${what}"`);
  },
  async scan(ctx, options) {
    const date = new Date().toISOString().slice(0, 10);
    const [subs, open] = await Promise.all([this.live({ what: "subscriptions" }, ctx, options), this.live({ what: "open-invoices" }, ctx, options)]);
    const mrr = subs.items.reduce((s, x) => s + x.monthly, 0);
    const metrics = [
      { date, key: "mrr", value: Math.round(mrr * 100) / 100 }, { date, key: "subscriptions", value: subs.items.length },
      { date, key: "open_invoices", value: open.items.length }, { date, key: "open_invoices_amount", value: open.items.reduce((s, x) => s + x.amount, 0) },
      { date, key: "open_invoices_overdue", value: open.items.filter((x) => x.overdue).length },
    ];
    return { metrics, count: subs.items.length, message: `${subs.items.length} active subscriptions, MRR ${metrics[0].value}` };
  },
};
