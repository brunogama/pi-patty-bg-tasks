#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createAgentSession, DefaultResourceLoader, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const extensionPath = join(repo, "index.ts");
const requiredTools = ["bash", "bash_bg", "jobs", "monitor", "agent_bg"];
const mode = process.argv[2];
const feature = process.argv[3];
const scratch = mkdtempSync(join(tmpdir(), "pi-patty-verify-run-"));
const agentDir = mkdtempSync(join(tmpdir(), "pi-patty-verify-agent-"));
const controller = new AbortController();
const activeJobs = new Set();
let session;
let callNumber = 0;
let proof;

for (const signal of ["SIGINT", "SIGTERM"]) {
    process.once(signal, () => {
        controller.abort();
        process.exitCode = signal === "SIGINT" ? 130 : 143;
    });
}

async function start() {
    const settingsManager = SettingsManager.inMemory();
    const loader = new DefaultResourceLoader({
        cwd: scratch,
        agentDir,
        settingsManager,
        additionalExtensionPaths: [extensionPath],
    });
    await loader.reload();
    ({ session } = await createAgentSession({
        cwd: scratch,
        agentDir,
        settingsManager,
        resourceLoader: loader,
        sessionManager: SessionManager.inMemory(scratch),
    }));
    await session.bindExtensions({});
    const tools = session.getAllTools();
    const active = new Set(session.getActiveToolNames());
    for (const name of requiredTools) {
        assert.equal(tools.find((tool) => tool.name === name)?.sourceInfo.path, extensionPath,
            `${name} must come from this checkout, not a globally installed extension`);
        assert.ok(active.has(name), `${name} must be active in the Pi session`);
    }
    assert.equal(session.sessionFile, undefined, "the verification session must stay in memory");
    return tools.filter((tool) => requiredTools.includes(tool.name)).map((tool) => tool.name);
}

async function call(name, params) {
    const tool = session.agent.state.tools.find((item) => item.name === name);
    assert.ok(tool, `${name} must be available to the Pi agent`);
    const updates = [];
    const result = await tool.execute(`verify-${++callNumber}`, params, controller.signal, (update) => {
        updates.push(update.content.map((item) => item.text).join("\n"));
    });
    const text = result.content.map((item) => item.text).join("\n");
    proof?.actions.push({ tool: name, params, updates, result: text });
    return text;
}

function jobId(text, kind) {
    const match = kind === "monitor" ? /Monitor (\w+) started/ : /with ID: (\w+)\./;
    const id = match.exec(text)?.[1];
    assert.ok(id, `Missing ${kind} ID in: ${text}`);
    activeJobs.add(id);
    return id;
}

function quote(value) {
    return `'${value.replaceAll("'", "'\\''")}'`;
}

