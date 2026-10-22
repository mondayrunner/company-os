import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../core/db.mjs";
import { writeRunsFile, readRunsFile } from "../core/index.mjs";

function vault() {
  const root = mkdtempSync(join(tmpdir(), "company-os-runs-"));
  const ctx = {
    root,
    dbPath: join(root, ".company-os", "brain.db"),
    path: (p) => (p.startsWith("/") ? p : join(root, p)),
    short: (p) => p.replace(root + "/", ""),
    config: { runsFile: "runs.jsonl" },
  };
  const db = openDb(ctx);
  return { root, ctx, db, clean: () => { try { db.close(); } catch {} rmSync(root, { recursive: true, force: true }); } };
}

const ins = (db, row) =>
  db.prepare("INSERT INTO events (ts, job, result, done, failed, message, json) VALUES (?,?,?,?,?,?,?)")
    .run(row.ts, row.job, row.result, row.done, row.failed, row.message, row.json ?? null);

test("a plain status row without extras is byte-identical to the old shape", async () => {
  const { ctx, db, clean } = vault();
  try {
    const base = { ts: "2026-03-01T10:00:00.000Z", job: "check", result: "ok", done: 3, failed: 0, message: "3 errors, 0 warnings, 0 new in inbox" };
    ins(db, base);
    // Old behaviour: SELECT without json, then JSON.stringify the row.
    const oldLine = JSON.stringify(base) + "\n";
    await writeRunsFile(ctx, db);
    const got = readFileSync(ctx.path("runs.jsonl"), "utf8");
    assert.equal(got, oldLine);
  } finally { clean(); }
});

test("extras from the json blob survive a write → read → write round-trip", async () => {
  const { ctx, db, clean } = vault();
  try {
    ins(db, {
      ts: "2026-03-01T11:00:00.000Z", job: "check", result: "ok", done: 2, failed: 0, message: "ok",
      json: JSON.stringify({ findings: 4, inbox_new: 1, contract_id: "c-9", done_when: "signed", score: 0.8 }),
    });
    await writeRunsFile(ctx, db);
    const written = JSON.parse(readFileSync(ctx.path("runs.jsonl"), "utf8").trim());
    assert.equal(written.findings, 4);
    assert.equal(written.inbox_new, 1);
    assert.equal(written.contract_id, "c-9");
    assert.equal(written.done_when, "signed");
    assert.equal(written.score, 0.8);
    assert.equal(written.job, "check");
    assert.equal("json" in written, false);

    // Fresh db: restore from the file, then rewrite and compare.
    db.exec("DELETE FROM events");
    const n = await readRunsFile(ctx, db);
    assert.equal(n, 1);
    const row = db.prepare("SELECT json FROM events").get();
    const blob = JSON.parse(row.json);
    assert.equal(blob.findings, 4);
    assert.equal(blob.inbox_new, 1);
    assert.equal(blob.contract_id, "c-9");

    await writeRunsFile(ctx, db);
    const again = JSON.parse(readFileSync(ctx.path("runs.jsonl"), "utf8").trim());
    assert.equal(again.findings, 4);
    assert.equal(again.inbox_new, 1);
    assert.equal(again.contract_id, "c-9");
    assert.equal(again.done_when, "signed");
    assert.equal(again.score, 0.8);
    assert.equal("json" in again, false);
  } finally { clean(); }
});

test("an extra that collides with a base field does not overwrite the base", async () => {
  const { ctx, db, clean } = vault();
  try {
    ins(db, {
      ts: "2026-03-01T12:00:00.000Z", job: "index", result: "ok", done: 1, failed: 0, message: "real",
      json: JSON.stringify({ result: "spoofed", message: "nope", findings: 1 }),
    });
    await writeRunsFile(ctx, db);
    const line = JSON.parse(readFileSync(ctx.path("runs.jsonl"), "utf8").trim());
    assert.equal(line.result, "ok");
    assert.equal(line.message, "real");
    assert.equal(line.findings, 1);
  } finally { clean(); }
});

test("invalid or empty json blobs are treated as no extras", async () => {
  const { ctx, db, clean } = vault();
  try {
    const base = { ts: "2026-03-01T13:00:00.000Z", job: "snapshot", result: "ok", done: 0, failed: 0, message: "" };
    ins(db, { ...base, json: "not-json" });
    await writeRunsFile(ctx, db);
    assert.equal(readFileSync(ctx.path("runs.jsonl"), "utf8"), JSON.stringify(base) + "\n");

    db.exec("DELETE FROM events");
    ins(db, { ...base, ts: "2026-03-01T13:01:00.000Z", json: "[]" });
    await writeRunsFile(ctx, db);
    assert.equal(readFileSync(ctx.path("runs.jsonl"), "utf8"), JSON.stringify({ ...base, ts: "2026-03-01T13:01:00.000Z" }) + "\n");
  } finally { clean(); }
});
