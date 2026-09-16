#!/usr/bin/env node
/**
 * Viewer server + build/run service.
 *
 * Serves the trace viewer and exposes POST /api/run, which compiles user code
 * and executes it in the simulator.
 *
 * SECURITY: /api/run executes arbitrary code with your user's privileges, so the
 * server binds to 127.0.0.1 ONLY. Do not change that to 0.0.0.0 — on a shared
 * network it would be remote code execution on this machine. User code runs in a
 * child process with a hard timeout so a runaway loop cannot wedge the server.
 *
 *   node serve.mjs [port]      then open http://localhost:8099/
 */

import { createServer } from "node:http";
import { readFile, readdir, writeFile, mkdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { extname, join, normalize, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");
const PORT = parseInt(process.argv[2] || "8099", 10);
const HOST = "127.0.0.1";
const RUN_TIMEOUT_MS = 15000;

const require = createRequire(import.meta.url);
let ts = null;
try { ts = require("typescript"); } catch { /* fall back to the tsc CLI */ }

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
};

// ---------------------------------------------------------------------------
// Prelude / postlude cache
// ---------------------------------------------------------------------------
//
// The extension is compiled ONCE and reused. tsc --outFile concatenates into a
// single global scope, and TypeScript's namespace emit merges across separately
// compiled chunks, so prelude + user + postlude behaves exactly like one build.
// Verified: this produces traces byte-identical to the monolithic path.

const PRELUDE_SRC = [resolve(HERE, "src/shim.ts"), resolve(REPO, "robotpu.ts"), resolve(REPO, "main.ts")];
const POSTLUDE_SRC = [resolve(HERE, "src/driver.ts")];
const BUILT = resolve(HERE, "built");
const PRELUDE = resolve(BUILT, "_prelude.js");
const POSTLUDE = resolve(BUILT, "_postlude.js");

async function newestMtime(files) {
  let m = 0;
  for (const f of files) m = Math.max(m, (await stat(f)).mtimeMs);
  return m;
}

/** Rebuild a chunk if any source is newer than the output. */
async function ensureChunk(out, sources, label) {
  let fresh = false;
  if (existsSync(out)) {
    fresh = (await stat(out)).mtimeMs >= await newestMtime(sources);
  }
  if (fresh) return;

  console.log(`  building ${label} ...`);
  const tsc = resolve(HERE, "node_modules/.bin/tsc");
  const bin = existsSync(tsc) ? tsc : "npx";
  const args = existsSync(tsc)
    ? ["--outFile", out, "--target", "es2017", "--lib", "es2017", "--skipLibCheck", ...sources]
    : ["-y", "-p", "typescript@5.4", "tsc", "--outFile", out, "--target", "es2017", "--lib", "es2017", "--skipLibCheck", ...sources];
  spawnSync(bin, args, { encoding: "utf8" });   // type errors are non-fatal; it still emits
  if (!existsSync(out)) throw new Error(`failed to build ${label}`);
}

async function ensureRuntime() {
  await mkdir(BUILT, { recursive: true });
  await ensureChunk(PRELUDE, PRELUDE_SRC, "prelude (shim + robotpu + main)");
  await ensureChunk(POSTLUDE, POSTLUDE_SRC, "postlude (driver)");
}

// ---------------------------------------------------------------------------
// Compile + run user code
// ---------------------------------------------------------------------------

function transpile(code) {
  if (!ts) {
    // No compiler API: assume the code is already plain JavaScript.
    return { js: code, diagnostics: [], transpiled: false };
  }
  const res = ts.transpileModule(code, {
    compilerOptions: { target: ts.ScriptTarget.ES2017, removeComments: false },
    reportDiagnostics: true,
  });
  const diagnostics = (res.diagnostics || []).map((d) => {
    const msg = ts.flattenDiagnosticMessageText(d.messageText, " ");
    if (d.file && d.start != null) {
      const { line, character } = d.file.getLineAndCharacterOfPosition(d.start);
      return { line: line + 1, column: character + 1, message: msg };
    }
    return { line: 0, column: 0, message: msg };
  });
  return { js: res.outputText, diagnostics, transpiled: true };
}

/** The beginner 6-DOF package uses `robotPu`; this extension is `robotPuPro`. */
function namespaceWarning(code) {
  const stripped = code.replace(/robotPuPro/g, "");
  if (/\brobotPu\s*\./.test(stripped)) {
    return "This code targets the beginner 6-DOF package (namespace `robotPu`). " +
           "This extension is `robotPuPro` — rename the calls, or they will be undefined at runtime.";
  }
  return null;
}

async function buildAndRun(code, opts) {
  await ensureRuntime();

  const warning = namespaceWarning(code);
  const { js, diagnostics } = transpile(code);

  // transpileModule emits even for malformed input, so without this a syntax
  // error would quietly produce a degenerate trace and report success.
  if (diagnostics.length) {
    return {
      ok: false, diagnostics, warning,
      error: "The program did not compile. Fix the errors below and run again.",
    };
  }

  const runId = "ide-" + Date.now().toString(36);
  const bundle = resolve(BUILT, `${runId}.js`);
  const tracePath = resolve(BUILT, `${runId}.json`);

  const [pre, post] = await Promise.all([readFile(PRELUDE, "utf8"), readFile(POSTLUDE, "utf8")]);
  await writeFile(bundle, pre + "\n" + js + "\n" + post);

  const env = {
    ...process.env,
    SIM_MS: String(opts.ms ?? 8000),
    SIM_SEED: String(opts.seed ?? 1),
    SIM_SAMPLE_MS: String(opts.sample ?? 10),
    SIM_BUTTONS: opts.buttons || "",
    SIM_SOUND: opts.sound || "quiet",
    SIM_I2C_US: String(opts.i2cUs ?? 0),
    SIM_SKIP_BOOT: opts.skipBoot ? "1" : "",
    SIM_PROGRAM: opts.name || "editor",
    SIM_OUT: tracePath,
  };

  return await new Promise((done) => {
    const child = spawn(process.execPath, [bundle], { env });
    let out = "", err = "", killed = false;
    const timer = setTimeout(() => {
      killed = true;
      child.kill("SIGKILL");
    }, RUN_TIMEOUT_MS);

    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));

    child.on("close", async () => {
      clearTimeout(timer);
      if (killed) {
        return done({
          ok: false, diagnostics, warning,
          error: `Program did not finish within ${RUN_TIMEOUT_MS / 1000}s and was stopped.\n` +
                 `A loop with no basic.pause() never yields — add a pause, or reduce the work per iteration.`,
          stdout: out,
        });
      }
      if (!existsSync(tracePath)) {
        // Node's stack trace points into the generated bundle, whose absolute
        // path and line numbers mean nothing to someone typing in the editor.
        // Keep the message, drop the noise.
        let msg = (err || out || "the program produced no trace").trim();
        msg = msg.split("\n")
          .filter((l) => !/^\s*at /.test(l) && !l.includes("node:internal"))
          .map((l) => l.replace(BUILT + "/", "").replace(/^\/\S+\.js:\d+\s*$/, ""))
          .filter((l) => l.trim())
          .slice(0, 6)
          .join("\n");

        // A ReferenceError right after a namespace warning has one obvious cause.
        if (warning && /is not defined/.test(msg)) {
          msg = warning + "\n\n" + msg;
        }
        return done({ ok: false, diagnostics, warning, error: msg, stdout: out });
      }
      const trace = JSON.parse(await readFile(tracePath, "utf8"));
      done({ ok: true, diagnostics, warning, trace, stdout: out.trim() });
    });

    child.on("error", (e) => {
      clearTimeout(timer);
      done({ ok: false, diagnostics, warning, error: e.message });
    });
  });
}

