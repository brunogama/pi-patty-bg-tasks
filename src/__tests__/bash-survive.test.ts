import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { BackgroundRegistry } from "../state.ts";
import { registerBashTool } from "../tools/bash.ts";
import { processExists, killProcessTree } from "../spawn.ts";
import type { Job } from "../types.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface ToolDef {
    execute: (
        toolCallId: string,
        params: unknown,
        signal: AbortSignal | undefined,
        onUpdate: unknown,
        ctx: unknown
    ) => Promise<unknown>;
}

function harness() {
    let tool: ToolDef | undefined;
    const pi = {
        registerTool: (def: ToolDef) => { tool = def; },
        sendMessage: () => {},
    };
    const reg = new BackgroundRegistry();
    registerBashTool(pi as never, reg, {} as never);
    const ctx = {
        cwd: process.cwd(),
        ui: {
            notify: () => {},
            setWidget: () => {},
            setStatus: () => {},
            theme: { fg: (_c: string, t: string) => t },
        },
    };
    return { tool: tool!, reg, ctx };
}

void describe("bash foreground — Claude Code parity on turn abort", () => {
    const spawnedPids: number[] = [];

    void it("a genuine cancel (Esc) KILLS the foreground command", async () => {
        const { tool, reg, ctx } = harness();
        const ac = new AbortController();
        void tool.execute("t1", { command: "tail -f /dev/null" }, ac.signal, undefined, ctx);
        await sleep(400);

        const job = [...reg.jobs.values()][0] as Job;
        const pid = job.pid;
        spawnedPids.push(pid);
        assert.ok(processExists(pid), "running before the abort");

        // No pause was requested → this is a deliberate cancel → CC kills it.
        ac.abort();
        await sleep(200);

        assert.ok(!processExists(pid), "process is killed on a genuine cancel (CC parity)");
    });

    void it("a backgrounding pause (steering / Ctrl+Shift+B) SURVIVES the abort", async () => {
        const { tool, reg, ctx } = harness();
        const ac = new AbortController();
        void tool.execute("t2", { command: "tail -f /dev/null" }, ac.signal, undefined, ctx);
        await sleep(400);

        const job = [...reg.jobs.values()][0] as Job;
        const pid = job.pid;
        spawnedPids.push(pid);

        // Cooperative path: a pause is requested (as steering / Ctrl+Shift+B does)
        // BEFORE the abort — CC's 'interrupt'/background path never kills.
        reg.foreground.get(job.toolCallId)?.requestPause("manual");
        ac.abort();
        await sleep(200);

        assert.ok(processExists(pid), "backgrounded command survives the abort");
    });

    after(() => {
        for (const pid of spawnedPids) {
            try { killProcessTree(pid, "SIGKILL"); } catch { /* already gone */ }
        }
    });
});

