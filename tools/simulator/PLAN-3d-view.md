# Feature plan — 3D view of the robot

Status: **in progress**. Created 2026-09-16.

Decided: 3D sits **alongside** the 2D panels, not replacing them. 2D stays the
faster read for diagnosis; 3D is the better read for understanding a pose.

Render the trace as a 3D articulated figure you can orbit, alongside the existing
2D side and front panels.

---

## 1. Why this is much cheaper than the physics stage

PLAN.md §4 defers physics (Stage 3) because there is no CAD in the repo — I
re-checked: no STL, OBJ, URDF, STEP, 3MF or glTF anywhere. That blocked physics
because physics needs **masses, inertia tensors and friction coefficients**,
none of which can be eyeballed.

A 3D *view* needs far less:

| Needed for | Physics | 3D view |
|---|---|---|
| Link lengths | yes | **yes** |
| Joint axes | yes | **yes** |
| Masses / inertias | yes | no |
| Friction | yes | no |
| Collision meshes | yes | no |

So the whole gap is **link lengths and joint axes** — about eight numbers and a
convention. That is fifteen minutes with a ruler, not a week of calibration.

**There is even a scale reference.** The repo records the exact servo body size
(22.8 × 12.2 × 28.5 mm, from `tutorials/specifications.md`), and servos are
clearly visible in `assets/product/robotpu-tools-clear.png` at 6.9 MB. A known-size
object in the frame means link lengths can be estimated from the photos to
within a few millimetres if nobody wants to measure the physical robot.

---

## 2. Geometry source

Three options considered:

| Option | Verdict |
|---|---|
| Import a mesh (STL / glTF) | **No** — no CAD exists; authoring one is a modelling project, not a rendering one |
| Photogrammetry from product shots | **No** — overkill for a diagnostic view |
| **Parametric primitives from measurements** | **Yes** — boxes and cylinders, sized from a handful of numbers |

The figure should read as a **schematic**, the same as the 2D panels: proportioned
boxes for the chassis and limbs, not a likeness of the product. The point is to
show joint motion clearly, not to look like a render.

### `robot-model.json` — a mini-URDF

Define the model once, in data:

```json
{
  "units": "mm",
  "links": {
    "chassis":   { "size": [46, 34, 52] },
    "thigh":     { "size": [12, 24, 40] },
    "foot":      { "size": [26, 40, 10] },
    "head":      { "size": [40, 36, 30] }
  },
  "joints": {
    "LeftLeg":   { "parent": "chassis", "child": "thigh", "axis": "y", "origin": [-17, 0, -26] },
    "LeftFoot":  { "parent": "thigh",   "child": "foot",  "axis": "x", "origin": [0, 0, -40] },
    "HeadYaw":   { "parent": "chassis", "child": "neck",  "axis": "z", "origin": [0, 0, 26] },
    "HeadPitch": { "parent": "neck",    "child": "head",  "axis": "y", "origin": [0, 0, 12] }
  }
}
```

Everything above is a **placeholder pending measurement** — the shape of the file
is the deliverable, not those numbers.

Keeping it as data rather than code pays off twice: the renderer stays generic,
and if physics is ever revisited the same file generates the URDF. That closes
most of the gap PLAN.md §4 flagged as a blocker.

### Joint axes

Already established from the 2D work, and consistent with `pcb.servo()`:

| Servo | Joint | Rotation | Axis |
|---|---|---|---|
| 0, 2 | feet | ankle **roll** — frontal plane | X (fore–aft) |
| 1, 3 | legs | hip **pitch** — sagittal plane | Y (lateral) |
| 4 | head yaw | horizontal | Z (vertical) |
| 5 | head pitch | nod | Y |
| 6, 7 | shoulders | unverified | — |
| 8, 9 | arms | unverified | — |

Servo angle 90 is neutral; the rendered rotation is `(angle − 90)` degrees about
the joint axis.

---

## 3. Stack

**three.js**, installed with npm and served from `node_modules` by the existing
`serve.mjs`. No CDN — the tool already works offline and should stay that way.

- `THREE.Group` per link, nested to form the kinematic chain, so setting joint
  rotations is a one-liner per frame
- `OrbitControls` for mouse orbit / zoom
- A grid and ground plane for spatial reference
- One directional light plus ambient; no shadows initially (they cost frame time
  and add nothing diagnostic)

Driving it is trivial: on each frame, read the trace row and set
`joint.rotation[axis] = rad(angle - 90)`. That is the entire animation loop.

---

## 4. The pose problem returns

The front-view work surfaced this and 3D will hit it again, harder.

`Jump` (LF 100 / RF 45) is **kinematically over-constrained**: with both feet flat
the hips cannot stay a fixed distance apart. The 2D fix was to hang the legs off
a rigid body and settle the lowest foot onto the ground.

In 3D the same choice applies, and it must be explicit:

1. **Float the chassis at a fixed height.** Honest and simple — feet penetrate or
   hover on asymmetric poses. Good for reading joint angles.
2. **Settle the lowest foot to the ground.** What the 2D front view does. Looks
   right, but implies a ground contact that is not being simulated.
3. Solve contact properly — that is physics, and out of scope.

Recommend **(2) with a visible ground plane**, matching the 2D panels, plus a
subtle marker when a foot is off the ground so the viewer is not implying support
that does not exist.

---

## 5. Stages

### Stage 1 — Measure and define (½ day, mostly not coding)
`robot-model.json` with real numbers. Measure the physical robot, or scale off
the product photos using the servo body as the reference.

### Stage 2 — Renderer (2 days)
three.js scene built from the model file, joints driven by the current trace row,
orbit controls, grid, ground. Legs and head first.

### Stage 3 — Integration (½ day)
A third panel beside side/front, or a toggle that swaps the 2D pair for 3D. Keep
the 2D views — they are more *readable* for diagnosis even though 3D is more
impressive; the strip chart and the front-view ankle split stay the fastest way
to see what a pose is doing.

### Stage 4 — Optional
Camera presets (side / front / three-quarter), foot-contact markers, a ghost of
the previous pose to show motion direction, arms once servos 6–9 are verified.

---

## 6. Effort and risk

| Stage | Effort | Confidence |
|---|---|---|
| 1 — model definition | ½ day | High (once measured) |
| 2 — renderer | 2 days | High |
| 3 — integration | ½ day | High |
| 4 — extras | 1 day | Medium |

Risks:

1. **Wrong joint axis conventions.** A sign error puts a leg through the floor.
   Mitigated by checking against the 2D views, which are already known-correct —
   the same trace must read the same way in both.
2. **Measurements never taken**, leaving placeholder proportions in place. The
   figure would animate correctly but look wrong, which is worse than obviously
   schematic. Stage 1 is not optional.
3. **Arms remain unverified** (PLAN.md §8: the `ServoJoint` enum disagrees with
   the hardware at indices 7–8). Do not render arms until the mapping is
   confirmed on a physical robot — a 3D view showing the wrong limb moving is
   more misleading than no arms at all.
4. **Over-claiming.** A 3D figure looks authoritative. It is still kinematics
   only: no contact, no balance, no falling. Worth a caption in the UI itself,
   not just the README.

---

## 7. Decisions needed

- **Measure the robot, or estimate from photos?** Measuring is better and takes
  fifteen minutes; photos are fine if the hardware is not to hand.
- **Replace the 2D panels or sit alongside them?** Recommend alongside — 2D is
  better for diagnosis, 3D better for understanding a pose.
- **Render arms?** Recommend not until 6–9 are verified.
