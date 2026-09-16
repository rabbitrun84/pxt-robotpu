/**
 * Moonwalk (backslide) for Robot PU - standalone add-on.
 *
 * Paste this into the JavaScript tab of a MakeCode project that has the
 * Robot PU extension added. It does NOT require any change to the extension.
 *
 * Controls:
 *   A      - start / stop the moonwalk
 *   B      - run two cycles, then stop
 *   A + B  - return to neutral and release
 *
 * How it works: the planted, weight-bearing leg drives backward (this is what
 * actually moves PU), while the unweighted leg snaps forward as if stepping.
 * The snap is fast and the glide is slow - that timing split is the illusion.
 */

// ---------------------------------------------------------------------------
// Tuning
// ---------------------------------------------------------------------------

// The snap: few interpolation steps, short pause -> fast free-leg swing.
const SNAP_STEPS = 6
const SNAP_MS = 12

// The glide: many steps, longer pause -> slow backward drive of the planted leg.
// Keep GLIDE clearly slower than SNAP or the move degrades into a shuffle.
const GLIDE_STEPS = 22
const GLIDE_MS = 18

// ---------------------------------------------------------------------------
// Pose table
// ---------------------------------------------------------------------------

// Pose vector: [LeftFoot, LeftLeg, RightFoot, RightLeg, HeadYaw, HeadPitch]
//
// Foot angles (index 0 and 2) carry the weight shift, and they move together:
//   both below 90 -> lean left,  weight on the LEFT foot,  right foot free
//   both above 90 -> lean right, weight on the RIGHT foot, left foot free
//
// Leg angles (index 1 and 3) are split, which is what separates this from a
// normal walk: the free leg is thrown forward while the planted leg drives back.
let mwPoses: number[][] = [
    [117, 135, 106, 70, 70, 80],    // 0 cock left   - weight right, left leg thrown forward
    [106, 120, 98, 45, 90, 82],     // 1 glide right - right leg drives back, PU travels backward
    [74, 70, 63, 135, 110, 80],     // 2 cock right  - weight left, right leg thrown forward
    [82, 45, 74, 120, 90, 82]       // 3 glide left  - left leg drives back, PU travels backward
]

// Which phases are glides (slow). The others are snaps (fast).
let mwIsGlide = [false, true, false, true]

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let mwCurrent = [90, 90, 90, 90, 90, 90]
let mwTrims = [0, 0, 0, 0, 0, 0]
let mwRunning = false

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mwClamp(v: number): number {
    if (v < 0) return 0
    if (v > 180) return 180
    return v
}

/**
 * Read the saved servo trims once.
 *
 * robotPuPro.servo() writes the angle straight to the hardware and does NOT
 * apply trim, unlike the extension's own gaits. On a robot that has been
 * calibrated, skipping trim makes PU veer instead of sliding straight, so we
 * add the trims back ourselves.
 */
function mwLoadTrims(): void {
    let t = robotPuPro.servoTrims()
    for (let i = 0; i < 6; i++) {
        mwTrims[i] = i < t.length ? t[i] : 0
    }
}

function mwSetPose(a: number[]): void {
    robotPuPro.servo(robotPuPro.ServoJoint.LeftFoot, mwClamp(a[0] + mwTrims[0]))
    robotPuPro.servo(robotPuPro.ServoJoint.LeftLeg, mwClamp(a[1] + mwTrims[1]))
    robotPuPro.servo(robotPuPro.ServoJoint.RightFoot, mwClamp(a[2] + mwTrims[2]))
    robotPuPro.servo(robotPuPro.ServoJoint.RightLeg, mwClamp(a[3] + mwTrims[3]))
    robotPuPro.servo(robotPuPro.ServoJoint.HeadYaw, mwClamp(a[4] + mwTrims[4]))
    robotPuPro.servo(robotPuPro.ServoJoint.HeadPitch, mwClamp(a[5] + mwTrims[5]))
}

/** Move to a pose in small steps. More steps and a longer pause = slower. */
function mwMoveTo(target: number[], steps: number, stepMs: number): void {
    let s0 = mwCurrent[0]
    let s1 = mwCurrent[1]
    let s2 = mwCurrent[2]
    let s3 = mwCurrent[3]
    let s4 = mwCurrent[4]
    let s5 = mwCurrent[5]

    for (let k = 1; k <= steps; k++) {
        mwCurrent[0] = Math.round(s0 + (target[0] - s0) * k / steps)
        mwCurrent[1] = Math.round(s1 + (target[1] - s1) * k / steps)
        mwCurrent[2] = Math.round(s2 + (target[2] - s2) * k / steps)
        mwCurrent[3] = Math.round(s3 + (target[3] - s3) * k / steps)
        mwCurrent[4] = Math.round(s4 + (target[4] - s4) * k / steps)
        mwCurrent[5] = Math.round(s5 + (target[5] - s5) * k / steps)
        mwSetPose(mwCurrent)
        basic.pause(stepMs)
    }
}

/** Run one of the four phases. */
function mwPhase(i: number): void {
    if (mwIsGlide[i]) {
        mwMoveTo(mwPoses[i], GLIDE_STEPS, GLIDE_MS)
    } else {
        mwMoveTo(mwPoses[i], SNAP_STEPS, SNAP_MS)
    }
}

/** Ease back to a neutral standing pose. */
function mwNeutral(): void {
    mwMoveTo([90, 90, 90, 90, 90, 90], 20, 16)
}

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------

input.onButtonPressed(Button.A, function () {
    mwRunning = !mwRunning
    if (!mwRunning) {
        basic.showIcon(IconNames.No)
    } else {
        basic.showArrow(ArrowNames.West)
    }
})

input.onButtonPressed(Button.B, function () {
    if (mwRunning) return
    basic.showArrow(ArrowNames.West)
    for (let c = 0; c < 2; c++) {
        for (let i = 0; i < 4; i++) {
            mwPhase(i)
        }
    }
    mwNeutral()
    basic.showIcon(IconNames.Yes)
})

input.onButtonPressed(Button.AB, function () {
    mwRunning = false
    mwNeutral()
    basic.pause(200)
    robotPuPro.setServoPower(false)
    basic.showIcon(IconNames.Asleep)
})

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

mwLoadTrims()
mwSetPose(mwCurrent)   // snap to neutral so the first glide starts from a known pose
basic.pause(500)
basic.showIcon(IconNames.Yes)

basic.forever(function () {
    if (!mwRunning) {
        basic.pause(50)
        return
    }
    for (let i = 0; i < 4; i++) {
        if (!mwRunning) break
        mwPhase(i)
    }
})
