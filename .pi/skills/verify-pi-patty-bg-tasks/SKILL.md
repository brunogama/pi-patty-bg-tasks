---
name: verify-pi-patty-bg-tasks
description: Verify the pi-patty-bg-tasks Pi extension through its registered bash, bash_bg, jobs, and monitor tools. Use after changing background execution, command monitors, WebSocket monitors, or private log creation.
---

# Verify pi-patty-bg-tasks

Drive the extension from a fresh, in-memory Pi SDK session. The verifier loads this checkout's `index.ts`, calls the same registered tools that Pi gives the agent, and saves the tool results and file side effects. It does not call a model. Its drives cover command monitors, not WebSocket monitors, and do not assert log permissions or exclusive creation. Use the private-log probe below for those properties. The verifier does not cover terminal shortcuts or `agent_bg`. Read [the feature map](features/README.md) before choosing a drive.

## Launch

Run from the repository root with Node.js 22 or newer and the checkout's dependencies installed:

```sh
cd "$(git rev-parse --show-toplevel)"
npm run check
node .pi/skills/verify-pi-patty-bg-tasks/scripts/verify.mjs doctor
```

The extension is a Pi package, not a server. No port, account, seed data, or persistent process is needed. Each `drive` command creates its own temporary working directory and Pi session, loads `index.ts`, and ends after its tool calls. If dependencies are missing, document which checks could not run. Do not install packages without authorization; missing dependencies do not block Markdown updates.

---

## Doctor

Run `node .pi/skills/verify-pi-patty-bg-tasks/scripts/verify.mjs doctor` when a drive fails or the loaded extension looks wrong. Require `ready: true`, `isolated: true`, all five extension tools, and `source` pointing to this checkout's `index.ts`. The output also reports the package and Node versions. Doctor loads a temporary in-memory session, then removes it. It neither writes to the checkout nor calls a model.

---

## Drive

Run `doctor` before each drive because each drive creates a fresh Pi session. Run one feature at a time. The command exits with status `0` only after it checks the tool results and the command's file side effect.

```sh
node .pi/skills/verify-pi-patty-bg-tasks/scripts/verify.mjs drive foreground
node .pi/skills/verify-pi-patty-bg-tasks/scripts/verify.mjs drive background
node .pi/skills/verify-pi-patty-bg-tasks/scripts/verify.mjs drive monitor
```

Start with [background commands](features/background.md) when checking the main job flow. Use [foreground commands](features/foreground.md) for the `bash` override, or [command monitors](features/monitor.md) for stdout notifications and stderr diagnostics. The verifier calls registered Pi tools directly through the SDK. It does not assert that an LLM chose a tool or that a TUI shortcut worked.

---

## Check private log creation

Run from the repository root on Node.js 22 or newer. This probe imports the source without Pi SDK dependencies, uses a fake WebSocket instead of a network endpoint, and removes its temporary files. It sets a permissive umask to test that creation still yields owner-only files. `keepAlive: true` keeps the short-lived shell alive until the probe observes its exit.

