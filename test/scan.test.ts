import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import test from "node:test";
import { formatReport } from "../src/format.js";
import { scanRepository } from "../src/index.js";

test("passes a release-ready TypeScript package", async () => {
  const root = await fixture({
    "package.json": JSON.stringify({
      scripts: {
        build: "tsc -p tsconfig.json",
        test: "node --test dist/**/*.test.js",
        lint: "tsc -p tsconfig.json --noEmit"
      },
      dependencies: {
        kleur: "^4.1.5"
      },
      devDependencies: {
        typescript: "^5.8.3"
      },
      packageManager: "npm@11.8.0",
      license: "MIT"
    }),
    "package-lock.json": "{}",
    "README.md": "# Demo\n\nThis package has a real README with install steps, usage examples, expected output, and verification commands for maintainers.\n\n## Usage\n\nRun the CLI, inspect the report, and fix any warnings before release. This paragraph keeps the README above the minimum size used by the scanner.\n\n## Verification\n\nRun npm test before every release.",
    "LICENSE": "MIT",
    ".gitignore": "node_modules/\n.env\ndist/\n",
    "tsconfig.json": "{}",
    "src/index.ts": "export const value: number = 1;\n",
    ".github/workflows/ci.yml": "name: ci\non: [push]\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps: []\n"
  });

  const report = await scanRepository({ root, failOn: "high", strict: true });
  assert.equal(report.ok, true);
  assert.equal(report.totals.high, 0);
  assert.equal(report.totals.medium, 0);
});

test("flags dangerous scripts and loose dependencies", async () => {
  const root = await fixture({
    "package.json": JSON.stringify({
      scripts: {
        clean: "rm -rf /tmp/build-cache",
        test: "node --test",
        build: "node build.js"
      },
      dependencies: {
        leftpad: "latest"
      }
    }),
    "package-lock.json": "{}",
    "README.md": "# Demo\n\nShort.",
    ".gitignore": "node_modules/\n"
  });

  const report = await scanRepository({ root, failOn: "high" });
  assert.equal(report.ok, false);
  assert.equal(report.findings.some((finding) => finding.id === "dangerous-package-script"), true);
  assert.equal(report.findings.some((finding) => finding.id === "loose-dependency-version"), true);
});

test("flags AI-app exposure risks", async () => {
  const stripeSecret = "sk_live_" + "1234567890abcdef";
  const root = await fixture({
    "package.json": JSON.stringify({
      scripts: {
        test: "node --test",
        build: "node build.js"
      },
      dependencies: {
        stripe: "^18.0.0",
        "@supabase/supabase-js": "^2.0.0",
        openai: "^5.0.0"
      }
    }),
    "package-lock.json": "{}",
    "README.md": "# Demo\n\nThis package has a real README with install steps, usage examples, expected output, and verification commands for maintainers.\n\n## Usage\n\nRun the CLI, inspect the report, and fix any warnings before release. This paragraph keeps the README above the minimum size used by the scanner.\n\n## Verification\n\nRun npm test before every release.",
    ".gitignore": "node_modules/\n.env\ndist/\n",
    "src/app/api/stripe/webhook.ts": "const stripe = {};\nexport async function POST() {\n  const event = { type: 'checkout.session.completed' };\n  return event;\n}\n",
    "src/lib/client.ts": `export const leaked = '${stripeSecret}';\nexport const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;\n`,
    "src/app/api/debug/route.ts": "export async function POST() { return Response.json({ ok: true }); }\n"
  });

  const report = await scanRepository({ root, failOn: "high" });
  assert.equal(report.findings.some((finding) => finding.id === "hardcoded-private-secret"), true);
  assert.equal(report.findings.some((finding) => finding.id === "unsigned-stripe-webhook"), true);
  assert.equal(report.findings.some((finding) => finding.id === "undocumented-supabase-rls"), true);
  assert.equal(report.findings.some((finding) => finding.id === "debug-api-route"), true);
  assert.equal(report.findings.some((finding) => finding.id === "missing-ai-usage-guardrail"), true);
});

test("flags Firebase projects without checked-in rules", async () => {
  const root = await fixture({
    "package.json": JSON.stringify({
      scripts: {
        test: "node --test",
        build: "node build.js"
      },
      dependencies: {
        firebase: "^12.0.0"
      }
    }),
    "package-lock.json": "{}",
    "README.md": "# Demo\n\nThis package has a real README with install steps, usage examples, expected output, and verification commands for maintainers.\n\n## Usage\n\nRun the CLI, inspect the report, and fix any warnings before release. This paragraph keeps the README above the minimum size used by the scanner.\n\n## Verification\n\nRun npm test before every release.",
    ".gitignore": "node_modules/\n.env\ndist/\n",
    "src/firebase.ts": "import { initializeApp } from 'firebase/app';\nexport const app = initializeApp({});\n"
  });

  const report = await scanRepository({ root, failOn: "high" });
  assert.equal(report.findings.some((finding) => finding.id === "missing-firebase-rules"), true);
});

test("formats Markdown reports for client handoff", async () => {
  const root = await fixture({
    "package.json": JSON.stringify({
      scripts: {
        test: "node --test",
        build: "node build.js"
      }
    }),
    "package-lock.json": "{}"
  });

  const report = await scanRepository({ root, failOn: "high" });
  const markdown = formatReport(report, "markdown");
  assert.match(markdown, /# Shipcheck Report/);
  assert.match(markdown, /## Findings/);
  assert.match(markdown, /README\.md/);
});

async function fixture(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "shipcheck-"));

  for (const [relativePath, contents] of Object.entries(files)) {
    const fullPath = path.join(root, relativePath);
    await mkdir(path.dirname(fullPath), { recursive: true });
    await writeFile(fullPath, contents);
  }

  return root;
}
