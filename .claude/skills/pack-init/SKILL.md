---
name: pack-init
description: Create an npm-based AI toolkit package skeleton that bundles skills, rules and installer logic for the Model 2 CodeArtifact delivery path.
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Glob
  - Grep
  - AskUserQuestion
---

# /pack-init — Initialize The AI Toolkit Package

You create the package skeleton that turns generated AI artifacts into a versioned npm package.

This is step two of the Model 2 pipeline from m5l4: once the team skill exists (for example `skills/code-review/SKILL.md` generated from `m5l4-shared-spec-skill.md` with any skill-authoring tool or by hand), this skill wraps the artifact in a package that can be published to AWS CodeArtifact. If no skill exists yet, scaffold `skills/code-review/SKILL.md` from `m5l4-shared-spec-skill.md` and `m5l4-shared-conventions.md` and tell the learner to review it before publishing.

## Inputs

Read these files when present:

The `m5l4-*.md` specs come from `10x get m5l4`, which writes them to your tool's prompts directory (`.claude/prompts/`, or `.cursor/prompts/`, `.github/prompts/`, `.agents/prompts/` for other tools). Look there first, then fall back to the repository root if the learner moved them.

- `m5l4-codeartifact-spec-cicd.md`
- `m5l4-codeartifact-spec-terraform.md`
- `m5l4-shared-spec-skill.md`
- `m5l4-shared-conventions.md`
- `context/spec-pack.md`
- `context/spec-cicd.md`
- `context/spec-terraform.md`

Also inspect existing generated artifacts:

- `skills/*/SKILL.md`
- `rules/CLAUDE.md`
- `commands/`
- `prompts/`

## Workflow

1. Confirm the package name and namespace.
   - Prefer values from specs.
   - Default lesson values are `@10xdevs/ai-toolkit` and namespace `10xdevs`.
2. Create `packages/ai-toolkit/` if it does not exist.
3. Copy or scaffold the artifact structure:

```text
packages/ai-toolkit/
├── package.json
├── pack.yaml
├── install.js
├── uninstall.js
├── bin/
│   └── cli.js
├── skills/
│   └── code-review/
│       └── SKILL.md
└── rules/
    └── CLAUDE.md
```

4. Add `package.json` with:
   - package name,
   - version,
   - `type`,
   - `files`,
   - `bin`,
   - `postinstall`,
   - Node engine (`"engines": { "node": ">=22" }`).
5. Add `pack.yaml` with at least:
   - `name`,
   - `version`,
   - `description`,
   - `namespace`.
6. Add installer behavior:
   - `npm install` mode may symlink from `node_modules`,
   - `npx <package> install` mode must copy files because the npx cache is temporary,
   - installed files must be tracked in a manifest,
   - uninstall must read the manifest instead of guessing paths.

## Safety Rules

- Do not hardcode personal machine paths.
- Do not write AWS secrets, tokens or account credentials into package files.
- Do not overwrite user-managed files without a sentinel block or explicit confirmation.
- Keep installer operations idempotent.

## Verification

Run when possible:

```bash
npm pack --dry-run
node -e "JSON.parse(require('fs').readFileSync('packages/ai-toolkit/package.json', 'utf8'))"
test -f packages/ai-toolkit/pack.yaml
```

If a generated package contains skills, verify every `SKILL.md` starts with valid frontmatter.
