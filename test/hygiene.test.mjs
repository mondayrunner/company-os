// Keeping the vault tidy: stale open accounts, a second status file, merged
// accounts still open, job tables that drifted from the config, and done
// inbox items that pile up. Plus the row → folder match these lean on.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, mkdirSync, writeFileSync, utimesSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadContext } from "../core/config.mjs";
import { openDb } from "../core/db.mjs";
import { indexAll } from "../core/index.mjs";
import { makeHelpers, rowFolder } from "../core/checks.mjs";
import { archiveDone, listItems, postItem, reply } from "../core/inbox.mjs";
import stale from "../checks/stale-accounts.mjs";
import duplicates from "../checks/duplicate-accounts.mjs";
import docsVsJobs, { jobTables } from "../checks/docs-vs-jobs.mjs";

const fixture = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "company");
const lead = "accounts/leads/2026-01-15-acme-website";
const old = new Date("2026-01-20T10:00:00Z");

let root, ctx, db;
const helpers = () => makeHelpers(ctx, db, []);

before(async () => {
  const base = mkdtempSync(join(tmpdir(), "company-os-hygiene-"));
  root = join(base, "vault");
  cpSync(fixture, root, { recursive: true });
  // The lead has not been written in since January.
  utimesSync(join(root, lead, "STATUS.md"), old, old);
  // A second lead that was merged into the first, still on the open side.
  mkdirSync(join(root, "accounts/leads/2026-02-01-acme-old"), { recursive: true });
  writeFileSync(join(root, "accounts/leads/2026-02-01-acme-old/STATUS.md"), "> ⚠️ SUPERSEDED: merged into `leads/2026-01-15-acme-website/`\n\n# Acme (old)\n\n**Ball with:** —\n");
  // A code repo next to the vault with its own status file.
  mkdirSync(join(base, "clients/acme-site"), { recursive: true });
  writeFileSync(join(base, "clients/acme-site/STATUS.md"), "# Acme site\n");
  mkdirSync(join(base, "clients/globex-site"), { recursive: true });
  writeFileSync(join(base, "clients/globex-site/README.md"), "# Globex site\n");
  // A README with a job table that drifted.
  writeFileSync(join(root, "README.md"), "# Vault\n\n## Jobs\n\n| Job | When | Does |\n|---|---|---|\n| `check` | Monday | checks |\n| `compaction` | Friday | proposals |\n\nText after.\n");
  ctx = loadContext({ root });
  ctx.config.link = { extraAccountDirs: ["../clients"] };
  ctx.config.jobs = [{ name: "check", run: "company-os check", cron: "0 8 * * 1" }, { name: "index", run: "company-os index", cron: "0 7 * * *" }];
  ctx.config.checks = { ...(ctx.config.checks ?? {}), docs: ["README.md"] };
  db = openDb(ctx);
  await indexAll(ctx, db);
});

test("rowFolder: a path in the row wins over a name that shares one word", () => {
  const folders = ["accounts/leads/2026-07-20-boatyard-vandenberg", "accounts/leads/2026-09-25-samuel-van-den-berg"];
  const row = { who: "Samuel van den Berg", stage: "two sites. See `leads/2026-09-25-samuel-van-den-berg/`" };
  assert.equal(rowFolder(row, row.who, folders), folders[1]);
  // Without a path: the best match across all folders, not the first that shares a word.
  assert.equal(rowFolder({ who: "Samuel van den Berg" }, "Samuel van den Berg", folders), folders[1]);
  // The first path in the row is the one it is about.
  const two = { who: "Globex", action: "see `2026-09-25-samuel-van-den-berg` and later `leads/2026-07-20-boatyard-vandenberg`" };
  assert.equal(rowFolder(two, "Globex", folders), folders[1]);
});

test("stale-accounts: drift without a park side, a move proposal with one", async () => {
  const out = await stale.run(ctx, helpers(), { days: 90 });
  const f = out.find((x) => x.where === lead);
  assert.ok(f, "the January lead is stale");
  assert.equal(f.kind, "drift");
  assert.match(f.what, /since 2026-01-20/);
  assert.ok(!out.some((x) => x.where.includes("acme-old")), "a folder written today is not stale");

  ctx.config.accounts.sides = [...ctx.config.accounts.sides, "parked"];
  const parked = await stale.run(ctx, helpers(), { days: 90, parkSide: "parked" });
  const p = parked.find((x) => x.where === lead);
  assert.equal(p.kind, "proposal");
  assert.deepEqual(p.action, { type: "move-file", inward: true, from: lead, to: "accounts/parked/2026-01-15-acme-website" });
  // A park side that is an open side, or not a side at all, is no park side.
  assert.equal((await stale.run(ctx, helpers(), { days: 90, parkSide: "leads" })).find((x) => x.where === lead).kind, "drift");
  assert.equal((await stale.run(ctx, helpers(), { days: 90, parkSide: "nowhere" })).find((x) => x.where === lead).kind, "drift");
  ctx.config.accounts.sides = ctx.config.accounts.sides.filter((s) => s !== "parked");
});

