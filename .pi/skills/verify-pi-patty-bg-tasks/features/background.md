# Background command

Pi starts a shell command with `bash_bg` and returns a job ID immediately. The user can inspect that job with `jobs` while it runs and after it completes.

## Sub-features

- `background-start`: `bash_bg` returns a job ID and log path.
- `background-list`: `jobs list` shows the named job.
- `background-attach`: `jobs attach` waits for a completed status.
- `background-output`: `jobs output` returns `BACKGROUND_DONE` from the job's log.
- `background-search`: `jobs search` finds the same line and its log path.
- `background-file`: the job writes `BG_OK` to `result.txt` in its isolated working directory.

---

## How to get to it (user POV)

Ask Pi to call `bash_bg({ command: "printf 'BACKGROUND_DONE\\n'", name: "verification job" })`. Then use the returned ID with `jobs({ action: "attach", jobId: id })` and `jobs({ action: "output", jobId: id })`. Search by calling `jobs({ action: "search", pattern: "BACKGROUND_DONE" })`.

---

## Driving it with the SDK verifier

Preconditions:

- `doctor` reports that `bash_bg` and `jobs` come from this checkout's `index.ts`.
- The verifier has a new in-memory Pi session and a unique temporary working directory.

Run `node .pi/skills/verify-pi-patty-bg-tasks/scripts/verify.mjs drive background`. The drive makes the `bash_bg` call, lists jobs, attaches, reads the output, searches the log, and reads the marker file before cleanup. Require `observations.attached` to contain `Status: completed`, `observations.output` and `observations.search` to contain `BACKGROUND_DONE`, `observations.marker` to equal `BG_OK`, and `exitCode` to equal `0`. Compare the returned `.log` path with the search hit, then confirm that exact path is absent after `jobs cleanup`; the evidence's `cleanup` booleans cover only the session directories.

---

## Verify private log creation

Run the [private-log probe](../SKILL.md#check-private-log-creation) and `node --experimental-strip-types --test src/__tests__/spawn.test.ts`. Require a `0o600` shell `.log` containing stdout and stderr, plus `EEXIST` when opening the same path again. `drive background` checks job behavior but does not assert file mode or exclusive creation.

---

## Gotchas

- The job can finish before `jobs list` runs. Its ID must still appear in the list.
- `jobs attach` reports status, not the full output. Use `jobs output` for the log.
- This drive does not test `bash({ run_in_background: true })`, manual TUI backgrounding, or `agent_bg`.
