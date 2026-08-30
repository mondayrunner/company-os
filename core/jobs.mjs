/**
 * Jobs: one list in the config, installed on whatever the machine has —
 * launchd (macOS), cron, or systemd user timers. Every job honours the same
 * status contract: a status file per run (written by the job itself, or by
 * `company-os jobs run` as a fallback when the job wrote none) and a log that
 * rotates at 2 MB.
 *
 *   "scheduler": { "logs": "~/Library/Logs", "logPrefix": "company-os-", "labelPrefix": "com.company-os." },
 *   "jobs": [
 *     { "name": "index",  "title": "Index the vault", "run": "company-os index", "cron": "45 7 * * 1-5" },
 *     { "name": "check",  "title": "Weekly checks",   "run": "company-os check", "cron": "0 8 * * 1", "label": "nl.example.check" },
 *     { "name": "ui",     "title": "Dashboard",       "run": "company-os ui",    "service": true }
 *   ]
 *
 * `cron` is standard five-field cron. `service: true` = keep running (KeepAlive / @reboot / Restart=always).
 */
import { mkdir, readFile, writeFile, stat, rename, readdir } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { existsSync } from "node:fs";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { dirname, join } from "node:path";
import { expandHome } from "./config.mjs";
import { writeStatus } from "./status.mjs";
import { normalizeStatus } from "../connectors/status.mjs";
const exec = promisify(execFile);

const DEFAULT_SCHEDULER = { logs: "~/.local/state/company-os/logs", logPrefix: "", labelPrefix: "com.company-os." };

export function schedulerOf(ctx) {
  const s = { ...DEFAULT_SCHEDULER, ...(ctx.config.scheduler ?? {}) };
  return { ...s, logs: ctx.path(expandHome(s.logs)) };
}

export function jobsOf(ctx) {
  const s = schedulerOf(ctx);
  return (ctx.config.jobs ?? []).map((j) => ({ ...j, label: j.label ?? `${s.labelPrefix}${j.name}`, log: join(s.logs, `${s.logPrefix}${j.name}.log`) }));
}

// One cron field → sorted list of ints, or null for "*". Supports n, a-b, a,b, star/n and a-b/n.
export function cronField(field, min, max) {
  if (field === "*" || field === undefined) return null;
  const out = new Set();
  for (const part of field.split(",")) {
    const m = part.match(/^(\*|\d+)(?:-(\d+))?(?:\/(\d+))?$/);
    if (!m) throw new Error(`bad cron field: ${field}`);
    const step = m[3] ? +m[3] : 1;
    let a = m[1] === "*" ? min : +m[1];
    let b = m[2] ? +m[2] : m[1] === "*" || m[3] ? max : a;
    for (let v = a; v <= b; v += step) out.add(v === 7 && max === 7 ? 0 : v);
  }
  return [...out].sort((x, y) => x - y);
}

