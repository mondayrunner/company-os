import { test, before } from "node:test";
import assert from "node:assert/strict";
import { rmSync, cpSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadContext } from "../core/config.mjs";
import { openDb } from "../core/db.mjs";
import { indexAll } from "../core/index.mjs";
import { search } from "../core/search.mjs";
import { runChecks } from "../core/checks.mjs";

const fixture = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "company");
let root, ctx, db, result;

before(async () => {
  // Work on a copy: checks post inbox items and write reports into the root.
  root = mkdtempSync(join(tmpdir(), "company-os-checks-"));
  cpSync(fixture, root, { recursive: true });
  ctx = loadContext({ root });
  db = openDb(ctx);
  await indexAll(ctx, db);
  result = await runChecks(ctx, db, { live: false });
});

test("index finds documents and kinds", () => {
  const kinds = Object.fromEntries(db.prepare("SELECT kind, count(*) n FROM documents GROUP BY kind").all().map((r) => [r.kind, r.n]));
  assert.equal(kinds.knowledge, 1);
  assert.equal(kinds.account, 2);
  assert.equal(kinds.pipeline, 1);
});

test("search hits the pipeline", () => {
  assert.ok(search(db, "proposal").some((r) => r.path === "pipeline/pipeline.md"));
});

test("relations: files inside an account folder are part-of it", () => {
  const r = db.prepare("SELECT to_path FROM relations WHERE from_path = ? AND kind = 'part-of'").get("accounts/leads/2026-01-15-acme-website/STATUS.md");
  assert.equal(r.to_path, "accounts/leads/2026-01-15-acme-website");
});

const has = (check, part) => result.findings.some((f) => f.check === check && f.what.includes(part));

test("pipeline-freshness: header lags behind the log", () => assert.ok(has("pipeline-freshness", "2026-01-20")));
test("pipeline-accounts: Initech has no folder", () => assert.ok(has("pipeline-accounts", "Initech")));
test("ball-mismatch: Acme pipeline vs status", () => assert.ok(has("ball-mismatch", "Them")));
test("copied-figures: MRR outside the log", () => assert.ok(has("copied-figures", "MRR")));
test("knowledge-frontmatter: stale last_verified", () => assert.ok(has("knowledge-frontmatter", "days old")));
test("wikilinks: dead [[positioning]]", () => assert.ok(has("wikilinks", "positioning")));
test("doc-paths: dead playbook path", () => assert.ok(has("doc-paths", "playbooks/sales.md")));
test("subscriptions check skipped without a finance connector", () => assert.ok(result.skipped.some((s) => s.check === "subscriptions-vs-accounts")));

test("metrics survive losing the database: written to CSV, read back on index", async () => {
  const { writeMetrics } = await import("../core/index.mjs");
  const { writeMetricsFile, readMetricsFile } = await import("../core/index.mjs");
  writeMetrics(db, [{ date: "2026-01-01", key: "mrr", value: 4250 }, { date: "2026-01-02", key: "mrr", value: 4400 }]);
  const written = await writeMetricsFile(ctx, db);
  assert.equal(written.rows, 2);
  db.exec("DELETE FROM metrics");
  assert.equal(db.prepare("SELECT count(*) n FROM metrics").get().n, 0);
  assert.equal(await readMetricsFile(ctx, db), 2);
  assert.equal(db.prepare("SELECT value FROM metrics WHERE date='2026-01-02'").get().value, 4400);
});
