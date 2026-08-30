// One place for configuration. The root is the folder that holds
// company-os.config.json; everything else is relative to it. Markdown in the
// root is the canon; the database and the state folder are derived.
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Where company-os itself lives; private connectors import core modules from here. */
export const LIB = dirname(dirname(fileURLToPath(import.meta.url)));

export const HOME = homedir();
export const CONFIG_FILE = "company-os.config.json";

export const DEFAULTS = {
  name: "Company",
  language: "en",
  db: ".company-os/brain.db",
  stateDir: "~/.local/state/company-os",
  outputs: "outputs",
  ignore: ["node_modules", ".git", "_archive", ".company-os", ".obsidian"],
  // Ordered: first match wins. `prefix` or `pattern` (regex source).
  kinds: [
    { kind: "knowledge", prefix: "knowledge/" },
    { kind: "account", pattern: "^accounts/[^/]+/" },
    { kind: "pipeline", prefix: "pipeline/" },
    { kind: "contact", prefix: "contacts/" },
    { kind: "transcript", prefix: "transcripts/" },
  ],
  // Accounts (customers, leads, partners): one folder per relationship.
  accounts: { root: "accounts", sides: [], openSides: [], statusFile: "STATUS.md", ballLine: "**Ball with:**" },
  // Frontmatter keys, so existing vaults keep their own vocabulary.
  frontmatter: { account: ["account"], sources: ["sources"], linkedBy: ["linked_by"], proposal: ["account_proposal"], status: ["status"], lastVerified: ["last_verified"] },
  // Inline account references in the body, e.g. on contact pages.
  accountLine: ["**Account:**"],
  transcripts: { inbox: "transcripts/_inbox" },
  // Lines carrying these markers are already flagged by a human; checks stay quiet about them.
  markers: ["⚠️", "SUPERSEDED"],
  connectors: { markdown: {}, status: {} },
  checks: {},
  pipeline: null,
  // The headless agent for jobs that need one (link --smart, an approved inbox
  // item). Tools never call it; the agent you talk to does the thinking.
  agent: { command: "claude", model: null, timeoutMs: 240000 },
  // `refuseWords`: an approved item whose instruction reads like an outward
  // action is refused before it runs. Words, so another language can add its
  // own — the hard guarantee is the tool list in `runApproved`, not this list.
  inbox: { dir: "inbox", fromChecks: true, fromLink: true, refuseWords: ["send", "mail", "email", "e-mail", "publish", "post to", "invoice", "tweet", "payment", "pay"] },
  // Search reranking: words to ignore, how much each kind counts, and which
  // kinds are raw material (returned only on request or to fill up).
  search: { stopwords: null, weights: {}, raw: null },
  // Canonical files by short name: the one place a fact lives. `company-os canon pricing`.
  canon: {},
  link: { namesModule: null, extraAccountDirs: [], editors: "ghostty|cursor|sublime|iterm|terminal|claude|code", strongSources: null, weakSources: null },
};

export function expandHome(p) {
  return p && p.startsWith("~/") ? join(HOME, p.slice(2)) : p;
}

/** Walk up from `from` until a config file is found. */
export function findRoot(from = process.cwd()) {
  const env = process.env.COMPANY_OS_ROOT || process.env.COMPANY_OS;
  if (env && existsSync(join(expandHome(env), CONFIG_FILE))) return expandHome(env);
  let dir = resolve(from);
  for (;;) {
    if (existsSync(join(dir, CONFIG_FILE))) return dir;
    const up = dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

function merge(base, extra) {
  const out = { ...base };
  for (const [k, v] of Object.entries(extra ?? {})) {
    out[k] = v && typeof v === "object" && !Array.isArray(v) && base[k] && typeof base[k] === "object" && !Array.isArray(base[k]) ? merge(base[k], v) : v;
  }
  return out;
}

/**
 * Load the config and return a context object every command and connector
 * receives: root, config, and small path helpers.
 */
export function loadContext({ root: rootArg } = {}) {
  const root = rootArg ? resolve(expandHome(rootArg)) : findRoot();
  if (!root) throw new Error(`no ${CONFIG_FILE} found here or above; run \`company-os init\` or set COMPANY_OS_ROOT`);
  const file = join(root, CONFIG_FILE);
  let raw = {};
  try { raw = JSON.parse(readFileSync(file, "utf8")); } catch (e) { throw new Error(`${file}: ${e.message}`); }
  const config = merge(DEFAULTS, raw);
  const path = (rel) => (isAbsolute(rel) ? rel : resolve(root, expandHome(rel)));
  const sides = config.accounts.sides?.length ? `(?:${config.accounts.sides.join("|")})/` : "";
  const accountRe = new RegExp(`^(${config.accounts.root}/${sides}[^/]+)`);
  return {
    root, config, configFile: file, path,
    home: HOME, lib: LIB,
    dbPath: path(config.db),
    stateDir: path(expandHome(config.stateDir)),
    outputs: path(config.outputs),
    /** Account folder for a repo-relative path, or null. */
    accountOf: (rel) => rel.match(accountRe)?.[1] ?? null,
    accountRe,
    /** Document kind for a repo-relative path. */
    kindOf: (rel) => {
      for (const k of config.kinds) {
        if (k.prefix && rel.startsWith(k.prefix)) return k.kind;
        if (k.pattern && new RegExp(k.pattern).test(rel)) return k.kind;
      }
      return "other";
    },
    /** First frontmatter value found under any of the configured keys. */
    fm: (meta, which) => { for (const k of config.frontmatter[which] ?? []) if (meta[k] !== undefined) return meta[k]; return undefined; },
    short: (p) => p.replace(root + "/", "").replace(HOME, "~"),
  };
}

/** "nl" → "Dutch": the language agents write in, from the two-letter code in the config. */
export function languageName(code) {
  return { en: "English", nl: "Dutch", de: "German", fr: "French", es: "Spanish", it: "Italian", pt: "Portuguese" }[code] ?? code;
}
