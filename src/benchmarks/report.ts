import fs from 'node:fs/promises'
import path from 'node:path'

import {
  BenchmarkReport,
  type AutoResolutionRecord,
  type BenchmarkReport as BenchmarkReportData,
  type BenchmarkRunResult,
} from './types.js'

export function summarizeBenchmarkResults(
  results: readonly BenchmarkRunResult[],
  autoResolutions: readonly AutoResolutionRecord[],
): BenchmarkReportData['summary'] {
  return {
    total: results.length,
    passed: results.filter(result => result.result === 'pass').length,
    failed: results.filter(result => result.result === 'fail').length,
    unsupported: results.filter(result => result.result === 'unsupported').length,
    inconclusive: results.filter(result => result.result === 'inconclusive').length,
    falseSuccesses: results.filter(result => result.failureClass === 'false_success').length,
    blockedByPolicy: autoResolutions.filter(record => record.status === 'blocked_by_policy').length,
    autoResolutions: autoResolutions.filter(record => record.status !== 'blocked_by_policy').length,
  }
}

export function buildBenchmarkReport(input: Omit<BenchmarkReportData, 'summary'>): BenchmarkReportData {
  return BenchmarkReport.parse({
    ...input,
    summary: summarizeBenchmarkResults(input.results, input.autoResolutions),
  })
}

export function renderBenchmarkMarkdown(report: BenchmarkReportData): string {
  const lines = [
    `# ${report.title}`,
    '',
    `Generated: ${report.generatedAt}`,
    `Automation policy: ${report.automationPolicy}`,
    `Task subset hash: ${report.taskSubsetHash}`,
    '',
    '## Summary',
    '',
    `- Total: ${report.summary.total}`,
    `- Passed: ${report.summary.passed}`,
    `- Failed: ${report.summary.failed}`,
    `- Unsupported: ${report.summary.unsupported}`,
    `- Inconclusive: ${report.summary.inconclusive}`,
    `- False successes: ${report.summary.falseSuccesses}`,
    `- Blocked by policy: ${report.summary.blockedByPolicy}`,
    `- Auto-resolutions: ${report.summary.autoResolutions}`,
    '',
    '## Results',
    '',
    '| Task | Result | Failure class | Tokens in/out | Cost USD | Turns | Commands | Latency ms | Evidence |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ...report.results.map(result => [
      result.taskId,
      result.result,
      result.failureClass,
      `${result.tokenUse.input}/${result.tokenUse.output}`,
      result.costUsd.toFixed(6),
      result.turns,
      result.commandCount,
      result.durationMs,
      [...result.evidenceRefs, ...result.auditRefs].map(ref => ref.ref).join('<br>') || 'none',
    ].map(cell => String(cell).replace(/\|/g, '\\|')).join(' | ')).map(row => `| ${row} |`),
    '',
    '## Auto-Resolutions',
    '',
    report.autoResolutions.length === 0
      ? 'No owner questions were auto-resolved or policy-blocked.'
      : '| Question | Status | Policy | Selected | Reason |\n| --- | --- | --- | --- | --- |\n' +
        report.autoResolutions.map(record => [
          record.questionId,
          record.status,
          record.policy,
          record.selectedChoiceId ?? 'none',
          record.policyReason,
        ].map(cell => String(cell).replace(/\|/g, '\\|')).join(' | ')).map(row => `| ${row} |`).join('\n'),
    '',
    '## Interpretation Guardrail',
    '',
    'These benchmark outputs are internal by default. Do not turn them into public comparative claims without redaction, reruns, and explicit review of benchmark fit.',
    '',
  ]
  return lines.join('\n')
}

export async function writeBenchmarkReport(
  reportInput: BenchmarkReportData,
  outputDir: string,
): Promise<BenchmarkReportData> {
  const report = BenchmarkReport.parse(reportInput)
  await fs.mkdir(outputDir, { recursive: true })
  const jsonl = path.join(outputDir, `${report.id}.jsonl`)
  const markdown = path.join(outputDir, `${report.id}.md`)
  const lines = [
    ...report.results.map(result => JSON.stringify({ type: 'result', payload: result })),
    ...report.autoResolutions.map(record => JSON.stringify({ type: 'auto_resolution', payload: record })),
  ]
  await fs.writeFile(jsonl, lines.join('\n') + '\n', 'utf8')
  await fs.writeFile(markdown, renderBenchmarkMarkdown(report), 'utf8')
  return {
    ...report,
    outputPaths: { jsonl, markdown },
  }
}
