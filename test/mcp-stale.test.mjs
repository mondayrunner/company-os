// A server that outlives an engine update says so when a tool fails.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { engineStamp, staleHint } from "../mcp/server.mjs";

test("staleHint: silent while the engine is as it was, loud once a module is newer", () => {
  const root = mkdtempSync(join(tmpdir(), "company-os-engine-"));
  mkdirSync(join(root, "core"));
  const file = join(root, "core", "link.mjs");
  writeFileSync(file, "export const a = 1;\n");
  utimesSync(file, new Date("2026-01-01"), new Date("2026-01-01"));
  const startedWith = engineStamp(root);
  assert.equal(staleHint(startedWith, engineStamp(root)), "");
  utimesSync(file, new Date("2026-01-02"), new Date("2026-01-02"));
  assert.match(staleHint(startedWith, engineStamp(root)), /Reconnect the company-os MCP server/);
});

test("engineStamp: a missing folder is not an error", () => {
  assert.equal(engineStamp(mkdtempSync(join(tmpdir(), "company-os-empty-"))), 0);
});
