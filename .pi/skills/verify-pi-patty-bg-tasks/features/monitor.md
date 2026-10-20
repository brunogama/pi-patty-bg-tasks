# Command monitor

Pi's `monitor` tool sends complete stdout lines in notifications, which may batch several lines, while retaining stderr for diagnosis. The verifier checks the event, the terminal failure, and both log searches.

## Sub-features

- `monitor-event`: the `MONITOR_EVENT` stdout line reaches Pi as a `bg-monitor-event` custom message.
- `monitor-failure`: the command exits with code 7 and `jobs attach` reports failure.
- `monitor-diagnostic`: `jobs output` includes the stderr line `MONITOR_DIAGNOSTIC`.
- `monitor-search`: `jobs search` finds the stdout line in `.log` and the diagnostic in `.err`.

---

## How to get to it (user POV)

Ask Pi to call `monitor({ command: "printf 'MONITOR_EVENT\\n'; printf 'MONITOR_DIAGNOSTIC\\n' >&2; exit 7", description: "verification events" })`. The command intentionally exits 7. Inspect the event in the conversation, then use `jobs({ action: "output", jobId: id })` and `jobs({ action: "search", pattern: "MONITOR_DIAGNOSTIC" })` for diagnostics.

---

## Driving it with the SDK verifier

Preconditions:

- `doctor` reports that `monitor` and `jobs` come from this checkout's `index.ts`.
- No WebSocket endpoint or other external service is needed.

Run `node .pi/skills/verify-pi-patty-bg-tasks/scripts/verify.mjs drive monitor`. The drive emits one stdout event, writes a separate stderr diagnostic, and exits with code 7. The verifier requires a delivered Pi custom event, `Status: failed`, both lines in `jobs output`, `.log` and `.err` paths in `jobs search`, and a drive `exitCode` of `0`. The command's failure is expected. A successful drive means Pi reported and retained it correctly.

---

## Verify private log creation

Run the [private-log probe](../SKILL.md#check-private-log-creation) and `node --experimental-strip-types --test src/__tests__/monitor.test.ts`. For a command monitor, require separate `0o600` stdout `.log` and stderr `.err` files and `EEXIST` when the stderr path exists. For a WebSocket monitor, require a `0o600` `.log` and `EEXIST` when that path exists. The WebSocket test stubs `globalThis.WebSocket` and checks frames written to the log; `drive monitor` exercises only a command monitor and does not assert log modes or exclusive creation.

---

## Gotchas

- Only stdout becomes an event. Stderr is a separate diagnostic until the command redirects it to stdout.
- A command failure is not a verifier failure when `jobs attach` reports that failure and diagnostics remain visible.
- This drive covers command monitors only. It does not verify WebSocket frames or a persistent monitor.
