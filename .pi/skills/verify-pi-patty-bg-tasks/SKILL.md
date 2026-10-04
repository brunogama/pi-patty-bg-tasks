---
name: verify-pi-patty-bg-tasks
description: Verify the pi-patty-bg-tasks Pi extension through its registered bash, bash_bg, jobs, and monitor tools. Use after changing background command execution, job management, or command monitors.
---

# Verify pi-patty-bg-tasks

Drive the extension from a fresh, in-memory Pi SDK session. The verifier loads this checkout's `index.ts`, calls the same registered tools that Pi gives the agent, and saves the tool results and file side effects. It does not call a model. It does not cover terminal shortcuts, `agent_bg`, or WebSocket monitors. Read [the feature map](features/README.md) before choosing a drive.

## Launch

Run from the repository root with Node.js 22 or newer and the checkout's dependencies installed:

```sh
cd "$(git rev-parse --show-toplevel)"
npm run check
node .pi/skills/verify-pi-patty-bg-tasks/scripts/verify.mjs doctor
```

The extension is a Pi package, not a server. No port, account, seed data, or persistent process is needed. Each `drive` command creates its own temporary working directory and Pi session, loads `index.ts`, and ends after its tool calls. If dependencies are missing, use the repository's lockfile with `corepack pnpm install --frozen-lockfile` before running the commands. Ask before allowing a dependency install that needs network access.

---

## Doctor

Run `node .pi/skills/verify-pi-patty-bg-tasks/scripts/verify.mjs doctor` when a drive fails or the loaded extension looks wrong. Require `ready: true`, `isolated: true`, all five extension tools, and `source` pointing to this checkout's `index.ts`. The output also reports the package and Node versions. Doctor loads a temporary in-memory session, then removes it. It neither writes to the checkout nor calls a model.

---

## Drive

Run one feature at a time. The command exits with status `0` only after it checks the tool results and the command's file side effect.

```sh
node .pi/skills/verify-pi-patty-bg-tasks/scripts/verify.mjs drive foreground
node .pi/skills/verify-pi-patty-bg-tasks/scripts/verify.mjs drive background
node .pi/skills/verify-pi-patty-bg-tasks/scripts/verify.mjs drive monitor
```

Start with [background commands](features/background.md) when checking the main job flow. Use [foreground commands](features/foreground.md) for the `bash` override, or [command monitors](features/monitor.md) for per-line notifications and stderr diagnostics. The verifier calls registered Pi tools directly through the SDK. It does not assert that an LLM chose a tool or that a TUI shortcut worked.

---

## Evidence

A drive prints `Evidence: <path>`. Open that JSON file after the command exits. It records the Git `headRevision` (a baseline if changes are uncommitted), a SHA-256 hash of the exact verifier script, and each tool call with its arguments, progress updates, and returned text. The `observations` field includes the verified command output and the contents of any file the command wrote. For a monitor, it includes the delivered Pi custom notification and both stdout and stderr search results. Require `exitCode: 0` and both `cleanup` values to be `true`.

The evidence file lives in its own system temporary directory, outside the disposable Pi session. The verifier does not trust the word "cleanup": it checks that both session directories are gone, then writes the evidence file. Retain the JSON file when reporting a result or diagnosing a failure. A failed drive also writes an artifact with its error and actions attempted.

---

## Cleanup

The verifier stops only the job IDs it started, calls `jobs cleanup`, disposes its in-memory session, and removes its two scratch directories. Its `SIGINT` and `SIGTERM` handlers abort a pending tool call so the same cleanup runs. Do not kill by process name or delete the evidence directory. A forced `SIGKILL` bypasses cleanup. If that happens, inspect the OS processes and logs. Terminate only a PID you can tie to that run.

---

## Helpers

`scripts/verify.mjs` is executable. Invoke it with `node` as shown above, or run `./.pi/skills/verify-pi-patty-bg-tasks/scripts/verify.mjs doctor`. It resolves the checkout relative to its own file, not from an absolute machine-specific path. Keep its three drive names aligned with [the feature index](features/README.md).
