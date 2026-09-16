/**
 * Stand / Jump / Yoga / Yoga2 / Yoga3 — run ONCE, for a single clean trace.
 *
 * Same functions and angles as programs/yoga-routine.ts; only the driving loop
 * differs. The original repeats forever, which makes a trace of overlapping
 * identical cycles. Here the sequence executes exactly once.
 *
 * Why a one-shot guard instead of bare top-level statements: code at top level
 * runs before the driver starts recording the run window, so the whole routine
 * would land in the boot phase and `--skip-boot` would discard it. Running once
 * inside forever() keeps every action inside the recorded window.
 *
 * Namespace adapted from the beginner 6-DOF `robotPu` package to `robotPuPro`.
 */

function Stand() {
    robotPuPro.servo(robotPuPro.ServoJoint.LeftFoot, 90)
    robotPuPro.servo(robotPuPro.ServoJoint.LeftLeg, 90)
    robotPuPro.servo(robotPuPro.ServoJoint.RightFoot, 90)
    robotPuPro.servo(robotPuPro.ServoJoint.RightLeg, 90)
    robotPuPro.servo(robotPuPro.ServoJoint.HeadYaw, 90)
    robotPuPro.servo(robotPuPro.ServoJoint.HeadPitch, 90)
}

function Jump() {
    robotPuPro.servo(robotPuPro.ServoJoint.LeftFoot, 100)
    robotPuPro.servo(robotPuPro.ServoJoint.LeftLeg, 90)
    robotPuPro.servo(robotPuPro.ServoJoint.RightFoot, 45)
    robotPuPro.servo(robotPuPro.ServoJoint.RightLeg, 90)
    robotPuPro.servo(robotPuPro.ServoJoint.HeadYaw, 90)
    robotPuPro.servo(robotPuPro.ServoJoint.HeadPitch, 30)
}

function Yoga() {
    robotPuPro.servo(robotPuPro.ServoJoint.LeftFoot, 70)
    robotPuPro.servo(robotPuPro.ServoJoint.LeftLeg, 90)
    robotPuPro.servo(robotPuPro.ServoJoint.RightFoot, 0)
    robotPuPro.servo(robotPuPro.ServoJoint.RightLeg, 90)
    robotPuPro.servo(robotPuPro.ServoJoint.HeadYaw, 90)
    robotPuPro.servo(robotPuPro.ServoJoint.HeadPitch, 30)
}

function Yoga2() {
    robotPuPro.servo(robotPuPro.ServoJoint.LeftFoot, 70)
    robotPuPro.servo(robotPuPro.ServoJoint.LeftLeg, 90)
    robotPuPro.servo(robotPuPro.ServoJoint.RightFoot, 90)
    while (robotPuPro.servoStepStatus(robotPuPro.ServoJoint.RightLeg, 20, 0.05) != 0) {
        robotPuPro.servoStep(robotPuPro.ServoJoint.HeadYaw, 45, 0.05)
        robotPuPro.servoStep(robotPuPro.ServoJoint.HeadPitch, 90, 0.05)
    }
}

function Yoga3() {
    robotPuPro.servo(robotPuPro.ServoJoint.LeftFoot, 70)
    robotPuPro.servo(robotPuPro.ServoJoint.LeftLeg, 90)
    robotPuPro.servo(robotPuPro.ServoJoint.RightFoot, 90)
    while (robotPuPro.servoStepStatus(robotPuPro.ServoJoint.RightLeg, 170, 0.05) != 0) {
        robotPuPro.servoStep(robotPuPro.ServoJoint.HeadYaw, 135, 0.05)
        robotPuPro.servoStep(robotPuPro.ServoJoint.HeadPitch, 60, 0.05)
    }
}

let sequenceDone = false

basic.forever(function () {
    if (sequenceDone) {
        basic.pause(100)
        return
    }
    sequenceDone = true

    Stand()
    basic.pause(500)
    Jump()
    basic.pause(500)
    Yoga()
    basic.pause(500)
    Yoga2()
    Yoga3()
})
