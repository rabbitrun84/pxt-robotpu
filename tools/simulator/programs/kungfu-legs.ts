/**
 * Kungfu routine for a Robot PU with NO ARM SERVOS.
 *
 * Adapted from tutorials/kungfu.md. The original expresses three of its four
 * gaits through the shoulders and arms (servos 6-9) — "raise hand and tiptoe"
 * and "spread arms" are almost entirely arm poses. Arms are optional hardware,
 * so on a robot without them the original routine reads as a robot standing
 * still and occasionally tipping over.
 *
 * Here every gait is built from the legs and head only (servos 0-5). Servos 6-9
 * are pinned at 90 so nothing is ever commanded to hardware that is not there.
 *
 * The two leg joints do different jobs, and the gaits use both:
 *   feet (0, 2) — ankle roll, the frontal-plane lean and weight shift
 *   legs (1, 3) — hip pitch, the fore-and-aft swing
 */

// set servo trims
robotPuPro.setServoTrim(robotPuPro.ServoJoint.LeftFoot, 4)
robotPuPro.setServoTrim(robotPuPro.ServoJoint.LeftLeg, 4)
robotPuPro.setServoTrim(robotPuPro.ServoJoint.RightFoot, 0)
robotPuPro.setServoTrim(robotPuPro.ServoJoint.RightLeg, 0)
robotPuPro.setServoTrim(robotPuPro.ServoJoint.HeadYaw, -8)
robotPuPro.setServoTrim(robotPuPro.ServoJoint.HeadPitch, 0)

// allow gamepad remote control
radio.onReceivedValue(function (name: string, value: number) {
    robotPuPro.runKeyValueCommand(name, value)
})

// allow robots to exchange information for group activities
radio.onReceivedString(function (receivedString: string) {
    robotPuPro.runStringCommand(receivedString)
})

// trigger servo calibration by gamepad
input.onLogoEvent(TouchButtonEvent.Pressed, function () {
    robotPuPro.toggleServoTrim()
})

input.onButtonPressed(Button.A, function () {
    robotPuPro.changeChannel(1)
})
input.onButtonPressed(Button.B, function () {
    robotPuPro.changeChannel(-1)
})

// Leg-only kungfu gaits. 10 servo angles each, range 0-180.
// Servos: left foot, left leg, right foot, right leg, head yaw, head pitch,
//         left shoulder, right shoulder, left arm, right arm.
// The last four stay at 90 — this robot has no arms.
let kungfuGaits = [
    // 1st gait: ready stance, square and neutral
    [90, 90, 90, 90, 90, 90, 90, 90, 90, 90],
    // 2nd gait: tiptoe with a front kick. Replaces "raise hand and tiptoe" —
    // the lean is kept, the raised arm becomes a raised leg.
    [140, 140, 40, 90, 60, 60, 90, 90, 90, 90],
    // 3rd gait: forward lunge, legs opposed fore and aft, head turned to follow.
    // Replaces "spread arms" — the wide shape is made with the legs instead.
    [90, 140, 90, 40, 120, 105, 90, 90, 90, 90],
    // 4th gait: wide leg split, ankles rolled to their limits
    [0, 90, 180, 80, 110, 50, 90, 90, 90, 90]
]

// set Kungfu Speed
let kungfuSpeed = [[2, 2, 2, 2, 2, 2, 2, 2, 2, 2],
[3, 1, 3, 1, 5, 5, 6, 6, 6, 6]]

let currentGait = kungfuGaits[0]
let currentSpeed = kungfuSpeed[0]

// action engine. It runs the gait and the gait speed you pick
basic.forever(function () {
    robotPuPro.moveServos(currentGait, currentSpeed, [0, 1, 2, 3], 1, [4, 5, 6, 7, 8, 9], 1)
    basic.pause(10)
})

// user selection of kungfu routines
basic.forever(function () {
    // go to the 2nd gait
    currentGait = kungfuGaits[1]
    currentSpeed = kungfuSpeed[1]
    basic.pause(2000)
    // go to the 3rd gait
    currentGait = kungfuGaits[2]
    currentSpeed = kungfuSpeed[1]
    basic.pause(2000)
    // go to the 4th gait
    currentGait = kungfuGaits[3]
    currentSpeed = kungfuSpeed[1]
    basic.pause(2000)
    // back to the ready stance, then the loop repeats
    currentGait = kungfuGaits[0]
    currentSpeed = kungfuSpeed[1]
    basic.pause(2000)
})
