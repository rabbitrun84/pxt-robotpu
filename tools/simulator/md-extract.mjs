#!/usr/bin/env node
/**
 * Extract fenced ```typescript blocks from a tutorial .md into a runnable .ts,
 * so tutorial code can be tested by the simulator without being copied by hand.
 *
 * Tutorials often split one program across several blocks (definitions in one,
 * the loop in another), and some blocks are alternative programs that redeclare
 * the same names. So the caller chooses which blocks to combine.
 *
 *   node md-extract.mjs ../../tutorials/dance-pu.md --list
 *   node md-extract.mjs ../../tutorials/dance-pu.md --blocks 1,2 --out built/dance-beat.ts
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve, basename } from "node:path";

const argv = process.argv.slice(2);
if (argv.length === 0) {
    console.error("usage: node md-extract.mjs <file.md> [--list] [--blocks 1,2] [--out FILE]");
    process.exit(2);
}

const mdPath = resolve(process.cwd(), argv[0]);
const opt = (n, d) => { const i = argv.indexOf("--" + n); return i >= 0 && i + 1 < argv.length ? argv[i + 1] : d; };

const src = readFileSync(mdPath, "utf8");

// Track the line each block starts on, so --list output points back at the source.
const blocks = [];
const re = /```(?:typescript|ts)\n([\s\S]*?)```/g;
let m;
while ((m = re.exec(src)) !== null) {
    blocks.push({ code: m[1], line: src.slice(0, m.index).split("\n").length });
}

if (argv.includes("--list")) {
    console.log(`${basename(mdPath)} — ${blocks.length} typescript blocks\n`);
    blocks.forEach((b, i) => {
        const decls = [...b.code.matchAll(/^(?:let|const|function)\s+(\w+)/gm)].map(x => x[1]);
        console.log(`[${i}] md line ${b.line}, ${b.code.trim().split("\n").length} lines`);
        console.log(`    declares: ${decls.join(", ") || "(none)"}`);
    });
    process.exit(0);
}

const want = (opt("blocks", blocks.map((_, i) => i).join(","))).split(",").map(s => parseInt(s.trim(), 10));
for (const i of want) {
    if (isNaN(i) || i < 0 || i >= blocks.length) {
        console.error(`error: no block ${i} (file has ${blocks.length})`);
        process.exit(2);
    }
}

const header = `// GENERATED from ${basename(mdPath)} blocks [${want.join(", ")}] — do not edit.\n` +
    `// Regenerate: node md-extract.mjs ${argv[0]} --blocks ${want.join(",")}\n\n`;
const body = want.map(i => `// ---- block ${i} (${basename(mdPath)}:${blocks[i].line}) ----\n${blocks[i].code}`).join("\n");

const outPath = resolve(process.cwd(), opt("out", `built/${basename(mdPath).replace(/\.md$/, "")}-${want.join("_")}.ts`));
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, header + body);
console.log(outPath);
