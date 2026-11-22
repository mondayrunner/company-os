/**
 * An open account that nobody has written in for a long time.
 *
 * A lead that went quiet in May still sits on the open side in November: it
 * shows up in `accounts`, in the daily plan and in every "who holds the ball"
 * count, and each of those reads a little less true. Nobody decides to close
 * it, because no single day makes it obviously dead.
 *
 * "Written in" is the newest file in the folder (`h.touched`), the same proxy
 * the other account checks use. A fresh clone resets every mtime, so after one
 * this check is quiet until the folders age again.
 *
 * Configure with `checks.stale-accounts`:
 *   { "days": 90, "parkSide": "parked" }
 * With a `parkSide` that is one of `accounts.sides`, the finding is a proposal:
 * approve and the folder moves there (a rename inside the vault, moved back
 * the same way). Without one it is drift: decide by hand. With
 * `brain-hygiene` in `inbox.autoApprove` the move runs without asking; the
 * inbox item it leaves behind is the log (see autoApprovable in core/checks.mjs).
 */
export default {
  name: "stale-accounts",
  description: "open account folders nobody wrote in for a long time",
  async run(ctx, h, options = {}) {
    const a = ctx.config.accounts;
    const days = options.days ?? 90;
    const park = options.parkSide && (a.sides ?? []).includes(options.parkSide) && !(a.openSides ?? []).includes(options.parkSide) ? options.parkSide : null;
    const cutoff = Date.now() - days * 864e5;
    const folders = await h.accountFolders();
    const out = [];
    for (const side of a.openSides ?? []) {
      for (const folder of folders[side] ?? []) {
        const t = await h.touched(folder);
        if (!t || t > cutoff) continue;
        const day = new Date(t).toISOString().slice(0, 10);
        const to = park ? `${a.root ? `${a.root}/` : ""}${park}/${folder.split("/").pop()}` : null;
        out.push({
          severity: "warn",
          where: folder,
          what: `open account, nothing written in it since ${day} (more than ${days} days)`,
          kind: to ? "proposal" : "drift",
          auto: to ? "brain-hygiene" : null,
          action: to ? { type: "move-file", inward: true, from: folder, to } : null,
          hint: to
            ? `Approve: the folder moves to \`${to}\`: off the open side, still searchable, and back with one move. Still alive? Write what happened in the status file and this closes by itself.`
            : "Still alive? Write what happened in the status file. Over? Move the folder to a closed side.",
        });
      }
    }
    return out;
  },
};
