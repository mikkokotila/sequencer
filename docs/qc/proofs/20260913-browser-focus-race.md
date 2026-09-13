# Sample browser focus race

PR #42 Chrome CI [run 34755019044](https://github.com/mikkokotila/sequencer/actions/runs/34755019044) failed the existing modal Space test while the compiler job passed. The browser scheduled search autofocus 50 ms after opening; this could steal focus from Close before Space activated it.

The mounted search field now receives focus synchronously when opening. Later user focus changes are not overridden. No test retries, timeouts, assertions, or gates are weakened.

The regression freezes the browser clock, focuses Close, then advances through the former delay. It fails against the original implementation (Close loses focus) and passes 20 consecutive times after the fix, including Space closure and contenteditable transport exclusion.

Real-browser verification was performed in the actual local app: search receives focus on opening; Close leaves transport stopped and the library song intact. Full compiler-executed gates and audio/control oracle results are recorded in the committed verdict.
