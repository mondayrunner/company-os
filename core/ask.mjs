// `company-os ask "<question>"`: FTS candidates from the index, then a headless
// agent reads the real files and answers with a source per claim. Every
// question is logged: a question without a source is a gap in the structure.
import { readFile, mkdir, appendFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { search } from "./search.mjs";
import { runAgent, fill } from "./run.mjs";
import { loadConnectors, byKind } from "./connectors.mjs";

const PROMPTS = join(dirname(fileURLToPath(import.meta.url)), "..", "prompts");

export async function ask(ctx, db, question, { askedBy = "human", n = 10 } = {}) {
  const q = String(question ?? "").trim();
  if (q.length < 3 || q.length > 800) throw new Error("question too short or too long");
  const t0 = Date.now();
  const candidates = search(db, q, n);
  const list = candidates.length
    ? candidates.map((k) => `- \`${k.path}\` · ${k.heading || k.title} · ${String(k.snippet).replace(/\s+/g, " ").slice(0, 220)}`).join("\n")
    : "- (the index found nothing; search yourself with Grep/Glob)";
  const live = await liveFor(ctx, q);
  const template = await readFile(ctx.config.ask.prompt ? ctx.path(ctx.config.ask.prompt) : join(PROMPTS, "ask.md"), "utf8");
  const prompt = fill(template, {
    root: ctx.root, company: ctx.config.name, language: languageName(ctx.config.language), question: q, candidates: list,
    canonical: (ctx.config.ask.canonical ?? []).map((l) => `- ${l}`).join("\n") || "- (none configured)",
    live: live.length ? live.map((l) => `### ${l.kind} via ${l.connector} (fetched ${l.fetched}) — cite as [[live:${l.kind} @ ${l.fetched.slice(0, 16)}]]\n\`\`\`json\n${JSON.stringify(l.data, null, 1).slice(0, 6000)}\n\`\`\``).join("\n\n") : "(none: the question does not touch a live source)",
  });
  const model = askedBy === "agent" ? ctx.config.ask.agentModel ?? ctx.config.ask.model : ctx.config.ask.model;
  const { result: answer, cost } = await runAgent(ctx, prompt, { allowedTools: ctx.config.ask.allowedTools, addDir: ctx.root, model, timeoutMs: ctx.config.ask.timeoutMs });
  const duration = Date.now() - t0;
  const sources = [...new Set([...answer.matchAll(/\[\[(live:[^\]]+|[^\]|#:]+?)(?::[\d-]+)?\]\]/g)].map((m) => m[1].trim()))];
  const found = !/^\W*(not found in the brain|niet gevonden in het brein)/i.test(answer.slice(0, 160));
  try {
    db.prepare("INSERT INTO questions (ts, question, answer, sources, found, cost_usd, duration_ms, asked_by) VALUES (?,?,?,?,?,?,?,?)")
      .run(new Date().toISOString(), q, answer, JSON.stringify(sources), found ? 1 : 0, cost, duration, askedBy);
  } catch {}
  if (ctx.config.ask.log) {
    try {
      const dir = ctx.path(ctx.config.ask.log);
      await mkdir(dir, { recursive: true });
      const day = new Date().toISOString().slice(0, 10);
      await appendFile(join(dir, `${day}.md`), `\n## ${new Date().toTimeString().slice(0, 5)} · ${q}\n\n${answer}\n\n<!-- found: ${found} · sources: ${sources.length} · ${duration} ms · $${cost ?? "?"} · ${askedBy} -->\n`);
    } catch {}
  }
  return { question: q, answer, sources, found, cost, duration, live: live.map((l) => ({ kind: l.kind, connector: l.connector, fetched: l.fetched })), candidates: candidates.map((k) => ({ path: k.path, heading: k.heading, kind: k.kind })) };
}

const DEFAULT_QUERY = { finance: { what: "subscriptions" }, tasks: { what: "cards" }, calendar: { what: "today" }, mail: { what: "unread", limit: 20 } };

/** Which volatile kinds does this question touch? Words per kind from config.ask.liveHints. */
export function liveKinds(ctx, question) {
  const q = question.toLowerCase();
  return Object.entries(ctx.config.ask.liveHints ?? {}).filter(([, words]) => words.some((w) => q.includes(w.toLowerCase()))).map(([kind]) => kind);
}

async function liveFor(ctx, question) {
  const kinds = liveKinds(ctx, question);
  if (!kinds.length) return [];
  const connectors = await loadConnectors(ctx);
  const out = [];
  for (const kind of kinds) {
    const c = byKind(connectors, kind).find((x) => x.live);
    if (!c) continue;
    try { const data = await c.live(DEFAULT_QUERY[kind] ?? {}, ctx, c.options); out.push({ kind, connector: c.name, fetched: data.fetched ?? new Date().toISOString(), data: trim(data) }); }
    catch (e) { out.push({ kind, connector: c.name, fetched: new Date().toISOString(), data: { error: e.message } }); }
  }
  return out;
}

const trim = (d) => (Array.isArray(d.items) && d.items.length > 40 ? { ...d, items: d.items.slice(0, 40), truncated: d.items.length - 40 } : d);

export function languageName(code) {
  return { en: "English", nl: "Dutch", de: "German", fr: "French", es: "Spanish", it: "Italian", pt: "Portuguese" }[code] ?? code;
}
