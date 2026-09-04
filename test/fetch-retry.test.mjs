import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchRetry } from "../core/env.mjs";

/** A fetch that answers from a script of statuses and counts the calls. */
function stub(statuses) {
  const calls = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    calls.push(init.method ?? "GET");
    const status = statuses[Math.min(calls.length - 1, statuses.length - 1)];
    return { ok: status < 400, status, headers: new Map([["retry-after", ""]]) };
  };
  return { calls, restore: () => (globalThis.fetch = real) };
}

test("a 429 is tried again", async () => {
  const s = stub([429, 429, 200]);
  const r = await fetchRetry("https://x", {}, 3);
  s.restore();
  assert.equal(r.status, 200);
  assert.equal(s.calls.length, 3);
});

test("a read survives a 500, a write does not repeat it", async () => {
  let s = stub([500, 200]);
  assert.equal((await fetchRetry("https://x", {}, 3)).status, 200);
  s.restore();

  s = stub([500, 200]);
  const w = await fetchRetry("https://x", { method: "POST" }, 3);
  s.restore();
  assert.equal(w.status, 500, "a write that may have landed is not sent twice");
  assert.equal(s.calls.length, 1);
});

test("a rate-limited write is repeated, because it never landed", async () => {
  const s = stub([429, 200]);
  const r = await fetchRetry("https://x", { method: "POST" }, 3);
  s.restore();
  assert.equal(r.status, 200);
});

test("it gives up with the last answer instead of hanging", async () => {
  const s = stub([429]);
  const r = await fetchRetry("https://x", {}, 2);
  s.restore();
  assert.equal(r.status, 429);
  assert.equal(s.calls.length, 2);
});
