/**
 * `company-os init`: a vault you can run a command against, not an empty room.
 *
 * The first version wrote a config and stopped. You then ran `index` on zero
 * files, `check` on nothing and `search` on an empty database, and had to guess
 * what the thing was for. So init writes the folders too, and `--example` fills
 * them with a small company that has a real problem in it: the first `check`
 * finds it. The demo is the explanation.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { DEFAULTS, CONFIG_FILE } from "./config.mjs";

const FOLDERS = ["knowledge", "accounts/leads", "accounts/customers", "inbox", "outputs", "transcripts/_inbox"];

/** The config a fresh vault starts with. Every path here matches FOLDERS. */
function starterConfig({ name, language }) {
  return {
    name,
    language,
    db: DEFAULTS.db,
    stateDir: DEFAULTS.stateDir,
    outputs: "outputs",
    ignore: ["node_modules", ".git", ".company-os"],
    kinds: [
      { kind: "knowledge", prefix: "knowledge/" },
      { kind: "account", pattern: "^accounts/[^/]+/" },
    ],
    accounts: {
      root: "accounts",
      sides: ["leads", "customers"],
      openSides: ["leads"],
      wonSides: ["customers"],
      statusFile: "STATUS.md",
      ballLine: "**Ball with:**",
    },
    transcripts: { inbox: "transcripts/_inbox" },
    connectors: { markdown: {}, status: {} },
    checks: { knowledge: { dir: "knowledge", slaDays: 60 }, docs: ["CLAUDE.md"] },
    ui: { title: name, panels: [] },
  };
}

const CLAUDE_MD = (name) => `# ${name}

The company brain. Markdown is the truth; \`.company-os/brain.db\` is a search
index built from it, and throwing it away costs nothing.

| Question | Where the answer lives |
|---|---|
| What we know | \`knowledge/\` |
| A customer or a lead | \`accounts/<side>/<name>/STATUS.md\` |
| What a job found, and what it wants from you | \`inbox/\` |

Rules:

- **Anything outward-facing is a proposal.** Sending, publishing, invoicing and
  deleting wait for a human who has seen the final version.
- **Do not copy a number a system already knows.** Ask the source. A copied
  figure is wrong the day after you paste it.
- Run \`company-os check\` when you change something structural. It says what
  broke before you find out the hard way.
`;

const README = (name) => `# ${name}

\`\`\`bash
company-os index     # read the markdown into the index
company-os search "…"  # find it back
company-os check     # what drifted
company-os status    # what is in the brain
\`\`\`

Add a source, a tile, a check or a job: see the company-os docs (\`docs/extending.md\`).
`;

// The example is one lead, one customer and a wiki page, with one thing wrong
// on purpose: the pipeline row says the ball is with them, the lead's status
// file says it is with you. `check` finds it on the first run. That is the
// whole idea in one command, which beats a paragraph explaining it.
const EXAMPLE = (today) => ({
  "knowledge/positioning.md": `---
status: current
last_verified: ${today}
---

# Positioning

We build the thing the customer cannot buy off the shelf. Not the cheapest and
not the biggest: the one they call when the standard answer does not fit.

Who we are not for: anyone shopping on price alone.
`,
  "accounts/customers/northwind/STATUS.md": `---
account: accounts/customers/northwind
status: active
---

# Northwind

**Ball with:** them

Running since March. Monthly retainer of €500.

## Log

- 2026-01-08 — renewed for another year.
`,
  "accounts/leads/harper-co/STATUS.md": `---
account: accounts/leads/harper-co
status: open
---

# Harper & Co

**Ball with:** you

Asked for a proposal on 4 January. Nothing sent yet.

## Log

- 2026-01-04 — first call.
`,
  "pipeline.md": `# Pipeline

Last update: 2026-01-08

## Active leads

| Since | Who | Stage | Next action | Ball |
|---|---|---|---|---|
| 2026-01-04 | Harper & Co | proposal | write the proposal | them |

## Recurring

Northwind pays €450 per month.
`,
});

export async function init(dir, { name = "My company", language = "en", example = false } = {}) {
  const file = join(dir, CONFIG_FILE);
  if (existsSync(file)) throw new Error(`${CONFIG_FILE} already exists in ${dir}`);

  const written = [];
  const put = async (rel, text) => {
    const target = join(dir, rel);
    await mkdir(join(target, ".."), { recursive: true });
    await writeFile(target, text);
    written.push(rel);
  };

  for (const f of FOLDERS) await mkdir(join(dir, f), { recursive: true });

  const config = starterConfig({ name, language });
  if (example) {
    config.pipeline = {
      file: "pipeline.md",
      updateLine: "Last update",
      logHeading: "## Log",
      leads: { heading: "## Active leads", columns: ["since", "who", "stage", "action", "ball"], who: "who", ball: "ball", action: "action" },
      ballSelf: ["you", "me", "us"],
    };
  }

  await put(CONFIG_FILE, JSON.stringify(config, null, 2) + "\n");
  await put("CLAUDE.md", CLAUDE_MD(name));
  await put("README.md", README(name));
  if (example) for (const [rel, text] of Object.entries(EXAMPLE(new Date().toISOString().slice(0, 10)))) await put(rel, text);

  return { dir, folders: FOLDERS, written, example };
}

/** What to do next, in the order that makes the thing explain itself. */
export function nextSteps({ example }) {
  return [
    "company-os index      read what is there",
    "company-os status     what the brain now holds",
    example ? "company-os check      finds the drift the example plants: the pipeline says the ball is with them, the account file says it is with you" : "company-os check      what drifted (nothing yet, in an empty vault)",
    'company-os search "…"  find it back',
    "",
    "Then: add your own markdown, connect a source (docs/extending.md), and put",
    "`company-os index` on a schedule with `company-os jobs install`.",
  ];
}
