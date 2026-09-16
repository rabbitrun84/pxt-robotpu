/**
 * Robot PU marches to a driving bass riff.
 *
 * The riff is original — a low minor-pentatonic ostinato — and is built with the
 * helpers from tutorials/music-pu.md: midiToHz() for equal-temperament pitch and
 * bpmToBeatMs() for tempo. Swap the note numbers in RIFF for your own melody.
 *
 * Motion and music run at the same time without fighting each other: walking is
 * handed to the robot's background state machine via start(Action.Walk, 0), so
 * the foreground loop is free to do nothing but play notes.
 */

// --- helpers from music-pu.md ---------------------------------------------

function midiToHz(n: number): number {
    return 440 * Math.pow(2, (n - 69) / 12)
}

function bpmToBeatMs(bpm: number): number {
    return 60000 / bpm
}

// --- the riff --------------------------------------------------------------

const bpm = 124
const beatMs = bpmToBeatMs(bpm)
const eighth = Math.round(beatMs / 2)

// MIDI notes. 45 = A2. A rising figure that falls away at the end, so the loop
// point is audible. Eight eighth-notes, one bar.
const RIFF: number[] = [40, 40, 43, 40, 38, 36, 35]

// Accent the first and fifth notes to give the bar a pulse.
const ACCENT: number[] = [1, 0, 0, 0, 1, 0, 0, 0]

function playRiffNote(i: number): void {
    const hz = Math.round(midiToHz(RIFF[i]))
    const loud = ACCENT[i] ? 255 : 170
    music.play(music.createSoundExpression(
        WaveShape.Square,
        hz,
        hz,
        loud,
        40,
        Math.round(eighth * 0.85),
        SoundExpressionEffect.None,
        InterpolationCurve.Linear
    ), music.PlaybackMode.UntilDone)
    basic.pause(Math.round(eighth * 0.15))
}

// A short noise hit on the backbeat, for a bit of percussion.
function hat(): void {
    music.play(music.createSoundExpression(
        WaveShape.Noise, 60, 60, 90, 0, 30,
        SoundExpressionEffect.None, InterpolationCurve.Linear
    ), music.PlaybackMode.InBackground)
}

// --- run -------------------------------------------------------------------

music.setVolume(255)

// Hand walking to the background state machine; 0 steps means keep going.
robotPuPro.start(robotPuPro.Action.Walk, 0)

let step = 0
basic.forever(function () {
    const i = step % RIFF.length
    if (i == 2 || i == 6) hat()
    playRiffNote(i)
    step++
})
