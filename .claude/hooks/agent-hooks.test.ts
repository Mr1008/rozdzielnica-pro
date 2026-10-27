import { execFile, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, it } from "vitest";

/**
 * Proof for the Claude Code hooks in `.claude/settings.json` (10x-configure-hook, Step 7). Each case
 * pipes a payload into the real script and asserts the exit code and the channel: exit 2 + stderr is
 * the only signal Claude sees. Work happens in throwaway git repos whose `node_modules` hold stub
 * ESLint / Vitest entries that react to markers (LINT_ERROR, TEST_FAIL) — git and
 * the scripts are real, only the slow tools are stubbed. Every stub run is appended to `tools.log`.
 */

const HOOKS = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HOOKS, "..", "..");
const LINT = path.join(HOOKS, "lint-edited-file.mjs");
const RELATED = path.join(HOOKS, "related-tests.mjs");
const STOP = path.join(HOOKS, "end-of-turn.mjs");

const STUB_HEADER = `
const fs = require("node:fs");
const path = require("node:path");
fs.appendFileSync(path.join(process.cwd(), "tools.log"), TOOL + " " + process.argv.slice(2).join(" ") + "\\n");
function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);
}
function hits(files, marker) {
  return files.filter((f) => fs.existsSync(f) && fs.readFileSync(f, "utf8").includes(marker));
}
`;

const STUBS: Record<string, string> = {
  "node_modules/eslint/bin/eslint.js": `const TOOL = "eslint";${STUB_HEADER}
const bad = hits(process.argv.slice(2).filter((a) => !a.startsWith("--")), "LINT_ERROR");
for (const f of bad) console.log(f + "  1:1  error  'LINT_ERROR' is defined but never used  no-unused-vars");
process.exit(bad.length > 0 ? 1 : 0);
`,
  "node_modules/vitest/vitest.mjs": `import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const TOOL = "vitest";${STUB_HEADER}
const args = process.argv.slice(2);
const files = args[0] === "related" ? [args[1]] : walk("src");
const bad = hits(files, "TEST_FAIL");
for (const f of bad) console.log("FAIL " + f + " > AssertionError: expected 1 to be 2");
process.exit(bad.length > 0 ? 1 : 0);
`,
};

const temps: string[] = [];
afterAll(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function git(cwd: string, ...args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("git", ["-c", "user.email=hooks@test", "-c", "user.name=hooks", "-C", cwd, ...args], (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout);
    });
  });
}

function write(file: string, content: string): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content);
}

function installStubs(root: string): void {
  for (const [rel, code] of Object.entries(STUBS)) write(path.join(root, rel), code);
}

/** A committed, clean repo with stub tools. */
async function makeRepo(): Promise<string> {
  const root = mkdtempSync(path.join(tmpdir(), "agent-hooks-"));
  temps.push(root);
  await git(root, "init", "-q");
  write(path.join(root, ".gitignore"), "node_modules/\ntools.log\n");
  write(path.join(root, "src", "ok.ts"), "export const ok = 1;\n");
  write(path.join(root, "README.md"), "# fixture\n");
  await git(root, "add", "-A");
  await git(root, "commit", "-q", "-m", "baseline");
  installStubs(root);
  return root;
}

interface Run {
  status: number | null;
  stdout: string;
  stderr: string;
}

function run(script: string, stdin: string, cwd: string, env: Record<string, string> = {}): Promise<Run> {
  return spawnRun(process.execPath, [script], stdin, cwd, env);
}

function spawnRun(command: string, args: string[], stdin: string, cwd: string, env: Record<string, string>): Promise<Run> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env: { ...process.env, ...env }, timeout: 30_000 });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    child.on("error", reject);
    child.on("close", (status) => {
      resolve({ status, stdout, stderr });
    });
    child.stdin.end(stdin);
  });
}

function edit(file: string, cwd: string, sessionId = uniqueSession()): string {
  return JSON.stringify({
    session_id: sessionId,
    cwd,
    hook_event_name: "PostToolUse",
    tool_name: "Edit",
    tool_input: { file_path: file },
  });
}

function stop(cwd: string, active = false, sessionId = uniqueSession()): string {
  return JSON.stringify({ session_id: sessionId, cwd, hook_event_name: "Stop", stop_hook_active: active });
}

function toolsLog(root: string): string {
  const file = path.join(root, "tools.log");
  return existsSync(file) ? readFileSync(file, "utf8") : "";
}

function uniqueSession(): string {
  return `t${String(Date.now())}${String(Math.floor(Math.random() * 1e6))}`;
}