export function parseCron(cron) {
  const f = cron.trim().split(/\s+/);
  if (f.length !== 5) throw new Error(`cron needs five fields: "${cron}"`);
  return { minute: cronField(f[0], 0, 59), hour: cronField(f[1], 0, 23), day: cronField(f[2], 1, 31), month: cronField(f[3], 1, 12), weekday: cronField(f[4], 0, 7) };
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Human-readable schedule, plus flags the dashboard uses to judge "too old". */
export function describeCron(cron) {
  const c = parseCron(cron);
  const hhmm = (c.hour ?? [0]).map((h) => `${String(h).padStart(2, "0")}:${String((c.minute ?? [0])[0]).padStart(2, "0")}`).join(", ");
  const wd = c.weekday ? c.weekday.join(",") : null;
  const weekdays = wd === "1,2,3,4,5";
  const weekly = !!c.weekday && c.weekday.length === 1 && !c.day;
  const monthly = !!c.day && c.day.length === 1 && !c.weekday;
  const text = weekdays ? `weekdays ${hhmm}` : weekly ? `${DAYS[c.weekday[0]]} ${hhmm}` : monthly ? `day ${c.day[0]} ${hhmm}` : c.weekday ? `${c.weekday.map((d) => DAYS[d]).join("/")} ${hhmm}` : `daily ${hhmm}`;
  return { text, weekdays, weekly, monthly };
}

/** launchd StartCalendarInterval: the cartesian product of the fixed fields. */
export function launchdCalendar(cron) {
  const c = parseCron(cron);
  let combos = [{}];
  for (const [key, vals] of [["Minute", c.minute], ["Hour", c.hour], ["Day", c.day], ["Month", c.month], ["Weekday", c.weekday]]) {
    if (!vals) continue;
    combos = combos.flatMap((o) => vals.map((v) => ({ ...o, [key]: v })));
  }
  return combos.length === 1 ? combos[0] : combos;
}

/** systemd OnCalendar from cron (weekday names, *-*-day hh:mm:ss). */
export function systemdCalendar(cron) {
  const c = parseCron(cron);
  const wd = c.weekday ? c.weekday.map((d) => DAYS[d]).join(",") + " " : "";
  const date = `${c.month ? c.month.join(",") : "*"}-${c.day ? c.day.join(",") : "*"}`;
  return `${wd}*-${date} ${(c.hour ?? ["*"]).join(",")}:${(c.minute ?? [0]).map((m) => String(m).padStart(2, "0")).join(",")}:00`;
}

const xml = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const plistValue = (v) => typeof v === "number" ? `<integer>${v}</integer>` : typeof v === "boolean" ? (v ? "<true/>" : "<false/>") : Array.isArray(v) ? `<array>${v.map(plistValue).join("")}</array>` : typeof v === "object" ? `<dict>${Object.entries(v).map(([k, x]) => `<key>${xml(k)}</key>${plistValue(x)}`).join("")}</dict>` : `<string>${xml(v)}</string>`;

function pathFor(ctx) {
  const extra = [dirname(process.execPath), join(ctx.home, ".local/bin"), "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"];
  return [...new Set(extra)].join(":");
}

function commandFor(ctx, job) {
  const bin = process.argv[1] && process.argv[1].endsWith("company-os.mjs") ? `${process.execPath} ${process.argv[1]}` : "company-os";
  return job.service ? `cd ${ctx.root} && ${job.run}` : `cd ${ctx.root} && exec ${bin} jobs run ${job.name}`;
}

export function renderLaunchd(ctx, job) {
  const dict = {
    Label: job.label, WorkingDirectory: ctx.root,
    EnvironmentVariables: { HOME: ctx.home, PATH: pathFor(ctx), COMPANY_OS_ROOT: ctx.root, ...(job.env ?? {}) },
    ProgramArguments: ["/bin/bash", "-lc", commandFor(ctx, job)],
    ...(job.service ? { KeepAlive: true, RunAtLoad: true } : { StartCalendarInterval: launchdCalendar(job.cron), RunAtLoad: !!job.runAtLoad }),
    StandardOutPath: job.log, StandardErrorPath: job.log,
  };
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">\n${plistValue(dict)}\n</plist>\n`;
}

export function renderCron(ctx, jobs) {
  const env = `PATH=${pathFor(ctx)}\nCOMPANY_OS_ROOT=${ctx.root}`;
  const lines = jobs.map((j) => `${j.service ? "@reboot" : j.cron} /bin/bash -lc '${commandFor(ctx, j).replace(/'/g, "'\\''")}' >> ${j.log} 2>&1`);
  return `# company-os:begin (generated by \`company-os jobs install --target cron\`; edit the config, not this block)\n${env}\n${lines.join("\n")}\n# company-os:end\n`;
}

export function renderSystemd(ctx, job) {
  const service = `[Unit]\nDescription=${job.title ?? job.name} (company-os)\n\n[Service]\nType=${job.service ? "simple" : "oneshot"}\nWorkingDirectory=${ctx.root}\nEnvironment=PATH=${pathFor(ctx)}\nEnvironment=COMPANY_OS_ROOT=${ctx.root}\nExecStart=/bin/bash -lc ${JSON.stringify(commandFor(ctx, job))}\nStandardOutput=append:${job.log}\nStandardError=append:${job.log}\n${job.service ? "Restart=always\nRestartSec=5\n\n[Install]\nWantedBy=default.target\n" : ""}`;
  const timer = job.service ? null : `[Unit]\nDescription=Timer for ${job.name} (company-os)\n\n[Timer]\nOnCalendar=${systemdCalendar(job.cron)}\nPersistent=true\n\n[Install]\nWantedBy=timers.target\n`;
  return { service, timer };
}

export function detectTarget() {
  if (process.platform === "darwin") return "launchd";
  if (existsSync("/run/systemd/system")) return "systemd";
  return "cron";
}

/** Generate the files for a target into <root>/.company-os/jobs/<target>/ and install them. */
/** launchd: PID of a running job, or null. */
async function launchdPid(uid, label) {
  const r = await exec("launchctl", ["list", label]).catch(() => null);
  const m = r?.stdout.match(/"PID"\s*=\s*(\d+)/);
  return m ? Number(m[1]) : null;
}

export async function install(ctx, { target = detectTarget(), only = null, dryRun = false, force = false } = {}) {
  const jobs = jobsOf(ctx).filter((j) => !only || j.name === only);
  const s = schedulerOf(ctx);
  await mkdir(s.logs, { recursive: true });
  const outDir = join(ctx.root, ".company-os", "jobs", target);
  await mkdir(outDir, { recursive: true });
  const done = [];
  if (target === "launchd") {
    const agents = join(ctx.home, "Library/LaunchAgents");
    await mkdir(agents, { recursive: true });
    const uid = process.getuid?.() ?? 501;
    for (const j of jobs) {
      const file = join(outDir, `${j.label}.plist`);
      await writeFile(file, renderLaunchd(ctx, j));
      if (dryRun) { done.push({ job: j.name, file }); continue; }
      const dest = join(agents, `${j.label}.plist`);
      // Reloading a job kills it if it is running right now (a 10-minute agent run at 08:15, say). Skip unless forced.
      const pid = j.service ? null : await launchdPid(uid, j.label);
      if (pid && !force) { done.push({ job: j.name, label: j.label, ok: false, skipped: true, error: `running (pid ${pid}); install again later or use --force` }); continue; }
      await writeFile(dest, renderLaunchd(ctx, j));
      await exec("launchctl", ["bootout", `gui/${uid}/${j.label}`]).catch(() => {});
      // bootout is asynchronous: a bootstrap right after it can fail with "Input/output error" while the old job is still unloading.
      let ok = false, error = null;
      for (let attempt = 0; attempt < 5 && !ok; attempt++) {
        if (attempt) await new Promise((r) => setTimeout(r, 1500 * attempt));
        try { await exec("launchctl", ["bootstrap", `gui/${uid}`, dest]); ok = true; error = null; }
        catch (e) { error = (e.stderr || e.message).toString().trim().split("\n")[0].slice(0, 200); if (/already loaded|service already/i.test(error)) { ok = true; error = null; } }
      }
      done.push({ job: j.name, label: j.label, file: dest, ok, error });
    }
  } else if (target === "cron") {
    const block = renderCron(ctx, jobs);
    const file = join(outDir, "crontab.txt");
    await writeFile(file, block);
    if (!dryRun) {
      const current = await exec("crontab", ["-l"]).then((r) => r.stdout).catch(() => "");
      const stripped = current.replace(/# company-os:begin[\s\S]*?# company-os:end\n?/g, "").trimEnd();
      const next = `${stripped}${stripped ? "\n\n" : ""}${block}`;
      const p = spawn("crontab", ["-"]); p.stdin.end(next);
      await new Promise((res, rej) => p.on("exit", (c) => (c === 0 ? res() : rej(new Error(`crontab exit ${c}`)))));
    }
    done.push(...jobs.map((j) => ({ job: j.name, file, ok: true })));
  } else if (target === "systemd") {
    const unitDir = join(ctx.home, ".config/systemd/user");
    await mkdir(unitDir, { recursive: true });
    for (const j of jobs) {
      const { service, timer } = renderSystemd(ctx, j);
      await writeFile(join(outDir, `${j.label}.service`), service);
      if (timer) await writeFile(join(outDir, `${j.label}.timer`), timer);
      if (dryRun) { done.push({ job: j.name, file: join(outDir, `${j.label}.service`) }); continue; }
      await writeFile(join(unitDir, `${j.label}.service`), service);
      if (timer) await writeFile(join(unitDir, `${j.label}.timer`), timer);
      let ok = true, error = null;
      try { await exec("systemctl", ["--user", "daemon-reload"]); await exec("systemctl", ["--user", "enable", "--now", timer ? `${j.label}.timer` : `${j.label}.service`]); } catch (e) { ok = false; error = (e.stderr || e.message).toString().trim().slice(0, 200); }
      done.push({ job: j.name, label: j.label, ok, error });
    }
  } else throw new Error(`unknown target ${target}`);
  return { target, generated: outDir, jobs: done };
}

export async function uninstall(ctx, { target = detectTarget(), only = null } = {}) {
  const jobs = jobsOf(ctx).filter((j) => !only || j.name === only);
  const uid = process.getuid?.() ?? 501;
  const done = [];
  for (const j of jobs) {
    if (target === "launchd") { await exec("launchctl", ["bootout", `gui/${uid}/${j.label}`]).catch(() => {}); await exec("rm", ["-f", join(ctx.home, "Library/LaunchAgents", `${j.label}.plist`)]).catch(() => {}); }
    if (target === "systemd") { await exec("systemctl", ["--user", "disable", "--now", `${j.label}.timer`]).catch(() => {}); await exec("systemctl", ["--user", "disable", "--now", `${j.label}.service`]).catch(() => {}); }
    done.push(j.name);
  }
  if (target === "cron") {
    const current = await exec("crontab", ["-l"]).then((r) => r.stdout).catch(() => "");
    const p = spawn("crontab", ["-"]); p.stdin.end(current.replace(/# company-os:begin[\s\S]*?# company-os:end\n?/g, ""));
    await new Promise((res) => p.on("exit", res));
  }
  return { target, removed: done };
}

/** Rotate a log above 2 MB: current → .1 (the previous .1 is dropped). */
export async function rotateLog(file, max = 2 * 1024 * 1024) {
  const st = await stat(file).catch(() => null);
  if (st && st.size > max) { await rename(file, `${file}.1`); await writeFile(file, `${new Date().toISOString()} · log rotated (previous in ${file.split("/").pop()}.1)\n`); }
}

/**
 * Run one job now under the status contract.
 *
 * The job's own status always wins. We only write one ourselves when the job
 * failed, or when it has never written a status at all — a job that exits 0
 * without touching its status is skipping on purpose (the daily plan already
 * exists, say), and overwriting that would erase the morning's real result.
 */
export async function runJob(ctx, name) {
  const job = jobsOf(ctx).find((j) => j.name === name);
  if (!job) throw new Error(`no job named ${name}`);
  await mkdir(dirname(job.log), { recursive: true });
  await rotateLog(job.log);
  const statusFile = join(ctx.stateDir, `${name}-status.json`);
  const before = (await stat(statusFile).catch(() => null))?.mtimeMs ?? 0;
  const started = Date.now();
  // Everything the job says goes to its log, whoever started it: the scheduler
  // redirects there anyway, and a run from the dashboard would otherwise vanish.
  const out = createWriteStream(job.log, { flags: "a" });
  out.write(`\n===== ${new Date().toISOString()} ${name} =====\n`);
  const code = await new Promise((resolve) => {
    const p = spawn("/bin/bash", ["-lc", job.run], { cwd: ctx.root, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, COMPANY_OS_ROOT: ctx.root, PATH: `${pathFor(ctx)}:${process.env.PATH ?? ""}`, ...(job.env ?? {}) } });
    for (const stream of [p.stdout, p.stderr]) {
      stream.pipe(out, { end: false });
      if (process.stdout.isTTY) stream.pipe(process.stdout, { end: false });
    }
    p.on("exit", (c) => resolve(c ?? 1));
    p.on("error", () => resolve(127));
  });
  await new Promise((r) => out.end(r));
  const after = (await stat(statusFile).catch(() => null))?.mtimeMs ?? 0;
  const wroteNothing = after <= before;
  const seconds = Math.round((Date.now() - started) / 1000);
  if (wroteNothing && code !== 0) await writeStatus(ctx, name, { result: "error", done: 0, failed: 1, message: `exit ${code} after ${seconds}s (the job wrote no status)` });
  else if (wroteNothing && !before) await writeStatus(ctx, name, { result: "ok", done: 1, failed: 0, message: `exit 0 after ${seconds}s (the job writes no status of its own)` });
  return code;
}

/** The list with the latest status per job. */
export async function listJobs(ctx) {
  const out = [];
  for (const j of jobsOf(ctx)) {
    // Through the same normalisation as everything else. A status file may
    // still be in the older Dutch vocabulary (the shell jobs write that), but
    // whoever reads it gets one set of words. Otherwise `jobs list` says
    // "fout" where the dashboard says "error".
    let raw = null;
    try { raw = JSON.parse(await readFile(join(ctx.stateDir, `${j.name}-status.json`), "utf8")); } catch {}
    const status = raw ? normalizeStatus(raw, j.name) : null;
    const d = j.service ? { text: "always on", weekdays: false, weekly: false, monthly: false } : describeCron(j.cron);
    out.push({ name: j.name, title: j.title ?? j.name, label: j.label, run: j.run, schedule: d.text, cron: j.cron ?? null, service: !!j.service, weekdays: d.weekdays, weekly: d.weekly, monthly: d.monthly, log: j.log,
      lastRun: status?.ts ?? null, result: status?.result ?? null, message: status?.message ?? null });
  }
  return out;
}
