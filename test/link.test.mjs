// `company-os link` and the proposal the recordings connector writes: a name
// counts as a whole word, and only in what was said, never in our own header.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadContext } from "../core/config.mjs";
import { link, nameRe, spoken } from "../core/link.mjs";
import { listItems } from "../core/inbox.mjs";
import { setFrontmatter } from "../core/markdown.mjs";
import { frontmatter } from "../core/markdown.mjs";
import { proposal, wordCount } from "../connectors/paraspeech.mjs";

const fixture = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "company");
const globex = "accounts/customers/2026-02-01-globex-platform";
const index = new Map([["globex", { name: "globex", accounts: new Set([globex]), sources: new Set(["account-folder"]) }]]);

const file = (said, proposed = "") => [
  "---", "source: paraspeech", "kind: conversation", "date: 2026-09-06T10:00:00Z", "duration_s: 900", "app: Zoom", `account_proposal: [${proposed}]`, "account:", "---", "",
  "# Conversation 2026-09-06 10:00 · a talk…", "",
  proposed ? `Belongs to \`${proposed}\`? Set \`account:\` in the frontmatter to confirm.` : "No account recognised.",
  "", "## Transcript", "", said, "",
].join("\n");

let ctx, inbox;
// An empty `account:` parses as an empty list.
const account = (name) => { const a = frontmatter(readFileSync(join(inbox, name), "utf8")).meta.account; return Array.isArray(a) ? a[0] : a; };

before(() => {
  const root = mkdtempSync(join(tmpdir(), "company-os-link-"));
  cpSync(fixture, root, { recursive: true });
  mkdirSync(join(root, "connectors"), { recursive: true });
  writeFileSync(join(root, "connectors", "names.mjs"), `export const names = () => new Map([["globex", { name: "globex", accounts: new Set(["${globex}"]), sources: new Set(["account-folder"]) }]]);\n`);
  ctx = loadContext({ root });
  ctx.config.link.namesModule = "connectors/names.mjs";
  inbox = ctx.path(ctx.config.transcripts.inbox);
  mkdirSync(inbox, { recursive: true });
  // Said out loud: a real hit.
  writeFileSync(join(inbox, "2026-09-06-said.md"), file("We spoke with Globex about the renewal."));
  // Never said: the name is only in our own proposal line, and inside a longer word.
  writeFileSync(join(inbox, "2026-09-06-header.md"), file("A stage talk about globexology and nothing else.", globex));
});

test("nameRe: a whole word, not a part of one", () => {
  assert.ok(nameRe("north").test("we met north today"));
  assert.ok(nameRe("North").test("north."));
  assert.ok(!nameRe("north").test("the northern office"));
});

test("proposal: a name inside a longer word is not a proposal", () => {
  assert.deepEqual(proposal("the globexology of other things", index), []);
  assert.deepEqual(proposal("a call with Globex, again", index), [globex]);
});

test("spoken: everything from the first section on, or the whole body without one", () => {
  assert.equal(spoken("# Title\n\nBelongs to x?\n\n## Transcript\n\nhello"), "## Transcript\n\nhello");
  assert.equal(spoken("just text"), "just text");
});

test("wordCount: an open microphone is not a conversation", () => {
  assert.equal(wordCount("I pat  the\npatch"), 4);
  assert.equal(wordCount(""), 0);
});

test("link: attaches on what was said, and never on its own proposal line", async () => {
  const out = await link(ctx);
  assert.deepEqual(out.auto.map((a) => a.file), ["2026-09-06-said.md"]);
  assert.equal(account("2026-09-06-said.md"), globex);
  assert.ok(!account("2026-09-06-header.md"));
  assert.deepEqual(out.open.map((o) => o.file), ["2026-09-06-header.md"]);
});

test("link: a question closes by itself once its transcript is attached", async () => {
  const waiting = async () => (await listItems(ctx, { status: "open" })).filter((i) => i.from === "link").map((i) => i.where);
  assert.deepEqual(await waiting(), ["transcripts/_inbox/2026-09-06-header.md"]);
  // Answered by hand, outside the inbox.
  const file = join(inbox, "2026-09-06-header.md");
  writeFileSync(file, setFrontmatter(readFileSync(file, "utf8"), { account: "none" }));
  const out = await link(ctx);
  assert.equal(out.closed.length, 1);
  assert.deepEqual(await waiting(), []);
});