async function drive() {
    const marker = join(scratch, "result.txt");
    if (feature === "foreground") {
        const result = await call("bash", {
            command: `printf 'FORE_OK\\n' > ${quote(marker)}; printf 'FOREGROUND_DONE\\n'`,
        });
        assert.match(result, /FOREGROUND_DONE/);
        assert.equal(readFileSync(marker, "utf8"), "FORE_OK\n");
        proof.observations = { marker: "FORE_OK", result };
        return;
    }
    if (feature === "background") {
        const started = await call("bash_bg", {
            command: `printf 'BG_OK\\n' > ${quote(marker)}; printf 'BACKGROUND_DONE\\n'`,
            name: "verification job",
        });
        const id = jobId(started, "shell");
        const listed = await call("jobs", { action: "list" });
        const attached = await call("jobs", { action: "attach", jobId: id });
        const output = await call("jobs", { action: "output", jobId: id });
        const search = await call("jobs", { action: "search", pattern: "BACKGROUND_DONE" });
        assert.match(listed, new RegExp(id));
        assert.match(listed, /verification job/);
        assert.match(attached, /Status: completed/);
        assert.match(output, /BACKGROUND_DONE/);
        assert.match(search, /BACKGROUND_DONE/);
        assert.equal(readFileSync(marker, "utf8"), "BG_OK\n");
        proof.observations = { jobId: id, marker: "BG_OK", attached, output, search };
        return;
    }
    if (feature === "monitor") {
        const started = await call("monitor", {
            command: "printf 'MONITOR_EVENT\\n'; printf 'MONITOR_DIAGNOSTIC\\n' >&2; exit 7",
            description: "verification events",
        });
        const id = jobId(started, "monitor");
        const attached = await call("jobs", { action: "attach", jobId: id });
        const output = await call("jobs", { action: "output", jobId: id });
        const event = await call("jobs", { action: "search", pattern: "MONITOR_EVENT" });
        const diagnostic = await call("jobs", { action: "search", pattern: "MONITOR_DIAGNOSTIC" });
        assert.match(attached, /Status: failed/);
        assert.match(output, /MONITOR_EVENT/);
        assert.match(output, /stderr:\nMONITOR_DIAGNOSTIC/);
        assert.match(event, /\.log:\d+: MONITOR_EVENT/);
        assert.match(diagnostic, /\.err:\d+: MONITOR_DIAGNOSTIC/);
        const notification = session.messages.find((message) =>
            message.role === "custom" && message.customType === "bg-monitor-event" &&
            String(message.content).includes("MONITOR_EVENT")
        );
        assert.ok(notification, "Pi must deliver the stdout line as a monitor event");
        proof.observations = { jobId: id, notification: notification.content, attached, output, event, diagnostic };
        return;
    }
    throw new Error(`Unknown feature: ${feature}. Use foreground, background, or monitor.`);
}

async function cleanup() {
    try {
        if (session) {
            for (const id of activeJobs) {
                try {
                    await call("jobs", { action: "kill", jobId: id });
                } catch (error) {
                    if (!String(error).includes("not running") && !String(error).includes("No task found")) throw error;
                }
            }
            await call("jobs", { action: "cleanup" });
        }
    } finally {
        session?.dispose();
        rmSync(scratch, { recursive: true, force: true });
        rmSync(agentDir, { recursive: true, force: true });
    }
}

if (mode !== "doctor" && mode !== "drive") {
    console.error("Usage: verify.mjs doctor | drive <foreground|background|monitor>");
    process.exitCode = 2;
    rmSync(scratch, { recursive: true, force: true });
    rmSync(agentDir, { recursive: true, force: true });
} else {
    const evidenceDir = mode === "drive" ? mkdtempSync(join(tmpdir(), "pi-patty-proof-")) : undefined;
    if (evidenceDir) proof = { feature, startedAt: new Date().toISOString(), actions: [] };
    try {
        if (proof) {
            proof.verifierSha256 = createHash("sha256").update(readFileSync(fileURLToPath(import.meta.url))).digest("hex");
            proof.headRevision = execFileSync("git", ["-C", repo, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
        }
        const loadedTools = await start();
        if (mode === "doctor") {
            const pkg = JSON.parse(readFileSync(join(repo, "package.json"), "utf8"));
            console.log(JSON.stringify({ ready: true, version: pkg.version, node: process.version, tools: loadedTools, source: extensionPath, isolated: true }));
        } else {
            await drive();
        }
    } catch (error) {
        process.exitCode = 1;
        if (proof) proof.error = String(error);
        else console.error(error);
    } finally {
        try {
            await cleanup();
        } catch (error) {
            process.exitCode = 1;
            if (proof) proof.cleanupError = String(error);
            else console.error(error);
        }
        if (proof) {
            proof.cleanup = { scratchRemoved: !existsSync(scratch), agentDirectoryRemoved: !existsSync(agentDir) };
            if (!proof.cleanup.scratchRemoved || !proof.cleanup.agentDirectoryRemoved) {
                process.exitCode = 1;
                proof.cleanupError ??= "Isolated session directories remained after cleanup";
            }
            proof.finishedAt = new Date().toISOString();
            proof.exitCode = process.exitCode ?? 0;
            const artifact = join(evidenceDir, `${feature || "unknown"}.json`);
            writeFileSync(artifact, JSON.stringify(proof, null, 2) + "\n");
            assert.ok(existsSync(artifact), "evidence must survive cleanup");
            console.log(`Evidence: ${artifact}`);
            if (proof.error) console.error(proof.error);
        }
    }
}
