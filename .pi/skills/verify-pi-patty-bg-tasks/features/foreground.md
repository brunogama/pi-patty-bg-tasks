# Foreground command

Pi's `bash` tool runs a command and returns its output. The verifier also checks that the command wrote the expected file.

## Sub-features

- `foreground-result`: the registered `bash` tool returns `FOREGROUND_DONE`.
- `foreground-file`: the command creates `result.txt` with `FORE_OK` in the isolated working directory.

---

## How to get to it (user POV)

Ask Pi to run a short shell command with `bash({ command: "printf 'FOREGROUND_DONE\\n'" })`. On macOS, this extension uses zsh for shell commands. On other platforms, it uses Bash.

---

## Driving it with the SDK verifier

Preconditions:

- `doctor` reports that `bash` comes from this checkout's `index.ts`.
- No prior Pi session or server is needed.

Run `node .pi/skills/verify-pi-patty-bg-tasks/scripts/verify.mjs drive foreground`. The drive calls `bash`, checks the returned text, reads the created file, and prints an evidence path. Require `observations.result` to contain `FOREGROUND_DONE`, `observations.marker` to equal `FORE_OK`, and `exitCode` to equal `0`.

---

## Gotchas

- This is an in-memory, non-interactive Pi session. It does not prove the TUI hint, the Ctrl+Shift+B shortcut, or the interactive 120-second auto-background handoff.
- The command runs in a unique temporary directory. Check the captured marker value in the evidence file after cleanup, not the removed scratch path.
