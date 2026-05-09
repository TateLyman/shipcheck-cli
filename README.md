# shipcheck-cli

[![npm version](https://img.shields.io/npm/v/shipcheck-cli.svg)](https://www.npmjs.com/package/shipcheck-cli)
[![ci](https://github.com/TateLyman/shipcheck-cli/actions/workflows/ci.yml/badge.svg)](https://github.com/TateLyman/shipcheck-cli/actions/workflows/ci.yml)
[![shipcheck](https://github.com/TateLyman/shipcheck-cli/actions/workflows/shipcheck.yml/badge.svg)](https://github.com/TateLyman/shipcheck-cli/actions/workflows/shipcheck.yml)

Release-readiness and app exposure scanner for JavaScript and TypeScript repositories.

`shipcheck` inspects a repo before you publish, hand it to a client, or ask someone to review it. It catches the boring issues that make projects feel unfinished: missing CI, missing lockfiles, thin documentation, loose dependency versions, unsafe package scripts, and local environment-file hygiene problems.

It also checks common failure points in modern full-stack apps built with tools such as Lovable, Bolt, Replit, Cursor, v0, Base44, Supabase, Firebase, and Stripe: exposed private keys, public frontend env vars that look private, unsigned Stripe webhooks, missing Firebase rules, undocumented Supabase RLS, debug API routes, and missing usage guardrails.

For MCP packages, Shipcheck also checks launch metadata that directories and clients increasingly expect: `mcpName`, `server.json`, pinned package versions, npm package mapping, copyable install config, smoke-test proof, remote auth notes, and basic tool-safety documentation.

Tool page: https://tateprograms.com/shipcheck.html

Free MCP launch self-check: https://tateprograms.com/mcp-self-check.html

MCP directory launch checklist: https://tateprograms.com/mcp-directory-checklist.html

Paid MCP launch check: https://tateprograms.com/mcp-launch-review.html

## Install

Run from npm:

```bash
npx --yes shipcheck-cli .
```

Or install/build locally:

```bash
npm install
npm run build
```

Run locally:

```bash
node dist/src/cli.js .
```

After publishing or linking:

```bash
shipcheck ../my-app --format markdown
```

## Usage

```bash
shipcheck [path] [--format text|markdown|json|sarif] [--fail-on info|low|medium|high] [--strict]
```

Examples:

```bash
shipcheck
shipcheck ../client-app --format markdown
shipcheck . --strict --fail-on medium
shipcheck . --format sarif > shipcheck.sarif
```

## GitHub Action

Action repo: https://github.com/TateLyman/shipcheck-action

MCP server: https://www.npmjs.com/package/shipcheck-mcp

Add Shipcheck as a release gate in any JS/TS repo:

```yaml
name: shipcheck

on:
  pull_request:
  push:
    branches:
      - main

jobs:
  shipcheck:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: TateLyman/shipcheck-action@v1
        with:
          fail-on: medium
          strict: true
```

The action runs the npm package with `npx`, so target repos do not need to add Shipcheck as a dependency.

## MCP Server

Use Shipcheck from MCP clients:

```json
{
  "mcpServers": {
    "shipcheck": {
      "command": "npx",
      "args": ["--yes", "--package", "shipcheck-mcp", "shipcheck-mcp"]
    }
  }
}
```

## What It Checks

- `package.json` exists and has repeatable `test` and `build` scripts
- dangerous package scripts such as broad `rm -rf`, `sudo`, `curl | bash`, and force pushes
- loose dependency versions such as `latest`, `*`, direct URLs, and Git dependencies
- dependency lockfile presence and package-manager consistency
- npm publish workflows that still depend on long-lived registry tokens instead of trusted publishing/OIDC
- README depth, license declaration, and `.gitignore` hygiene
- GitHub Actions workflow presence
- TypeScript files without `tsconfig.json`
- `.env` risk and missing `.env.example` when environment variables are used
- hardcoded private-looking secrets such as Stripe secret keys and provider API keys
- public frontend env names that include `SECRET`, `SERVICE`, `PRIVATE`, `TOKEN`, or `WEBHOOK`
- Stripe webhook handlers that do not visibly verify signatures
- Firebase usage without checked-in `firestore.rules` or `storage.rules`
- Supabase usage without visible RLS migrations, policy notes, or access-boundary proof
- debug, seed, reset, mock, or test API routes that may ship to production
- external API usage without obvious rate limits, quotas, throttling, or cost guardrails
- MCP package metadata gaps such as missing `mcpName`, missing `server.json`, unpinned registry package versions, missing install config, missing smoke-test proof, undocumented remote auth boundaries, or unclear tool-safety notes

Shipcheck is a defensive static scanner, not a penetration test. It looks for review gaps and risky patterns in repos you own or are authorized to inspect.

## Output

Text output is designed for terminal use:

```text
Shipcheck report: /work/my-app
Score: 78/100
Status: pass
Findings: 0 high, 2 medium, 1 low, 0 info
```

Markdown output is designed for client handoff:

```bash
shipcheck ../my-app --format markdown > shipcheck-report.md
```

JSON output is designed for automation:

```bash
shipcheck . --format json
```

SARIF output is designed for GitHub code scanning upload:

```bash
shipcheck . --format sarif > shipcheck.sarif
```

Use it with the Marketplace action and GitHub's SARIF uploader:

```yaml
permissions:
  contents: read
  security-events: write

jobs:
  shipcheck:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: TateLyman/shipcheck-action@v1
        with:
          format: sarif
          output: shipcheck.sarif
          fail-on: medium
          strict: true
      - uses: github/codeql-action/upload-sarif@v4
        if: always()
        with:
          sarif_file: shipcheck.sarif
```

## Manual Review

Shipcheck is the first pass. If the report finds a blocker in an app you own or are authorized to inspect, you can request a manual review from the tool page.

Manual reviews focus on auth, data rules, env boundaries, Stripe/webhooks, deploy config, and the first paid user flow.

## Exit Codes

By default, `shipcheck` exits with code `1` only when a `high` finding is present.

Use `--fail-on medium` for CI gates:

```bash
shipcheck . --strict --fail-on medium
```

## Development

```bash
npm install
npm run check
```

The test suite uses Node's built-in test runner and temporary fixture repositories.
