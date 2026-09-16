/**
 * MakeCode / micro:bit runtime shim for the Robot PU desktop simulator.
 *
 * This file provides Node implementations of the MakeCode globals that the
 * Robot PU extension uses, so `robotpu.ts` and `main.ts` can run UNMODIFIED.
 * Nothing here reimplements robot behaviour - the gait logic always comes from
 * the real extension source. That is deliberate: a simulator that reimplements
 * the thing it is testing drifts away from it.
 *
 * Hardware is intercepted at the `pins` layer (the narrowest seam):
 *   servos 0-7 -> pins.i2cWriteBuffer register writes
 *   servos 8-9 -> pins.servoWritePin(P14 / P15)
 *
 * Fidelity notes are in tools/simulator/README.md. The important one is the
 * concurrency model, described at "Scheduler" below.
 */

// ---------------------------------------------------------------------------
// MakeCode enums
// ---------------------------------------------------------------------------

enum Dimension { X = 0, Y = 1, Z = 2, Strength = 3 }
enum Gesture {
    Shake = 11, LogoUp = 1, LogoDown = 2, ScreenUp = 5, ScreenDown = 6,
    TiltLeft = 3, TiltRight = 4, FreeFall = 7, EightG = 8, ThreeG = 9, SixG = 10
}
enum Button { A = 1, B = 2, AB = 3 }
enum NumberFormat { Int8LE = 1, UInt8LE = 5, Int16LE = 2, UInt16LE = 7, Int32LE = 10, UInt32LE = 11 }
enum AnalogPin { P0 = 100, P1 = 101, P2 = 102, P3 = 103, P4 = 104, P8 = 108, P10 = 110,
                 P12 = 112, P13 = 113, P14 = 114, P15 = 115, P16 = 116 }
enum DigitalPin { P0 = 100, P1 = 101, P2 = 102, P8 = 108, P12 = 112, P13 = 113, P14 = 114, P15 = 115, P16 = 116 }
enum PulseValue { High = 1, Low = 0 }
enum TouchPin { P0 = 100, P1 = 101, P2 = 102 }
enum WaveShape { Sine = 0, Sawtooth = 1, Triangle = 2, Square = 3, Noise = 4 }
enum SoundExpressionEffect { None = 0, Vibrato = 1, Tremolo = 2, Warble = 3 }
enum InterpolationCurve { Linear = 0, Curve = 1, Logarithmic = 2 }
enum NeoPixelMode { RGB = 1, RGBW = 2, RGB_RGB = 3 }
// micro:bit V2 logo touch. The numeric values are not load-bearing here —
// nothing in the simulator dispatches on them, only on the handler registration.
enum TouchButtonEvent { Pressed = 3, Released = 4, LongPressed = 5 }
enum IconNames { Heart = 0, Yes = 1, No = 2, Happy = 3, Sad = 4, Asleep = 5, Confused = 6 }
enum ArrowNames { North = 0, East = 2, South = 4, West = 6 }

// ---------------------------------------------------------------------------
// Buffer
// ---------------------------------------------------------------------------

class Buffer {
    public data: number[];
    constructor(size: number) {
        this.data = [];
        for (let i = 0; i < size; i++) this.data.push(0);
    }
    setNumber(_fmt: NumberFormat, offset: number, value: number): void {
        this.data[offset] = value & 0xff;
    }
    getNumber(_fmt: NumberFormat, offset: number): number {
        return this.data[offset];
    }
    get length(): number { return this.data.length; }
}

// ---------------------------------------------------------------------------
// Virtual clock + scheduler
// ---------------------------------------------------------------------------
//
// Scheduler model (the one fidelity trade-off worth understanding):
//
//   * The program under test runs as the MAIN fiber, synchronously. Its loop
//     state is fully preserved, so multi-step motions interpolate correctly.
//   * basic.pause(ms) advances VIRTUAL time, then gives background tasks a
//     slice. Virtual time means runs are deterministic and faster than
//     real-time - no wall-clock flake in tests.
//   * Background tasks registered via control.inBackground() are poll loops of
//     the form `while (true) { ...; basic.pause(n) }`. We run them from the top
//     each slice and unwind at their first pause. That is exactly equivalent
//     for a loop with no loop-carried local state, which is what the Robot PU
//     background fiber is (updateStates(); stateMachine(); pause(10)).
//
// If you add a background task that DOES carry state across its pause points,
// this model will silently restart it. SimTrace.warnings records a note when a
// background task overruns its slice budget, which is the usual symptom.

