#!/usr/bin/env node
/**
 * Invariant checks and golden-trace comparison.
 *
 * Golden comparison is EXACT. That is only meaningful because the runtime is
 * fully deterministic: virtual time plus a seeded PRNG, and the gait code
 * rounds to integer angles. If you ever see spurious golden diffs, suspect
 * determinism first, not tolerance.
 *
 * Usage:
 *   node check.mjs traces/moonwalk-pu.json
 *   node check.mjs traces/moonwalk-pu.json --golden traces/golden/moonwalk-pu.json
 *   node check.mjs traces/moonwalk-pu.json --bless        # write/refresh the golden
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve, basename } from "node:path";

const argv = process.argv.slice(2);
if (argv.length === 0) {
    console.error("usage: node check.mjs <trace.json> [--golden FILE] [--bless]");
    process.exit(2);
}

const tracePath = resolve(process.cwd(), argv[0]);
const bless = argv.includes("--bless");
const gi = argv.indexOf("--golden");
const goldenPath = gi >= 0 && gi + 1 < argv.length
    ? resolve(process.cwd(), argv[gi + 1])
    : resolve(dirname(tracePath), "golden", basename(tracePath));

const trace = JSON.parse(readFileSync(tracePath, "utf8"));
const rows = trace.rows;

let failures = 0;
let checks = 0;

function check(name, ok, detail) {
    checks++;
    if (ok) {
        console.log(`  PASS  ${name}`);
    } else {
        failures++;
        console.log(`  FAIL  ${name}${detail ? " — " + detail : ""}`);
    }
}

// ---------------------------------------------------------------------------
// Generic invariants — apply to any Robot PU program
// ---------------------------------------------------------------------------

console.log(`\n${trace.program}  (seed ${trace.seed}, boot ${trace.bootMs}ms, ${rows.length} samples)\n`);
console.log("generic invariants");

const bad = [];
for (const r of rows) {
    for (let s = 1; s <= 10; s++) {
        const v = r[s];
        if (!Number.isInteger(v) || v < 0 || v > 180) bad.push({ t: r[0], servo: s - 1, v });
    }
}
check("all servo angles are integers in 0..180", bad.length === 0,
    bad.length ? `${bad.length} violations, first ${JSON.stringify(bad[0])}` : "");

check("no unknown I2C register writes", (trace.unknownI2c || []).length === 0,
    (trace.unknownI2c || []).slice(0, 3).map(u => `reg 0x${u.reg.toString(16)}`).join(", "));

check("no scheduler warnings", (trace.warnings || []).length === 0,
    (trace.warnings || []).join("; "));

check("timestamps are monotonic", rows.every((r, i) => i === 0 || r[0] >= rows[i - 1][0]));

const moved = rows.some(r => r.slice(1, 11).some((v, i) => v !== rows[0][i + 1]));
check("servos actually moved", moved, moved ? "" : "trace is static — did the program run?");

// ---------------------------------------------------------------------------
// Gait invariants — only for programs that declare a phase pose table
// ---------------------------------------------------------------------------

// [LF, LL, RF, RL, HY, HP] for each moonwalk phase, from tutorials/moonwalk-pu.ts
const MOONWALK_PHASES = [
    { name: "cock left", pose: [117, 135, 106, 70, 70, 80], glide: false },
    { name: "glide right", pose: [106, 120, 98, 45, 90, 82], glide: true },
    { name: "cock right", pose: [74, 70, 63, 135, 110, 80], glide: false },
    { name: "glide left", pose: [82, 45, 74, 120, 90, 82], glide: true },
];

if (trace.program === "moonwalk-pu") {
    console.log("\nmoonwalk gait invariants");

    // Find the sample index where each phase pose is first reached, in order.
    const hits = [];
    let cursor = 0;
    for (let cycle = 0; cycle < 3; cycle++) {
        for (let p = 0; p < MOONWALK_PHASES.length; p++) {
            const want = MOONWALK_PHASES[p].pose;
            let found = -1;
            for (let i = cursor; i < rows.length; i++) {
                const got = rows[i].slice(1, 7);
                if (want.every((v, k) => v === got[k])) { found = i; break; }
            }
            if (found < 0) { cursor = -1; break; }
            hits.push({ cycle, phase: p, i: found, t: rows[found][0] });
            cursor = found + 1;
        }
        if (cursor < 0) break;
    }

    check("reaches all 4 phase poses exactly, in order, for 2+ cycles",
        hits.length >= 8, `only reached ${hits.length} phase poses`);

    if (hits.length >= 8) {
        // Duration of each phase = time from reaching the previous pose to this one.
        const durs = [];
        for (let i = 1; i < hits.length; i++) {
            durs.push({ phase: hits[i].phase, ms: hits[i].t - hits[i - 1].t });
        }
        const snapMs = durs.filter(d => !MOONWALK_PHASES[d.phase].glide).map(d => d.ms);
        const glideMs = durs.filter(d => MOONWALK_PHASES[d.phase].glide).map(d => d.ms);
        const avg = a => a.reduce((x, y) => x + y, 0) / a.length;

        const snapAvg = avg(snapMs), glideAvg = avg(glideMs);
        console.log(`        snap avg ${snapAvg.toFixed(0)}ms, glide avg ${glideAvg.toFixed(0)}ms, ratio ${(glideAvg / snapAvg).toFixed(2)}x`);

        // THE invariant for this move: if the glide is not clearly slower than the
        // snap, the illusion collapses into a shuffle.
        check("glide is at least 2x slower than snap", glideAvg >= snapAvg * 2,
            `glide ${glideAvg.toFixed(0)}ms vs snap ${snapAvg.toFixed(0)}ms`);
    }

    // Weight shift must alternate: feet above 90 load the right foot, below 90 the left.
    const sides = hits.map(h => {
        const r = rows[h.i];
        return (r[1] + r[3]) / 2 > 90 ? "R" : "L";
    });
    const expected = hits.map(h => (h.phase < 2 ? "R" : "L"));
    check("weight shift alternates right,right,left,left",
        sides.join("") === expected.join(""), `got ${sides.join("")} want ${expected.join("")}`);
}

// ---------------------------------------------------------------------------
// Golden comparison (exact)
// ---------------------------------------------------------------------------

console.log("\ngolden trace");

// A trace is only comparable to a golden recorded under the SAME run config.
// Without this, simply asking for a longer run reports a false regression.
const config = (t) => `${t.seed}|${t.durationMs}|${t.sampleMs}|${(t.buttons || []).map(b => b.at + ":" + b.button).join(",")}`;

if (bless) {
    mkdirSync(dirname(goldenPath), { recursive: true });
    writeFileSync(goldenPath, JSON.stringify({
        rows: trace.rows, seed: trace.seed, durationMs: trace.durationMs,
        sampleMs: trace.sampleMs, buttons: trace.buttons, config: config(trace),
    }));
    console.log(`  WROTE ${goldenPath} (${rows.length} rows, config ${config(trace)})`);
} else if (!existsSync(goldenPath)) {
    console.log(`  SKIP  no golden at ${goldenPath} — create one with --bless`);
} else {
    const golden = JSON.parse(readFileSync(goldenPath, "utf8"));

    if (golden.config && golden.config !== config(trace)) {
        console.log(`  SKIP  golden was recorded for a different run configuration`);
        console.log(`          golden: ${golden.config}`);
        console.log(`          this:   ${config(trace)}`);
        console.log(`        Not a regression. Re-record with --bless, or re-run with the golden's settings.`);
        console.log(`\n${checks - failures}/${checks} checks passed\n`);
        process.exit(failures > 0 ? 1 : 0);
    }

    check("seed matches golden", golden.seed === trace.seed, `${trace.seed} vs golden ${golden.seed}`);

    let diff = null;
    if (golden.rows.length !== rows.length) {
        diff = `row count ${rows.length} vs golden ${golden.rows.length}`;
    } else {
        for (let i = 0; i < rows.length && !diff; i++) {
            for (let c = 0; c < rows[i].length; c++) {
                if (rows[i][c] !== golden.rows[i][c]) {
                    diff = `row ${i} col ${c}: ${rows[i][c]} vs golden ${golden.rows[i][c]} (t=${rows[i][0]})`;
                    break;
                }
            }
        }
    }
    check("trace matches golden exactly", diff === null, diff || "");
}

console.log(`\n${checks - failures}/${checks} checks passed\n`);
process.exit(failures > 0 ? 1 : 0);
