/** Estimate the sample currently reaching the output device, not the render head. */
export function getOutputTime(ctx: AudioContext): number {
  if (ctx.state !== 'running') return 0;
  try {
    const stamp = ctx.getOutputTimestamp();
    const age = (performance.now() - (stamp.performanceTime ?? 0)) / 1000;
    if (Number.isFinite(stamp.contextTime) && stamp.performanceTime && age >= 0 && age < 1) {
      return Math.max(0, Math.min(ctx.currentTime, (stamp.contextTime ?? 0) + age));
    }
  } catch {
    // Older browsers do not expose the output timestamp API.
  }
  const latency = (ctx.outputLatency || 0) + (ctx.baseLatency || 0);
  return Math.max(0, ctx.currentTime - latency);
}
