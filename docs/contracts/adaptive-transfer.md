# Adaptive Transfer Contract

## Mandate

Every nonlinear audio processor must exhibit signal-dependent behavior: its transfer function, timing, or harmonic output must vary as a function of the input signal's level, frequency content, or history — not only as a function of user-facing parameters.

A processor whose output is fully determined by a static curve applied identically to every sample regardless of context is rejected.

## Requirements

| Processor | Required adaptive behavior |
|-----------|---------------------------|
| Compressor | Envelope timing shifts with program material. Attack/release respond differently to transients vs sustained signals. |
| Saturation | Harmonic distortion scales with input level. Quiet signals pass cleaner than loud signals. Varies with frequency band and prior signal state. |
| Waveshaper | Drive-dependent curve crossfades from identity at zero to full saturation. Not a fixed static curve at any nonzero setting. |
| Tape emulation | Bias and saturation characteristics change with signal history. High-frequency content saturates before low. |
| Transformer | Even-harmonic content scales proportionally with input level. |

## Exempt

Linear processors are exempt: EQ, delay, gain, pan, and any processor whose output is a linear function of its input.

## How to verify

For any nonlinear processor, feed two signals through it with identical parameter settings:
1. A quiet sine wave at -30dBFS
2. A loud sine wave at -6dBFS

Measure THD on both outputs. If the THD is identical, the processor violates this contract — it's applying a static curve regardless of input level.
