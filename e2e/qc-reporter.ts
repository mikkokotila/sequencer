import path from 'node:path';
import type { Reporter, TestCase, TestResult, TestError } from '@playwright/test/reporter';

function oneLine(value: string): string {
  return value.replace(/\u001b\[[0-9;]*m/g, '').replace(/\|/g, '/').replace(/\s+/g, ' ').trim();
}

/** Preserve actionable Playwright failures in the compiler's existing FAIL-ITEM protocol. */
export default class QcReporter implements Reporter {
  onTestEnd(test: TestCase, result: TestResult): void {
    if (result.status === test.expectedStatus || result.status === 'skipped') return;
    const location = `${path.relative(process.cwd(), test.location.file)}:${test.location.line}`;
    const title = oneLine(test.titlePath().filter(Boolean).join(' › '));
    const message = oneLine(result.errors.map(error => error.message || error.value || result.status).join(' '));
    console.log(`FAIL-ITEM | e2e | ${title} @ ${location} | ${message.slice(0, 2400)}`);
  }
  onError(error: TestError): void {
    console.log(`FAIL-ITEM | e2e | global setup | ${oneLine(error.message || error.value || 'unknown error').slice(0, 2400)}`);
  }
}