describe.concurrent("lint-edited-file.mjs (PostToolUse)", { timeout: 30_000 }, () => {
  it("blocks with exit 2 and names the file and the problem on a lint error", async ({ expect }) => {
    const root = await makeRepo();
    const file = path.join(root, "src", "bad.ts");
    write(file, "const LINT_ERROR = 1;\n");
    const result = await run(LINT, edit(file, root), root);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("src/bad.ts");
    expect(result.stderr).toContain("LINT_ERROR");
  });

  it("passes silently on a clean file, linting only that file", async ({ expect }) => {
    const root = await makeRepo();
    write(path.join(root, "src", "other.ts"), "const LINT_ERROR = 1;\n");
    const result = await run(LINT, edit(path.join(root, "src", "ok.ts"), root), root);
    expect(result).toMatchObject({ status: 0, stderr: "" });
    expect(toolsLog(root)).toContain("src/ok.ts");
    expect(toolsLog(root)).not.toContain("other.ts");
  });

  it("covers .astro files", async ({ expect }) => {
    const root = await makeRepo();
    const file = path.join(root, "src", "pages", "index.astro");
    write(file, "---\nconst LINT_ERROR = 1;\n---\n");
    expect((await run(LINT, edit(file, root), root)).status).toBe(2);
  });

  it("skips files the linter does not cover, and files that do not exist", async ({ expect }) => {
    const root = await makeRepo();
    expect((await run(LINT, edit(path.join(root, "README.md"), root), root)).status).toBe(0);
    expect((await run(LINT, edit(path.join(root, "src", "gone.ts"), root), root)).status).toBe(0);
    expect(toolsLog(root)).toBe("");
  });

  it("treats empty, unparseable and path-less payloads as nothing to check", async ({ expect }) => {
    const root = await makeRepo();
    for (const stdin of ["", "{}", "not json", JSON.stringify({ tool_name: "Bash", tool_input: { command: "ls" } })]) {
      expect((await run(LINT, stdin, root)).status).toBe(0);
      expect((await run(RELATED, stdin, root)).status).toBe(0);
    }
  });

  it("resolves a relative path against the payload cwd", async ({ expect }) => {
    const root = await makeRepo();
    write(path.join(root, "src", "bad.ts"), "const LINT_ERROR = 1;\n");
    const elsewhere = await makeRepo();
    expect((await run(LINT, edit("src/bad.ts", root), elsewhere)).status).toBe(2);
  });

  it("skips a broken file of another repository", async ({ expect }) => {
    const session = await makeRepo();
    const other = await makeRepo();
    const file = path.join(other, "src", "bad.ts");
    write(file, "const LINT_ERROR = 1;\n");
    expect((await run(LINT, edit(file, session), session)).status).toBe(0);
  });

  it("ignores a $CLAUDE_PROJECT_DIR that points at another, broken checkout", async ({ expect }) => {
    const session = await makeRepo();
    const stale = await makeRepo();
    write(path.join(stale, "src", "ok.ts"), "const LINT_ERROR = 1;\n");
    const result = await run(LINT, edit(path.join(session, "src", "ok.ts"), session), session, { CLAUDE_PROJECT_DIR: stale });
    expect(result.status).toBe(0);
  });

  it("fails visibly when ESLint is not installed", async ({ expect }) => {
    const root = await makeRepo();
    rmSync(path.join(root, "node_modules", "eslint"), { recursive: true });
    const result = await run(LINT, edit(path.join(root, "src", "ok.ts"), root), root);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("not installed");
  });
});

describe.concurrent("related-tests.mjs (PostToolUse)", { timeout: 30_000 }, () => {
  it("blocks when a test related to the edited module fails", async ({ expect }) => {
    const root = await makeRepo();
    const file = path.join(root, "src", "math.ts");
    write(file, "export const two = 1; // TEST_FAIL\n");
    const result = await run(RELATED, edit(file, root), root);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("src/math.ts");
    expect(toolsLog(root)).toContain("--config vitest.config.ts");
  });

  it("passes on a clean module and skips .astro and missing files", async ({ expect }) => {
    const root = await makeRepo();
    expect(await run(RELATED, edit(path.join(root, "src", "ok.ts"), root), root)).toMatchObject({ status: 0, stderr: "" });
    expect((await run(RELATED, edit(path.join(root, "src", "page.astro"), root), root)).status).toBe(0);
    expect((await run(RELATED, edit(path.join(root, "src", "gone.ts"), root), root)).status).toBe(0);
  });

  it("fails visibly when Vitest is not installed", async ({ expect }) => {
    const root = await makeRepo();
    rmSync(path.join(root, "node_modules", "vitest"), { recursive: true });
    expect((await run(RELATED, edit(path.join(root, "src", "ok.ts"), root), root)).status).toBe(2);
  });
});

