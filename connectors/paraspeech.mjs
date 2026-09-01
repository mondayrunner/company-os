/**
 * Paraspeech: speech to text that runs on your own Mac, so the recordings never
 * leave it. This connector reads its database and files the ones worth keeping
 * as markdown in the transcript inbox, with a proposal for which account they
 * belong to. You confirm by setting the account key in the frontmatter (or by
 * moving the file into the account folder); `company-os index` reads that back.
 *
 *   "paraspeech": { "minSeconds": 600, "minChars": 8000 }
 *
 * What it skips is the point: a ten-second dictation into an editor is a prompt,
 * not a conversation. Imported recordings and anything ten minutes or longer are
 * candidates; the rest is left alone, because an inbox that fills with your own
 * shell commands is an inbox you stop reading.
 *
 * The frontmatter keys for the account and the proposal come from the config, so
 * a vault that already speaks its own vocabulary keeps it.
 */
import { DatabaseSync } from "node:sqlite";
import { copyFile, mkdir, readdir, writeFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadNames } from "../core/link.mjs";

const APPLE_EPOCH = 978307200;
const dbPath = (ctx, options) => (options?.database ? ctx.path(options.database) : join(ctx.home, "Library/Containers/me.offlocalhost.Paraspeech/Data/Library/Application Support/Paraspeech/Database/paraspeech.sqlite"));

async function snapshotCopy(src) {
  // Core Data keeps the WAL open; always read from a copy.
  const dir = join(tmpdir(), "company-os-paraspeech");
  await mkdir(dir, { recursive: true });
  for (const ext of ["", "-wal", "-shm"]) await copyFile(src + ext, join(dir, "p.sqlite" + ext)).catch(() => {});
  return join(dir, "p.sqlite");
}

/** The accounts whose names appear in the text, most mentions first. */
export function proposal(text, index) {
  const t = text.toLowerCase();
  const out = new Map();
  for (const v of index.values()) {
    const n = String(v.name ?? "").toLowerCase();
    if (n.length >= 4 && t.includes(n)) for (const a of v.accounts ?? []) out.set(a, (out.get(a) ?? 0) + 1);
  }
  return [...out.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([a]) => a);
}

async function* mdNames(dir, skip) {
  let ents = [];
  try { ents = await readdir(dir, { withFileTypes: true }); } catch { return; }
  for (const d of ents) {
    if (d.name.startsWith(".") || d.name === skip) continue;
    if (d.isDirectory()) yield* mdNames(join(dir, d.name), skip);
    else if (d.name.endsWith(".md")) yield d.name;
  }
}

const SAY = {
  en: { recording: "Recording", conversation: "Conversation", proposed: (a, k) => `Belongs to ${a}? Set \`${k}:\` in the frontmatter to confirm, or move this file into that account folder.`, none: (k) => `No account recognised. Set \`${k}:\` if this belongs to one.`, notes: "Notes", transcript: "Transcript" },
  nl: { recording: "Opname", conversation: "Gesprek", proposed: (a, k) => `Voorstel: hoort bij ${a}. Zet \`${k}:\` in de frontmatter om te bevestigen, of verplaats dit bestand naar die dossiermap.`, none: (k) => `Geen dossier herkend. Zet \`${k}:\` als het bij een klant hoort.`, notes: "Notities", transcript: "Transcript" },
};

export default {
  name: "paraspeech",
  kind: "transcripts",
  producesFiles: true,
  location: (ctx, options) => ctx.short(dbPath(ctx, options)),
  async scan(ctx, options = {}) {
    const src = dbPath(ctx, options);
    if (!(await stat(src).catch(() => null))) return { count: 0, added: 0, message: "Paraspeech database not found" };
    const say = SAY[ctx.config.language] ?? SAY.en;
    const accountKey = (ctx.config.frontmatter.account ?? ["account"])[0];
    const proposalKey = (ctx.config.frontmatter.proposal ?? ["account_proposal"])[0];
    const inboxRel = ctx.config.transcripts.inbox;
    const inbox = ctx.path(inboxRel);

    const db = new DatabaseSync(await snapshotCopy(src), { readOnly: true });
    const rows = db.prepare(`
      SELECT hex(ZID) id, ZCREATEDAT t, ZAUDIODURATION dur, ZORIGIN origin, ZTARGETAPPNAME app,
             COALESCE(ZMEETINGNOTESMARKDOWN, '') notes, COALESCE(ZSPEAKERLABELEDTRANSCRIPTTEXT, ZCLEANEDTEXT, ZTEXT, '') text
      FROM ZTRANSCRIPTENTITY
      WHERE ZORIGIN = 'file' OR ZAUDIODURATION >= ? OR length(COALESCE(ZTEXT,'')) >= ?
      ORDER BY ZCREATEDAT DESC`).all(options.minSeconds ?? 600, options.minChars ?? 8000);
    db.close();

    await mkdir(inbox, { recursive: true });
    const inInbox = new Set((await readdir(inbox)).map((b) => b.replace(/\.md$/, "")));
    // A recording that was already filed lives under its account by now; its id
    // is still in the name, which is what keeps this from importing it again.
    const everywhere = new Set();
    for (const dir of ["transcripts", ctx.config.accounts.root]) for await (const n of mdNames(ctx.path(dir), "_inbox")) everywhere.add(n);
    let index = new Map();
    try { index = await loadNames(ctx); } catch { /* no names module: no proposal, still a file */ }

    let added = 0;
    for (const r of rows) {
      const date = new Date((r.t + APPLE_EPOCH) * 1000);
      const id = r.id.slice(0, 8).toLowerCase();
      const base = `${date.toISOString().slice(0, 10)}-${id}`;
      if (inInbox.has(base) || [...everywhere].some((b) => b.includes(id))) continue;
      const kind = r.origin === "file" ? "recording" : "conversation";
      const accounts = proposal(r.text + " " + r.notes, index);
      const head = r.text.replace(/\s+/g, " ").slice(0, 80);
      const md = [
        "---", "source: paraspeech", `paraspeech_id: ${r.id.toLowerCase()}`, `kind: ${kind}`, `date: ${date.toISOString()}`,
        `duration_s: ${Math.round(r.dur ?? 0)}`, `app: ${r.app ?? ""}`, `${proposalKey}: [${accounts.join(", ")}]`, `${accountKey}:`, "---", "",
        `# ${say[kind]} ${date.toISOString().slice(0, 16).replace("T", " ")} · ${head}…`, "",
        accounts.length ? say.proposed(accounts.map((a) => `\`${a}\``).join(", "), accountKey) : say.none(accountKey),
        "", r.notes ? `## ${say.notes} (Paraspeech)\n\n${r.notes}\n` : "", `## ${say.transcript}`, "", r.text, "",
      ].join("\n");
      await writeFile(join(inbox, `${base}.md`), md);
      added++;
    }
    return { count: rows.length, added, message: added ? `${added} new in ${inboxRel}/` : "nothing new" };
  },
};
