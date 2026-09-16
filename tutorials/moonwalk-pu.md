# Moonwalk tutorial (Robot PU)

This tutorial makes Robot PU **backslide** — the dance move most people call the
moonwalk. PU travels *backward* while its legs make *forward* stepping motions.

This is a **standalone add-on**. It runs entirely in your own MakeCode project
using the extension's public API, so there is nothing to change in the Robot PU
extension itself.

Ready-to-paste program: [moonwalk-pu.ts](https://github.com/robotgyms/pxt-robotpu/blob/main/tutorials/moonwalk-pu.ts)

## Prerequisites

- Open https://makecode.microbit.org
- Add the **Robot PU** extension
- A **smooth, hard floor**. The move depends on the planted foot sliding — carpet kills it
- A charged battery. A weak battery makes the glide jerky, which breaks the illusion

Arms are **not** used, so this works on a PU without the optional arm servos.

## Part 1: Quick start

1. Create a new MakeCode project and add the Robot PU extension
2. Switch to the **JavaScript** tab
3. Replace everything with the contents of
   [moonwalk-pu.ts](https://github.com/robotgyms/pxt-robotpu/blob/main/tutorials/moonwalk-pu.ts)
4. Flash it to PU

Controls:

| Button | What it does |
|---|---|
| **A** | Start / stop the moonwalk |
| **B** | Run two cycles, then return to neutral |
| **A + B** | Return to neutral and release the servos |

## Part 2: Why the illusion works

A normal walk swings both legs together. The moonwalk **splits the legs**, and
that split is the whole trick:

| Leg | While carrying weight | While unweighted |
|---|---|---|
| Planted leg | Drives **backward**, slowly | — |
| Free leg | — | Snaps **forward**, quickly |

Two things follow:

1. **The planted leg is what actually moves PU.** Pushing a weight-bearing foot
   backward against the floor slides the whole body backward. This is the motion
   the audience is *not* meant to notice, so it is deliberately slow and smooth.
2. **The free leg sells the lie.** It snaps forward like a normal step.

Your eye follows the fast free leg and concludes PU is walking forward, while the
slow planted leg quietly carries it backward.

**Timing matters as much as the poses.** If both phases ran at the same speed the
move would just look like a shuffle. In the program this is the difference
between the snap and the glide:

```typescript
const SNAP_STEPS = 6      // few steps, short pause  -> fast
const SNAP_MS = 12
const GLIDE_STEPS = 22    // many steps, long pause  -> slow
const GLIDE_MS = 18
```

Roughly 70 ms for a snap versus 400 ms for a glide.

## Part 3: The pose table

Like [dance-pu.md](https://github.com/robotgyms/pxt-robotpu/blob/main/tutorials/dance-pu.md),
a pose is a vector of servo angles:

```
[LeftFoot, LeftLeg, RightFoot, RightLeg, HeadYaw, HeadPitch]
```

The **foot** servos do the weight shift. They are ankle-roll joints and move together:

- Both **below 90** → PU leans left, weight on the **left** foot, right foot free
- Both **above 90** → PU leans right, weight on the **right** foot, left foot free

The four phases:

| # | Phase | LF | LL | RF | RL | Weight |
|---|---|---|---|---|---|---|
| 0 | cock left | 117 | **135** | 106 | 70 | right |
| 1 | glide right | 106 | 120 | 98 | **45** | right |
| 2 | cock right | 74 | 70 | 63 | **135** | left |
| 3 | glide left | 82 | **45** | 74 | 120 | left |

Follow the left leg (`LL`) through the cycle:

- **0** → `135`, thrown forward while unweighted (weight is on the right)
- **1** → `120`, holding out front
- **2** → `70`, now planted and driving back
- **3** → `45`, still driving back — *this is where PU moves*
- back to **0** → snaps to `135` again

The right leg does the same, two phases out of step. At every moment exactly one
leg is gliding and one is snapping.

## Part 4: Tuning

Start slow and work up. To make the glide more pronounced, raise `GLIDE_STEPS`
and `GLIDE_MS`:

| Setting | Result |
|---|---|
| `GLIDE_STEPS = 30, GLIDE_MS = 22` | Very smooth, exaggerated. Best on slick floors |
| `GLIDE_STEPS = 22, GLIDE_MS = 18` | Default |
| `GLIDE_STEPS = 12, GLIDE_MS = 12` | Too fast — degrades into a shuffle |

Keep the glide clearly slower than the snap. That ratio is the illusion;
everything else is styling.

## Part 5: Two things this program handles for you

### Servo trims are applied manually

`robotPuPro.servo()` writes the angle **straight to the hardware and does not
apply servo trim**, unlike the extension's own built-in gaits. On a calibrated
robot, skipping trim makes PU veer instead of sliding straight.

The program reads the saved trims once and adds them back:

```typescript
function mwLoadTrims(): void {
    let t = robotPuPro.servoTrims()
    for (let i = 0; i < 6; i++) {
        mwTrims[i] = i < t.length ? t[i] : 0
    }
}
```

This is worth reusing in any project that drives servos directly.

### The background state machine stands down

Calling any direct-servo API puts the extension into manual mode, so its
background behavior loop stops issuing its own movements and will not fight your
poses. You do not need to call `stop()` first.

## Heads-up: `ServoJoint` arm indices look wrong

If you extend this program to use the arms, be careful. The `ServoJoint` enum
disagrees with the hardware on indices **7 and 8**:

| Index | `ServoJoint` says | Hardware actually is | Driver |
|---|---|---|---|
| 6 | `LeftShoulder` | Left shoulder | I2C |
| 7 | `LeftArm` | **Right shoulder** | I2C |
| 8 | `RightShoulder` | **Left arm** | micro:bit P14 |
| 9 | `RightArm` | Right arm | micro:bit P15 |

The hardware column matches both the servo wiring table in
[README.md](https://github.com/robotgyms/pxt-robotpu/blob/main/tutorials/README.md)
and the routing in `pcb.servo()`, which sends 0–7 over I2C and 8/9 to pins
P14/P15. So `ServoJoint.LeftArm` actually drives a shoulder over I2C.

This tutorial only uses joints 0–5, where all sources agree, so it is unaffected.

## Testing and calibration

1. **Trim the servos first.** If PU does not stand square, the weight shift lands
   on the wrong foot and it will veer instead of sliding straight. See
   [servo-trim-calibration.md](https://github.com/robotgyms/pxt-robotpu/blob/main/tutorials/servo-trim-calibration.md)
2. **Test on a hard floor** before changing anything else
3. **Press B first** to watch two cycles before switching to continuous with A
4. **Watch from the side**, not the front. That is the angle the illusion is built for

## Troubleshooting

| Problem | Cause | Fix |
|---|---|---|
| PU steps in place, no travel | Too much grip | Move to a smoother floor |
| PU shuffles, no glide | Glide too fast | Raise `GLIDE_STEPS` and `GLIDE_MS` |
| PU drifts left or right | Trims not applied or not calibrated | Re-run trim calibration |
| PU rocks but legs barely move | Battery low | Recharge |
| PU tips over | Pose angles too extreme for this surface | Slow the glide; check the floor is level |
| Looks like a backward walk | Snap too slow | Lower `SNAP_STEPS` / `SNAP_MS` |

## If you want it as a block instead

This add-on stays in your project. To turn the moonwalk into a reusable
`robotPuPro.moonwalk()` block, it would need to move into the extension itself:
a four-entry state sequence in `Parameters`, two speed profiles (fast snap, slow
glide), an `Action` token, and a block wrapper in `main.ts`. The add-on is the
better starting point — you can tune the poses on real hardware first.

## Next steps

- [dance-pu.md](https://github.com/robotgyms/pxt-robotpu/blob/main/tutorials/dance-pu.md) — beat-synced choreography and a Q-learning gait sequencer
- [learn-skate.md](https://github.com/robotgyms/pxt-robotpu/blob/main/tutorials/learn-skate.md) — the skate gait, which also uses a slide
- [kungfu.md](https://github.com/robotgyms/pxt-robotpu/blob/main/tutorials/kungfu.md) — scripted pose sequences