```sh
node --experimental-strip-types --input-type=module <<'NODE'
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnWithFileOutput } from './src/spawn.ts';
import { openWsSource } from './src/monitor-ws.ts';
const dir = mkdtempSync(join(tmpdir(), 'patty-private-logs-'));
const oldUmask = process.umask(0);
const originalWebSocket = globalThis.WebSocket;
try {
  const logPath = join(dir, 'shell.log');
  const shell = spawnWithFileOutput({ command: "printf 'out\\n'; printf 'err\\n' >&2", cwd: dir, logPath, keepAlive: true });
  assert.equal((await shell.exit).code, 0);
  assert.equal(statSync(logPath).mode & 0o777, 0o600);
  assert.match(readFileSync(logPath, 'utf8'), /out/);
  assert.match(readFileSync(logPath, 'utf8'), /err/);
  assert.throws(() => spawnWithFileOutput({ command: 'echo overwrite', cwd: dir, logPath }), { code: 'EEXIST' });
  const errPath = join(dir, 'monitor.err');
  const split = spawnWithFileOutput({ command: "printf 'out\\n'; printf 'err\\n' >&2", cwd: dir, logPath: join(dir, 'monitor.log'), errPath, keepAlive: true });
  assert.equal((await split.exit).code, 0);
  assert.equal(statSync(join(dir, 'monitor.log')).mode & 0o777, 0o600);
  assert.equal(statSync(errPath).mode & 0o777, 0o600);
  writeFileSync(join(dir, 'existing.err'), 'sentinel');
  assert.throws(() => spawnWithFileOutput({ command: 'echo overwrite', cwd: dir, logPath: join(dir, 'fresh.log'), errPath: join(dir, 'existing.err') }), { code: 'EEXIST' });
  assert.equal(readFileSync(join(dir, 'existing.err'), 'utf8'), 'sentinel');
  globalThis.WebSocket = class { addEventListener() {} close() {} };
  const wsPath = join(dir, 'ws.log');
  const ws = openWsSource({ url: 'ws://example.invalid' }, wsPath);
  assert.equal(statSync(wsPath).mode & 0o777, 0o600);
  assert.throws(() => openWsSource({ url: 'ws://example.invalid' }, wsPath), { code: 'EEXIST' });
  ws.close();
  await ws.exit;
  console.log('PASS: private exclusive shell .log, command monitor .log/.err, and WebSocket .log');
} finally {
  globalThis.WebSocket = originalWebSocket;
  process.umask(oldUmask);
  rmSync(dir, { recursive: true, force: true });
}
NODE
```

Require `0o600` for the shell log, command-monitor stdout `.log` and stderr `.err`, and WebSocket `.log`. Require `EEXIST` rather than truncation when a path already exists. The check exercises `spawnWithFileOutput` and `openWsSource` directly. The shell path merges stdout and stderr; the command-monitor path splits them. The source uses `openSync(path, "wx", 0o600)` in both functions. The probe does not check permissions on the parent log directory or WebSocket event delivery.

Run the existing focused tests with `node --experimental-strip-types --test src/__tests__/spawn.test.ts src/__tests__/monitor.test.ts`. `spawn.test.ts` asserts the shell log mode. `monitor.test.ts` asserts the WebSocket log mode and checks split output, but does not assert the `.err` mode or exclusive creation. The probe supplies those missing assertions without changing the product tests.

---

## Evidence

A drive prints `Evidence: <path>`. Open that JSON file after the command exits. It records the Git `headRevision` (a baseline if changes are uncommitted), a SHA-256 hash of the exact verifier script, and each tool call with its arguments, progress updates, and returned text. The `observations` field includes the verified command output and the contents of any file the command wrote. For a monitor, it includes the delivered Pi custom notification and both stdout and stderr search results. Require `exitCode: 0` and both `cleanup` values to be `true`. For background and monitor drives, compare the job ID and log paths in the action results with `jobs search`, then check the exact `.log` and `.err` paths are absent after cleanup. The two booleans cover session directories, not job logs.

The evidence file lives in its own system temporary directory, outside the disposable Pi session. The verifier does not trust the word "cleanup": it checks that both session directories are gone, then writes the evidence file. Retain the JSON file when reporting a result or diagnosing a failure. A failed drive also writes an artifact with its error and actions attempted.

---

## Cleanup

The verifier stops only the job IDs it started, calls `jobs cleanup`, disposes its in-memory session, and removes its two scratch directories. Its `SIGINT` and `SIGTERM` handlers abort a pending tool call so the same cleanup runs. Do not kill by process name or delete the evidence directory. A forced `SIGKILL` bypasses cleanup. If that happens, inspect the OS processes and logs. Terminate only a PID you can tie to that run.

---

## Helpers

`scripts/verify.mjs` is executable. Invoke it with `node` as shown above, or run `./.pi/skills/verify-pi-patty-bg-tasks/scripts/verify.mjs doctor`. It resolves the checkout relative to its own file, not from an absolute machine-specific path. Keep its three drive names aligned with [the feature index](features/README.md).
