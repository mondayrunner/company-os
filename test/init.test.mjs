import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { init } from "../core/init.mjs";

async function fresh(opts) {
  const dir = await mkdtemp(join(tmpdir(), "os-init-"));
  const r = await init(dir, opts);
  return { dir, r, clean: () => rm(dir, { recursive: true, force: true }) };
}

test("init writes a config, the folders, a gitignore for the derived files and nothing else", async () => {
  const { dir, r, clean } = await fresh({ name: "Acme" });
  try {
    assert.deepEqual(r.written.sort(), [".gitignore", "CLAUDE.md", "README.md", "company-os.config.json"]);
    assert.match(await readFile(join(dir, ".gitignore"), "utf8"), /^\.company-os\/$/m);
    const cfg = JSON.parse(await readFile(join(dir, "company-os.config.json"), "utf8"));
    assert.equal(cfg.name, "Acme");
    assert.equal(cfg.language, "en");
    assert.equal(cfg.ui.title, "Acme");
    for (const f of r.folders) assert.ok((await readdir(join(dir, f))) !== undefined, `${f} exists`);
  } finally { await clean(); }
});

test("the example plants a drift the default checks can see", async () => {
  const { dir, clean } = await fresh({ name: "Acme", example: true });
  try {
    const cfg = JSON.parse(await readFile(join(dir, "company-os.config.json"), "utf8"));
    assert.equal(cfg.pipeline.file, "pipeline.md");
    const pipeline = await readFile(join(dir, "pipeline.md"), "utf8");
    const status = await readFile(join(dir, "accounts/leads/harper-co/STATUS.md"), "utf8");
    // The row says "them", the status file says "you". That disagreement is
    // the whole demo; if someone "fixes" one of them the first run says nothing.
    assert.match(pipeline, /\| Harper & Co \|.*\| them \|/);
    assert.match(status, /\*\*Ball with:\*\* you/);
  } finally { await clean(); }
});

test("init refuses to overwrite an existing vault", async () => {
  const { dir, clean } = await fresh({ name: "Acme" });
  try {
    await assert.rejects(() => init(dir, { name: "Other" }), /already exists/);
  } finally { await clean(); }
});