test("duplicate-accounts: a status file outside the root, a merged account still open", async () => {
  const out = await duplicates.run(ctx, helpers(), {});
  assert.ok(out.some((f) => f.where === "../clients/acme-site/STATUS.md"), "second status file in a code repo");
  assert.ok(!out.some((f) => f.where.includes("globex-site")), "a repo without a status file is fine");
  const merged = out.find((f) => f.where === "accounts/leads/2026-02-01-acme-old/STATUS.md");
  assert.ok(merged);
  assert.equal(merged.line, 1);
  assert.ok(!out.some((f) => f.where === `${lead}/STATUS.md`), "the live lead is not flagged");
});

test("docs-vs-jobs: a listed job that does not run, a running job that is not listed", async () => {
  assert.deepEqual(jobTables("| Job | When |\n|---|---|\n| `a` | x |\n| plain | y |\n").map((t) => t.rows.map((r) => r.name)), [["a"]]);
  const out = await docsVsJobs.run(ctx, helpers());
  assert.equal(out.length, 2);
  assert.match(out.find((f) => f.what.includes("compaction")).what, /not in `jobs`/);
  assert.equal(out.find((f) => f.what.includes("compaction")).line, 8);
  assert.match(out.find((f) => f.what.includes("`index`")).what, /does not mention it/);
  // No job table anywhere: nothing to compare.
  ctx.config.checks.docs = ["CLAUDE.md"];
  assert.deepEqual(await docsVsJobs.run(ctx, helpers()), []);
  ctx.config.checks.docs = ["README.md"];
});

test("archiveDone: old done items move to _done/<month>/; rejected, open and recent ones stay", async () => {
  const mk = async (title, status) => {
    const r = await postItem(ctx, { kind: "drift", from: "check", title });
    if (status !== "open") await reply(ctx, r.id, "", { status });
    return r.id;
  };
  const doneOld = await mk("old and done", "done");
  const rejectedOld = await mk("old and rejected", "rejected");
  const openOld = await mk("old and open", "open");
  const doneNew = await mk("new and done", "done");
  const dir = join(root, "inbox");
  for (const id of [doneOld, rejectedOld, openOld]) utimesSync(join(dir, `${id}.md`), old, old);
  // Backdate `created` as well: the month folder comes from it.
  const { readFileSync } = await import("node:fs");
  for (const id of [doneOld, rejectedOld, openOld]) {
    const file = join(dir, `${id}.md`);
    writeFileSync(file, readFileSync(file, "utf8").replace(/^created: .*$/m, "created: 2026-01-20T10:00:00.000Z"));
    utimesSync(file, old, old);
  }
  const moved = await archiveDone(ctx, { days: 14 });
  assert.deepEqual(moved, [doneOld]);
  assert.ok(existsSync(join(dir, "_done", "2026-01", `${doneOld}.md`)));
  const left = (await listItems(ctx)).map((i) => i.id);
  for (const id of [rejectedOld, openOld, doneNew]) assert.ok(left.includes(id), `${id} stays`);
  assert.ok(!left.includes(doneOld), "listItems does not read _done/");
  // The rejected twin still silences its finding.
  assert.equal((await postItem(ctx, { kind: "drift", from: "check", title: "old and rejected" })).created, false);
  assert.ok(readdirSync(join(dir, "_done", "2026-01")).length === 1);
});

test("autoApprovable brain-hygiene: only the narrow stale-accounts move", async () => {
  const { autoApprovable } = await import("../core/checks.mjs");
  const c = structuredClone(ctx.config);
  const cx = { ...ctx, config: { ...c, accounts: { ...c.accounts, sides: [...c.accounts.sides, "parked"] }, inbox: { autoApprove: ["brain-hygiene"] }, checks: { "stale-accounts": { parkSide: "parked" } } } };
  const ok = { check: "stale-accounts", auto: "brain-hygiene", action: { type: "move-file", inward: true, from: lead, to: "accounts/parked/2026-01-15-acme-website" } };
  assert.equal(autoApprovable(cx, ok), true);
  const bad = (patch) => autoApprovable(cx, { ...ok, ...patch, action: { ...ok.action, ...(patch.action ?? {}) } });
  assert.equal(bad({ check: "duplicate-accounts" }), false, "another check");
  assert.equal(bad({ action: { to: "accounts/parked/other-name" } }), false, "renamed on the way");
  assert.equal(bad({ action: { to: "accounts/customers/2026-01-15-acme-website" } }), false, "to a side that is not the park side");
  assert.equal(bad({ action: { from: "accounts/customers/2026-02-01-globex-platform", to: "accounts/parked/2026-02-01-globex-platform" } }), false, "from a side that is not open");
  assert.equal(bad({ action: { from: `${lead}/STATUS.md`, to: "accounts/parked/STATUS.md" } }), false, "a file, not a folder");
  assert.equal(bad({ action: { to: "accounts/parked/../../x" } }), false, "climbing out");
  assert.equal(bad({ action: { type: "edit-markdown" } }), false, "another action type");
  assert.equal(bad({ action: { append: "x" } }), false, "extra keys");
  assert.equal(autoApprovable({ ...cx, config: { ...cx.config, inbox: { autoApprove: [] } } }, ok), false, "not listed");
});
