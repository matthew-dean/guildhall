import fs from 'node:fs/promises'
import path from 'node:path'
import { assertSafePersistentBenchmarkOutputDir } from './paths.js'

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
  const scoreableResults = results.filter(result => Number.isFinite(result.qualityScore)).length
  const resultAutoResolutions = results.reduce((sum, result) => sum + result.autoResolutionCount, 0)
  const resultBlockedByPolicy = results.reduce((sum, result) => sum + result.blockedByPolicyCount, 0)
  const averageQualityScore = scoreableResults === 0
    ? 0
    : Number(
        (results.reduce((sum, result) => sum + (Number.isFinite(result.qualityScore) ? result.qualityScore : 0), 0) /
          scoreableResults).toFixed(1),
      )
  return {
    total: results.length,
    passed: results.filter(result => result.result === 'pass').length,
    failed: results.filter(result => result.result === 'fail').length,
    unsupported: results.filter(result => result.result === 'unsupported').length,
    inconclusive: results.filter(result => result.result === 'inconclusive').length,
    falseSuccesses: results.filter(result => result.failureClass === 'false_success').length,
    blockedByPolicy: resultBlockedByPolicy + autoResolutions.filter(record => record.status === 'blocked_by_policy').length,
    autoResolutions: resultAutoResolutions + autoResolutions.filter(record => record.status !== 'blocked_by_policy').length,
    scoreableResults,
    averageQualityScore,
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
    `- Average quality: ${report.summary.averageQualityScore} (${report.summary.scoreableResults} scored)`,
    '',
    '## Results',
    '',
    '| Task | Result | Failure class | Quality | Tokens in/out/cache | Cost USD | Ticks | Automation | Commands | Latency ms | Touched files | Evidence |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ...report.results.map(result => [
      result.taskId,
      result.result,
      result.failureClass,
      result.qualityScore,
      `${result.tokenUse.input}/${result.tokenUse.output}/${result.tokenUse.cachedInput}`,
      result.costUsd === null ? 'n/a' : result.costUsd.toFixed(6),
      result.orchestratorTicks || result.turns,
      [
        result.autoResolutionCount > 0 ? `${result.autoResolutionCount} repair(s)` : '0',
        ...Object.entries(result.automationResolutionKinds).map(([kind, count]) => `${kind}:${count}`),
      ].join('<br>'),
      result.commandCount,
      result.durationMs,
      [
        result.touchedFiles.join(', ') || 'none',
        result.unexpectedTouchedFiles.length > 0 ? `unexpected: ${result.unexpectedTouchedFiles.join(', ')}` : '',
        result.missingExpectedFiles.length > 0 ? `missing: ${result.missingExpectedFiles.join(', ')}` : '',
      ].filter(Boolean).join('<br>'),
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
  const safeOutputDir = assertSafePersistentBenchmarkOutputDir(outputDir)
  await fs.mkdir(safeOutputDir, { recursive: true })
  const jsonl = path.join(safeOutputDir, `${report.id}.jsonl`)
  const markdown = path.join(safeOutputDir, `${report.id}.md`)
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
