/**
 * One account, two places that claim to be its status.
 *
 * Two ways this happens, both quietly:
 *   - a status file in a folder outside the accounts root (a code repo listed
 *     in `link.extraAccountDirs`). The checks read it as an account too, so a
 *     call gets written into the copy nobody updates any more.
 *   - an account that was merged into another one, with a banner that says so,
 *     still on an open side: it is counted, listed and planned as a live lead.
 *
 * Configure with `checks.duplicate-accounts`:
 *   { "mergedWords": ["SUPERSEDED", "merged into"], "head": 12 }
 * `mergedWords` are looked for in the first `head` lines of the status file.
 * Both findings are drift: which copy is the real one is the human's call.
 */
export default {
  name: "duplicate-accounts",
  description: "status files outside the accounts root, merged accounts still open",
  async run(ctx, h, options = {}) {
    const a = ctx.config.accounts;
    const out = [];

    for (const dir of [].concat(ctx.config.link?.extraAccountDirs ?? [])) {
      const base = String(dir).replace(/\/+$/, "");
      for (const name of await h.list(base)) {
        const rel = `${base}/${name}/${a.statusFile}`;
        if (!(await h.exists(rel))) continue;
        out.push({
          severity: "warn",
          where: rel,
          what: `a ${a.statusFile} outside the accounts root: a second status for "${name}" next to the one under \`${a.root}/\`?`,
          hint: `Keep one. Fold what is still true into the account under \`${a.root}/\` and rename this file (for example to STATUS-ARCHIVE.md) with a line that points there.`,
        });
      }
    }

    const words = options.mergedWords ?? ["SUPERSEDED", "merged into"];
    const head = options.head ?? 12;
    const re = new RegExp(words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "i");
    const folders = await h.accountFolders();
    for (const side of a.openSides ?? []) {
      for (const folder of folders[side] ?? []) {
        const rel = `${folder}/${a.statusFile}`;
        const text = await h.read(rel).catch(() => null);
        if (!text) continue;
        const lines = text.split("\n").slice(0, head);
        const i = lines.findIndex((l) => re.test(l));
        if (i === -1) continue;
        out.push({
          severity: "warn",
          where: rel,
          line: i + 1,
          what: `marked as merged or superseded, but still on the open side "${side}"`,
          hint: "Move what is left into the account it was merged into, and the folder off the open side.",
        });
      }
    }
    return out;
  },
};
