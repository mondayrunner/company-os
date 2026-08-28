// Every active subscription in the finance system has an account folder, and
// the folder's status file mentions the monthly amount. Needs a connector of
// kind "finance" with live({ what: "subscriptions" }) → { items: [{ id,
// customer, monthly, currency }] }. Skips when there is none.
export default {
  name: "subscriptions-vs-accounts",
  description: "active subscriptions ↔ account folders",
  needs: ["finance"],
  async run(ctx, h) {
    const r = await h.live("finance", { what: "subscriptions" });
    if (!r?.items) return [];
    const folders = Object.values(await h.accountFolders()).flat();
    const won = (ctx.config.accounts.wonSides ?? []).flatMap((s) => (folders.filter((f) => f.includes(`/${s}/`))));
    const pool = won.length ? won : folders;
    const out = [];
    for (const s of r.items) {
      let folder = null;
      for (const f of pool) {
        const text = await h.read(`${f}/${ctx.config.accounts.statusFile}`).catch(() => "");
        if (s.id && text.includes(s.id)) { folder = f; break; }
      }
      folder ??= h.matchFolder(s.customer ?? "", pool);
      if (!folder) { out.push({ severity: "warn", where: `subscription ${s.id}`, what: `active subscription for "${s.customer}" (${s.currency ?? ""}${s.monthly}/m) has no account folder` }); continue; }
      const text = await h.read(`${folder}/${ctx.config.accounts.statusFile}`).catch(() => "");
      const amount = String(Math.round(s.monthly));
      if (text && !text.replace(/\./g, "").includes(amount)) out.push({ severity: "warn", where: `${folder}/${ctx.config.accounts.statusFile}`, what: `live subscription is ${s.currency ?? ""}${amount}/m but the status file does not mention that amount` });
    }
    return out;
  },
};