namespace sim {
    export let now = 0;                  // virtual milliseconds
    export let warnings: string[] = [];

    class YieldSignal { public constructor(public ms: number) { } }

    interface BgTask { fn: () => void; nextDue: number; }

    interface Timer { at: number; fn: () => void; fired: boolean; }

    /**
     * kind: "unknown" until the body has run once as the main fiber.
     *   "poll"     — pauses exactly once, so re-running it from the top is
     *                equivalent and it is safe to service during another
     *                body's pause (a fast action engine).
     *   "stateful" — pauses more than once, so it carries state across pause
     *                points. It must always run as the main fiber, never be
     *                restarted (a routine selector stepping through gaits).
     */
    interface ForeverTask { fn: () => void; nextDue: number; kind: string; }

    let bgTasks: BgTask[] = [];
    let foreverTasks: ForeverTask[] = [];
    let timers: Timer[] = [];
    let inBackground = false;
    let currentForever = -1;   // index of the forever body running as main fiber
    let mainPauseCount = 0;    // pauses taken by the current main-fiber body

    export function reset(): void {
        now = 0;
        warnings = [];
        bgTasks = [];
        foreverTasks = [];
        timers = [];
        inBackground = false;
    }

    /**
     * Fire a callback once virtual time reaches `t`. Used to script input
     * (button presses, sensor changes) into a run.
     *
     * Timers fire from the run loop, not from inside pause(), so a handler that
     * itself blocks cannot re-enter the clock mid-advance.
     */
    export function scheduleAt(t: number, fn: () => void): void {
        timers.push({ at: t, fn: fn, fired: false });
    }

    function runDueTimers(): void {
        for (let i = 0; i < timers.length; i++) {
            const tm = timers[i];
            if (!tm.fired && now >= tm.at) {
                tm.fired = true;
                tm.fn();
            }
        }
    }

    /**
     * Virtual time at which robot initialisation finished, or -1.
     *
     * ensureRobot() runs `calibrate(); start();` and only THEN registers its
     * background poll loop, so the first background registration is an exact
     * marker for "init complete". That is the honest boundary for --skip-boot:
     * using "when the driver starts" instead would discard any program that
     * does its work at top level, which is most of them.
     */
    export let initDoneMs = -1;

    export function registerBackground(fn: () => void): void {
        if (initDoneMs < 0) initDoneMs = now;
        bgTasks.push({ fn: fn, nextDue: now });
    }

    export function registerForever(fn: () => void): void {
        foreverTasks.push({ fn: fn, nextDue: now, kind: "unknown" });
    }

    export function foreverCount(): number { return foreverTasks.length; }

    let usAccum = 0;

    /**
     * Advance virtual time by a sub-millisecond amount, for hardware
     * transaction cost (see hw.i2cCostUs).
     *
     * Deliberately does NOT service background tasks: this is called from
     * inside a bus write, and re-entering the scheduler there would let a
     * background fiber run in the middle of another fiber's I2C transaction.
     */
    export function advanceMicros(us: number): void {
        if (us <= 0) return;
        usAccum += us;
        while (usAccum >= 1000) { usAccum -= 1000; now += 1; }
        hw.sample(now);
    }

    /** Called by basic.pause(). Advances virtual time and services background tasks. */
    export function pause(ms: number): void {
        if (inBackground) {
            // Unwind this background task; it resumes from the top next slice.
            throw new YieldSignal(ms);
        }
        mainPauseCount++;
        const target = now + Math.max(0, ms);
        // Service background tasks at their own cadence while time advances.
        // Sample inside the loop too: during a long pause the only thing moving
        // the servos is the background fiber, and we still want that on the trace.
        while (now < target) {
            const step = Math.min(target - now, 1);
            now += step;
            runDueBackground();
            runDueForevers();
            hw.sample(now);
        }
        hw.sample(now);
    }

