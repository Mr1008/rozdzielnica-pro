# GitHub Packages CI/CD — Requirements

> **Default path for Zadanie 3.** This spec publishes the AI toolkit package to
> GitHub Packages. It deliberately avoids AWS, Terraform, IAM roles and
> CodeArtifact.

## Goal
Create a GitHub Actions workflow that validates and publishes the AI toolkit npm
package to GitHub Packages.

## Configuration
- Workflow file: `.github/workflows/publish-ai-toolkit.yml`
- Package location: repository root, unless the agent generated a monorepo
  layout; if so, use `packages/ai-toolkit/`
- Branch: support both `main` and `master`
- Node version: `24` (package `engines`: `>=22`)
- Registry: `https://npm.pkg.github.com`
- Package scope: `@twoj-zespol`

## Permissions
Use the ephemeral GitHub Actions token for publishing. Keep the workflow default
read-only and grant `packages: write` only to the publish job:

```yaml
permissions:
  contents: read

jobs:
  publish:
    permissions:
      contents: read
      packages: write
```

Pin every third-party action to a full commit SHA with the tag in a comment.

Do not require `AWS_ACCOUNT_ID`, `AWS_ROLE_ARN`, `id-token: write`, or any
CodeArtifact login step.

## Validation job
Before publishing, validate:
1. `package.json` exists and has `name`, `version`, `publishConfig.registry`.
2. `skills/code-review/SKILL.md` exists.
3. `SKILL.md` has YAML frontmatter with `name` and `description`.
4. The frontmatter `name` matches the skill directory name.
5. `npm pack --dry-run` succeeds.

The starter package has no dependencies and no lockfile, so do not run `npm ci`.

## Publish job
On push to `main` or `master`:
1. Check out the repository.
2. Set up Node with GitHub Packages registry and the package scope.
3. Skip publishing when `name@version` from `package.json` is already in the
   registry (`npm view`), so a push without a version bump does not fail on 409.
4. Publish with `NODE_AUTH_TOKEN: ${{ secrets.GITHUB_TOKEN }}`.

Starter shape:

```yaml
name: Publish AI Toolkit

on:
  push:
    branches: [main, master]
  pull_request:
    branches: [main, master]

permissions:
  contents: read

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
      - uses: actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0
        with:
          node-version: 24
      - run: test -f skills/code-review/SKILL.md
      - run: npm pack --dry-run

  publish:
    needs: validate
    if: github.event_name == 'push'
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
      - uses: actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0
        with:
          node-version: 24
          registry-url: "https://npm.pkg.github.com"
          scope: "@twoj-zespol"
      - run: npm publish --ignore-scripts
        env:
          NODE_AUTH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

## Consumer CI note
Consumer repositories that install this private package need read auth. Use a
separate `GH_PKG_TOKEN` secret for third-party CI or cross-org consumers. Same-org
GitHub Actions may be able to use repository/package permissions instead, but do
not assume every build platform can see GitHub's token.
