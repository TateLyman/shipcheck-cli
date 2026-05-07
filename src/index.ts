import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

export type Severity = "info" | "low" | "medium" | "high";

export type Finding = {
  id: string;
  title: string;
  severity: Severity;
  message: string;
  remediation: string;
  file?: string;
};

export type ScanOptions = {
  root: string;
  strict?: boolean;
  failOn?: Severity;
};

export type ScanReport = {
  root: string;
  score: number;
  ok: boolean;
  failOn: Severity;
  totals: Record<Severity, number>;
  findings: Finding[];
};

type PackageJson = {
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  packageManager?: string;
  license?: string;
  type?: string;
};

const severityRank: Record<Severity, number> = {
  info: 0,
  low: 1,
  medium: 2,
  high: 3
};

const scorePenalty: Record<Severity, number> = {
  info: 0,
  low: 4,
  medium: 10,
  high: 22
};

export async function scanRepository(options: ScanOptions): Promise<ScanReport> {
  const root = path.resolve(options.root);
  const failOn = options.failOn ?? "high";
  const strict = options.strict ?? false;
  const findings: Finding[] = [];

  const pkg = await readPackageJson(root);
  if (!pkg) {
    findings.push({
      id: "missing-package-json",
      title: "No package.json found",
      severity: "high",
      message: "Shipcheck is optimized for JavaScript and TypeScript repositories and could not find package.json.",
      remediation: "Run shipcheck from a JS/TS project root or add package.json before release.",
      file: "package.json"
    });
  }

  await checkReadme(root, findings);
  await checkLicense(root, pkg, findings);
  await checkGitignore(root, findings);
  await checkCi(root, findings);
  await checkTypeScript(root, findings);
  await checkEnvHygiene(root, findings);

  if (pkg) {
    checkScripts(pkg, findings, strict);
    checkDependencies(pkg, findings);
    await checkPackageManager(root, pkg, findings);
  }

  const totals = countTotals(findings);
  const rawScore = findings.reduce((score, finding) => score - scorePenalty[finding.severity], 100);
  const score = Math.max(0, rawScore);
  const ok = !findings.some((finding) => severityRank[finding.severity] >= severityRank[failOn]);

  return {
    root,
    score,
    ok,
    failOn,
    totals,
    findings: sortFindings(findings)
  };
}

export function shouldFail(report: ScanReport): boolean {
  return !report.ok;
}

async function readPackageJson(root: string): Promise<PackageJson | null> {
  const packagePath = path.join(root, "package.json");
  const body = await readText(packagePath);
  if (!body) {
    return null;
  }

  try {
    return JSON.parse(body) as PackageJson;
  } catch {
    return null;
  }
}

async function checkReadme(root: string, findings: Finding[]): Promise<void> {
  const readmePath = path.join(root, "README.md");
  const readme = await readText(readmePath);
  if (!readme) {
    findings.push({
      id: "missing-readme",
      title: "README.md is missing",
      severity: "medium",
      message: "A release-ready repo should explain what it does, how to install it, and how to verify it.",
      remediation: "Add README.md with install, usage, examples, and test commands.",
      file: "README.md"
    });
    return;
  }

  if (readme.trim().length < 350) {
    findings.push({
      id: "thin-readme",
      title: "README.md is too thin",
      severity: "low",
      message: "The README exists, but it is short enough that users may still need to inspect the code.",
      remediation: "Add usage examples, expected output, design notes, and local verification commands.",
      file: "README.md"
    });
  }
}

async function checkLicense(root: string, pkg: PackageJson | null, findings: Finding[]): Promise<void> {
  const hasLicenseFile = await exists(path.join(root, "LICENSE")) || await exists(path.join(root, "LICENSE.md"));
  if (!hasLicenseFile && !pkg?.license) {
    findings.push({
      id: "missing-license",
      title: "License is not declared",
      severity: "low",
      message: "Users and companies may avoid using code when reuse rights are unclear.",
      remediation: "Add a LICENSE file or set the license field in package.json.",
      file: "LICENSE"
    });
  }
}

async function checkGitignore(root: string, findings: Finding[]): Promise<void> {
  const gitignore = await readText(path.join(root, ".gitignore"));
  if (!gitignore) {
    findings.push({
      id: "missing-gitignore",
      title: ".gitignore is missing",
      severity: "medium",
      message: "Without a .gitignore, generated files and local secrets are easier to commit by accident.",
      remediation: "Add .gitignore entries for node_modules, dist, coverage, logs, and local env files.",
      file: ".gitignore"
    });
    return;
  }

  const requiredEntries = ["node_modules", ".env"];
  const missing = requiredEntries.filter((entry) => !gitignore.includes(entry));
  if (missing.length > 0) {
    findings.push({
      id: "incomplete-gitignore",
      title: ".gitignore misses common local files",
      severity: "medium",
      message: `Missing entries: ${missing.join(", ")}.`,
      remediation: "Add ignores for dependency directories and local environment files.",
      file: ".gitignore"
    });
  }
}