describe.concurrent("end-of-turn.mjs (Stop)", { timeout: 30_000 }, () => {
  it("passes without running any check when nothing changed", async ({ expect }) => {
    const root = await makeRepo();
    expect(await run(STOP, stop(root), root)).toMatchObject({ status: 0, stderr: "" });
    expect(toolsLog(root)).toBe("");
  });

  it("passes without running any check on a docs-only turn", async ({ expect }) => {
    const root = await makeRepo();
    write(path.join(root, "README.md"), "# changed\n");
    expect((await run(STOP, stop(root), root)).status).toBe(0);
    expect(toolsLog(root)).toBe("");
  });

  it("passes on a clean change after running lint and unit tests, never astro check", async ({ expect }) => {
    const root = await makeRepo();
    write(path.join(root, "src", "ok.ts"), "export const ok = 2;\n");
    expect(await run(STOP, stop(root), root)).toMatchObject({ status: 0, stderr: "" });
    const log = toolsLog(root);
    expect(log).toContain("eslint");
    expect(log).toContain("vitest run --config vitest.config.ts");
    expect(log).not.toContain("astro");
  });

  it("blocks on a lint error written through the shell, which no per-edit hook saw", async ({ expect }) => {
    const root = await makeRepo();
    write(path.join(root, "src", "shell.ts"), "const LINT_ERROR = 1;\n");
    const result = await run(STOP, stop(root), root);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("src/shell.ts");
  });

  it("blocks on a lint error and a failing unit test, in one message", async ({ expect }) => {
    const root = await makeRepo();
    write(path.join(root, "src", "ok.ts"), "const LINT_ERROR = 1; // TEST_FAIL\n");
    const result = await run(STOP, stop(root), root);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("ESLint errors");
    expect(result.stderr).toContain("Unit tests fail");
  });

  it("lets the agent finish on the retry, even with the error still present", async ({ expect }) => {
    const root = await makeRepo();
    write(path.join(root, "src", "shell.ts"), "const LINT_ERROR = 1;\n");
    expect((await run(STOP, stop(root, true), root)).status).toBe(0);
    expect((await run(STOP, JSON.stringify({ cwd: root, loop_count: 1 }), root)).status).toBe(0);
  });

  it("treats an unparseable payload as the process cwd", async ({ expect }) => {
    const root = await makeRepo();
    expect((await run(STOP, "not json", root)).status).toBe(0);
    write(path.join(root, "src", "shell.ts"), "const LINT_ERROR = 1;\n");
    expect((await run(STOP, "not json", root)).status).toBe(2);
  });

  it("ignores a $CLAUDE_PROJECT_DIR that points at another, broken checkout", async ({ expect }) => {
    const session = await makeRepo();
    const stale = await makeRepo();
    write(path.join(stale, "src", "bad.ts"), "const LINT_ERROR = 1;\n");
    expect((await run(STOP, stop(session), session, { CLAUDE_PROJECT_DIR: stale })).status).toBe(0);
  });

  it("sweeps a sibling worktree the session edited in", async ({ expect }) => {
    const session = await makeRepo();
    const worktree = path.join(mkdtempSync(path.join(tmpdir(), "agent-hooks-wt-")), "wt");
    temps.push(path.dirname(worktree));
    await git(session, "worktree", "add", "-q", worktree);
    installStubs(worktree);
    const file = path.join(worktree, "src", "bad.ts");
    write(file, "const LINT_ERROR = 1;\n");
    const sid = uniqueSession();

    expect((await run(LINT, edit(file, session, sid), session)).status).toBe(2);
    const result = await run(STOP, stop(session, false, sid), session);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("src/bad.ts");
    await git(session, "worktree", "remove", "--force", worktree);
  });

  it("fails visibly when vitest is not installed", async ({ expect }) => {
    const root = await makeRepo();
    rmSync(path.join(root, "node_modules", "vitest"), { recursive: true });
    write(path.join(root, "src", "ok.ts"), "export const ok = 2;\n");
    const result = await run(STOP, stop(root), root);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("vitest is not installed");
  });
});

/** Git Bash on Windows (Claude Code's hook shell), plain bash elsewhere; null when not found. */
function hookShell(): string | null {
  if (process.platform !== "win32") return "bash";
  const candidates = [process.env.CLAUDE_CODE_GIT_BASH_PATH, "C:\\Program Files\\Git\\bin\\bash.exe"];
  return candidates.find((c): c is string => c !== undefined && existsSync(c)) ?? null;
}

describe.concurrent("settings.json commands", { timeout: 30_000 }, () => {
  const settings = JSON.parse(readFileSync(path.join(REPO_ROOT, ".claude", "settings.json"), "utf8")) as {
    hooks: Record<string, { hooks: { command: string; timeout: number }[] }[]>;
  };
  const commands = Object.values(settings.hooks).flatMap((groups) => groups.flatMap((g) => g.hooks));
  const shell = hookShell();

  it("registers the per-edit and end-of-turn hooks with timeouts in seconds", async ({ expect }) => {
    expect(Object.keys(settings.hooks).sort()).toEqual(["PostToolUse", "Stop"]);
    for (const hook of commands) expect(hook.timeout).toBeLessThanOrEqual(600);
  });

  it.skipIf(shell === null)("reach their script from a subdirectory with a stale $CLAUDE_PROJECT_DIR", async ({ expect }) => {
    for (const hook of commands) {
      const result = await spawnRun(
        shell ?? "bash",
        ["-c", hook.command],
        JSON.stringify({ tool_name: "Bash", tool_input: { command: "ls" }, stop_hook_active: true }),
        HOOKS,
        { CLAUDE_PROJECT_DIR: path.join(tmpdir(), "does-not-exist") },
      );
      expect({ command: hook.command, status: result.status, stderr: result.stderr }).toEqual({
        command: hook.command,
        status: 0,
        stderr: "",
      });
    }
  });
});
