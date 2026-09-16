# Robot PU desktop simulator

Run Robot PU MakeCode programs on a laptop — no robot, no micro:bit — and get a
servo trace you can assert on and watch in a browser.

Design rationale and staging are in [PLAN.md](PLAN.md).

## Quick start

```sh
cd tools/simulator
npm install                 # optional; falls back to npx typescript

# run the moonwalk add-on, pressing A 200ms into the run
node run.mjs moonwalk-pu --ms 4000 --buttons 200:A

# check invariants
node check.mjs traces/moonwalk-pu.json

# watch it
node serve.mjs              # then open http://localhost:8099/
```

Or in one step: `npm run moonwalk`.

## How it works

The extension touches hardware through a very small seam, so the simulator
shims **`pins`** and runs the real `robotpu.ts` and `main.ts` **unmodified**:

| Write | Decoded as |
|---|---|
| I2C reg `3`–`9` | servos 0–6 |
| I2C reg `0x10` | servo 7 |
| I2C reg `0x12` | LED |
| I2C `0x31` / `0x32` | servo power on / off |
| `servoWritePin(P14 / P15)` | servos 8 / 9 |

> The simulator never reimplements robot behaviour. Gait logic always comes from
> the real extension source, and programs are compiled straight from
> `tutorials/` — there is no second copy to drift.

Everything is concatenated into one global scope with `tsc --outFile`, which is
how MakeCode builds too. Order: `shim.ts` → `robotpu.ts` → `main.ts` →
*program* → `driver.ts`.

## Commands

```
node run.mjs <program> [--ms N] [--seed N] [--sample N] [--buttons 200:A,3000:B] [--out FILE]
```

`<program>` is a name in `tutorials/` (e.g. `moonwalk-pu`) or a path to a `.ts`.

- `--ms` is the run length **after boot**. Robot PU spends several virtual
  seconds in `calibrate()` / `start()` before a program's own loop begins; that
  is excluded, and recorded as `bootMs` in the trace.
- `--buttons` times are likewise relative to the start of the run.

- `--sound quiet` (default) or `--sound beat[:bpm[:loud]]` drives the microphone.
  **Beat-driven programs do nothing without this.** The dance tutorials trigger on
  `soundLevel() > 140`; the default quiet level is 40, so they run but never move.
  `--sound beat:120` gives a synthetic 120 BPM envelope.

```
node check.mjs <trace.json> [--golden FILE] [--bless]
node serve.mjs [port]
```

### Testing tutorial code

Tutorials keep their code in fenced markdown blocks. `md-extract.mjs` pulls them
out so they can be run without hand-copying:

```sh
node md-extract.mjs ../../tutorials/dance-pu.md --list
node md-extract.mjs ../../tutorials/dance-pu.md --blocks 1,2 --out built/dance-B.ts
node run.mjs built/dance-B.ts --ms 8000 --sound beat:120 --out traces/dance-B.json
```

Pick blocks deliberately. A tutorial often splits one program across blocks
(definitions in one, the loop in another), while other blocks are *alternative*
programs that redeclare the same names and cannot be combined. In `dance-pu.md`:
block 0 stands alone, blocks 1+2 go together, block 3 is separate.

### The program suite

`programs.json` records those block groupings and the arguments each program
needs, so they do not have to be rediscovered:

```sh
node test-all.mjs           # run everything
node test-all.mjs motor     # just motorize-pu programs
```

Covered today: `moonwalk-pu.ts`, `dance-pu.md` (3 programs), `motorize-pu.md`
(7 programs).

Fields worth knowing:

- `expectMotion: false` marks a snippet that legitimately moves nothing — the raw
  I2C probes in `motorize-pu.md`. Those skip the "servos actually moved" check
  rather than failing it.
- `notRunnable` records blocks that cannot run on their own and why, so nobody
  wastes time retrying them. In `motorize-pu.md` blocks 6 and 7 are one-line
  fragments referencing an undefined `t`, meant to be pasted inside a function.

**Top-level motion lands before `bootMs`.** A program whose transitions run at
top level (`motor-pose`) does all its work before the driver starts, so filtering
a trace to post-boot rows will make it look static when it is not. Measure the
whole trace unless you specifically want the loop phase.

## What it can and cannot tell you

| Question | Answer |
|---|---|
| Does the code run, in the right order? | Yes |
| Angles in range? Trims applied? | Yes |
| Is the phase timing right? | Yes |
| Does the pose sequence look right? | Yes, in the viewer |
| **Does PU actually slide instead of toppling?** | **No** — needs contact physics |

The last row matters for the moonwalk specifically: its correctness lives in
foot–floor friction, which this does not model. Use the simulator to catch logic
and timing bugs, then confirm the move on a real floor.