function readBody(req, limitBytes = 1_000_000) {
  return new Promise((ok, fail) => {
    let n = 0;
    const chunks = [];
    req.on("data", (c) => {
      n += c.length;
      if (n > limitBytes) { fail(new Error("request too large")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => ok(Buffer.concat(chunks).toString("utf8")));
    req.on("error", fail);
  });
}

const json = (res, code, body) => {
  res.writeHead(code, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
};

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

createServer(async (req, res) => {
  let rel = decodeURIComponent(new URL(req.url, "http://x").pathname);

  // Redirect "/" to "/viewer/" rather than quietly serving viewer/index.html at
  // the root. The browser resolves relative URLs against the DOCUMENT path, so
  // serving the page at "/" makes <script src="viewer.js"> request "/viewer.js"
  // — a 404, leaving a dead page with no JS. The trailing slash matters.
  if (rel === "/" || rel === "/viewer") {
    res.writeHead(302, { location: "/viewer/" }).end();
    return;
  }
  if (rel.endsWith("/")) rel += "index.html";

  if (rel === "/api/run" && req.method === "POST") {
    try {
      const { code, opts } = JSON.parse(await readBody(req));
      if (typeof code !== "string" || !code.trim()) return json(res, 400, { ok: false, error: "no code supplied" });
      const t0 = Date.now();
      const result = await buildAndRun(code, opts || {});
      result.elapsedMs = Date.now() - t0;
      return json(res, 200, result);
    } catch (e) {
      return json(res, 500, { ok: false, error: e.message });
    }
  }

  // Example programs the editor can load, sourced from the manifest.
  if (rel === "/api/examples") {
    try {
      const m = JSON.parse(await readFile(resolve(HERE, "programs.json"), "utf8"));
      const out = [];
      for (const p of m.programs) {
        if (!p.file) continue;   // markdown-extracted entries need the extractor
        const src = resolve(HERE, p.file);
        if (!existsSync(src)) continue;
        out.push({ name: p.name, note: p.note || "", args: p.args || [], code: await readFile(src, "utf8") });
      }
      return json(res, 200, out);
    } catch (e) {
      return json(res, 200, []);
    }
  }

  if (rel === "/api/traces") {
    try {
      const names = (await readdir(join(HERE, "traces"), { withFileTypes: true }))
        .filter((d) => d.isFile() && d.name.endsWith(".json"))
        .map((d) => d.name)
        .sort();
      return json(res, 200, names);
    } catch {
      return json(res, 200, []);
    }
  }

  // Keep the static server inside tools/simulator.
  const path = resolve(join(HERE, normalize(rel)));
  if (!path.startsWith(HERE)) {
    res.writeHead(403).end("forbidden");
    return;
  }
  try {
    const body = await readFile(path);
    res.writeHead(200, {
      "content-type": TYPES[extname(path)] || "application/octet-stream",
      "cache-control": "no-store",
    });
    res.end(body);
  } catch {
    res.writeHead(404).end("not found");
  }
}).listen(PORT, HOST, async () => {
  console.log(`viewer:  http://localhost:${PORT}/`);
  console.log(`serving: ${HERE}`);
  console.log(`compile: ${ts ? "typescript " + ts.version + " (in-process)" : "tsc CLI fallback"}`);
  console.log(`bound to ${HOST} only — /api/run executes code, do not expose it`);
  try {
    await ensureRuntime();
    console.log("runtime ready");
  } catch (e) {
    console.error("runtime build failed:", e.message);
  }
  console.log("ctrl-c to stop");
});
