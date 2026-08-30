/**
 * Figures that live in a system of record (MRR, ARR) must not be copied into
 * markdown (where a current figure would live: pipeline, knowledge) outside log sections: a copy is a second system that starts ageing
 * immediately. Configure: checks["copied-figures"] (or the older key
 * checks.copiedFigures) = { patterns, currency, kinds, exclude: [path prefixes],
 * excludeHeadings: ["Log"] }.
 */
import { sections } from "../core/markdown.mjs";

export default {
  name: "copied-figures",
  description: "MRR/ARR amounts copied into markdown",
  async run(ctx, h, options = {}) {
    const cfg = Object.keys(options).length ? options : ctx.config.checks.copiedFigures ?? {};
    const patterns = cfg.patterns ?? ["MRR", "ARR"];
    const currency = cfg.currency ?? "€";
    const exclude = cfg.exclude ?? [];
    const excludeHeadings = (cfg.excludeHeadings ?? ["Log", "Changelog", "History"]).map((s) => s.toLowerCase());
    const re = new RegExp(`\\b(${patterns.join("|")})\\b`);
    const out = [];
    const kinds = cfg.kinds ?? ["pipeline", "knowledge"];   // accounts hold dated decisions, not a current stand
    const docs = h.db.prepare(`SELECT path FROM documents WHERE kind IN (${kinds.map(() => "?").join(",")})`).all(...kinds);
    for (const { path } of docs) {
      if (exclude.some((e) => path.startsWith(e))) continue;
      const text = await h.read(path).catch(() => null);
      if (!text || !re.test(text)) continue;
      for (const s of sections(text)) {
        if (excludeHeadings.some((x) => s.heading.toLowerCase().startsWith(x))) continue;
        s.lines.forEach((line, i) => {
          if (re.test(line) && line.includes(currency) && /\d/.test(line)) out.push({ severity: "warn", where: path, line: s.start + i, what: `copied figure: "${line.trim().slice(0, 90)}"`, text: line });
        });
      }
    }
    return out;
  },
};
