// `brainlane ask "<question>"`: FTS candidates from the index, then a headless
// agent reads the real files and answers with a source per claim. Every
// question is logged: a question without a source is a gap in the structure.
import { readFile, mkdir, appendFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { search } from "./search.mjs";
import { runAgent, fill } from "./run.mjs";

const PROMPTS = join(dirname(fileURLToPath(import.meta.url)), "..", "prompts");

export async function ask(ctx, db, question, { askedBy = "human", n = 10 } = {}) {
  const q = String(question ?? "").trim();
  if (q.length < 3 || q.length > 800) throw new Error("question too short or too long");
  const t0 = Date.now();
  const candidates = search(db, q, n);
  const list = candidates.length
    ? candidates.map((k) => `- \`${k.path}\` · ${k.heading || k.title} · ${String(k.snippet).replace(/\s+/g, " ").slice(0, 220)}`).join("\n")
    : "- (the index found nothing; search yourself with Grep/Glob)";
  const template = await readFile(ctx.config.ask.prompt ? ctx.path(ctx.config.ask.prompt) : join(PROMPTS, "ask.md"), "utf8");
  const prompt = fill(template, {
    root: ctx.root, company: ctx.config.name, language: languageName(ctx.config.language), question: q, candidates: list,
    canonical: (ctx.config.ask.canonical ?? []).map((l) => `- ${l}`).join("\n") || "- (none configured)",
  });
  const { result: answer, cost } = await runAgent(ctx, prompt, { allowedTools: ctx.config.ask.allowedTools, addDir: ctx.root, model: ctx.config.ask.model, timeoutMs: ctx.config.ask.timeoutMs });
  const duration = Date.now() - t0;
  const sources = [...new Set([...answer.matchAll(/\[\[([^\]|#:]+?)(?::[\d-]+)?\]\]/g)].map((m) => m[1].trim()))];
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
  return { question: q, answer, sources, found, cost, duration, candidates: candidates.map((k) => ({ path: k.path, heading: k.heading, kind: k.kind })) };
}

export function languageName(code) {
  return { en: "English", nl: "Dutch", de: "German", fr: "French", es: "Spanish", it: "Italian", pt: "Portuguese" }[code] ?? code;
}
