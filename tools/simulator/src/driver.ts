/**
 * Simulator driver. Compiled LAST in the bundle, so by the time main() runs the
 * program under test has already executed its top level and registered its
 * forever() / background handlers.
 *
 * Configured entirely through environment variables, set by run.mjs:
 *   SIM_MS         virtual milliseconds to run          (default 8000)
 *   SIM_SEED       PRNG seed                            (default 1)
 *   SIM_SAMPLE_MS  trace sample interval                (default 10)
 *   SIM_BUTTONS    scripted presses, "500:A,4000:B"     (default none)
 *   SIM_PROGRAM    label recorded in the trace header
 *   SIM_OUT        output path; stdout if unset
 */

declare function require(name: string): any;
declare const console: { log(...args: any[]): void };

namespace driver {
    function env(name: string, dflt: string): string {
        if (typeof process === "undefined" || !process.env || !process.env[name]) return dflt;
        return process.env[name];
    }

    function envInt(name: string, dflt: number): number {
        const v = parseInt(env(name, String(dflt)), 10);
        return isNaN(v) ? dflt : v;
    }

    /**
     * Parse "500:A,4000:B" into scheduled button presses.
     *
     * Times are relative to the START OF THE RUN, not to power-on. Robot PU
     * spends seconds of virtual time in calibrate()/start() before the program's
     * own loop begins, and "press A half a second in" should mean half a second
     * into the program, not into the boot sequence.
     */
    function scheduleButtons(spec: string, base: number): { at: number; button: string }[] {
        const planned: { at: number; button: string }[] = [];
        if (!spec) return planned;
        const parts = spec.split(",");
        for (let i = 0; i < parts.length; i++) {
            const piece = parts[i].trim();
            if (!piece) continue;
            const bits = piece.split(":");
            if (bits.length !== 2) continue;
            const at = parseInt(bits[0], 10);
            const name = bits[1].trim().toUpperCase();
            if (isNaN(at)) continue;
            const btn = name === "A" ? Button.A : name === "B" ? Button.B : Button.AB;
            planned.push({ at: base + at, button: name });
            sim.scheduleAt(base + at, function () { buttons.press(btn); });
        }
        return planned;
    }

    export function main(): void {
        const durationMs = envInt("SIM_MS", 8000);
        const program = env("SIM_PROGRAM", "unknown");
        const outPath = env("SIM_OUT", "");

        // Everything before this point was boot: the program's top level, plus
        // ensureRobot() -> calibrate() / start(), which burn seconds of virtual
        // time. The requested duration covers the run, not the boot.
        const bootMs = sim.now;
        const planned = scheduleButtons(env("SIM_BUTTONS", ""), bootMs);

        sim.run(bootMs + durationMs);

        const trace = {
            schema: "robotpu-trace/1",
            program: program,
            seed: boot.seedUsed,
            durationMs: durationMs,
            bootMs: bootMs,
            sampleMs: hw.sampleMs,
            joints: hw.JOINT_NAMES,
            // Servos rendered by the viewer: legs and head only. Arms are optional
            // hardware and the ServoJoint enum is unreliable at indices 7-8, so they
            // are recorded but not drawn.
            rendered: [0, 1, 2, 3, 4, 5],
            columns: ["t", "s0", "s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8", "s9"],
            rows: hw.trace,
            buttons: planned,
            events: hw.events,
            unknownI2c: hw.i2cUnknown,
            warnings: sim.warnings,
            foreverTasks: sim.foreverCount()
        };

        const json = JSON.stringify(trace);
        if (outPath) {
            const fs = require("fs");
            fs.writeFileSync(outPath, json);
            const rows = hw.trace.length;
            console.log("program : " + program);
            console.log("seed    : " + boot.seedUsed);
            console.log("virtual : " + durationMs + " ms");
            console.log("samples : " + rows);
            console.log("events  : " + hw.events.length);
            if (hw.i2cUnknown.length > 0) {
                console.log("WARN    : " + hw.i2cUnknown.length + " unknown I2C register writes");
            }
            for (let i = 0; i < sim.warnings.length; i++) {
                console.log("WARN    : " + sim.warnings[i]);
            }
            console.log("trace   : " + outPath);
        } else {
            console.log(json);
        }
    }
}

driver.main();
