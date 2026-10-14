#!/usr/bin/env node
// PostToolUse (Write|Edit): run the unit tests that depend on the edited module.
// `vitest related` exits 0 when no test depends on the file.
import {
  editedFile,
  editedFileCheckout,
  fail,
  hasExtension,
  readPayload,
  runTool,
  sessionCwd,
  TEST_EXTENSIONS,
} from "./lib.mjs";
import { existsSync } from "node:fs";
import path from "node:path";

const payload = readPayload();
const file = editedFile(payload);
if (file === null || !hasExtension(file, TEST_EXTENSIONS) || !existsSync(file)) process.exit(0);

const root = editedFileCheckout(file, sessionCwd(payload));
if (root === null) process.exit(0);

const rel = path.relative(root, file).split(path.sep).join("/");
// The unit config only: the integration suite needs a live Supabase (AGENTS.md, Tripwires).
const result = await runTool(root, "vitest", ["related", rel, "--run", "--config", "vitest.config.ts"], 55_000);
if (!result.ok) fail(`Unit tests related to ${rel} fail:\n${result.output}`);
process.exit(0);
