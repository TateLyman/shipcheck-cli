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
  name?: string;
  version?: string;
  private?: boolean;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  packageManager?: string;
  license?: string;
  type?: string;
  mcpName?: string;
  keywords?: string[];
};

type ServerJson = {
  name?: string;
  version?: string;
  packages?: Array<{
    registryType?: string;
    identifier?: string;
    version?: string;
    transport?: {
      type?: string;
    };
  }>;
  remotes?: Array<{
    type?: string;
    url?: string;
  }>;
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
  await checkAppExposure(root, pkg, findings);
  await checkMcpReleaseMetadata(root, pkg, findings);

  if (pkg) {
    checkScripts(pkg, findings, strict);
    checkDependencies(pkg, findings);
    await checkPackageManager(root, pkg, findings);
    await checkNpmPublishWorkflow(root, pkg, findings);
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

async function readServerJson(root: string): Promise<ServerJson | null> {
  const serverPath = path.join(root, "server.json");
  const body = await readText(serverPath);
  if (!body) {
    return null;
  }

  try {
    return JSON.parse(body) as ServerJson;
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

  const sourceFiles = (await listFiles(root, 4)).filter(isProductionRelevantFile);
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

async function checkAppExposure(root: string, pkg: PackageJson | null, findings: Finding[]): Promise<void> {
  const files = (await listFiles(root, 5)).filter(isProductionRelevantFile);

  await checkHardcodedSecrets(root, files, findings);
  await checkStripeWebhookVerification(root, pkg, files, findings);
  await checkFirebaseRules(root, pkg, files, findings);
  await checkSupabaseRls(root, pkg, files, findings);
  await checkDebugRoutes(root, files, findings);
  await checkPaidApiUsageGuardrails(root, pkg, files, findings);
}

async function checkHardcodedSecrets(root: string, files: string[], findings: Finding[]): Promise<void> {
  const secretPatterns: Array<{ pattern: RegExp; label: string }> = [
    { pattern: /\bsk_live_[A-Za-z0-9]{12,}\b/, label: "Stripe live secret key" },
    { pattern: /\bsk_test_[A-Za-z0-9]{12,}\b/, label: "Stripe test secret key" },
    { pattern: /\brk_live_[A-Za-z0-9]{12,}\b/, label: "Stripe restricted key" },
    { pattern: /\b(?:OPENAI|ANTHROPIC|GROQ|XAI|GEMINI|GOOGLE)_API_KEY\s*[:=]\s*["'][^"'\s]{20,}["']/i, label: "paid provider API key" },
    { pattern: /\bSUPABASE_SERVICE_ROLE(?:_KEY)?\s*[:=]\s*["'][^"'\s]{20,}["']/i, label: "Supabase service-role key" }
  ];

  for (const file of files.filter(isSourceOrConfigFile)) {
    const text = await readText(file);
    if (!text) {
      continue;
    }

    const secretMatch = secretPatterns.find(({ pattern }) => pattern.test(text));
    if (secretMatch) {
      findings.push({
        id: "hardcoded-private-secret",
        title: "Private secret appears in repo text",
        severity: "high",
        message: `Detected a likely ${secretMatch.label} in a source or config file.`,
        remediation: "Rotate the key, move it to server-only environment variables, and make sure it is not reachable from browser bundles.",
        file: relativeTo(root, file)
      });
      return;
    }

    const publicPrivateEnv = /\b(?:NEXT_PUBLIC|VITE|PUBLIC)_[A-Z0-9_]*(?:SECRET|SERVICE|PRIVATE|TOKEN|WEBHOOK)[A-Z0-9_]*\b/;
    if (publicPrivateEnv.test(text)) {
      findings.push({
        id: "public-private-env-name",
        title: "Private-looking env var is exposed to browser code",
        severity: "high",
        message: "The repo references a public frontend env var name that includes secret, service, private, token, or webhook.",
        remediation: "Rename private values without a public prefix and read them only from server routes or server actions.",
        file: relativeTo(root, file)
      });
      return;
    }

    const serviceRoleReference = /process\.env\.(?:SUPABASE_SERVICE_ROLE|SUPABASE_SERVICE_ROLE_KEY)\b|["']service_role["']\s*[:=]|serviceRoleKey\s*[:=]/.test(text);
    if (/\bsupabase\b/i.test(text) && serviceRoleReference) {
      findings.push({
        id: "supabase-service-role-reference",
        title: "Supabase service role appears in application code",
        severity: "high",
        message: "Service-role credentials bypass row-level security and should not appear in frontend or shared application code.",
        remediation: "Keep service-role usage inside tightly scoped server-only admin code, rotate any exposed key, and verify no client bundle contains it.",
        file: relativeTo(root, file)
      });
      return;
    }
  }
}

async function checkStripeWebhookVerification(
  root: string,
  pkg: PackageJson | null,
  files: string[],
  findings: Finding[]
): Promise<void> {
  const usesStripe = hasDependency(pkg, "stripe") || await repoTextMatches(files, /\bstripe\b/i);
  if (!usesStripe) {
    return;
  }

  for (const file of files.filter(isSourceOrConfigFile)) {
    const relative = relativeTo(root, file);
    const text = await readText(file);
    if (!text) {
      continue;
    }

    const looksLikeWebhook = /webhook/i.test(relative) || /checkout\.session|invoice\.|customer\.subscription|payment_intent/i.test(text);
    const verifiesSignature = /webhooks\.constructEvent|constructEvent\(/.test(text);
    if (looksLikeWebhook && /\bstripe\b/i.test(text) && !verifiesSignature) {
      findings.push({
        id: "unsigned-stripe-webhook",
        title: "Stripe webhook handler may skip signature verification",
        severity: "high",
        message: "A Stripe webhook-like file handles Stripe events without an obvious constructEvent signature check.",
        remediation: "Verify the raw request body with stripe.webhooks.constructEvent before granting paid access, credits, roles, or orders.",
        file: relative
      });
      return;
    }
  }
}

async function checkFirebaseRules(root: string, pkg: PackageJson | null, files: string[], findings: Finding[]): Promise<void> {
  const usesFirebase = hasDependency(pkg, "firebase") || hasDependency(pkg, "@firebase/app")
    || await repoTextMatches(files, /\b(?:getFirestore|initializeApp)\(|firebaseConfig\s*=/);

  if (!usesFirebase) {
    return;
  }

  const hasFirestoreRules = await exists(path.join(root, "firestore.rules"));
  const hasStorageRules = await exists(path.join(root, "storage.rules"));
  if (!hasFirestoreRules && !hasStorageRules) {
    findings.push({
      id: "missing-firebase-rules",
      title: "Firebase app has no checked-in security rules",
      severity: "medium",
      message: "Firebase projects need explicit Firestore or Storage rules to make user-data boundaries reviewable.",
      remediation: "Commit firestore.rules or storage.rules and test denied reads/writes with at least two separate users.",
      file: "firestore.rules"
    });
  }
}

async function checkSupabaseRls(root: string, pkg: PackageJson | null, files: string[], findings: Finding[]): Promise<void> {
  const usesSupabase = hasDependency(pkg, "@supabase/supabase-js")
    || await repoTextMatches(files, /\bcreateClient\([^)]*supabase|process\.env\.(?:NEXT_PUBLIC_)?SUPABASE_URL|supabaseUrl\s*=/i);
  if (!usesSupabase) {
    return;
  }

  const hasSupabaseFolder = await exists(path.join(root, "supabase"));
  const hasRlsNotes = await repoTextMatches(files, /\b(row level security|rls|auth\.uid\(\)|policy)\b/i);
  if (!hasSupabaseFolder && !hasRlsNotes) {
    findings.push({
      id: "undocumented-supabase-rls",
      title: "Supabase usage has no visible RLS proof",
      severity: "medium",
      message: "The repo uses Supabase, but the scan did not find migrations, policies, or documentation showing row-level security was tested.",
      remediation: "Add Supabase migrations or a short launch note showing RLS policies and two-user access-boundary tests.",
      file: "supabase"
    });
  }
}

async function checkDebugRoutes(root: string, files: string[], findings: Finding[]): Promise<void> {
  const riskyRoute = files.find((file) => {
    const relative = relativeTo(root, file).replace(/\\/g, "/");
    return /(?:^|\/)(?:app|pages|src\/app|src\/pages)\/api\/(?:debug|test|dev|seed|mock|reset)(?:\/|\.|-)/i.test(relative);
  });

  if (riskyRoute) {
    findings.push({
      id: "debug-api-route",
      title: "Debug or seed API route may ship to production",
      severity: "medium",
      message: "Debug, test, seed, reset, and mock API routes are common launch leftovers that can expose data or mutate production state.",
      remediation: "Remove the route, gate it behind server-side admin checks, or make it impossible to deploy in production.",
      file: relativeTo(root, riskyRoute)
    });
  }
}

async function checkPaidApiUsageGuardrails(root: string, pkg: PackageJson | null, files: string[], findings: Finding[]): Promise<void> {
  const usesAiProvider = hasAnyDependency(pkg, ["openai", "@anthropic-ai/sdk", "ai", "@google/generative-ai"])
    || await repoTextMatches(files, /\b(?:from\s+["']openai["']|require\(["']openai["']\)|new\s+OpenAI\(|generateText\(|streamText\(|chat\.completions)\b/i);

  if (!usesAiProvider) {
    return;
  }

  const hasCostGuardrail = await repoTextMatches(files, /\b(rateLimit|rate-limit|quota|usageLimit|usage_limit|throttle|limiter|upstash\/ratelimit)\b/i);
  if (!hasCostGuardrail) {
    findings.push({
      id: "missing-paid-api-usage-guardrail",
      title: "Paid API usage has no obvious quota or rate limit",
      severity: "low",
      message: "Apps that call paid external APIs need usage guardrails so one user or bot cannot run up costs.",
      remediation: "Add per-user quotas, route-level rate limits, abuse logging, or a billing-aware usage cap around expensive actions.",
      file: "package.json"
    });
  }
}

async function checkMcpReleaseMetadata(root: string, pkg: PackageJson | null, findings: Finding[]): Promise<void> {
  const hasServerJson = await exists(path.join(root, "server.json"));
  const isLikelyMcpServer = Boolean(pkg && (
    pkg.mcpName
    || hasAnyDependency(pkg, ["@modelcontextprotocol/sdk", "@modelcontextprotocol/server"])
    || /(?:^|[-_])mcp(?:$|[-_])/i.test(pkg.name ?? "")
  )) || hasServerJson;

  if (!isLikelyMcpServer) {
    return;
  }

  if (!pkg?.mcpName) {
    findings.push({
      id: "missing-mcp-name",
      title: "MCP package is missing mcpName",
      severity: "medium",
      message: "Official MCP Registry publishing verifies npm ownership with the mcpName field in package.json.",
      remediation: "Add package.json mcpName that matches the server.json name, such as io.github.owner/server-name.",
      file: "package.json"
    });
  }

  const server = await readServerJson(root);
  if (!server) {
    findings.push({
      id: "missing-mcp-server-json",
      title: "MCP package has no server.json",
      severity: "medium",
      message: "MCP registries and directories increasingly rely on server.json for install and discovery metadata.",
      remediation: "Add server.json with name, description, repository, version, package identifier, and transport metadata.",
      file: "server.json"
    });
  } else {
    if (pkg?.mcpName && server.name && server.name !== pkg.mcpName) {
      findings.push({
        id: "mcp-name-mismatch",
        title: "MCP registry names do not match",
        severity: "medium",
        message: `package.json mcpName is ${pkg.mcpName}, but server.json name is ${server.name}.`,
        remediation: "Use the same reverse-DNS server name in package.json mcpName and server.json name.",
        file: "server.json"
      });
    }

    const npmPackage = server.packages?.find((item) => item.registryType === "npm");
    if (pkg?.version && server.version && server.version !== pkg.version) {
      findings.push({
        id: "mcp-server-version-mismatch",
        title: "server.json version does not match package.json",
        severity: "medium",
        message: `package.json version is ${pkg.version}, but server.json version is ${server.version}.`,
        remediation: "Set server.json version to the exact package version before publishing MCP Registry metadata.",
        file: "server.json"
      });
    }

    if (pkg?.name && (!npmPackage || npmPackage.identifier !== pkg.name)) {
      findings.push({
        id: "mcp-npm-package-missing",
        title: "server.json does not point at the npm package",
        severity: "medium",
        message: "The MCP server metadata does not include an npm package entry matching package.json name.",
        remediation: "Add a packages entry with registryType npm, identifier set to the package name, a fixed version, and stdio transport.",
        file: "server.json"
      });
    }

    if (npmPackage && (!npmPackage.version || /^(?:latest|[\^~*]|\d+\.x)/i.test(npmPackage.version))) {
      findings.push({
        id: "mcp-package-version-not-pinned",
        title: "server.json npm package version is not pinned",
        severity: "medium",
        message: "MCP registry package versions should be fixed release versions, not latest or semver ranges.",
        remediation: "Set packages[].version to the exact npm version being published.",
        file: "server.json"
      });
    }

    if (pkg?.version && npmPackage?.version && npmPackage.version !== pkg.version) {
      findings.push({
        id: "mcp-package-version-mismatch",
        title: "server.json package version does not match package.json",
        severity: "medium",
        message: `package.json version is ${pkg.version}, but server.json packages[].version is ${npmPackage.version}.`,
        remediation: "Set the npm package entry in server.json to the exact package version before publishing MCP Registry metadata.",
        file: "server.json"
      });
    }
  }

  const readme = await readText(path.join(root, "README.md"));
  if (readme && !/(mcpServers|claude\s+mcp\s+add|npx|uvx|docker)/i.test(readme)) {
    findings.push({
      id: "missing-mcp-install-config",
      title: "README lacks MCP install config",
      severity: "low",
      message: "MCP users need a copyable client config or add command before they can try the server.",
      remediation: "Document a copyable mcpServers JSON block or client-specific add command.",
      file: "README.md"
    });
  }

  if (readme && !/(smoke|inspector|tools\/list|list tools|expected tools?|test command|verification|verify the server|try it locally)/i.test(readme)) {
    findings.push({
      id: "missing-mcp-smoke-test-docs",
      title: "README lacks MCP smoke-test proof",
      severity: "low",
      message: "MCP users and directory reviewers need a quick way to confirm the server starts and exposes the expected tools.",
      remediation: "Add a smoke-test command or short verification section using MCP Inspector, tools/list, or expected tool output.",
      file: "README.md"
    });
  }

  const safetyText = [
    readme,
    await readText(path.join(root, "SECURITY.md"))
  ].filter((text): text is string => Boolean(text)).join("\n");

  const hasRemoteServer = Boolean(server?.remotes?.length);
  const hasRemoteAuthNotes = /\b(oauth|auth|authenticate|authorization|api key|token|bearer|login|sign in|permission|scope|secret)\b/i.test(safetyText);
  if (hasRemoteServer && !hasRemoteAuthNotes) {
    findings.push({
      id: "mcp-remote-auth-undocumented",
      title: "Remote MCP auth boundaries are not documented",
      severity: "low",
      message: "Remote MCP servers need clear notes about authentication, token handling, scopes, and user-data boundaries before users connect a client.",
      remediation: "Document the remote auth flow, required tokens or OAuth scopes, data access boundaries, and how users can revoke access.",
      file: "README.md"
    });
  }

  const sourceFiles = (await listFiles(root, 4)).filter(isProductionRelevantFile).filter(isSourceOrConfigFile);
  const hasToolAnnotations = await repoTextMatches(sourceFiles, /\b(readOnlyHint|destructiveHint|idempotentHint|openWorldHint)\b/);
  const hasSafetyNotes = /\b(authorized|read-only|destructive|permissions|least privilege|security)\b/i.test(safetyText);
  if (!hasToolAnnotations && !hasSafetyNotes) {
    findings.push({
      id: "unclear-mcp-tool-safety",
      title: "MCP tool safety is not documented",
      severity: "low",
      message: "MCP users and directories need to understand whether tools read data, mutate state, or need special permissions.",
      remediation: "Add tool annotations where supported and document read/write behavior, required permissions, and security boundaries.",
      file: "README.md"
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

async function checkNpmPublishWorkflow(root: string, pkg: PackageJson, findings: Finding[]): Promise<void> {
  if (pkg.private === true) {
    return;
  }

  const workflowsRoot = path.join(root, ".github", "workflows");
  const workflowFiles = (await listFiles(workflowsRoot, 1))
    .filter((file) => [".yml", ".yaml"].includes(path.extname(file).toLowerCase()));

  const publishPattern = /\b(?:npm\s+publish|pnpm\s+publish|yarn\s+npm\s+publish)\b|JS-DevTools\/npm-publish/i;
  const tokenPattern = /\b(?:NPM_TOKEN|NODE_AUTH_TOKEN|NPM_CONFIG__AUTH|_authToken)\b|secrets\.[A-Z0-9_]*NPM[A-Z0-9_]*/i;
  const idTokenPattern = /id-token\s*:\s*write/i;

  for (const workflowFile of workflowFiles) {
    const workflow = await readText(workflowFile);
    if (!workflow || !publishPattern.test(workflow)) {
      continue;
    }

    const relativeWorkflowFile = relativeTo(root, workflowFile);
    if (tokenPattern.test(workflow)) {
      findings.push({
        id: "npm-publish-uses-long-lived-token",
        title: "npm publish workflow uses a long-lived token",
        severity: "medium",
        message: "The workflow appears to publish to npm with NPM_TOKEN, NODE_AUTH_TOKEN, or an npm auth token instead of OIDC trusted publishing.",
        remediation: "Configure npm Trusted Publisher for this workflow, grant id-token: write, and remove publish-scope npm tokens from the publish job.",
        file: relativeWorkflowFile
      });
      continue;
    }

    if (!idTokenPattern.test(workflow)) {
      findings.push({
        id: "npm-publish-missing-oidc-permission",
        title: "npm publish workflow is missing OIDC permission",
        severity: "low",
        message: "The workflow runs npm publish but does not visibly grant id-token: write for trusted publishing.",
        remediation: "Add permissions.id-token: write to the publish workflow or publish job after configuring npm Trusted Publisher.",
        file: relativeWorkflowFile
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

function hasDependency(pkg: PackageJson | null, name: string): boolean {
  if (!pkg) {
    return false;
  }

  return Boolean(pkg.dependencies?.[name] || pkg.devDependencies?.[name] || pkg.peerDependencies?.[name]);
}

function hasAnyDependency(pkg: PackageJson | null, names: string[]): boolean {
  return names.some((name) => hasDependency(pkg, name));
}

function isSourceOrConfigFile(file: string): boolean {
  const basename = path.basename(file).toLowerCase();
  if (basename.endsWith("-lock.json") || basename.endsWith(".lock") || basename === "license") {
    return false;
  }

  const extension = path.extname(file).toLowerCase();
  return [
    ".js",
    ".jsx",
    ".ts",
    ".tsx",
    ".mjs",
    ".cjs",
    ".json",
    ".env",
    ".local",
    ".toml",
    ".yaml",
    ".yml"
  ].includes(extension) || basename.startsWith(".env");
}

function isProductionRelevantFile(file: string): boolean {
  const normalized = file.replace(/\\/g, "/").toLowerCase();
  const basename = path.basename(normalized);
  return !normalized.includes("/test/")
    && !normalized.includes("/tests/")
    && !normalized.includes("/__tests__/")
    && !normalized.includes("/fixtures/")
    && !normalized.includes("/fixture/")
    && !basename.includes(".test.")
    && !basename.includes(".spec.");
}

function relativeTo(root: string, file: string): string {
  return path.relative(root, file) || path.basename(file);
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
