import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { formatReport } from "../src/format.js";
import { scanRepository } from "../src/index.js";

test("prints the package version", async () => {
  const packageJson = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { version: string };
  const cliPath = fileURLToPath(new URL("../src/cli.js", import.meta.url));
  const stdout = execFileSync(process.execPath, [cliPath, "--version"], { encoding: "utf8" });

  assert.equal(stdout.trim(), packageJson.version);
});

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

test("flags npm publish workflows that use long-lived tokens", async () => {
  const root = await fixture({
    "package.json": JSON.stringify({
      name: "token-publisher",
      scripts: {
        build: "tsc -p tsconfig.json",
        test: "node --test"
      },
      license: "MIT"
    }),
    "package-lock.json": "{}",
    "README.md": "# Demo\n\nThis package has a real README with install steps, usage examples, expected output, and verification commands for maintainers.\n\n## Usage\n\nRun the CLI, inspect the report, and fix any warnings before release. This paragraph keeps the README above the minimum size used by the scanner.\n\n## Verification\n\nRun npm test before every release.",
    "LICENSE": "MIT",
    ".gitignore": "node_modules/\n.env\ndist/\n",
    "tsconfig.json": "{}",
    "src/index.ts": "export const value: number = 1;\n",
    ".github/workflows/publish-npm.yml": "name: publish-npm\non: workflow_dispatch\njobs:\n  publish:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v6\n      - uses: actions/setup-node@v6\n        with:\n          registry-url: https://registry.npmjs.org\n      - run: npm ci\n      - run: npm publish\n        env:\n          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}\n"
  });

  const report = await scanRepository({ root, failOn: "high" });
  assert.equal(report.findings.some((finding) => finding.id === "npm-publish-uses-long-lived-token"), true);
});

test("accepts npm trusted publishing workflows", async () => {
  const root = await fixture({
    "package.json": JSON.stringify({
      name: "trusted-publisher",
      scripts: {
        build: "tsc -p tsconfig.json",
        test: "node --test"
      },
      license: "MIT"
    }),
    "package-lock.json": "{}",
    "README.md": "# Demo\n\nThis package has a real README with install steps, usage examples, expected output, and verification commands for maintainers.\n\n## Usage\n\nRun the CLI, inspect the report, and fix any warnings before release. This paragraph keeps the README above the minimum size used by the scanner.\n\n## Verification\n\nRun npm test before every release.",
    "LICENSE": "MIT",
    ".gitignore": "node_modules/\n.env\ndist/\n",
    "tsconfig.json": "{}",
    "src/index.ts": "export const value: number = 1;\n",
    ".github/workflows/publish-npm.yml": "name: publish-npm\non: workflow_dispatch\npermissions:\n  contents: read\n  id-token: write\njobs:\n  publish:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v6\n      - uses: actions/setup-node@v6\n        with:\n          node-version: 24\n          registry-url: https://registry.npmjs.org\n      - run: npm ci\n      - run: npm publish\n"
  });

  const report = await scanRepository({ root, failOn: "high" });
  const npmPublishFindings = report.findings.filter((finding) => finding.id.startsWith("npm-publish-"));
  assert.deepEqual(npmPublishFindings, []);
});

