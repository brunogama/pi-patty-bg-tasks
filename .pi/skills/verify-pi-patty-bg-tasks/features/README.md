# Verification feature map

This map covers the extension's registered shell, job, and command-monitor tools. Each drive starts a new in-memory Pi session with a unique temporary working directory. It does not reuse your current Pi conversation or its jobs.

## Preconditions

- Run the commands from the repository root with the checkout's dependencies installed.
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

Ctrl+Shift+B, `/bg`, `agent_bg`, and WebSocket monitors need different drivers. This map makes no claim that those paths passed when one of the drives above passes.