    function runDueBackground(): void {
        for (let i = 0; i < bgTasks.length; i++) {
            const t = bgTasks[i];
            if (now < t.nextDue) continue;
            inBackground = true;
            try {
                t.fn();
                // Completed without pausing: it is not a poll loop. Run once only.
                t.nextDue = Number.MAX_SAFE_INTEGER;
            } catch (e) {
                if (e instanceof YieldSignal) {
                    t.nextDue = now + Math.max(1, (e as YieldSignal).ms);
                } else {
                    inBackground = false;
                    throw e;
                }
            }
            inBackground = false;
        }
    }

    /**
     * While one forever() body is blocked in pause(), let the OTHERS run.
     *
     * MakeCode runs each forever() as an independent fiber. kungfu.md relies on
     * this: a fast action engine (moveServos + pause(10)) alongside a slow
     * routine selector (pause(2000) between gaits). Calling the bodies
     * round-robin in lockstep starves the fast loop — it got one call per 2000ms
     * and the servos crawled a couple of degrees instead of reaching the gait.
     *
     * The body being serviced here is re-entered from the top and unwound at its
     * first pause, exactly like a background task. That is correct for a poll
     * loop with no state across its pause — which is what a fast action engine
     * is. A *stateful* body would be restarted, but it is never the one blocked:
     * the blocked body is the main fiber and is excluded via currentForever.
     */
    function runDueForevers(): void {
        for (let i = 0; i < foreverTasks.length; i++) {
            if (i === currentForever) continue;
            const t = foreverTasks[i];
            // Only poll loops may be re-entered from the top. An unclassified
            // body might be stateful, so leave it for the main-fiber path.
            if (t.kind !== "poll") continue;
            if (now < t.nextDue) continue;
            inBackground = true;
            try {
                t.fn();
                t.nextDue = now + 20;      // MakeCode's implicit forever yield
            } catch (e) {
                if (e instanceof YieldSignal) {
                    t.nextDue = now + Math.max(1, (e as YieldSignal).ms);
                } else {
                    inBackground = false;
                    throw e;
                }
            }
            inBackground = false;
        }
    }

