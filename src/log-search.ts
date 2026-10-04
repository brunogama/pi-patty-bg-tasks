/**
 * Streaming log search service.
 *
 * The jobs tool owns parameter parsing and result formatting; this module owns
 * full-log scanning, match counting, bounded display-hit retention, and the
 * tail fallback used when the log file cannot be streamed line-by-line.
 */

import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { OUTPUT_PREVIEW_CHARS, PREVIEW_CHARS, type Job } from "./types.ts";
import { readBoundedTail } from "./output.ts";

export interface LogSearchHit {
    path: string;
    line: number;
    text: string;
}

export interface LogSearchGroup {
    jobId: string;
    name?: string;
    count: number;
    hits: LogSearchHit[];
}

export interface LogSearchResult {
    totalHits: number;
    groups: LogSearchGroup[];
}

interface ScanOptions {
    maxHitsPerJob: number;
    maxLineChars: number;
}

export async function searchLogs(args: {
    jobs: Iterable<Job>;
    pattern: RegExp;
    maxHitsPerJob: number;
    maxLineChars?: number;
}): Promise<LogSearchResult> {
    const options: ScanOptions = {
        maxHitsPerJob: args.maxHitsPerJob,
        maxLineChars: args.maxLineChars ?? PREVIEW_CHARS.line,
    };
    const jobs = [...args.jobs];

    const groups = (
        await Promise.all(jobs.map((job) => scanOneJob(job, args.pattern, options)))
    ).filter((g) => g.count > 0);

    let totalHits = 0;
    for (const group of groups) totalHits += group.count;
    return { totalHits, groups };
}

async function scanOneJob(
    job: Job,
    re: RegExp,
    options: ScanOptions
): Promise<LogSearchGroup> {
    const group: LogSearchGroup = { jobId: job.id, name: job.name, count: 0, hits: [] };
    for (const logPath of [job.logPath, job.stderrPath]) {
        if (!logPath) continue;
        const scanned = await streamLogFile(logPath, re, group, options);
        if (!scanned) {
            const tail = readBoundedTail(logPath, OUTPUT_PREVIEW_CHARS);
            if (tail !== "(no output yet)") scanTailText(logPath, re, tail, group, options);
        }
    }
    return group;
}

function record(group: LogSearchGroup, hit: LogSearchHit, maxHitsPerJob: number): void {
    group.count++;
    if (group.hits.length < maxHitsPerJob) group.hits.push(hit);
    else if (group.hits.length > 0 && !group.hits.some((saved) => saved.path === hit.path)) {
        group.hits[group.hits.length - 1] = hit;
    }
}

async function streamLogFile(
    logPath: string,
    re: RegExp,
    group: LogSearchGroup,
    options: ScanOptions
): Promise<boolean> {
    return await new Promise<boolean>((resolve) => {
        let lineNo = 0;
        let sawFile = false;
        const stream = createReadStream(logPath, { encoding: "utf-8" });
        stream.on("error", () => resolve(false));
        const rl = createInterface({ input: stream, crlfDelay: Infinity });
        rl.on("line", (line) => {
            sawFile = true;
            lineNo++;
            if (re.test(line)) {
                record(group, {
                    path: logPath,
                    line: lineNo,
                    text: truncateLine(line, options.maxLineChars),
                }, options.maxHitsPerJob);
            }
        });
        rl.on("close", () => resolve(sawFile));
    });
}

function scanTailText(
    logPath: string,
    re: RegExp,
    text: string,
    group: LogSearchGroup,
    options: ScanOptions
): void {
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
        if (re.test(lines[i])) {
            record(group, {
                path: `${logPath} (log tail)`,
                line: i + 1,
                text: truncateLine(lines[i], options.maxLineChars),
            }, options.maxHitsPerJob);
        }
    }
}

function truncateLine(line: string, maxChars: number): string {
    if (line.length <= maxChars) return line;
    return `${line.slice(0, maxChars)}...[truncated]`;
}