test("flags app exposure risks", async () => {
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
  assert.equal(report.findings.some((finding) => finding.id === "missing-paid-api-usage-guardrail"), true);
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

test("flags MCP registry metadata gaps", async () => {
  const root = await fixture({
    "package.json": JSON.stringify({
      name: "demo-mcp",
      scripts: {
        test: "node --test",
        build: "node build.js"
      },
      dependencies: {
        "@modelcontextprotocol/sdk": "^1.29.0"
      }
    }),
    "package-lock.json": "{}",
    "README.md": "# Demo MCP\n\nThis MCP server has a real README with usage notes and release context, but it intentionally omits registry metadata, copyable client install configuration, and first-run proof so the scanner can flag launch-readiness gaps before publication.",
    ".gitignore": "node_modules/\n.env\ndist/\n"
  });

  const report = await scanRepository({ root, failOn: "high" });
  assert.equal(report.findings.some((finding) => finding.id === "missing-mcp-name"), true);
  assert.equal(report.findings.some((finding) => finding.id === "missing-mcp-server-json"), true);
  assert.equal(report.findings.some((finding) => finding.id === "missing-mcp-install-config"), true);
  assert.equal(report.findings.some((finding) => finding.id === "missing-mcp-smoke-test-docs"), true);
});

test("flags remote MCP servers without auth boundary docs", async () => {
  const root = await fixture({
    "package.json": JSON.stringify({
      name: "remote-demo-mcp",
      mcpName: "io.github.demo/remote-demo-mcp",
      scripts: {
        test: "node --test",
        build: "node build.js"
      },
      dependencies: {
        "@modelcontextprotocol/sdk": "^1.29.0"
      }
    }),
    "server.json": JSON.stringify({
      name: "io.github.demo/remote-demo-mcp",
      description: "Remote demo MCP server",
      version: "1.0.0",
      remotes: [
        {
          type: "streamable-http",
          url: "https://example.com/mcp"
        }
      ]
    }),
    "package-lock.json": "{}",
    "README.md": "# Remote Demo MCP\n\nThis MCP server has a copyable mcpServers config and a verification command. Use MCP Inspector to run tools/list and confirm the expected tools are available before release.",
    ".gitignore": "node_modules/\n.env\ndist/\n"
  });

  const report = await scanRepository({ root, failOn: "high" });
  assert.equal(report.findings.some((finding) => finding.id === "mcp-remote-auth-undocumented"), true);
});

test("flags MCP server metadata version mismatches", async () => {
  const root = await fixture({
    "package.json": JSON.stringify({
      name: "demo-mcp",
      version: "1.0.1",
      mcpName: "io.github.demo/demo-mcp",
      scripts: {
        test: "node --test",
        build: "node build.js"
      },
      dependencies: {
        "@modelcontextprotocol/sdk": "^1.29.0"
      }
    }),
    "server.json": JSON.stringify({
      name: "io.github.demo/demo-mcp",
      description: "Demo MCP server",
      version: "1.0.0",
      packages: [
        {
          registryType: "npm",
          identifier: "demo-mcp",
          version: "1.0.0",
          transport: {
            type: "stdio"
          }
        }
      ]
    }),
    "package-lock.json": "{}",
    "README.md": "# Demo MCP\n\nThis package has a real README with install steps, usage examples, expected output, and verification commands for maintainers.\n\n## Usage\n\nAdd it to an MCP client with a copyable mcpServers JSON block and run it with npx.\n\n## Verification\n\nRun npm test before every release. This paragraph keeps the README above the minimum size used by the scanner.",
    "SECURITY.md": "Only run this MCP server against repositories you are authorized to inspect. The tools are read-only.",
    ".gitignore": "node_modules/\n.env\ndist/\n",
    ".github/workflows/ci.yml": "name: ci\non: [push]\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps: []\n"
  });

  const report = await scanRepository({ root, failOn: "high" });
  assert.equal(report.findings.some((finding) => finding.id === "mcp-server-version-mismatch"), true);
  assert.equal(report.findings.some((finding) => finding.id === "mcp-package-version-mismatch"), true);
});

test("accepts matching MCP server metadata", async () => {
  const root = await fixture({
    "package.json": JSON.stringify({
      name: "demo-mcp",
      mcpName: "io.github.demo/demo-mcp",
      scripts: {
        test: "node --test",
        build: "node build.js"
      },
      dependencies: {
        "@modelcontextprotocol/sdk": "^1.29.0"
      },
      license: "MIT"
    }),
    "server.json": JSON.stringify({
      name: "io.github.demo/demo-mcp",
      description: "Demo MCP server",
      version: "1.0.0",
      packages: [
        {
          registryType: "npm",
          identifier: "demo-mcp",
          version: "1.0.0",
          transport: {
            type: "stdio"
          }
        }
      ]
    }),
    "package-lock.json": "{}",
    "README.md": "# Demo MCP\n\nThis package has a real README with install steps, usage examples, expected output, and verification commands for maintainers.\n\n## Usage\n\nAdd it to an MCP client with a copyable mcpServers JSON block and run it with npx.\n\n## Verification\n\nRun npm test before every release. This paragraph keeps the README above the minimum size used by the scanner.",
    "SECURITY.md": "Only run this MCP server against repositories you are authorized to inspect. The tools are read-only.",
    "LICENSE": "MIT",
    ".gitignore": "node_modules/\n.env\ndist/\n",
    ".github/workflows/ci.yml": "name: ci\non: [push]\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps: []\n"
  });

  const report = await scanRepository({ root, failOn: "high" });
  const mcpFindings = report.findings.filter((finding) => finding.id.startsWith("mcp-") || finding.id.includes("-mcp-"));
  assert.deepEqual(mcpFindings, []);
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

test("formats SARIF reports for GitHub code scanning upload", async () => {
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
  const sarif = JSON.parse(formatReport(report, "sarif")) as {
    version: string;
    runs: Array<{
      tool: { driver: { name: string; rules: Array<{ id: string }> } };
      results: Array<{
        ruleId: string;
        level: string;
        locations: Array<{ physicalLocation: { artifactLocation: { uri: string } } }>;
      }>;
    }>;
  };

  assert.equal(sarif.version, "2.1.0");
  assert.equal(sarif.runs[0]?.tool.driver.name, "Shipcheck");
  assert.equal(sarif.runs[0]?.results.some((result) => result.ruleId === "missing-readme"), true);
  assert.equal(sarif.runs[0]?.results.some((result) => result.level === "warning"), true);
  assert.equal(
    sarif.runs[0]?.results.some((result) => result.locations[0]?.physicalLocation.artifactLocation.uri === "README.md"),
    true
  );
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