## Fidelity notes

**Virtual time.** `control.millis()` is simulated, and `basic.pause()` advances
it. Runs are faster than real-time and perfectly repeatable.

**Deterministic RNG.** `Math.random` is a seeded mulberry32; the seed is in the
trace header. Without this, golden traces could not be compared exactly.

**Concurrency — the one real trade-off.** The program under test runs as the main
fiber with full loop state. Background tasks from `control.inBackground()` are
re-run from the top each slice and unwound at their first `basic.pause()`. That
is exactly equivalent for a poll loop with no loop-carried state, which is what
the Robot PU background fiber is. A *stateful* background task would be silently
restarted; the harness records a warning on slice overrun, which is the usual
symptom.

**Modelled:** servo bus, virtual clock, IMU, sound level, compass, sonar, buttons,
settings storage.
**Recorded as events only:** LEDs, audio, radio, serial. Movement first — these
stub out without crashing, but do not behave.

Sensors are injectable, so a test can tilt the robot or drive the microphone:

```ts
sensors.accel = { x: 200, y: 0, z: -1000 };   // lean
sensors.sound = 180;                           // loud
```

## Viewer

Legs and head only (servos 0–5). Arms are recorded in the trace but not drawn —
they are optional hardware and the `ServoJoint` enum is unreliable at indices
7–8 (see PLAN.md §8), so drawing them would imply confidence we do not have.

- **Side view** — hip pitch, i.e. the fore-aft leg swing that makes the gait
- **Front view** — ankle roll, i.e. the weight shift
- Strip chart of all six angles, with a playhead
- Scrub, play/pause, 0.25×–4× speed
- A dropdown lists everything in `traces/` (served by `/api/traces`)
- Deep link to one with `?trace=dance-B-beat.json`
- Drag a trace `.json` onto the page to load it

Open it at **http://localhost:8099/** — `/` redirects to `/viewer/`. The trailing
slash matters: serving the page at `/` would make the browser resolve
`viewer.js` to `/viewer.js` and 404, leaving a dead page with no JavaScript.

## Writing code in the browser

Press **`</> code`** in the header for an editor. Type a program, press
**Build & Run** (or Cmd/Ctrl+Enter) and the resulting trace loads straight into
the playback panels. Typical round trip is **~100 ms**.

- **load example…** pulls the real source of any `file:` program in
  `programs.json`, along with its arguments
- Run options mirror the CLI flags: duration, `--sound`, `--buttons`,
  `--i2c-us`, `--skip-boot`
- The buffer persists in `localStorage`

### How it stays fast

The extension is compiled **once** into `built/_prelude.js`
(shim + robotpu + main) and `built/_postlude.js` (driver), cached with an mtime
check against the sources — edit `robotpu.ts` and they rebuild. Each run only
transpiles the user's code with the TypeScript compiler API held in memory, then
concatenates prelude + user + postlude.

This is the same split `tsc --outFile` already does, and it was verified to
produce traces **byte-identical** to the monolithic build. Going through the
`npx tsc` CLI instead costs ~1.3 s per run, almost all of it process startup.

### Safety

`/api/run` executes arbitrary code with your user's privileges. Two consequences:

- **The server binds `127.0.0.1` only.** Do not change this to `0.0.0.0` — on a
  shared network it would be remote code execution on your machine.
- **User code runs in a child process with a 15 s timeout**, then `SIGKILL`. A
  `while (true) {}` with no `basic.pause()` cannot wedge the server; it comes
  back as a normal error explaining that the loop never yields.

Syntax errors fail the build rather than running — `transpileModule` emits even
for malformed input, so without that check a broken program would quietly
produce a degenerate trace and report success.

Code using the beginner 6-DOF `robotPu` namespace is detected and flagged, since
it would otherwise fail with a bare `ReferenceError`. It is reported, never
silently rewritten: it is a genuine incompatibility, not a typo.

## Golden traces

Comparison is **exact** — viable because the runtime is fully deterministic and
the gait code rounds to integer angles.

```sh
node check.mjs traces/moonwalk-pu.json --bless    # record
node check.mjs traces/moonwalk-pu.json            # compare
```

If a golden diff appears unexpectedly, suspect a determinism leak (an unseeded
random source, or real wall-clock time) before reaching for a tolerance.

## Layout

```
tools/simulator/
  run.mjs       build + run a program
  check.mjs     invariants + golden comparison
  serve.mjs     static server for the viewer
  src/
    shim.ts     MakeCode runtime (enums, clock, scheduler, pins, sensors)
    driver.ts   runs the sim, emits the trace
  viewer/       browser viewer
  traces/       recorded traces; traces/golden/ holds blessed ones
  built/        compiled bundles (gitignored)
```
