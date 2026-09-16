# Feature plan — in-browser code editor for the trace viewer

Status: **proposed**. Created 2026-09-16.

Let users type JavaScript/TypeScript into the viewer, press **Build & Run**, and
see the resulting motion in the existing playback panels.

Scope confirmed: **no real-time / streaming visualization.** This is a
request-response cycle — edit, click, watch the finished trace. That keeps the
design simple and reuses the whole existing pipeline.

---

## 1. Feasibility — already proven

The one risky assumption was that the extension could be compiled *once* and
only user code compiled per run. It was tested before writing this plan.

| Measurement | Result |
|---|---|
| Full build (shim + robotpu + main + program + driver) | **1196–1635 ms** |
| Prebuild prelude (shim+robotpu+main) + postlude (driver) | 2777 ms, **one time** |
| Compile user program alone | 1041 ms |
| Concatenate prelude + user + postlude and run | **works** |
| Output vs committed golden | **byte-identical** |

`tsc --outFile` concatenates into one global scope, and TypeScript's namespace
emit (`var ns; (function(ns){…})(ns || (ns = {}))`) merges correctly across
separately-compiled chunks. So the split is safe, and it produces exactly the
same trace as the monolithic build.

**The 1041 ms is not compilation.** `npx tsc --version` alone takes **1333 ms** —
the per-run cost is almost entirely process startup. A long-lived server holding
the TypeScript compiler API in memory should bring a 3 KB user file down to tens
of milliseconds. That is the difference between a usable editor and a sluggish one.

---

## 2. Architecture

```
browser                          serve.mjs (long-lived)
┌──────────────────┐             ┌────────────────────────────────┐
│ editor textarea  │  POST /api/run                               │
│ options          │ ──────────► │ 1. ts.transpileModule(userCode)│  ~20ms
│ [Build & Run]    │   {code,    │ 2. prelude + user + postlude   │  cached
│                  │    opts}    │ 3. spawn node, timeout+kill    │  ~300ms
│ existing viewer  │ ◄────────── │ 4. return {trace, diagnostics} │
└──────────────────┘   trace     └────────────────────────────────┘
```

Nothing about the simulator changes. The server gains one endpoint; the viewer
gains an editor panel and feeds the returned trace into `load()`, which already
exists and already drives every panel.

**Why server-side rather than running in the browser:** the same principle that
governs the rest of this tool — never have a second implementation. Running the
real `robotpu.ts` in a real Node process means the editor tests exactly what the
CLI tests. Shipping a browser-side runtime would create two things to keep in
sync, and the first behavioural divergence would destroy trust in both.

### Compilation

Use the TypeScript compiler API in-process:

```js
ts.transpileModule(code, { compilerOptions: { target: "es2017" } })
```

`transpileModule` does no type checking, which is the right trade here: it is
fast, and it never refuses to emit. Type errors in user code are reported
separately and non-fatally, matching how `run.mjs` already treats them.

Prelude and postlude are built once at server start (or cached on disk with an
mtime check against `robotpu.ts` / `main.ts` / `shim.ts`, so editing the
extension invalidates them).

---

## 3. Security — must be handled before this ships

Adding this endpoint turns the viewer from a file server into **an arbitrary code
execution service**. Three things follow.

**1. Bind to localhost.** `serve.mjs` currently calls `.listen(PORT)` with no
host, which binds **all interfaces** — anyone on the network can reach it. That
is already sloppy for a file server; with `/api/run` it is remote code execution
on your laptop. Change to `.listen(PORT, "127.0.0.1")`. *This is the single most
important item in this plan.*

**2. Kill runaway programs.** A bare `while (true) {}` with no `basic.pause()`
hangs the child forever. The existing scheduler guard only covers `forever()`
bodies that never pause — it does not help at top level. So: always run in a
child process, never in the server process, with a hard wall-clock timeout
(~10 s) and `SIGKILL` on expiry. Report the timeout to the user as a result, not
a crash.

**3. Accept the residual risk knowingly.** Even sandboxed by process, user code
runs with your user's privileges and can touch the filesystem. That is the same
risk as running any script locally, and acceptable for a personal dev tool bound
to loopback — but it should be a documented decision, not an accident. If this
ever needs to be shared, it needs a real sandbox (container or `vm` with a
restricted global), which is out of scope here.

---

## 4. Stages

### Stage 1 — Working loop

- `POST /api/run` — transpile, concatenate, spawn, return trace + diagnostics
- Prelude/postlude cache with mtime invalidation
- Localhost bind, child-process timeout
- Viewer: `<textarea>`, **Build & Run** button, error panel, wire result into `load()`

Deliverable: paste the yoga routine in, click, watch it.

### Stage 2 — Usable editor

- CodeMirror 6 for syntax highlighting (~200 KB; Monaco is ~5 MB and overkill
  when we are not doing type checking in-browser)
- Options UI for the flags that already exist: duration, `--sound`, `--buttons`,
  `--i2c-us`, `--skip-boot`
- **Load example** dropdown populated from `programs.json`, so users start from
  working code rather than an empty box
- Persist the editor buffer to `localStorage` — losing work on refresh is the
  fastest way to make a tool annoying

### Stage 3 — Polish (optional)

- Save buffer to `programs/` and register in `programs.json`
- Show the invariant checks from `check.mjs` alongside the trace
- Share a run via URL (code in the fragment)

---

## 5. Effort and risk

| Stage | Effort | Confidence |
|---|---|---|
| 1 — working loop | 1–2 days | High — pipeline already proven |
| 2 — usable editor | 2–3 days | High |
| 3 — polish | 1–2 days | Medium |

Risks:

1. **Security, if the localhost bind is forgotten.** Mitigated by doing it first,
   in the same commit as the endpoint.
2. **Prelude staleness** — an edit to `robotpu.ts` silently served against a
   cached prelude would be baffling to debug. Mitigated by mtime invalidation;
   worth an explicit test.
3. **`transpileModule` accepts code `tsc` would reject.** Slightly more permissive
   than the CLI path, so a program could work in the editor and fail in
   `run.mjs`. Acceptable, but the diagnostics panel should make type errors
   visible rather than silently dropping them.

---

## 6. Decisions needed

- **Editor**: plain `<textarea>` for Stage 1 then CodeMirror, or go straight to
  CodeMirror? (Recommend: textarea first — it makes Stage 1 a one-day job and
  proves the loop before adding a dependency.)
- **Namespace help**: user code written against the beginner `robotPu` namespace
  fails here, as we hit with the yoga routine. Auto-rewrite `robotPu.` →
  `robotPuPro.`, or just detect it and show a clear message? (Recommend: detect
  and warn — silent rewriting hides a real incompatibility.)
- **Default program** in an empty editor: blank, or the moonwalk add-on?