async function checkCi(root: string, findings: Finding[]): Promise<void> {
  const workflowDir = path.join(root, ".github", "workflows");
  if (!await exists(workflowDir)) {
    findings.push({
      id: "missing-ci",
      title: "No GitHub Actions workflow found",
      severity: "medium",
      message: "The repo does not advertise an automated verification path for pull requests.",
      remediation: "Add a CI workflow that runs install, lint, build, and tests.",
      file: ".github/workflows"
    });
    return;
  }

  const workflows = await listFiles(workflowDir, 1);
  const yamlWorkflows = workflows.filter((file) => file.endsWith(".yml") || file.endsWith(".yaml"));
  if (yamlWorkflows.length === 0) {
    findings.push({
      id: "empty-ci",
      title: "Workflow directory has no YAML workflow",
      severity: "medium",
      message: "The workflow folder exists, but GitHub Actions will not run without a YAML file.",
      remediation: "Add a workflow file such as .github/workflows/ci.yml.",
      file: ".github/workflows"
    });
  }
}

async function checkTypeScript(root: string, findings: Finding[]): Promise<void> {
  const files = await listFiles(root, 4);
  const hasTypeScript = files.some((file) => file.endsWith(".ts") || file.endsWith(".tsx"));
  if (hasTypeScript && !await exists(path.join(root, "tsconfig.json"))) {
    findings.push({
      id: "missing-tsconfig",
      title: "TypeScript files exist without tsconfig.json",
      severity: "medium",
      message: "TypeScript projects need an explicit compiler contract to make local and CI checks consistent.",
      remediation: "Add tsconfig.json with strict compiler options and include it in CI.",
      file: "tsconfig.json"
    });
  }
}

