// "Ball with" in the pipeline row must agree with the account's status file.
// Configure: pipeline.leads.ball (column), pipeline.ballSelf (words that mean
// "me"), accounts.statusFile, accounts.ballLine.
export default {
  name: "ball-mismatch",
  description: "who holds the ball: pipeline row vs status file",
  async run(ctx, h) {
    const p = ctx.config.pipeline, a = ctx.config.accounts;
    if (!p?.leads || !a.ballLine) return [];
    const self = new RegExp(`\\b(${(p.ballSelf ?? ["me", "us"]).join("|")})\\b`, "i");
    const rows = await h.pipelineLeads();
    const all = Object.values(await h.accountFolders()).flat();
    const out = [];
    for (const r of rows) {
      const who = h.clean(r[p.leads.who ?? "who"]);
      let ball = h.clean(r[p.leads.ball ?? "ball"]);
      const action = h.clean(r[p.leads.action ?? "action"]);
      if (!ball) ball = action.match(/^([A-Za-zÀ-ÿ]+)\s+[—-]\s+/)?.[1] ?? "";
      if (!ball) continue;
      const f = h.matchFolder(who, all);
      if (!f) continue;
      const statusRel = `${f}/${a.statusFile}`;
      if (!(await h.exists(statusRel))) continue;
      const text = await h.read(statusRel);
      const line = text.split("\n").find((l) => l.includes(a.ballLine));
      if (!line) continue;
      const statusBall = h.clean(line.split(a.ballLine)[1] ?? "").split(/[—–(:,.-]/)[0].trim();
      if (!statusBall) continue;
      if (self.test(ball) !== self.test(statusBall)) out.push({ severity: "warn", where: statusRel, what: `pipeline says ball with "${ball}", status file says "${statusBall}"`, text: line });
    }
    return out;
  },
};
