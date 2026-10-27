// Shared helpers for the Claude Code hooks in this directory (see settings.json).
// Signal protocol: exit 2 + stderr is the only combination Claude sees; exit 0 = clean or nothing to check.
import { execFile, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/** Hook output is read by a model, not a terminal. */
export const PLAIN_ENV = { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0", CI: "1" };

/** ESLint covers these (eslint.config.js: TS/JS, React, eslint-plugin-astro, scripts/*.mjs). */
export const LINT_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".astro"];
/** Vitest related mode makes sense for modules, not for .astro pages. */
export const TEST_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs"];
/** A change to any of these can break lint or the unit suite. */
export const CODE_EXTENSIONS = [...LINT_EXTENSIONS, ".json"];

/** Tools are run from the checkout's own node_modules: a missing one fails visibly, never passes. */
export const TOOLS = {
  eslint: "node_modules/eslint/bin/eslint.js",
  vitest: "node_modules/vitest/vitest.mjs",
};

export function fail(message) {
  process.stderr.write(message.endsWith("\n") ? message : `${message}\n`);
  process.exit(2);
}

/** The payload, or {} for empty or unparseable stdin. */
export function readPayload() {
  let raw = "";
  try {
    raw = readFileSync(0, "utf8");
  } catch {
    return {};
  }
  try {
    const parsed = JSON.parse(raw);
    return parsed !== null && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function git(cwd, args) {
  try {
    return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

function samePath(a, b) {
  const norm = (p) => path.resolve(p).replace(/\\/g, "/").replace(/\/$/, "");
  return process.platform === "win32" ? norm(a).toLowerCase() === norm(b).toLowerCase() : norm(a) === norm(b);
}

export function toplevel(dir) {
  const top = git(dir, ["rev-parse", "--show-toplevel"]);
  return top ? path.resolve(top) : null;
}

function commonDir(dir) {
  return git(dir, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
}

/**
 * The checkout of the edited file, or null when it belongs to no repository or to another
 * repository than the session's (~/.claude, other projects). Any worktree of this repository counts.
 * Never $CLAUDE_PROJECT_DIR: after EnterWorktree, or for a sibling worktree, it names another checkout.
 */
export function editedFileCheckout(file, sessionCwd) {
  const root = toplevel(path.dirname(file));
  if (root === null) return null;
  const repo = commonDir(root);
  const sessionRepo = commonDir(sessionCwd);
  if (repo === null || sessionRepo === null || !samePath(repo, sessionRepo)) return null;
  return root;
}

/** The edited path from a Write/Edit payload, absolute, or null. */
export function editedFile(payload) {
  const input = payload.tool_input ?? {};
  const raw = input.file_path ?? input.notebook_path ?? input.path;
  if (typeof raw !== "string" || raw === "") return null;
  return path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(sessionCwd(payload), raw);
}

export function sessionCwd(payload) {
  return typeof payload.cwd === "string" && payload.cwd !== "" ? payload.cwd : process.cwd();
}

function sessionId(payload) {
  return typeof payload.session_id === "string" ? payload.session_id.replace(/[^A-Za-z0-9_-]/g, "") : "";
}

function registryPath(payload) {
  const sid = sessionId(payload);
  return sid === "" ? null : path.join(tmpdir(), "claude-hooks", `${sid}.roots`);
}

/** Remember a checkout the agent edited in, so the Stop hook sweeps it even when it is not the cwd. */
export function registerCheckout(payload, root) {
  const file = registryPath(payload);
  if (file === null) return;
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    appendFileSync(file, `${root}\n`);
  } catch {
    // The cwd checkout is swept anyway; a lost registry only narrows the sweep to it.
  }
}

/** The session's checkout plus every registered one, deduplicated. */
export function checkoutsToSweep(payload) {
  const roots = [];
  const add = (dir) => {
    if (!dir || !existsSync(dir)) return;
    const top = toplevel(dir);
    if (top !== null && !roots.some((r) => samePath(r, top))) roots.push(top);
  };
  add(sessionCwd(payload));
  const file = registryPath(payload);
  if (file !== null && existsSync(file)) {
    for (const line of readFileSync(file, "utf8").split(/\r?\n/)) add(line.trim());
  }
  return roots;
}

export function clearRegistry(payload) {
  const file = registryPath(payload);
  if (file !== null && existsSync(file)) writeFileSync(file, "");
}

/** Changed and untracked files of a checkout, relative to it. */
export function changedFiles(root) {
  const diff = git(root, ["diff", "--name-only", "HEAD"]) ?? "";
  const untracked = git(root, ["ls-files", "-o", "--exclude-standard"]) ?? "";
  return [...new Set(`${diff}\n${untracked}`.split(/\r?\n/).filter(Boolean))];
}

export function hasExtension(file, extensions) {
  return extensions.some((ext) => file.toLowerCase().endsWith(ext));
}

/**
 * Runs a tool's JS entry with this Node. Resolves { ok, output, missing }. Never rejects.
 * Output is ANSI-stripped and capped, so a flood of diagnostics stays readable.
 */
export function runTool(root, tool, args, timeoutMs) {
  const entry = path.join(root, TOOLS[tool]);
  if (!existsSync(entry)) {
    return Promise.resolve({ ok: false, missing: true, output: `${tool} is not installed (${TOOLS[tool]} missing in ${root}) — run npm ci.` });
  }
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [entry, ...args],
      { cwd: root, env: PLAIN_ENV, maxBuffer: 64 * 1024 * 1024, timeout: timeoutMs, windowsHide: true },
      (error, stdout, stderr) => {
        const output = cap(stripAnsi(`${stdout}${stderr}`).trim());
        if (error && error.killed) resolve({ ok: false, missing: false, output: `${tool} timed out after ${timeoutMs / 1000}s.\n${output}` });
        else resolve({ ok: !error, missing: false, output });
      },
    );
  });
}

function stripAnsi(text) {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "");
}

const MAX_LINES = 150;

function cap(text) {
  const lines = text.split(/\r?\n/);
  if (lines.length <= MAX_LINES) return text;
  return [...lines.slice(0, MAX_LINES), `… ${lines.length - MAX_LINES} more lines cut.`].join("\n");
}
