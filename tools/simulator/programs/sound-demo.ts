/**
 * Startup chime followed by a short walk.
 *
 * Shows audio and motion on one timeline. init_sound() fires five sound
 * expressions with PlaybackMode.InBackground, so the function returns
 * immediately — but the micro:bit has a single background audio channel, so the
 * sounds QUEUE rather than overlap and the chime actually runs for 1.25s while
 * the robot is already walking.
 */

function init_sound() {
    music.setVolume(255)
    music.play(music.createSoundExpression(
        WaveShape.Square, 400, 600, 255, 0, 200,
        SoundExpressionEffect.Warble, InterpolationCurve.Linear
    ), music.PlaybackMode.InBackground)
    music.play(music.createSoundExpression(
        WaveShape.Square, 400, 600, 255, 0, 200,
        SoundExpressionEffect.Warble, InterpolationCurve.Linear
    ), music.PlaybackMode.InBackground)
    music.play(music.createSoundExpression(
        WaveShape.Square, 400, 600, 255, 0, 200,
        SoundExpressionEffect.Warble, InterpolationCurve.Linear
    ), music.PlaybackMode.InBackground)
    music.play(music.createSoundExpression(
        WaveShape.Square, 400, 600, 255, 0, 150,
        SoundExpressionEffect.Warble, InterpolationCurve.Linear
    ), music.PlaybackMode.InBackground)
    music.play(music.createSoundExpression(
        WaveShape.Noise, 54, 54, 255, 0, 500,
        SoundExpressionEffect.None, InterpolationCurve.Linear
    ), music.PlaybackMode.InBackground)
}

init_sound()

robotPuPro.startAndWait(robotPuPro.Action.Walk, 12)
robotPuPro.stop()

// A blocking tone, for contrast: UntilDone holds the program up for its
// full duration, unlike the queued background sounds above.
music.playTone(660, 300)
music.playTone(880, 300)
