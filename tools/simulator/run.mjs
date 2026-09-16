#!/usr/bin/env node
/**
 * Build and run a Robot PU program in the desktop simulator.
 *
 * The program under test is compiled directly from its source in tutorials/ -
 * there is no copy. A broken tutorial therefore breaks this build, which is the
 * intended signal.
 *
 * Usage:
 *   node run.mjs moonwalk-pu --ms 6000 --buttons 500:A
 *   node run.mjs moonwalk-pu --out traces/moonwalk.json
 *   node run.mjs ../../test.ts --ms 2000
 */

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { describeSource } from "./describe.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2);
if (argv.length === 0 || argv[0].startsWith("--")) {
    console.error("usage: node run.mjs <program> [--ms N] [--seed N] [--sample N] [--buttons 500:A,4000:B] [--out FILE]");
    console.error("  <program> is a name in tutorials/ (e.g. moonwalk-pu) or a path to a .ts file");
    process.exit(2);
}

const programArg = argv[0];
const opt = (name, dflt) => {
    const i = argv.indexOf("--" + name);
    return i >= 0 && i + 1 < argv.length ? argv[i + 1] : dflt;
};

// Resolve the program: a bare name means tutorials/<name>.ts
let programPath = programArg.endsWith(".ts")
    ? resolve(process.cwd(), programArg)
    : resolve(REPO, "tutorials", programArg + ".ts");

if (!existsSync(programPath)) {
    const alt = resolve(REPO, "tutorials", basename(programArg) + ".ts");
    if (existsSync(alt)) programPath = alt;
    else {
        console.error(`error: program not found: ${programPath}`);
        process.exit(2);
    }
}

const label = basename(programPath).replace(/\.ts$/, "");
const outPath = resolve(HERE, opt("out", `traces/${label}.json`));
const builtDir = resolve(HERE, "built");
const bundle = resolve(builtDir, `${label}.js`);

mkdirSync(builtDir, { recursive: true });
mkdirSync(dirname(outPath), { recursive: true });

// ---------------------------------------------------------------------------
// Compile
// ---------------------------------------------------------------------------
//
// --outFile concatenates into one global scope, which is exactly how MakeCode
// builds. Order matters: shim first (it boots the world), driver last (it runs
// after the program has registered its handlers).

const files = [
    resolve(HERE, "src/shim.ts"),
    resolve(REPO, "robotpu.ts"),
    resolve(REPO, "main.ts"),
    programPath,
    resolve(HERE, "src/driver.ts"),
];

const tscArgs = [
    "--outFile", bundle,
    "--target", "es2017",
    "--lib", "es2017",
    "--skipLibCheck",
    ...files,
];

function runTsc(args) {
    const local = resolve(HERE, "node_modules/.bin/tsc");
    if (existsSync(local)) return spawnSync(local, args, { encoding: "utf8" });
    return spawnSync("npx", ["-y", "-p", "typescript@5.4", "tsc", ...args], { encoding: "utf8" });
}

console.log(`building ${label} ...`);
const build = runTsc(tscArgs);
const buildOut = (build.stdout || "") + (build.stderr || "");

if (build.error) {
    console.error("error: could not run tsc.", build.error.message);
    console.error("Install it locally with:  npm install  (in tools/simulator)");
    process.exit(1);
}

// tsc exits non-zero on type errors but still emits. Only real emit failure is fatal.
if (buildOut.trim()) console.log(buildOut.trim());
if (!existsSync(bundle)) {
    console.error("error: compile produced no output");
    process.exit(1);
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

const env = {
    ...process.env,
    SIM_MS: opt("ms", "8000"),
    SIM_SEED: opt("seed", "1"),
    SIM_SAMPLE_MS: opt("sample", "10"),
    SIM_BUTTONS: opt("buttons", ""),
    SIM_SOUND: opt("sound", "quiet"),
    SIM_I2C_US: opt("i2c-us", "0"),
    SIM_DESC: opt("description", describeSource(readFileSync(programPath, "utf8"))),
    SIM_SKIP_BOOT: argv.includes("--skip-boot") ? "1" : "",
    SIM_PROGRAM: opt("name", label),
    SIM_OUT: outPath,
};

try {
    const out = execFileSync(process.execPath, [bundle], { env, encoding: "utf8" });
    process.stdout.write(out);
} catch (e) {
    console.error("error: simulation failed");
    if (e.stdout) process.stdout.write(e.stdout);
    if (e.stderr) process.stderr.write(e.stderr);
    process.exit(1);
}