void describe("headless Pi process lifetime", () => {
    void it("keeps the subprocess alive until its tool result is ready", () => {
        const command = "node -e 'setTimeout(() => console.log(\"SDK_COMPLETE\"), 300)'";
        const source = `
            import { BackgroundRegistry } from './src/state.ts';
            import { registerBashTool } from './src/tools/bash.ts';
            let tool;
            registerBashTool({ registerTool(def) { tool = def; }, sendMessage() {} }, new BackgroundRegistry(), {});
            const ctx = { cwd: process.cwd(), hasUI: false, ui: { notify() {}, setWidget() {}, setStatus() {} } };
            const result = await tool.execute('sdk-foreground', { command: ${JSON.stringify(command)} }, undefined, undefined, ctx);
            process.stdout.write(result.content[0].text);
        `;
        const child = spawnSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", source], {
            cwd: process.cwd(),
            encoding: "utf-8",
            timeout: 4_000,
        });
        assert.equal(child.status, 0, child.stderr || String(child.error));
        assert.match(child.stdout, /SDK_COMPLETE/);
    });

    void it("releases the host process when a foreground command becomes background work", () => {
        const command = "node -e 'setTimeout(() => console.log(\"LATE\"), 4000)'";
        const source = `
            import { BackgroundRegistry } from './src/state.ts';
            import { registerBashTool } from './src/tools/bash.ts';
            let tool;
            const reg = new BackgroundRegistry();
            registerBashTool({ registerTool(def) { tool = def; }, sendMessage() {} }, reg, {});
            const ctx = { cwd: process.cwd(), hasUI: false, ui: { notify() {}, setWidget() {}, setStatus() {} } };
            setTimeout(() => reg.foreground.get('sdk-handoff')?.requestPause('manual'), 100);
            const result = await tool.execute('sdk-handoff', { command: ${JSON.stringify(command)} }, undefined, undefined, ctx);
            process.stdout.write(JSON.stringify({ result: result.content[0].text, pid: [...reg.jobs.values()][0]?.pid }));
        `;
        const started = Date.now();
        const child = spawnSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", source], {
            cwd: process.cwd(), encoding: "utf-8", timeout: 6_000,
        });
        const elapsed = Date.now() - started;
        const pid = /"pid":(\d+)/.exec(child.stdout)?.[1];
        try {
            assert.equal(child.status, 0, child.stderr || String(child.error));
            assert.match(child.stdout, /manually backgrounded/);
            assert.ok(elapsed < 3_600, `background handoff should not wait for the 4s child (${elapsed}ms)`);
        } finally {
            if (pid) killProcessTree(Number(pid), "SIGKILL");
        }
    });

    void it("keeps the host alive while jobs attach waits for a background command", () => {
        const source = `
            import { BackgroundRegistry } from './src/state.ts';
            import { registerBashBgTool } from './src/tools/bash-bg.ts';
            import { registerJobsTool } from './src/tools/jobs.ts';
            const tools = new Map();
            const reg = new BackgroundRegistry();
            const pi = { registerTool(def) { tools.set(def.name, def); }, sendMessage() {} };
            registerBashBgTool(pi, reg);
            registerJobsTool(pi, reg);
            const ctx = { cwd: process.cwd(), hasUI: false, ui: { notify() {}, setWidget() {}, setStatus() {} } };
            const started = await tools.get('bash_bg').execute('sdk-background', {
                command: "node -e 'setTimeout(() => console.log(\\\"ATTACH_DONE\\\"), 300)'",
            }, undefined, undefined, ctx);
            const id = /with ID: (\\w+)\\./.exec(started.content[0].text)?.[1];
            if (!id) throw new Error('missing background job ID');
            await tools.get('jobs').execute('sdk-attach', { action: 'attach', jobId: id }, undefined, undefined, ctx);
            const output = await tools.get('jobs').execute('sdk-output', { action: 'output', jobId: id }, undefined, undefined, ctx);
            process.stdout.write(output.content[0].text);
        `;
        const child = spawnSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", source], {
            cwd: process.cwd(), encoding: "utf-8", timeout: 4_000,
        });
        assert.equal(child.status, 0, child.stderr || String(child.error));
        assert.match(child.stdout, /ATTACH_DONE/);
    });
    void it("returns after canceling a foreground shell that ignores SIGTERM", () => {
        const source = `
            import { BackgroundRegistry } from './src/state.ts';
            import { registerBashTool } from './src/tools/bash.ts';
            let tool;
            const reg = new BackgroundRegistry();
            registerBashTool({ registerTool(def) { tool = def; }, sendMessage() {} }, reg, {});
            const ctx = { cwd: process.cwd(), hasUI: false, ui: { notify() {}, setWidget() {}, setStatus() {} } };
            const abort = new AbortController();
            const result = tool.execute('sdk-cancel', {
                command: "trap '' TERM; while :; do sleep 0.1; done",
            }, abort.signal, undefined, ctx);
            setTimeout(() => process.stdout.write('CHILD_PID=' + [...reg.jobs.values()][0]?.pid + '\\n'), 150);
            setTimeout(() => abort.abort(), 400);
            await result;
            process.stdout.write('CANCEL_RETURNED');
        `;
        const child = spawnSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", source], {
            cwd: process.cwd(), encoding: "utf-8", timeout: 5_000,
        });
        const pid = /CHILD_PID=(\d+)/.exec(child.stdout)?.[1];
        try {
            assert.equal(child.status, 0, child.stderr || String(child.error));
            assert.match(child.stdout, /CANCEL_RETURNED/);
        } finally {
            if (pid) killProcessTree(Number(pid), "SIGKILL");
        }
    });
});
