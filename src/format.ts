import type { Finding, ScanReport, Severity } from "./index.js";

export type ReportFormat = "text" | "markdown" | "json" | "sarif";

const severityLabel: Record<Severity, string> = {
  high: "High",
  medium: "Medium",
  low: "Low",
  info: "Info"
};

const sarifLevel: Record<Severity, "error" | "warning" | "note"> = {
  high: "error",
  medium: "warning",
  low: "warning",
  info: "note"
};

export function formatReport(report: ScanReport, format: ReportFormat): string {
  if (format === "json") {
    return JSON.stringify(report, null, 2);
  }

  if (format === "sarif") {
    return formatSarif(report);
  }

  if (format === "markdown") {
    return formatMarkdown(report);
  }

  return formatText(report);
}

function formatText(report: ScanReport): string {
  const lines = [
    `Shipcheck report: ${report.root}`,
    `Score: ${report.score}/100`,
    `Status: ${report.ok ? "pass" : `fail (threshold: ${report.failOn})`}`,
    `Findings: ${summary(report)}`,
    ""
  ];

  if (report.findings.length === 0) {
    lines.push("No findings. This repo has the basics needed for a clean release.");
    return lines.join("\n");
  }

  for (const finding of report.findings) {
    lines.push(renderTextFinding(finding), "");
  }

  return lines.join("\n").trimEnd();
}

function formatMarkdown(report: ScanReport): string {
  const lines = [
    "# Shipcheck Report",
    "",
    `- **Repository:** \`${report.root}\``,
    `- **Score:** ${report.score}/100`,
    `- **Status:** ${report.ok ? "Pass" : `Fail at \`${report.failOn}\` threshold`}`,
    `- **Findings:** ${summary(report)}`,
    ""
  ];

  if (report.findings.length === 0) {
    lines.push("No findings. This repo has the basics needed for a clean release.");
    return lines.join("\n");
  }

  lines.push("## Findings", "");
  for (const finding of report.findings) {
    const rendered = [
      `### ${severityLabel[finding.severity]}: ${finding.title}`,
      "",
      `- **ID:** \`${finding.id}\``,
      finding.file ? `- **File:** \`${finding.file}\`` : undefined,
      `- **Problem:** ${finding.message}`,
      `- **Fix:** ${finding.remediation}`,
      ""
    ].filter((line): line is string => line !== undefined);

    lines.push(...rendered);
  }

  return lines.join("\n").trimEnd();
}

function formatSarif(report: ScanReport): string {
  const rules = new Map<string, {
    id: string;
    name: string;
    shortDescription: { text: string };
    fullDescription: { text: string };
    help: { text: string };
    properties: { shipcheckSeverity: Severity };
  }>();

  for (const finding of report.findings) {
    if (!rules.has(finding.id)) {
      rules.set(finding.id, {
        id: finding.id,
        name: finding.title,
        shortDescription: {
          text: finding.title
        },
        fullDescription: {
          text: finding.message
        },
        help: {
          text: finding.remediation
        },
        properties: {
          shipcheckSeverity: finding.severity
        }
      });
    }
  }

  const sarif = {
    $schema: "https://json.schemastore.org/sarif-2.1.0.json",
    version: "2.1.0",
    runs: [
      {
        tool: {
          driver: {
            name: "Shipcheck",
            informationUri: "https://tatelyman.github.io/tate-web-services/shipcheck.html",
            rules: [...rules.values()]
          }
        },
        results: report.findings.map((finding) => ({
          ruleId: finding.id,
          level: sarifLevel[finding.severity],
          message: {
            text: `${finding.message} Fix: ${finding.remediation}`
          },
          locations: [
            {
              physicalLocation: {
                artifactLocation: {
                  uri: finding.file ?? "."
                },
                region: {
                  startLine: 1
                }
              }
            }
          ],
          properties: {
            shipcheckSeverity: finding.severity
          }
        }))
      }
    ]
  };

  return JSON.stringify(sarif, null, 2);
}

function renderTextFinding(finding: Finding): string {
  const lines = [
    `[${finding.severity.toUpperCase()}] ${finding.title}`,
    `  id: ${finding.id}`
  ];

  if (finding.file) {
    lines.push(`  file: ${finding.file}`);
  }

  lines.push(`  problem: ${finding.message}`);
  lines.push(`  fix: ${finding.remediation}`);
  return lines.join("\n");
}

function summary(report: ScanReport): string {
  return [
    `${report.totals.high} high`,
    `${report.totals.medium} medium`,
    `${report.totals.low} low`,
    `${report.totals.info} info`
  ].join(", ");
}
