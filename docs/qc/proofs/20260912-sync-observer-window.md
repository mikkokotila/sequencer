# Synchronization observer boundary race

GitHub's browser gate on b801e6a reported a phrase mismatch at a boundary, while the independently running compiler gate passed. Six unchanged local repetitions reproduced a related boundary disagreement once: step 55 was shown at scheduled time 8.144441352 s, while the observer's later device-clock reading was 8.144387912 s. The 53.44 microsecond difference classified the same boundary as step 54. Raw observations and failing logs are preserved; this was not resolved by rerunning CI until green.

The probe now captures device-clock readings before and after the application's render callback. It accepts only the latest scheduled step within that measured interval, with the existing 1 ms visual-clock precision budget. The marker must match the displayed step's phrase, and observer work must remain below 30 ms. Error messages include the complete failed observation. This accounts for clock rounding and time spent observing without accepting an obsolete frame from before the interval.

Audio acceptance is unchanged: zero late source starts, equal onset counts across all nine tracks, inter-track skew no greater than one sample, and no surviving sources or visuals after stop. No application, scheduling, DSP, production-serving or governance code changes in this follow-up.

Final repeated pressure and compiler validation results are recorded in the task artifacts. The current runtime source retains its earlier passing audio and compiler evidence. Historical proof debt and macOS sample-folder access are unchanged.

All six corrected pressure repetitions passed: 16995 scheduled sources, zero late starts, zero inter-track onset skew and zero invalid/stale frames. Maximum observer work was 2.9 ms; maximum measured clock window including rounding allowance was 4.89 ms.

Final compiler verdict: PASS with zero diagnostics. All six command gates, all 84 browser tests and both required audio oracles passed. The initial missing control-table entry in the follow-up specification was corrected before validation.
