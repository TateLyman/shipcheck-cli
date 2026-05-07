import type { Finding, ScanReport, Severity } from "./index.js";

const severityLabel: Record<Severity, string> = {
  high: "High",
  medium: "Medium",
  low: "Low",
  info: "Info"
};

export function formatReport(report: ScanReport, format: "text" | "markdown" | "json"): string {
  if (format === "json") {
    return JSON.stringify(report, null, 2);
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
