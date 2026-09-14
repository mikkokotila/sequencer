import { test, expect } from '@playwright/test';

test('device clock uses latency fallback for missing, stale, or invalid timestamps', async ({
  page,
}) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { getOutputTime } = await import('/src/engine/output-clock.ts');
    const context = {
      state: 'running',
      currentTime: 10,
      outputLatency: 0.09,
      baseLatency: 0.01,
      getOutputTimestamp: () => ({ contextTime: 9.8, performanceTime: performance.now() - 10 }),
    };
    const read = () => getOutputTime(context as unknown as AudioContext);
    const valid = read();
    context.getOutputTimestamp = () => ({
      contextTime: 9.8,
      performanceTime: performance.now() - 2000,
    });
    const stale = read();
    context.getOutputTimestamp = () => ({
      contextTime: 9.8,
      performanceTime: performance.now() + 10,
    });
    const future = read();
    context.getOutputTimestamp = () => ({
      contextTime: NaN,
      performanceTime: performance.now() - 10,
    });
    const invalid = read();
    context.getOutputTimestamp = () => {
      throw new Error('API unavailable');
    };
    const missing = read();
    context.state = 'suspended';
    return { valid, stale, future, invalid, missing, suspended: read() };
  });
  expect(result.valid).toBeCloseTo(9.81, 2);
  expect(result.stale).toBeCloseTo(9.9, 5);
  expect(result.future).toBeCloseTo(9.9, 5);
  expect(result.invalid).toBeCloseTo(9.9, 5);
  expect(result.missing).toBeCloseTo(9.9, 5);
  expect(result.suspended).toBe(0);
});
