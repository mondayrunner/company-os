import { test, before } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadContext } from "../core/config.mjs";
import { openDb } from "../core/db.mjs";
import { indexAll } from "../core/index.mjs";
import { search } from "../core/search.mjs";
import { account, accounts, canon } from "../core/brief.mjs";
import { tasks } from "../core/live.mjs";
import { runChecks } from "../core/checks.mjs";

// The example vault in examples/acme is what a newcomer runs first. This test
// keeps it honest: every command in its README has to keep working.
const example = join(dirname(fileURLToPath(import.meta.url)), "..", "examples", "acme");
let root, ctx, db;

before(async () => {
  root = mkdtempSync(join(tmpdir(), "company-os-example-"));
  cpSync(example, root, { recursive: true });
  ctx = loadContext({ root });
  db = openDb(ctx);
  await indexAll(ctx, db);
});

test("example: account harper answers in one call", async () => {
  const a = await account(ctx, db, "harper");
  assert.equal(a.name, "Harper & Co (website)");
  assert.match(a.ball, /^Us/);
  assert.equal(a.pipeline.lead.stage, "Proposal");
  // A copied vault has equal mtimes, so either contact moment may win the tie.
  assert.match(a.lastContact.path, /transcript-2026-08-14-call|mail-2026-08-20-proposal/);
});

test("example: accounts, canon, tasks, search", async () => {
  const rows = await accounts(ctx, db);
  assert.equal(rows.length, 3, "two leads and one customer; the partner is neither open nor won");
  assert.deepEqual((await canon(ctx, null)).keys.map((k) => k.key), ["pricing", "positioning", "compass", "company"]);
  assert.match((await canon(ctx, "pricing", { section: "build" })).text, /€3,000/);
  const t = await tasks(ctx);
  assert.equal(t.open, 3);
  assert.equal(search(db, "proposal", 8, ctx)[0].kind, "account");
});

test("example: check finds the planted ball mismatch", async () => {
  const r = await runChecks(ctx, db, { live: false });
  assert.ok(r.findings.some((f) => f.check === "ball-mismatch" && /harper/.test(f.where)));
});
