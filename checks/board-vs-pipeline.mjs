/**
 * The sales board and the pipeline file tell the same story.
 *
 * The pipeline file is the canon: leads, who holds the ball, what was decided.
 * The board is the view of it people glance at. Views drift: a lead gets a row
 * and never a card, a card sits in LEADS months after the folder moved to
 * lost. A view is not something to ask the human about sixteen times; it is
 * something to bring in line. So:
 *
 *   1. A lead with a pipeline row and no card → the check makes the card
 *      (`sync: true`; a card is reversible, you archive it) and reports what
 *      it made, once. With `sync` off it is one grouped finding instead.
 *   2. A folder on an open side with neither a row nor a card → one grouped
 *      question: alive (then it gets a row) or lost? Only the human knows.
 *   3. A card in the open lists that names no open lead → one grouped
 *      question: moved on, or a lead without a folder?
 *
 * Won and done lists are left alone. Needs a connector of kind "tasks" with
 * live({ what: "boards" }), live({ what: "cards", board }) and, for sync,
 * act("create", { title, body, list, board }) — Trello. Which board:
 * `boards.sales.title` in the config, or checks["board-vs-pipeline"].board.
 *
 * Configure: checks["board-vs-pipeline"] = { board: "_Sales Funnel", lists: ["LEADS", "ON HOLD", "RUNNING"], sync: true, newList: "LEADS" }.
 */
import { nameWords } from "../core/checks.mjs";
import { doAct } from "../core/connectors.mjs";
import { titleOf } from "../core/markdown.mjs";

const DEFAULT_LISTS = ["LEADS", "ON HOLD", "RUNNING"];

/**
 * How much a card looks like a lead: the number of real words they share
 * (folder segments count, pipeline names count). Zero is no match. The best
 * card wins, not the first: two leads that both mention "Claude" must not end
 * up on one card while the other's own card is called an orphan.
 */
function likeness(cardTitle, folder, pipelineWho) {
  const words = nameWords(cardTitle).filter((w) => w.length >= 4);
  let n = 0;
  if (folder) {
    const segs = [...new Set(folder.toLowerCase().split(/[\/-]/))];
    n += words.filter((w) => segs.includes(w) || (w.length >= 6 && segs.some((s) => s.startsWith(w)))).length;
  }
  if (pipelineWho) { const ws = nameWords(pipelineWho).filter((w) => w.length >= 4); n += words.filter((w) => ws.includes(w)).length; }
  return n;
}

/** A card title from a pipeline "who" cell: the name, without markdown and without the aside in brackets. */
const cardTitle = (who) => who.replace(/\*\*/g, "").replace(/\s*\([^)]*\)\s*$/, "").trim().slice(0, 120);

