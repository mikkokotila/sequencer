# Export failure diagnostics

The user reported that Download WAV immediately showed “Export cancelled.” The existing tab retained its song but the local server on port 5173 was no longer listening. Offline rendering loads fresh AudioWorklet processors from the server, and the browser reports a failed module load as AbortError. The dialog incorrectly treated every AbortError as deliberate cancellation.

The explicit product repair request overrides the default GA-only scope. This branch starts from main at 5777c385ce8fa218a8ffc98f061edd3ab3b04128. No new product features, DSP changes, sample changes, or governance policy changes.

## Changes

- The export dialog uses its own AbortSignal to identify cancellation. Other failures retain their error details and visible error styling, even when the browser calls them AbortError.
- Failed offline processor registration reports that the audio processors could not load and asks the user to check server availability before retrying. Explicit cancellation during setup still returns AbortError.
- Existing cleanup and retry behavior remain intact; rendering captures the current song and mix without changing live state.

## Evidence

Three new regressions cover WAV and MP3 processor-registration failure followed by successful real file downloads, plus a native rendering AbortError followed by successful WAV retry. They assert visible failure, absence of false cancellation, cleared error styling after recovery, no premature download, and retained song name, tempo and note. The first network-route fixture did not exercise failure because Chromium reused cached worklet modules; the corrected fixture injects the browser-native registration failure at AudioWorklet.addModule. All three assertions failed on the original implementation with “Export cancelled.”

The full 19-test audio export suite passes in Chromium. It also covers actual WAV/MP3 decoding, channel balance, captured state, effect tails, all processors, envelopes, melody/harmony, cancellation, encoder failure and playback continuity. Separate installed Google Chrome verification is recorded in the manifest. Compiler-owned full regression, static, contract, architecture, commit-range and audio oracle results are authoritative in the generated logs and verdict.

In the actual in-app browser, restoring the server allowed PLEIN RÉGIME to render its complete 36 phrases / 144 bars at the user's confirmed 96 BPM. The GUI reached “PLEIN RÉGIME.wav downloaded.” The song's current mix was retained; no import or reset was performed. The host download destination could not be inspected from the shell, so a successful in-app filesystem save is not asserted on the basis of that message alone. Automated Chrome download tests inspect the actual emitted files. No full-song acoustic measurement or hardware acceptance is claimed.

The first compiler run exposed an unsupported Error constructor cause option under the repository TypeScript target. The run was stopped before completion, the option removed, and all required gates rerun on the final implementation.
