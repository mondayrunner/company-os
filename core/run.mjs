/**
 * Run a command-line agent headlessly and return its JSON result. Used by
 * `ask` and `link`. The agent is whatever `config.agent.command` says
 * (default: the `claude` CLI); the brain never needs an API key of its own.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { join } from "node:path";
const exec = promisify(execFile);

export function agentBinary(ctx) {
  const cmd = ctx.config.agent.command || "claude";
  if (cmd.includes("/")) return cmd;
  for (const p of [join(ctx.home, ".local/bin", cmd), join("/opt/homebrew/bin", cmd), join("/usr/local/bin", cmd)]) if (existsSync(p)) return p;
  return cmd;
}

export async function runAgent(ctx, prompt, { allowedTools = "", addDir = null, model = null, timeoutMs = 240000 } = {}) {
  const args = ["-p", prompt, "--output-format", "json", "--allowedTools", allowedTools];
  if (addDir) args.push("--add-dir", addDir);
  if (model) args.push("--model", model);
  const { stdout } = await exec(agentBinary(ctx), args, { timeout: timeoutMs, maxBuffer: 50 * 1024 * 1024, cwd: ctx.root });
  const j = JSON.parse(stdout.slice(stdout.indexOf("{")));
  return { result: String(j.result ?? "").trim(), cost: typeof j.total_cost_usd === "number" ? j.total_cost_usd : null };
}

export const fill = (template, vars) => template.replace(/\{\{(\w+)\}\}/g, (_, k) => (vars[k] ?? ""));
