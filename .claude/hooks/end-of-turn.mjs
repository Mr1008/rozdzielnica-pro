#!/usr/bin/env node
// Stop: before the agent finishes, sweep every file this turn left changed — lint, the whole
// unit suite (~6 s, so all of it, not only related tests) and `astro check` — in every checkout
// the session touched. One retry: once sent back, the agent may finish; the commit gate and CI
// catch the rest. Also the net for files rewritten through Bash, which no per-edit hook sees.
import {
  changedFiles,
  checkoutsToSweep,
  clearRegistry,
  CODE_EXTENSIONS,
  hasExtension,
  LINT_EXTENSIONS,
  readPayload,
  runTool,
} from "./lib.mjs";
import { existsSync } from "node:fs";
import path from "node:path";

const payload = readPayload();

// Already sent back once by this hook (loop_count: Cursor, which imports .claude/settings.json).
if (payload.stop_hook_active === true || (typeof payload.loop_count === "number" && payload.loop_count > 0)) {
  process.exit(0);
}

const roots = checkoutsToSweep(payload);
if (roots.length === 0) {
  process.stdout.write(JSON.stringify({ systemMessage: "end-of-turn.mjs: no git checkout found, nothing checked." }));
  process.exit(0);
}

const reports = [];
for (const root of roots) {
  const changed = changedFiles(root);
  const code = changed.filter((f) => hasExtension(f, CODE_EXTENSIONS));
  if (code.length === 0) continue; // A Q&A or docs-only turn: nothing to typecheck or test.
  const lint = code.filter((f) => hasExtension(f, LINT_EXTENSIONS) && existsSync(path.join(root, f)));

  // Independent checks, in parallel: the turn waits for the slowest (astro check, ~45 s).
  const [eslint, vitest, astro] = await Promise.all([
    lint.length > 0
      ? runTool(root, "eslint", ["--quiet", "--no-warn-ignored", ...lint], 150_000)
      : Promise.resolve({ ok: true, output: "" }),
    runTool(root, "vitest", ["run", "--config", "vitest.config.ts"], 150_000),
    runTool(root, "astro", ["check", "--minimumSeverity", "error"], 150_000),
  ]);
  if (!eslint.ok) reports.push(`ESLint errors in changed files (${root}):\n${eslint.output}`);
  if (!vitest.ok) reports.push(`Unit tests fail — npm run test:unit (${root}):\n${vitest.output}`);
  if (!astro.ok) reports.push(`astro check fails (${root}):\n${astro.output}`);
}

if (reports.length > 0) {
  process.stderr.write(`Fix these before you finish:\n\n${reports.join("\n\n")}\n`);
  process.exit(2);
}
// Green: start the next turn with an empty registry.
clearRegistry(payload);
process.exit(0);
