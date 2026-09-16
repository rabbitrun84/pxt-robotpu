/**
 * Stand / Jump / Yoga routine.
 *
 * Adapted from a user program written against the beginner 6-DOF package
 * (namespace `robotPu`). This extension is `robotPuPro`, so the namespace is
 * renamed throughout. Nothing else is changed — same joints, angles, step
 * sizes and sequence.
 *
 * Note on the while-loops in Yoga2 / Yoga3: servoStepStatus() advances the
 * servo by stepSize PER CALL and returns the error from before the step, so the
 * loop ends once the target is reached. It contains no basic.pause(), so on the
 * simulator it consumes no virtual time unless an I2C transaction cost is set
 * (run.mjs --i2c-us). On hardware the cost is the I2C bus write itself.
 */

function Stand() {
    robotPuPro.servo(robotPuPro.ServoJoint.LeftFoot, 90)
    robotPuPro.servo(robotPuPro.ServoJoint.LeftLeg, 90)
    robotPuPro.servo(robotPuPro.ServoJoint.RightFoot, 90)
    robotPuPro.servo(robotPuPro.ServoJoint.RightLeg, 90)
    robotPuPro.servo(robotPuPro.ServoJoint.HeadYaw, 90)
    robotPuPro.servo(robotPuPro.ServoJoint.HeadPitch, 90)
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

function Jump() {
    robotPuPro.servo(robotPuPro.ServoJoint.LeftFoot, 100)
    robotPuPro.servo(robotPuPro.ServoJoint.LeftLeg, 90)
    robotPuPro.servo(robotPuPro.ServoJoint.RightFoot, 45)
    robotPuPro.servo(robotPuPro.ServoJoint.RightLeg, 90)
    robotPuPro.servo(robotPuPro.ServoJoint.HeadYaw, 90)
    robotPuPro.servo(robotPuPro.ServoJoint.HeadPitch, 30)
}

basic.forever(function () {
    Stand()
    basic.pause(500)
    Jump()
    basic.pause(500)
    Yoga()
    basic.pause(500)
    Yoga2()
    Yoga3()
})