async function checkEnvHygiene(root: string, findings: Finding[]): Promise<void> {
  const envPath = path.join(root, ".env");
  const examplePath = path.join(root, ".env.example");
  const hasEnv = await exists(envPath);
  const hasExample = await exists(examplePath);

  if (hasEnv) {
    findings.push({
      id: "local-env-present",
      title: ".env exists in the project root",
      severity: "medium",
      message: "A local .env file can accidentally leak secrets if it is committed or copied into an artifact.",
      remediation: "Keep .env ignored and commit a redacted .env.example instead.",
      file: ".env"
    });
  }

  const sourceFiles = await listFiles(root, 4);
  const likelyUsesEnv = sourceFiles.some((file) => file.endsWith(".js") || file.endsWith(".ts"))
    && await repoTextMatches(sourceFiles, /process\.env(?:\.[A-Z_][A-Z0-9_]*|\[['"][A-Z_][A-Z0-9_]*['"]\])/);

  if (likelyUsesEnv && !hasExample) {
    findings.push({
      id: "missing-env-example",
      title: "Environment variables are used without .env.example",
      severity: "low",
      message: "New contributors cannot tell which environment variables are required.",
      remediation: "Add .env.example with placeholder values and document each variable.",
      file: ".env.example"
    });
  }
}

function checkScripts(pkg: PackageJson, findings: Finding[], strict: boolean): void {
  const scripts = pkg.scripts ?? {};
  const missingRequired = ["test", "build"].filter((script) => !scripts[script]);
  const missingStrict = strict ? ["lint"].filter((script) => !scripts[script]) : [];
  const missing = [...missingRequired, ...missingStrict];

  if (missing.length > 0) {
    findings.push({
      id: "missing-package-scripts",
      title: "Expected package scripts are missing",
      severity: strict ? "medium" : "low",
      message: `Missing scripts: ${missing.join(", ")}.`,
      remediation: "Add repeatable npm scripts so maintainers and CI run the same checks.",
      file: "package.json"
    });
  }

  const dangerousPatterns: Array<[RegExp, string]> = [
    [/\brm\s+-rf\s+(?:\/[^\s]*|\*|~[^\s]*|\.\.[^\s]*)(?:\s|$)/i, "recursive forced deletion outside a clearly scoped build folder"],
    [/\bsudo\b/i, "privileged command execution"],
    [/\bcurl\b.+\|\s*(?:sh|bash)\b/i, "curl piped directly into a shell"],
    [/\bwget\b.+\|\s*(?:sh|bash)\b/i, "wget piped directly into a shell"],
    [/\bgit\s+push\b.+\s--force(?:-with-lease)?\b/i, "force push in a package script"]
  ];

  for (const [name, command] of Object.entries(scripts)) {
    const match = dangerousPatterns.find(([pattern]) => pattern.test(command));
    if (match) {
      findings.push({
        id: "dangerous-package-script",
        title: `Package script "${name}" contains a dangerous command`,
        severity: "high",
        message: `Detected ${match[1]} in: ${command}`,
        remediation: "Replace broad destructive commands with scoped cleanup scripts and require manual confirmation for risky operations.",
        file: "package.json"
      });
    }
  }
}

function checkDependencies(pkg: PackageJson, findings: Finding[]): void {
  const groups = {
    dependencies: pkg.dependencies ?? {},
    devDependencies: pkg.devDependencies ?? {},
    peerDependencies: pkg.peerDependencies ?? {}
  };

  for (const [groupName, deps] of Object.entries(groups)) {
    for (const [name, version] of Object.entries(deps)) {
      const normalized = version.trim().toLowerCase();
      const loose = normalized === "*" || normalized === "latest" || normalized.startsWith("http://")
        || normalized.startsWith("https://") || normalized.startsWith("git+");

      if (loose) {
        findings.push({
          id: "loose-dependency-version",
          title: `Loose dependency version for ${name}`,
          severity: "medium",
          message: `${groupName}.${name} uses "${version}", which can change without review.`,
          remediation: "Use a semver range or exact version and rely on dependency update tooling for upgrades.",
          file: "package.json"
        });
      }
    }
  }
}

async function checkPackageManager(root: string, pkg: PackageJson, findings: Finding[]): Promise<void> {
  const lockfiles = [
    ["npm", "package-lock.json"],
    ["pnpm", "pnpm-lock.yaml"],
    ["yarn", "yarn.lock"],
    ["bun", "bun.lockb"]
  ] as const;

  const present = [];
  for (const [manager, lockfile] of lockfiles) {
    if (await exists(path.join(root, lockfile))) {
      present.push({ manager, lockfile });
    }
  }

  if (present.length === 0) {
    findings.push({
      id: "missing-lockfile",
      title: "No dependency lockfile found",
      severity: "medium",
      message: "Installs may resolve different dependency trees across machines and CI.",
      remediation: "Commit the lockfile generated by the package manager used by the project.",
      file: "package-lock.json"
    });
    return;
  }

  if (present.length > 1) {
    const firstLockfile = present[0]?.lockfile ?? "package-lock.json";
    findings.push({
      id: "multiple-lockfiles",
      title: "Multiple package manager lockfiles found",
      severity: "medium",
      message: `Found: ${present.map((item) => item.lockfile).join(", ")}.`,
      remediation: "Keep one lockfile and remove stale lockfiles from other package managers.",
      file: firstLockfile
    });
  }

  if (pkg.packageManager) {
    const declaredManager = pkg.packageManager.split("@")[0];
    const lockfileManagers = new Set(present.map((item) => item.manager));
    if (declaredManager && !lockfileManagers.has(declaredManager as "npm" | "pnpm" | "yarn" | "bun")) {
      findings.push({
        id: "package-manager-mismatch",
        title: "packageManager does not match lockfile",
        severity: "medium",
        message: `package.json declares ${pkg.packageManager}, but found ${present.map((item) => item.lockfile).join(", ")}.`,
        remediation: "Update packageManager or regenerate the lockfile with the declared tool.",
        file: "package.json"
      });
    }
  }
}

async function repoTextMatches(files: string[], pattern: RegExp): Promise<boolean> {
  for (const file of files) {
    if (file.includes("node_modules") || file.includes(`${path.sep}dist${path.sep}`)) {
      continue;
    }

    const text = await readText(file);
    if (text && pattern.test(text)) {
      return true;
    }
  }

  return false;
}

async function readText(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return null;
  }
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function listFiles(root: string, maxDepth: number): Promise<string[]> {
  const output: string[] = [];

  async function walk(current: string, depth: number): Promise<void> {
    if (depth > maxDepth) {
      return;
    }

    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "dist") {
        continue;
      }

      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath, depth + 1);
      } else if (entry.isFile()) {
        output.push(fullPath);
      }
    }
  }

  await walk(root, 0);
  return output;
}

function countTotals(findings: Finding[]): Record<Severity, number> {
  return findings.reduce<Record<Severity, number>>(
    (totals, finding) => {
      totals[finding.severity] += 1;
      return totals;
    },
    { info: 0, low: 0, medium: 0, high: 0 }
  );
}

function sortFindings(findings: Finding[]): Finding[] {
  return [...findings].sort((a, b) => {
    const severityDelta = severityRank[b.severity] - severityRank[a.severity];
    if (severityDelta !== 0) {
      return severityDelta;
    }

    return a.id.localeCompare(b.id);
  });
}
