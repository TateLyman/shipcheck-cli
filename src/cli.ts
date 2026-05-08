#!/usr/bin/env node
import { formatReport, type ReportFormat } from "./format.js";
import { scanRepository, shouldFail, type Severity } from "./index.js";

type ParsedArgs = {
  root: string;
  format: ReportFormat;
  strict: boolean;
  failOn: Severity;
  help: boolean;
  version: boolean;
};

const validFormats = new Set<ReportFormat>(["text", "markdown", "json", "sarif"]);
const validSeverities = new Set<Severity>(["info", "low", "medium", "high"]);

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    console.log(helpText());
    return;
  }

  if (args.version) {
    console.log("0.3.0");
    return;
  }

  const report = await scanRepository({
    root: args.root,
    strict: args.strict,
    failOn: args.failOn
  });

  console.log(formatReport(report, args.format));

  if (shouldFail(report)) {
    process.exitCode = 1;
  }
}

function parseArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = {
    root: process.cwd(),
    format: "text",
    strict: false,
    failOn: "high",
    help: false,
    version: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (!arg) {
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
      continue;
    }

    if (arg === "--version" || arg === "-v") {
      parsed.version = true;
      continue;
    }

    if (arg === "--strict") {
      parsed.strict = true;
      continue;
    }

    if (arg === "--format") {
      const value = argv[index + 1];
      if (!value || !validFormats.has(value as ReportFormat)) {
        throw new Error("--format must be one of: text, markdown, json, sarif");
      }

      parsed.format = value as ReportFormat;
      index += 1;
      continue;
    }

    if (arg === "--fail-on") {
      const value = argv[index + 1];
      if (!value || !validSeverities.has(value as Severity)) {
        throw new Error("--fail-on must be one of: info, low, medium, high");
      }

      parsed.failOn = value as Severity;
      index += 1;
      continue;
    }

    if (arg.startsWith("--")) {
      throw new Error(`Unknown option: ${arg}`);
    }

    parsed.root = arg;
  }

  return parsed;
}

function helpText(): string {
  return [
    "shipcheck - release-readiness and AI-app exposure scanner for JavaScript and TypeScript repos",
    "",
    "Usage:",
    "  shipcheck [path] [--format text|markdown|json|sarif] [--fail-on info|low|medium|high] [--strict]",
    "",
    "Examples:",
    "  shipcheck",
    "  shipcheck ../my-app --format markdown",
    "  shipcheck . --strict --fail-on medium",
    "",
    "Options:",
    "  --format     Output format. Defaults to text.",
    "  --fail-on    Exit non-zero when this severity or higher is found. Defaults to high.",
    "  --strict     Treat missing lint scripts as a release-readiness issue.",
    "  --help       Show this help message.",
    "  --version    Show the CLI version."
  ].join("\n");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
