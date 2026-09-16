#!/usr/bin/env node
/**
 * Run every program in programs.json and report a summary.
 *
 *   node test-all.mjs              run all
 *   node test-all.mjs motor        run programs whose name contains "motor"
 *
 * Exits non-zero if any program fails to build, run, or check.
 */

import { spawnSync } from "node:child_process";
import { readFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const filter = process.argv[2] || "";
const manifest = JSON.parse(readFileSync(resolve(HERE, "programs.json"), "utf8"));
const programs = manifest.programs.filter((p) => !filter || p.name.includes(filter));

mkdirSync(resolve(HERE, "built"), { recursive: true });
mkdirSync(resolve(HERE, "traces"), { recursive: true });

const node = (args) => spawnSync(process.execPath, args, { cwd: HERE, encoding: "utf8" });

let failed = 0;
const results = [];

for (const p of programs) {
    let src = p.file;

    // Extract from markdown when the program lives in a tutorial.
    if (p.md) {
        src = `built/${p.name}.ts`;
        const ex = node(["md-extract.mjs", p.md, "--blocks", p.blocks.join(","), "--out", src]);
        if (ex.status !== 0) {
            results.push({ name: p.name, state: "EXTRACT FAIL", detail: (ex.stderr || "").trim().split("\n")[0] });
            failed++;
            continue;
        }
    }

    const trace = `traces/${p.name}.json`;
    // `description` is for whoever reads the trace ("what does the robot do?").
    // `note` is a maintainer note about block wiring and gotchas — not shown in the viewer.
    const desc = p.description ? ["--description", p.description] : [];
    const named = ["--name", p.name];
    const run = node(["run.mjs", src, "--out", trace, ...desc, ...named, ...(p.args || [])]);
    if (!(run.stdout || "").includes("trace   :")) {
        const msg = ((run.stdout || "") + (run.stderr || "")).split("\n").filter(Boolean).slice(-2).join(" | ");
        results.push({ name: p.name, state: "RUN FAIL", detail: msg });
        failed++;
        continue;
    }

    const chk = node(["check.mjs", trace, ...(p.expectMotion ? [] : ["--no-motion-expected"])]);
    const out = chk.stdout || "";
    const pass = (out.match(/PASS/g) || []).length;
    const fail = (out.match(/FAIL/g) || []).length;

    // Motion is reported for context, not asserted here beyond the check above.
    const t = JSON.parse(readFileSync(resolve(HERE, trace), "utf8"));
    const travel = t.rows.slice(1).reduce((sum, r, i) => {
        for (let c = 1; c <= 6; c++) sum += Math.abs(r[c] - t.rows[i][c]);
        return sum;
    }, 0);

    if (fail > 0) failed++;
    results.push({
        name: p.name, state: fail > 0 ? "CHECK FAIL" : "ok",
        detail: `${pass} pass, ${fail} fail · ${t.rows.length} samples · ${travel}° travel`,
    });
}

console.log(`\n${"program".padEnd(18)} ${"state".padEnd(12)} detail`);
console.log("-".repeat(78));
for (const r of results) {
    console.log(`${r.name.padEnd(18)} ${r.state.padEnd(12)} ${r.detail}`);
}
console.log(`\n${results.length - failed}/${results.length} programs OK\n`);
process.exit(failed > 0 ? 1 : 0);