    /** Drive registered forever() handlers until the virtual time limit. */
    export function run(limitMs: number): void {
        hw.sample(now);
        if (foreverTasks.length === 0) {
            // No forever loop: just let background tasks run out the clock.
            while (now < limitMs) { runDueTimers(); pause(10); }
            return;
        }
        let guard = 0;
        while (now < limitMs) {
            const before = now;
            runDueTimers();

            // Pick the main fiber. A body known to be stateful must always run
            // here (it can never be restarted from the top); otherwise take
            // whichever is due soonest.
            let pick = -1;
            for (let i = 0; i < foreverTasks.length; i++) {
                const t = foreverTasks[i];
                if (t.kind === "stateful" && t.nextDue <= now) { pick = i; break; }
                if (pick < 0 || t.nextDue < foreverTasks[pick].nextDue) pick = i;
            }
            const task = foreverTasks[pick];
            if (task.nextDue > now) pause(Math.min(task.nextDue - now, limitMs - now));
            if (now >= limitMs) break;

            currentForever = pick;
            mainPauseCount = 0;
            try {
                task.fn();
            } finally {
                currentForever = -1;
            }
            // Classify on the first main-fiber run: one pause means a poll loop
            // that is safe to service during another body's pause; more than
            // one means it carries state across pause points.
            if (task.kind === "unknown") {
                task.kind = mainPauseCount > 1 ? "stateful" : "poll";
            }
            task.nextDue = now + 20;   // MakeCode's implicit forever yield

            if (now === before) {
                // A forever body that never pauses would spin forever.
                guard++;
                if (guard > 1000) {
                    warnings.push("forever() body never called basic.pause(); advancing clock to avoid a hang");
                    pause(1);
                    guard = 0;
                }
            } else {
                guard = 0;
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Hardware model: servo bus + recorder
// ---------------------------------------------------------------------------

namespace hw {
    export const SERVO_COUNT = 10;
    export const JOINT_NAMES = [
        "LeftFoot", "LeftLeg", "RightFoot", "RightLeg", "HeadYaw",
        "HeadPitch", "LeftShoulder", "RightShoulder", "LeftArm", "RightArm"
    ];

    /** Commanded angles. Index order matches the extension's stateTargets. */
    export let servo: number[] = [];
    export let servoPower = true;
    export let light = 0;
    export let i2cUnknown: { t: number; reg: number; val: number }[] = [];
    export let events: { t: number; kind: string; detail: string }[] = [];

    // Sampled trace
    export let sampleMs = 10;
    export let trace: number[][] = [];     // [t, s0..s9]
    let lastSample = -1;

    /**
     * Virtual cost of one bus transaction, in microseconds. Default 0.
     *
     * Zero keeps existing golden traces valid, but it makes any tight loop that
     * drives servos without basic.pause() collapse into a single instant -
     * see the while-loops in programs/yoga-routine.ts. Set --i2c-us 400 for a
     * rough 100kHz-bus approximation when timing such a loop matters.
     */
    export let i2cCostUs = 0;

    export function reset(): void {
        servo = [];
        for (let i = 0; i < SERVO_COUNT; i++) servo.push(90);
        servoPower = true;
        light = 0;
        i2cUnknown = [];
        events = [];
        trace = [];
        lastSample = -1;
        selectedReg = -1;
    }

    export function setServo(idx: number, angle: number): void {
        if (idx < 0 || idx >= SERVO_COUNT) return;
        servo[idx] = angle;
    }

    export function logEvent(kind: string, detail: string): void {
        events.push({ t: sim.now, kind: kind, detail: detail });
    }

    /** Record a row if a sample interval has elapsed. */
    export function sample(t: number): void {
        if (lastSample >= 0 && t - lastSample < sampleMs) return;
        lastSample = t;
        const row = [t];
        for (let i = 0; i < SERVO_COUNT; i++) row.push(servo[i]);
        trace.push(row);
    }

    /**
     * Decode an I2C write from the extension's PCB class.
     * Register map (from robotpu.ts pcb.servo / setLight / setServoPower):
     *   reg 3..9  -> servo index reg-3   (servos 0..6)
     *   reg 0x10  -> servo 7
     *   reg 0x12  -> LED / light
     *   0x31/0x32 -> servo power on/off
     */
    /** Register selected by a bare i2cWriteNumber(), for a following read. */
    export let selectedReg = -1;

    /** Map a bus register back to a servo index, or -1. Inverse of pcb.servo(). */
    export function regToServo(reg: number): number {
        if (reg >= 3 && reg <= 9) return reg - 3;
        if (reg === 0x10) return 7;
        return -1;
    }

    export function i2cWrite(buf: Buffer): void {
        const reg = buf.data[0];
        const val = buf.data[1];
        if (reg >= 3 && reg <= 9) {
            setServo(reg - 3, val);
        } else if (reg === 0x10) {
            setServo(7, val);
        } else if (reg === 0x12) {
            light = val;
            logEvent("light", String(val));
        } else if (reg === 0x31) {
            servoPower = true;
            logEvent("servoPower", "on");
        } else if (reg === 0x32) {
            servoPower = false;
            logEvent("servoPower", "off");
        } else {
            i2cUnknown.push({ t: sim.now, reg: reg, val: val });
        }
    }
}

// ---------------------------------------------------------------------------
// Sensor model (injectable, so tests can drive the IMU / mic)
// ---------------------------------------------------------------------------

namespace sensors {
    // Upright at rest: ~1g on -Z, in milli-g as MakeCode reports.
    export let accel = { x: 0, y: 0, z: -1024 };
    export let heading = 0;
    export let temperature = 22;
    export let gesture: Gesture | -1 = -1;
    export let sonarCm = 100;

    // --- Microphone ------------------------------------------------------
    //
    // A constant sound level silently defeats every beat-driven program: the
    // dance tutorials trigger on soundLevel() > 140, so a flat 40 means they
    // run but never move. The synthetic beat below is a plain numeric envelope
    // (a spike at each beat, quiet in between) so that code path can be tested.

    export let soundMode = "quiet";     // "quiet" | "beat"
    export let soundQuiet = 40;
    export let soundLoud = 200;
    export let bpm = 120;
    export let beatWidthMs = 70;

    export function reset(): void {
        accel = { x: 0, y: 0, z: -1024 };
        heading = 0;
        temperature = 22;
        gesture = -1;
        sonarCm = 100;
        soundMode = "quiet";
        soundQuiet = 40;
        soundLoud = 200;
        bpm = 120;
        beatWidthMs = 70;
    }

    /** Sound level at a given virtual time. */
    export function soundAt(t: number): number {
        if (soundMode !== "beat") return soundQuiet;
        const period = 60000 / Math.max(1, bpm);
        const phase = t % period;
        if (phase >= beatWidthMs) return soundQuiet;
        // Sharp attack, quick decay - enough shape for a threshold detector.
        const k = 1 - phase / beatWidthMs;
        return Math.round(soundQuiet + (soundLoud - soundQuiet) * k);
    }
}

// ---------------------------------------------------------------------------
// MakeCode global namespaces
// ---------------------------------------------------------------------------

namespace basic {
    export function pause(ms: number): void { sim.pause(ms); }
    export function forever(cb: () => void): void { sim.registerForever(cb); }
    export function showNumber(n: number): void { hw.logEvent("showNumber", String(n)); }
    export function showString(s: string): void { hw.logEvent("showString", s); }
    export function showIcon(i: IconNames): void { hw.logEvent("showIcon", String(i)); }
    export function showArrow(a: ArrowNames): void { hw.logEvent("showArrow", String(a)); }
    export function showLeds(_s: string): void { hw.logEvent("showLeds", ""); }
    export function clearScreen(): void { hw.logEvent("clearScreen", ""); }
}

namespace control {
    export function millis(): number { return sim.now; }
    export function inBackground(cb: () => void): void { sim.registerBackground(cb); }
    export function waitMicros(us: number): void { sim.now += Math.max(0, Math.floor(us / 1000)); }
    export function deviceSerialNumber(): number { return 0x5150; }
    export function reset(): void { hw.logEvent("reset", ""); }
}

namespace input {
    export function acceleration(d: Dimension): number {
        if (d === Dimension.X) return sensors.accel.x;
        if (d === Dimension.Y) return sensors.accel.y;
        if (d === Dimension.Z) return sensors.accel.z;
        const a = sensors.accel;
        return Math.round(Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z));
    }
    export function soundLevel(): number { return sensors.soundAt(sim.now); }
    export function compassHeading(): number { return sensors.heading; }
    export function temperature(): number { return sensors.temperature; }
    export function isGesture(g: Gesture): boolean { return sensors.gesture === g; }
    export function onButtonPressed(b: Button, cb: () => void): void { buttons.register(b, cb); }
    export function onLogoEvent(e: TouchButtonEvent, cb: () => void): void { logo.register(e, cb); }
    export function logoIsPressed(): boolean { return false; }
    export function onGesture(_g: Gesture, _cb: () => void): void { /* not modelled */ }
    export function lightLevel(): number { return 128; }
    export function runningTime(): number { return sim.now; }
}

/** Button handlers, so a test can press A / B programmatically. */
namespace buttons {
    let handlers: { b: Button; cb: () => void }[] = [];
    export function reset(): void { handlers = []; }
    export function register(b: Button, cb: () => void): void { handlers.push({ b: b, cb: cb }); }
    export function press(b: Button): void {
        hw.logEvent("button", String(b));
        for (let i = 0; i < handlers.length; i++) {
            if (handlers[i].b === b) handlers[i].cb();
        }
    }
}

/** Logo touch handlers, so a test can trigger them like buttons. */
namespace logo {
    let handlers: { e: TouchButtonEvent; cb: () => void }[] = [];
    export function reset(): void { handlers = []; }
    export function register(e: TouchButtonEvent, cb: () => void): void { handlers.push({ e: e, cb: cb }); }
    export function fire(e: TouchButtonEvent): void {
        hw.logEvent("logo", String(e));
        for (let i = 0; i < handlers.length; i++) {
            if (handlers[i].e === e) handlers[i].cb();
        }
    }
}

namespace pins {
    export function createBuffer(size: number): Buffer { return new Buffer(size); }
    export function i2cWriteBuffer(_addr: number, buf: Buffer, _repeat?: boolean): void {
        hw.i2cWrite(buf);
        sim.advanceMicros(hw.i2cCostUs);
    }
    export function i2cReadBuffer(_addr: number, size: number, _repeat?: boolean): Buffer {
        return new Buffer(size);
    }
    /**
     * Single-number I2C access, as used by the raw-bus examples in
     * motorize-pu.md. A lone write selects a register; the following read
     * returns that register's value, so `write(reg 0x03); read()` gives back
     * servo 0's angle rather than a meaningless constant.
     */
    export function i2cWriteNumber(_addr: number, value: number, _fmt?: NumberFormat, _repeat?: boolean): void {
        hw.selectedReg = value & 0xff;
        hw.logEvent("i2cSelect", "0x" + (value & 0xff).toString(16));
        sim.advanceMicros(hw.i2cCostUs);
    }
    export function i2cReadNumber(_addr: number, _fmt?: NumberFormat, _repeat?: boolean): number {
        const idx = hw.regToServo(hw.selectedReg);
        return idx >= 0 ? hw.servo[idx] : 0;
    }
    export function servoWritePin(pin: AnalogPin, value: number): void {
        // The hardware takes an integer angle and clamps it. pcb.servo() only
        // floors/clamps on the I2C path (servos 0-7); servos 8-9 go out through
        // here with whatever servoStep() produced, which can be fractional. Do
        // what the board does, so the trace shows the angle actually commanded.
        const a = Math.min(180, Math.max(0, Math.floor(value)));
        if (pin === AnalogPin.P14) hw.setServo(8, a);
        else if (pin === AnalogPin.P15) hw.setServo(9, a);
        sim.advanceMicros(hw.i2cCostUs);
    }
    export function analogWritePin(_pin: AnalogPin, _value: number): void { /* no-op */ }
    export function digitalWritePin(_pin: DigitalPin, _value: number): void { /* no-op */ }
    export function digitalReadPin(_pin: DigitalPin): number { return 0; }
    /** Ultrasonic echo: convert the modelled distance back into a pulse width. */
    export function pulseIn(_pin: DigitalPin, _value: PulseValue, _maxUs?: number): number {
        return Math.round(sensors.sonarCm * 58);
    }
    export function analogReadPin(_pin: AnalogPin): number { return 0; }
    export function setPull(_pin: DigitalPin, _pull: number): void { /* no-op */ }
}

// Movement-first: audio, radio and LEDs are recorded but not modelled.

/**
 * Audio.
 *
 * Sound is modelled for TIMING and recorded to the trace; no waveform is
 * synthesised. Timing is the part that affects the robot: a play() that blocks
 * holds up the whole program, and queued background sounds decide when the next
 * one starts. Getting that wrong silently shifts every motion after it.
 *
 * The micro:bit has one background audio channel, so consecutive
 * InBackground plays QUEUE rather than overlap. That is why the five calls in a
 * typical init_sound() take 1.25s to finish even though the function returns at
 * once.
 *
 * Not modelled: the microphone does not hear the speaker. On hardware it does,
 * which matters for programs that dance to their own music — treat soundLevel()
 * as external sound only.
 */
namespace music {
    export enum PlaybackMode { UntilDone = 1, InBackground = 2, LoopingInBackground = 3 }

    export interface Sound {
        wave: number; startFreq: number; endFreq: number;
        startVol: number; endVol: number; ms: number;
        effect: number; curve: number;
    }

    export let volume = 128;
    export let speakerOn = true;

    /** Virtual time at which the single background audio channel frees up. */
    export let busyUntil = 0;

    /** Everything played, for the trace. */
    export let played: {
        t: number; endT: number; ms: number; mode: number;
        wave: number; freq0: number; freq1: number;
        vol0: number; vol1: number; effect: number; curve: number; kind: string;
    }[] = [];

    export function reset(): void {
        volume = 128;
        speakerOn = true;
        busyUntil = 0;
        played = [];
    }

    function record(kind: string, ms: number, mode: number, wave: number, f0: number, f1: number,
        v0: number, v1: number, effect: number, curve: number): number {
        const start = Math.max(sim.now, mode === PlaybackMode.UntilDone ? sim.now : busyUntil);
        played.push({
            t: start, endT: start + ms, ms: ms, mode: mode,
            wave: wave, freq0: f0, freq1: f1, vol0: v0, vol1: v1,
            effect: effect, curve: curve, kind: kind,
        });
        return start;
    }

    export function createSoundExpression(
        wave: number, startFreq: number, endFreq: number,
        startVol: number, endVol: number, ms: number,
        effect: number, curve: number
    ): Sound {
        return {
            wave: wave, startFreq: startFreq, endFreq: endFreq,
            startVol: startVol, endVol: endVol, ms: ms,
            effect: effect, curve: curve,
        };
    }

    /** Rough duration for a melody string: one beat per token. */
    export function stringPlayable(s: string, tempo: number): Sound {
        const beats = s.trim().split(/\s+/).filter(function (x) { return x.length > 0; }).length;
        const ms = Math.round(beats * (60000 / Math.max(1, tempo)));
        return {
            wave: WaveShape.Square, startFreq: 440, endFreq: 440,
            startVol: volume, endVol: volume, ms: ms,
            effect: SoundExpressionEffect.None, curve: InterpolationCurve.Linear,
        };
    }

    export function play(sound: Sound, mode: number = PlaybackMode.UntilDone): void {
        const ms = sound && sound.ms ? sound.ms : 0;
        const wave = sound ? sound.wave : 0;
        const f0 = sound ? sound.startFreq : 0;
        const f1 = sound ? sound.endFreq : 0;
        const fx = sound ? sound.effect : 0;
        const v0 = sound ? sound.startVol : 255;
        const v1 = sound ? sound.endVol : 0;
        const cv = sound ? sound.curve : 0;

        if (mode === PlaybackMode.UntilDone) {
            record("expr", ms, mode, wave, f0, f1, v0, v1, fx, cv);
            busyUntil = sim.now + ms;
            sim.pause(ms);           // blocks the caller
            return;
        }
        // InBackground / LoopingInBackground: returns immediately, but the single
        // audio channel serialises them.
        const start = record("expr", ms, mode, wave, f0, f1, v0, v1, fx, cv);
        busyUntil = start + ms;
    }

    export function playTone(freq: number, ms: number): void {
        hw.logEvent("tone", freq + "@" + ms);
        record("tone", ms, PlaybackMode.UntilDone, WaveShape.Square, freq, freq, volume, volume, 0, 0);
        busyUntil = sim.now + ms;
        sim.pause(ms);
    }

    export function rest(ms: number): void { sim.pause(ms); }
    export function setVolume(v: number): void { volume = v; }
    export function setBuiltInSpeakerEnabled(on: boolean): void { speakerOn = on; }
    export function ringTone(_f: number): void { /* continuous tone, no duration */ }
    export function stopAllSounds(): void { busyUntil = sim.now; }
}

namespace radio {
    export function setGroup(g: number): void { hw.logEvent("radioGroup", String(g)); }
    export function sendString(s: string): void { hw.logEvent("radioTx", s); }
    export function sendValue(n: string, v: number): void { hw.logEvent("radioTx", n + "=" + v); }
    export function onReceivedString(_cb: (s: string) => void): void { /* no inbound traffic */ }
    export function onReceivedValue(_cb: (n: string, v: number) => void): void { /* no inbound traffic */ }
}

namespace settings {
    let store: { [k: string]: any } = {};
    export function reset(): void { store = {}; }
    export function writeNumber(k: string, v: number): void { store[k] = v; }
    export function readNumber(k: string): number { return store[k]; }
    export function writeString(k: string, v: string): void { store[k] = v; }
    export function readString(k: string): string { return store[k] !== undefined ? store[k] : ""; }
    export function exists(k: string): boolean { return store[k] !== undefined; }
}

namespace serial {
    export function writeLine(s: string): void { hw.logEvent("serial", s); }
    export function writeString(s: string): void { hw.logEvent("serial", s); }
    export function writeValue(n: string, v: number): void { hw.logEvent("serial", n + "=" + v); }
}

namespace neopixel {
    export class Strip {
        setPixelColor(_i: number, _c: number): void { /* no-op */ }
        show(): void { /* no-op */ }
        clear(): void { /* no-op */ }
        setBrightness(_b: number): void { /* no-op */ }
        showColor(_c: number): void { /* no-op */ }
        length(): number { return 2; }
        range(_s: number, _n: number): Strip { return this; }
        rotate(_n: number): void { /* no-op */ }
    }
    export function create(_pin: DigitalPin, _n: number, _mode: NeoPixelMode): Strip { return new Strip(); }
    export function rgb(r: number, g: number, b: number): number { return (r << 16) | (g << 8) | b; }
    export function colors(c: number): number { return c; }
    export function hsl(h: number, _s: number, _l: number): number { return h; }
}

// ---------------------------------------------------------------------------
// Deterministic RNG
// ---------------------------------------------------------------------------
//
// Golden traces are compared EXACTLY, so every run must be reproducible. The
// extension calls randint() (dance(), for one), which would otherwise make the
// trace differ on every run. Math.random is replaced with a seeded mulberry32
// generator; the seed is written into the trace header.

namespace rng {
    let state = 0;

    export function seed(s: number): void {
        state = s >>> 0;
    }

    /** mulberry32 — small, fast, good enough for reproducible test runs. */
    export function next(): number {
        state = (state + 0x6D2B79F5) >>> 0;
        let t = state;
        t = ime(t ^ (t >>> 15), t | 1);
        t ^= t + ime(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }

    /** Math.imul, spelled out so this stays dependency-free. */
    function ime(a: number, b: number): number {
        const aHi = (a >>> 16) & 0xffff, aLo = a & 0xffff;
        const bHi = (b >>> 16) & 0xffff, bLo = b & 0xffff;
        return ((aLo * bLo) + (((aHi * bLo + aLo * bHi) << 16) >>> 0)) | 0;
    }
}

// Replace Math.random globally so the extension's randint() is deterministic.
(Math as any).random = function (): number { return rng.next(); };

// MakeCode globals that live on the bare scope.
function randint(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

// MakeCode also exposes Math.randomRange.
interface Math { randomRange(min: number, max: number): number; }
(Math as any).randomRange = function (min: number, max: number): number {
    return randint(min, max);
};

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
//
// This runs FIRST in the bundle, before the program under test. That ordering
// matters: a MakeCode program does real work at top level (the moonwalk add-on
// reads trims and strikes a pose), and that work must land in an initialised
// world with a seeded RNG, or the very first trace rows would be garbage.

declare const process: any;

namespace boot {
    function envInt(name: string, dflt: number): number {
        if (typeof process === "undefined" || !process.env || !process.env[name]) return dflt;
        const v = parseInt(process.env[name], 10);
        return isNaN(v) ? dflt : v;
    }

    export let seedUsed = 1;

    function envStr(name: string, dflt: string): string {
        if (typeof process === "undefined" || !process.env || !process.env[name]) return dflt;
        return process.env[name];
    }

    export function init(): void {
        seedUsed = envInt("SIM_SEED", 1);
        rng.seed(seedUsed);
        sim.reset();
        hw.reset();
        hw.sampleMs = envInt("SIM_SAMPLE_MS", 10);
        hw.i2cCostUs = envInt("SIM_I2C_US", 0);
        sensors.reset();
        buttons.reset();
        logo.reset();
        music.reset();
        settings.reset();

        // SIM_SOUND: "quiet" (default) or "beat[:bpm[:loud]]".
        // Applied here, before the program's top level, so even boot-time code
        // sees a consistent microphone.
        const spec = envStr("SIM_SOUND", "quiet").split(":");
        if (spec[0] === "beat") {
            sensors.soundMode = "beat";
            if (spec.length > 1 && !isNaN(parseInt(spec[1], 10))) sensors.bpm = parseInt(spec[1], 10);
            if (spec.length > 2 && !isNaN(parseInt(spec[2], 10))) sensors.soundLoud = parseInt(spec[2], 10);
        }
    }
}

boot.init();
