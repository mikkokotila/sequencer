// Dedicated measurement clock. The end handshake timestamps AFTER the audio
// thread finishes its DSP span. A stale start can only overestimate duration.
onmessage = ({ data }) => {
  const ticks = new BigInt64Array(data.ticks);
  const control = new Int32Array(data.control);
  let previous = performance.now(), resolution = Infinity;
  for (let i = 0; i < 100000; i++) {
    const now = performance.now();
    if (now > previous) resolution = Math.min(resolution, now - previous);
    previous = now;
  }
  if (!crossOriginIsolated || resolution > 0.1) {
    postMessage({ type: 'error', error: 'An isolated high-resolution clock is unavailable' });
    return;
  }
  postMessage({ type: 'ready', resolution });
  let acknowledged = 0;
  while (Atomics.load(control, 2) === 0) {
    Atomics.store(ticks, 0, BigInt(Math.floor(performance.now() * 1000)));
    const requested = Atomics.load(control, 0);
    if (requested !== acknowledged) {
      Atomics.store(ticks, 1, BigInt(Math.ceil(performance.now() * 1000)));
      Atomics.store(control, 1, requested);
      acknowledged = requested;
    }
  }
};
