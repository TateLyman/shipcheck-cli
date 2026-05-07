# shipcheck-cli

Release-readiness scanner for JavaScript and TypeScript repositories.

`shipcheck` inspects a repo before you publish, hand it to a client, or ask someone to review it. It catches the boring issues that make projects feel unfinished: missing CI, missing lockfiles, thin documentation, loose dependency versions, unsafe package scripts, and local environment-file hygiene problems.

## Install

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
shipcheck [path] [--format text|markdown|json] [--fail-on info|low|medium|high] [--strict]
```

Examples:

```bash
shipcheck
shipcheck ../client-app --format markdown
shipcheck . --strict --fail-on medium
```

## What It Checks

- `package.json` exists and has repeatable `test` and `build` scripts
- dangerous package scripts such as broad `rm -rf`, `sudo`, `curl | bash`, and force pushes
- loose dependency versions such as `latest`, `*`, direct URLs, and Git dependencies
- dependency lockfile presence and package-manager consistency
- README depth, license declaration, and `.gitignore` hygiene
- GitHub Actions workflow presence
- TypeScript files without `tsconfig.json`
- `.env` risk and missing `.env.example` when environment variables are used

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
