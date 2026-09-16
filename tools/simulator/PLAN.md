# Robot PU desktop simulator — implementation plan

Status: **Stages 0-2 implemented**. Stage 3 (physics) deferred. Last updated 2026-09-16.
See [README.md](README.md) for usage.

A local test rig for Robot PU MakeCode code. General-purpose, but built
movement-first. The viewer is browser-based.

---

## 1. Goal and scope

Run Robot PU programs on a laptop — no robot, no micro:bit — to catch logic,
sequencing and timing bugs before flashing hardware.

**Decisions taken:**

| Decision | Choice | Why |
|---|---|---|
| Scope | General rig, movement first | Other subsystems stub out cleanly; gaits are what we're testing now |
| Viewer | Browser (local HTTP) | Renders anywhere, easy to share a trace, no native toolchain |
| Location | `tools/simulator/` | `sim/` is reserved by pxt; `pxt.json` ships an explicit file list so `tools/` never leaks into the extension |

**Non-goals:** flashing, the micro:bit LED matrix, radio peer traffic, audio
fidelity. These get recorded as events, not modelled.

---

## 2. What this can and cannot tell you

This is the most important section. Set expectations before writing code.

| Question | Answerable? | By what |
|---|---|---|
| Does the code run without crashing, in the right order? | Yes | Stage 0 |
| Are servo angles in range? Trims applied? | Yes | Stage 1 |
| Is the phase timing right (e.g. glide slower than snap)? | Yes | Stage 1 |
| Does the pose sequence *look* like the intended move? | Yes | Stage 2 |
| **Does PU actually slide backward instead of toppling?** | **No** | Stage 3 only, and even then only weakly |

The moonwalk's correctness lives in foot–floor friction and weight transfer —
precisely what small-biped sims model worst. Treat any physics answer as a
hypothesis to check on hardware, never a verdict. For this class of move the
real floor is the more trustworthy instrument, and it costs two minutes.

---

## 3. Architecture

### 3.1 The seam

The extension touches hardware through a very small surface:

```
pins.i2cWriteBuffer   pins.servoWritePin   pins.analogWritePin
pins.digitalWritePin  pins.digitalReadPin  pins.pulseIn
```

Everything else is ordinary MakeCode globals. So we **shim at the `pins` layer
and run the real `robotpu.ts` / `main.ts` unmodified.**

> **Core principle: never reimplement robot behaviour in the simulator.**
> A simulator that reimplements the thing it tests drifts away from it, and then
> agrees with itself instead of with the robot. Gait logic always comes from the
> real extension source.

Register map, decoded from `pcb.servo()` / `setLight()` / `setServoPower()`:

| Write | Meaning |
|---|---|
| reg `3`–`9` | servo index `reg - 3` (servos 0–6) |
| reg `0x10` | servo 7 |
| reg `0x12` | LED / light |
| `0x31` / `0x32` | servo power on / off |
| `servoWritePin(P14 / P15)` | servos 8 / 9 |

Unknown registers are captured rather than dropped, so protocol changes surface
instead of silently no-op'ing.

### 3.2 Build model

MakeCode sources are non-module scripts sharing one global scope. `tsc --outFile`
reproduces that exactly:

```
shim.ts → robotpu.ts → main.ts → <program under test> → run.ts
```

Feasibility is confirmed: `tsc` already compiles `robotpu.ts` + `main.ts` with
*only* missing-global errors and zero syntax errors. It is standard TypeScript;
Node runs it once the globals exist.

### 3.3 Concurrency — the one real trade-off

MakeCode uses cooperative fibers. Node has none, so:

- The **program under test runs as the main fiber**, synchronously. Loop state is
  fully preserved, so multi-step interpolation behaves correctly.
- `basic.pause(ms)` advances a **virtual clock**, then gives background tasks a
  slice. Virtual time makes runs deterministic *and* faster than real-time — no
  wall-clock flake in tests.
- `control.inBackground()` tasks are poll loops shaped
  `while (true) { …; basic.pause(n) }`. We run them from the top each slice and
  unwind at their first pause.

**Why that last one is sound:** restarting from the top is exactly equivalent for
a loop with no loop-carried local state — which is what the Robot PU background
fiber is (`updateStates(); stateMachine(); basic.pause(10)`).

**Where it breaks:** a background task that *does* carry state across its pause
points gets silently restarted. Mitigation: record a warning when a background
task overruns its slice budget, which is the usual symptom. Documented, not
hidden.

---

## 4. Stages

### Stage 0 — Harness ✅ done

Node runtime shim for `basic`, `control`, `input`, `pins`, `music`, `radio`,
`settings`, `serial`, `neopixel`, plus `randint` / `Math.randomRange`, a `Buffer`
class, and the MakeCode enums.

Movement-first split:

- **Modelled:** servo bus, virtual clock, IMU, sound level, compass, sonar, buttons
- **Recorded as events only:** LEDs, audio, radio, serial

Sensors are injectable so a test can tilt the robot or drive the mic.