export default {
  name: "board-vs-pipeline",
  description: "sales board ↔ pipeline: cards for leads with a row; one question for folders without either, one for cards without a lead",
  needs: ["tasks"],
  async run(ctx, h, options = {}) {
    const a = ctx.config.accounts, p = ctx.config.pipeline;
    const wantedBoard = options.board ?? ctx.config.boards?.sales?.title;
    if (!wantedBoard) return [];
    const lists = (options.lists ?? ctx.config.boards?.sales?.openLists ?? DEFAULT_LISTS).map((l) => l.toLowerCase());
    const sync = options.sync === true;
    const newList = options.newList ?? (options.lists ?? ctx.config.boards?.sales?.openLists ?? DEFAULT_LISTS)[0];

    const boards = (await h.live("tasks", { what: "boards" }))?.items ?? [];
    const board = boards.find((b) => b.id === wantedBoard || (b.title ?? b.name) === wantedBoard);
    if (!board) return [{ severity: "warn", where: "boards", what: `no board named "${wantedBoard}" — the sales board in the config does not exist for this token` }];
    const boardName = board.title ?? board.name;
    const cards = ((await h.live("tasks", { what: "cards", board: board.id }))?.items ?? []).filter((c) => lists.includes((c.list ?? "").toLowerCase()));

    // Open leads: folders on the open sides, each with its pipeline row if it
    // has one, plus pipeline rows that have no folder yet (a lead is a lead).
    const open = await h.openAccounts(a.openSides ?? []);
    const rows = p?.leads ? await h.pipelineLeads() : [];
    const whoOf = (r) => h.clean(r[p.leads.who ?? "who"]);
    const used = new Set();
    const leads = open.map((folder) => {
      const row = rows.find((r) => !used.has(r) && h.matchFolder(whoOf(r), [folder]));
      if (row) used.add(row);
      return { folder, row, who: row ? whoOf(row) : null };
    });
    for (const r of rows) if (!used.has(r)) leads.push({ folder: null, row: r, who: whoOf(r) });

    // Best pairs first: every (lead, card) with a likeness, strongest on top,
    // each lead and each card used once.
    const pairs = [];
    for (const l of leads) for (const c of cards) { const n = likeness(c.title, l.folder, l.who); if (n) pairs.push({ l, c, n }); }
    pairs.sort((x, y) => y.n - x.n);
    const matched = new Set(), placed = new Set();
    for (const { l, c } of pairs) { if (placed.has(l) || matched.has(c.id)) continue; placed.add(l); matched.add(c.id); }
    const noCard = leads.filter((l) => !placed.has(l));
    const withRow = noCard.filter((l) => l.row);
    const folderOnly = noCard.filter((l) => !l.row);
    const orphanCards = cards.filter((c) => !matched.has(c.id));

    const out = [];
    const label = (l) => (l.who ? cardTitle(l.who) : l.folder.split("/").pop());

    // 1. Leads with a row: the board is a view, so the view gets the card.
    if (withRow.length && sync) {
      const made = [], failed = [];
      for (const l of withRow) {
        let title = label(l);
        if (l.folder) title = titleOf(await h.read(`${l.folder}/${a.statusFile}`).catch(() => ""), title).replace(/^(status|stand)\s*[—–-]\s*/i, "").slice(0, 120) || title;
        const body = [`Made by \`company-os check board-vs-pipeline\`: this lead has a pipeline row and had no card.`, l.folder ? `Folder: \`${l.folder}\`` : null, l.row?.[p.leads.action ?? "action"] ? `Next: ${h.clean(l.row[p.leads.action ?? "action"]).slice(0, 300)}` : null].filter(Boolean).join("\n\n");
        try {
          await doAct(ctx, "tasks", "create", { title, body, list: newList, board: board.id });
          made.push(title);
        } catch (e) { failed.push(`${title} (${e.message.slice(0, 80)})`); }
      }
      if (made.length) out.push({ severity: "info", kind: "report", where: `board ${boardName} · ${newList}`, what: `board brought in line with the pipeline: ${made.length} card${made.length === 1 ? "" : "s"} made on ${newList}: ${made.join("; ")}` });
      if (failed.length) out.push({ severity: "warn", where: `board ${boardName}`, what: `${failed.length} card${failed.length === 1 ? "" : "s"} could not be made: ${failed.join("; ")}` });
    } else if (withRow.length) {
      out.push({ severity: "warn", where: p.file, what: `${withRow.length} lead${withRow.length === 1 ? " has" : "s have"} a pipeline row and no card on "${boardName}" (${lists.map((x) => x.toUpperCase()).join("/")}): ${withRow.map(label).join("; ")}`, hint: `Set \`checks["board-vs-pipeline"].sync: true\` and the check makes these cards itself; or make them by hand and this closes.` });
    }

    // 2. Folders without a row or a card: alive or lost is a human call — once, for all of them.
    if (folderOnly.length) {
      const names = folderOnly.map((l) => l.folder).sort();
      out.push({
        severity: "warn", kind: "question", where: `${a.root}/${(a.openSides ?? [])[0] ?? ""}`,
        what: `${names.length} open folder${names.length === 1 ? " has" : "s have"} neither a pipeline row nor a card on "${boardName}": ${names.map((n) => n.split("/").pop()).join("; ")}`,
        hint: `Reply per folder with \`alive\` or \`lost\` (e.g. "2026-04-15-martine: lost, 2026-05-02-rinske: alive") and approve: lost folders move to the lost side, alive ones get a pipeline row (and a card on the next run). Say nothing about a folder to leave it as it is.`,
        action: { type: "agent", inward: true, instruction: `The human answers per folder. For every folder named \`lost\`: move the folder from its open side to \`${a.root}/${(ctx.config.accounts.sides ?? []).find((s) => /lost|churn|verloren/i.test(s)) ?? "lost"}/\` (same folder name) and add one dated line at the top of its ${a.statusFile} saying it was closed as lost on the human's word. For every folder named \`alive\`: add a row for it to the leads table under "${p.leads.heading}" in \`${p.file}\`, taking the name, stage, next action and ball from its ${a.statusFile}; do not invent what is not there. Folders the human does not mention: leave alone. Folders in question:\n${names.map((n) => `- ${n}`).join("\n")}` },
      });
    }

    // 3. Cards that name no open lead: moved on, or a lead without a folder?
    if (orphanCards.length) {
      const names = orphanCards.map((c) => `"${c.title}" (${c.list})`).sort();
      out.push({
        severity: "warn", kind: "question", where: `board ${boardName}`,
        what: `${names.length} card${names.length === 1 ? "" : "s"} in ${lists.map((x) => x.toUpperCase()).join("/")} name${names.length === 1 ? "s" : ""} no open lead: ${names.join("; ")}`,
        hint: `Moved on? Archive or move the card on the board and this closes. A real lead without a folder? Reply with the card and the folder name to make (e.g. "Acme → 2026-09-09-acme-website") and approve.`,
        action: { type: "agent", inward: true, instruction: `For every card the human names with a folder name: make that folder under \`${a.root}/${(a.openSides ?? [])[0] ?? ""}/\` with a ${a.statusFile} that has a title, a "ball" line (${a.ballLine ?? "**Ball:**"}) and a next-action section, using only what the human wrote and the card title. Add a matching row to the leads table under "${p.leads.heading}" in \`${p.file}\`. Cards the human does not mention: leave alone. Cards in question:\n${names.map((n) => `- ${n}`).join("\n")}` },
      });
    }
    return out;
  },
};
