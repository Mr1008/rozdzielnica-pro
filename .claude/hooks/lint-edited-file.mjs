#!/usr/bin/env node
// PostToolUse (Write|Edit): lint only the file the agent just edited, in its own checkout.
// No --fix: rewriting the file would make the agent's next Edit fail with "modified since read".
import {
  editedFile,
  editedFileCheckout,
  fail,
  hasExtension,
  LINT_EXTENSIONS,
  readPayload,
  registerCheckout,
  runTool,
  sessionCwd,
} from "./lib.mjs";
import { existsSync } from "node:fs";
import path from "node:path";

const payload = readPayload();
const file = editedFile(payload);
if (file === null || !hasExtension(file, LINT_EXTENSIONS) || !existsSync(file)) process.exit(0);

const root = editedFileCheckout(file, sessionCwd(payload));
if (root === null) process.exit(0);
registerCheckout(payload, root);

const rel = path.relative(root, file).split(path.sep).join("/");
// --no-warn-ignored: .claude/** and gitignored files are not ours to lint (eslint.config.js).
const result = await runTool(root, "eslint", ["--quiet", "--no-warn-ignored", rel], 55_000);
if (!result.ok) fail(`ESLint reported errors in ${rel}:\n${result.output}`);
process.exit(0);