Deliverable: a servo-angle trace, `[t, s0..s9]` sampled at a fixed virtual
interval, plus an event log.

*Delivered:* `src/shim.ts`, `src/driver.ts`, `run.mjs`.

### Stage 1 — Assertions and regression ✅ done

Where most real bugs die, cheaply.

- Golden traces committed per program; diff on change
- Invariant checks: angles within 0–180, trims applied, weight shift alternates,
  glide measurably slower than snap, no unknown I2C registers
- Seed from `test.ts`, which already uses a `[SIMULATOR SAFE]` / `[HARDWARE]`
  convention worth reusing

### Stage 2 — Browser viewer ✅ done

Local HTTP page, canvas, loads a trace JSON.

- 2D **side view** — the angle the moonwalk illusion is built for
- Transport: play / pause / scrub / speed
- Phase markers and a servo-angle strip chart under the figure

### Stage 3 — Physics (optional, deferred)

PyBullet or MuJoCo replaying the trace as servo targets.

**Blocked on measurement, not code.** There is no CAD in the repo — no STL, URDF,
STEP, OBJ or SDF. Link lengths, masses and inertias must be measured off a
physical robot, then friction calibrated against real slides. That is most of the
cost.

Servo parameters are already known from `tutorials/specifications.md`: 9g class,
13.4 g, 1.8–2.2 kg·cm stall, 0.1 s/60° — enough for rate and torque limits.

---

## 5. Layout

As built:

```
tools/simulator/
  PLAN.md       this file
  README.md     usage + fidelity notes
  package.json
  run.mjs       build (tsc --outFile) + run a program
  check.mjs     invariants + exact golden comparison   (Stage 1)
  serve.mjs     static server for the viewer
  src/
    shim.ts     MakeCode runtime: enums, clock, scheduler, pins, sensors
    driver.ts   runs the sim, emits the trace          (Stage 0)
  viewer/
    index.html
    viewer.js   side + front view, strip chart         (Stage 2)
  traces/       recorded traces; traces/golden/ holds blessed ones
  built/        compiled bundles (gitignored)
```

Two deviations from the original sketch, both deliberate:

- **No `tsconfig.json`.** `run.mjs` passes the file list to `tsc` directly,
  because the order depends on which program is under test.
- **No `programs/` directory.** Programs are compiled straight from `tutorials/`,
  per the "import directly" decision in §7.

---

## 6. Effort and risk

| Stage | Effort | Confidence |
|---|---|---|
| 0 — harness | 1–2 days | High |
| 1 — assertions | ~1 day | High |
| 2 — browser viewer | 2–3 days | High |
| 3 — physics | 1–2 weeks+ | Low |

**Recommendation: build 0–2 and stop.** That covers every failure mode except
floor interaction, needs no CAD, and lands in about a week. Defer Stage 3 until
there is a concrete question hardware cannot answer.

Risks:

1. **Background-task restart model** (§3.3) — mitigated by warnings; revisit if a
   stateful background task ever lands.
2. **Extension source drift** — the harness compiles the real `robotpu.ts`, so a
   refactor there can break the build. That is the intended behaviour: it is a
   signal, not a defect.
3. **I2C protocol drift** — unknown registers are captured, so this surfaces loudly.
4. **Trace format churn** — pin the schema before writing the viewer, or Stage 2
   gets rewritten.

---

## 7. Resolved decisions

| Question | Decision | Consequence |
|---|---|---|
| Wrap tutorial `.ts` or import directly? | **Import directly** | One copy of the truth. Tutorial code must stay compile-clean — a broken tutorial now breaks the sim build, which is the point |
| Viewer renders arms? | **Legs and head only** (servos 0–5) | Arms are optional hardware and the `ServoJoint` enum is unreliable there (§8). The trace still records all 10 servos |
| Golden-trace tolerance | **Exact match** | Requires a fully deterministic run — see below |

**Exact match forces determinism.** Two consequences, both handled in the shim:

1. **Virtual time**, so sample timestamps never depend on wall-clock speed.
2. **Seeded PRNG.** The extension calls `randint()` (e.g. in `dance()`), so
   `Math.random` is replaced with a seeded generator. The seed is recorded in the
   trace header; an unseeded run could never produce a repeatable golden file.

Angles are integers (the gait code rounds), so exact comparison is well-defined
and no epsilon is needed.

---

## 8. Known issue this rig should help pin down

The `ServoJoint` enum in `main.ts` disagrees with the hardware on indices 7 and 8:

| Index | `ServoJoint` says | Hardware is | Driver |
|---|---|---|---|
| 6 | `LeftShoulder` | Left shoulder | I2C |
| 7 | `LeftArm` | **Right shoulder** | I2C |
| 8 | `RightShoulder` | **Left arm** | P14 |
| 9 | `RightArm` | Right arm | P15 |

The hardware column matches both the wiring table in `tutorials/README.md` and the
routing in `pcb.servo()`. Because the simulator decodes the *bus* rather than
trusting the enum, it will show plainly which physical joint each name drives —
useful evidence before making a breaking rename.
