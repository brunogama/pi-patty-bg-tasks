# Verification feature map

This map covers the extension's registered shell, job, and command-monitor tools. Each drive starts a new in-memory Pi session with a unique temporary working directory. It does not reuse your current Pi conversation or its jobs.

## Preconditions

- Run commands from the repository root. The SDK drives need the checkout's dependencies; the private-log probe does not.
- Run `node .pi/skills/verify-pi-patty-bg-tasks/scripts/verify.mjs doctor` and require the five tools to come from this checkout.
- Do not start an `agent_bg` run for this map. It calls a model and needs separate authorization.

---

## Driving conventions

- Use the `drive` command in the matching feature file. Do not substitute a unit test for a registered tool call.
- Check the `actions`, `observations`, `exitCode`, and `cleanup` fields in the printed evidence file.
- Treat the marker contents and returned `jobs` output as separate proof of a background command.
- Keep each evidence JSON file after its Pi session is cleaned up.

---

## Coverage

- [Foreground command](foreground.md) covers the `bash` override's result and filesystem side effect.
- [Background command](background.md) covers `bash_bg` launch, `jobs list`, `jobs attach`, `jobs output`, `jobs search`, and cleanup.
- [Command monitor](monitor.md) covers a delivered stdout event, a failed terminal status, stderr retrieval, and log search.
- [Private log creation](../SKILL.md#check-private-log-creation) checks `0600` modes and exclusive creation for shell stdout and stderr, split command-monitor diagnostics, and WebSocket logs with a direct source probe. The SDK drives do not assert these properties.

Ctrl+Shift+B, `/bg`, and `agent_bg` need different drivers. WebSocket frames are covered by a stubbed source unit test, not by an SDK drive; the direct private-log probe checks their log creation. This map makes no claim that those paths passed when one of the drives above passes.
