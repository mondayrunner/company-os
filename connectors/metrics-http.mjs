// Built-in: one daily snapshot of numbers from an HTTP JSON API (usually your
// own dashboard), so you can see them as a line later. Configure routes and a
// tiny path expression per metric:
//
//   "metrics-http": {
//     "url": "http://localhost:4321/api",
//     "routes": { "finance": "finance", "clients": "clients" },
//     "metrics": {
//       "mrr": "finance.stripe.mrr",
//       "tickets_open": "clients.clients[].tickets[]|count",
//       "tickets_late": "clients.clients[].tickets[?late]|count"
//     },
//     "timeoutMs": 90000
//   }
//
// Path grammar: dotted keys; `[]` flattens an array; `[?prop]` keeps items
// whose prop is truthy; a trailing `|count` or `|sum` reduces.
export function evaluate(expr, data) {
  const [pathPart, reducer] = expr.split("|").map((s) => s.trim());
  let cur = [data];
  for (const seg of pathPart.split(".")) {
    const m = seg.match(/^([^[]+)((?:\[[^\]]*\])*)$/);
    if (!m) return undefined;
    cur = cur.map((x) => x?.[m[1]]);
    for (const b of m[2].match(/\[[^\]]*\]/g) ?? []) {
      const f = b.match(/^\[\?(\w+)\]$/)?.[1];
      cur = cur.flatMap((x) => (Array.isArray(x) ? x : [])).filter((x) => (f ? !!x?.[f] : true));
    }
  }
  if (reducer === "count") return cur.filter((x) => x !== undefined && x !== null).length;
  if (reducer === "sum") return cur.reduce((s, x) => s + (Number(x) || 0), 0);
  const v = cur.length === 1 ? cur[0] : cur;
  return typeof v === "number" ? v : Number.isFinite(Number(v)) && v !== "" && v !== null ? Number(v) : undefined;
}

export default {
  name: "metrics-http",
  kind: "metrics",
  volatile: true,
  location: (ctx, o) => o?.url ?? "",
  async scan(ctx, options) {
    const o = options ?? ctx.config.connectors["metrics-http"] ?? {};
    const date = new Date().toISOString().slice(0, 10);
    const data = {};
    await Promise.all(Object.entries(o.routes ?? {}).map(async ([key, route]) => {
      try {
        const r = await fetch(`${o.url}/${route}`, { signal: AbortSignal.timeout(o.timeoutMs ?? 90000) });
        const j = await r.json();
        data[key] = j?.ok === false ? null : (j?.data ?? j);
      } catch { data[key] = null; }
    }));
    const metrics = [];
    for (const [key, expr] of Object.entries(o.metrics ?? {})) {
      const value = evaluate(expr, data);
      if (typeof value === "number" && Number.isFinite(value)) metrics.push({ date, key, value });
    }
    return { metrics, count: metrics.length, message: `${metrics.length} metrics for ${date}` };
  },
};
