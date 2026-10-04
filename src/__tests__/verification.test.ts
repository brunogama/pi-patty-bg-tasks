import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const verifier = fileURLToPath(new URL("../../.pi/skills/verify-pi-patty-bg-tasks/scripts/verify.mjs", import.meta.url));

describe("project verification helper", () => {
    it("retains failure evidence and removes scratch directories if git cannot start", () => {
        const temporaryRoot = mkdtempSync(join(tmpdir(), "pi-patty-verification-failure-"));
        try {
            const result = spawnSync(process.execPath, [verifier, "drive", "foreground"], {
                encoding: "utf8",
                timeout: 10_000,
                env: { ...process.env, TMPDIR: temporaryRoot, TMP: temporaryRoot, TEMP: temporaryRoot, PATH: "" },
            });
            assert.equal(result.status, 1, result.stderr || String(result.error));
            const remaining = readdirSync(temporaryRoot);
            assert.equal(remaining.filter((name) => name.startsWith("pi-patty-verify-")).length, 0,
                "failed verification must not leave its isolated session directories");
            const evidence = remaining.filter((name) => name.startsWith("pi-patty-proof-"));
            assert.equal(evidence.length, 1, "failure must leave a single evidence directory");
            const proof = JSON.parse(readFileSync(join(temporaryRoot, evidence[0], "foreground.json"), "utf8"));
            assert.match(proof.error, /spawnSync git ENOENT/);
            assert.deepEqual(proof.cleanup, { scratchRemoved: true, agentDirectoryRemoved: true });
        } finally {
            rmSync(temporaryRoot, { recursive: true, force: true });
        }
    });
});
