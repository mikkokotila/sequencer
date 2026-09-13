/** Independent validation of raw product-DSP timing packets. Never trust a page's PASS label. */
export function validateBenchmarkEvidence(value) {
  const failures = [];
  const fail = message => failures.push(message);
  if (!value || typeof value !== 'object' || !Array.isArray(value.samples)) return { ok: false, failures: ['Missing raw product DSP samples'] };
  const processors = ['compressor-processor', 'saturation-processor', 'freeverb-processor', 'delay-processor', 'transformer-processor'];
  const effects = ['compressor', 'pultec-eq', 'transformer', 'mixer', 'reverb', 'delay'];
  if (value.schemaVersion !== 1 || value.timer !== 'shared-worker-handshake' || value.quantizationUpperBoundMs !== 0.2) fail('Unverified timing source or precision');
  if (value.frames !== 128 || value.sampleRate !== 48000) fail('Benchmark must use actual 128-frame rendering at 48kHz');
  if (!Number.isFinite(value.workload?.voices) || value.workload.voices < 16) fail('Fewer than 16 sample voices');
  if (!effects.every(name => value.workload?.effects?.includes(name))) fail('Not all product effects were enabled');
  if (JSON.stringify(value.workload?.processors) !== JSON.stringify(processors)) fail('Missing shipped DSP processor identities');
  const samples = value.samples;
  if (samples.length < 50) fail('Insufficient sample count');
  let valid = true;
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i], previous = samples[i - 1];
    if (!s || ![s.frame, s.frames, s.startedAt, s.endedAt, s.wallStart, s.wallEnd, s.durationUpperBoundMs].every(Number.isFinite)
        || s.frames !== 128 || s.error || s.endedAt < s.startedAt || s.wallEnd < s.wallStart
        || s.durationUpperBoundMs < s.wallEnd - s.wallStart - 1
        || Math.abs(s.durationUpperBoundMs - (s.endedAt - s.startedAt + 0.2)) > 1e-6
        || JSON.stringify(s.counts) !== '[1,2,1,1,1]'
        || (previous && (s.frame !== previous.frame + 128 || s.startedAt < previous.startedAt || s.endedAt < previous.endedAt))) {
      valid = false; break;
    }
  }
  if (!valid) fail('Invalid, incomplete or discontinuous raw processing samples');
  const durationMs = samples.at(-1)?.endedAt - samples[0]?.startedAt;
  const wallDurationMs = samples.at(-1)?.wallEnd - samples[0]?.wallStart;
  if (!Number.isFinite(wallDurationMs) || Math.abs(durationMs - wallDurationMs) > 3) fail('Independent wall-clock duration disagrees with shared-clock duration');
  const coverage = samples.length * 128 / (durationMs / 1000 * 48000);
  if (!Number.isFinite(durationMs) || durationMs < 10000) fail('Less than ten seconds of measured product processing');
  if (!Number.isFinite(coverage) || coverage < 0.9 || coverage > 1.1) fail('Render throughput is outside the real-time workload bounds');
  const durations = valid ? samples.map(s => s.durationUpperBoundMs).sort((a,b) => a-b) : [];
  const p99 = durations[Math.floor(durations.length * 0.99)];
  const budget = 128 / 48000 * 1000;
  if (!Number.isFinite(p99) || p99 >= budget) fail('Product DSP p99 upper bound exceeds the real quantum budget');
  return { ok: failures.length === 0, failures, p99, budget, sampleCount: samples.length, durationMs, coverage };
}
