/* 3D view of the Robot PU trace.
 *
 * A schematic box figure — a diagram of where the joints are and how they move,
 * not a likeness of the product. Geometry comes from robot-model.json so the
 * renderer stays generic; correcting the proportions is a data edit, not a code
 * change.
 *
 * KINEMATICS ONLY. Joint angles are replayed exactly as the program commanded
 * them. Nothing here simulates contact, balance or falling — a pose that would
 * topple the real robot renders perfectly happily.
 */

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const AXIS = { x: "x", y: "y", z: "z" };
const rad = (d) => (d * Math.PI) / 180;

let renderer, scene, camera, controls, model;
let root = null;                 // chassis group; everything hangs off it
const jointGroups = {};          // name -> THREE.Group to rotate
const groundMeshes = [];
let ready = false;

async function init(canvas) {
  model = await (await fetch("../robot-model.json")).json();

  scene = new THREE.Scene();
  scene.background = new THREE.Color("#14161a");

  // Robotics convention: Z up, X forward, Y left — matching robot-model.json.
  camera = new THREE.PerspectiveCamera(38, 1, 1, 4000);
  camera.up.set(0, 0, 1);
  camera.position.set(360, -330, 240);

  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));

  controls = new OrbitControls(camera, canvas);
  controls.target.set(0, 0, 60);
  controls.enableDamping = true;

  scene.add(new THREE.AmbientLight(0xffffff, 1.1));
  const key = new THREE.DirectionalLight(0xffffff, 1.6);
  key.position.set(200, -260, 400);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0x88aaff, 0.5);
  fill.position.set(-250, 200, 120);
  scene.add(fill);

  const grid = new THREE.GridHelper(600, 20, 0x39404d, 0x272c35);
  grid.rotation.x = Math.PI / 2;      // GridHelper is XZ by default; we want XY
  scene.add(grid);

  // Ground arrow along +X. The eyes say which way the head faces; this says
  // which way is forward for the whole figure, which stays readable from behind.
  scene.add(new THREE.ArrowHelper(
    new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 0.5), 170, 0xff8a3d, 34, 20
  ));

  buildFigure();
  resize(canvas);
  ready = true;
  animate();
}

function boxMesh(spec) {
  const [x, y, z] = spec.size;
  const geo = new THREE.BoxGeometry(x, y, z);
  const mat = new THREE.MeshLambertMaterial({ color: spec.color || "#8b93a3" });
  const mesh = new THREE.Mesh(geo, mat);
  // Wireframe edges make joint rotation far easier to read than flat shading.
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(geo),
    new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35 })
  );
  mesh.add(edges);
  return mesh;
}

/**
 * A simple two-eye face on the +X (forward) side of a link.
 *
 * Purely an orientation aid: once you orbit the camera, a plain box figure gives
 * you no way to tell which way it is facing, and "is that leg swinging forward
 * or backward?" is exactly the question the view exists to answer.
 */
function addFace(mesh, spec) {
  const front = spec.size[0] / 2;        // +X face
  const eyeY = spec.size[1] * 0.24;      // eye separation
  const eyeZ = spec.size[2] * 0.16;      // a little above centre

  for (const side of [1, -1]) {
    const lens = new THREE.Mesh(
      new THREE.CylinderGeometry(5.2, 5.2, 2.4, 20),
      new THREE.MeshBasicMaterial({ color: 0xe9eef7 })
    );
    lens.rotation.z = Math.PI / 2;       // cylinders default to the Y axis
    lens.position.set(front + 1.2, side * eyeY, eyeZ);
    mesh.add(lens);

    const pupil = new THREE.Mesh(
      new THREE.CylinderGeometry(2.3, 2.3, 2.6, 16),
      new THREE.MeshBasicMaterial({ color: 0x14161a })
    );
    pupil.rotation.z = Math.PI / 2;
    pupil.position.set(front + 2.4, side * eyeY, eyeZ);
    mesh.add(pupil);
  }
}

function buildFigure() {
  root = new THREE.Group();
  scene.add(root);

  const chassis = boxMesh(model.links.chassis);
  root.add(chassis);

  const groups = { chassis: root };

  for (const j of model.joints) {
    const parent = groups[j.parent];
    if (!parent) continue;

    // The group sits at the joint; rotating it rotates everything below.
    const g = new THREE.Group();
    g.position.set(j.origin[0], j.origin[1], j.origin[2]);
    parent.add(g);

    const spec = model.links[j.child];
    const mesh = boxMesh(spec);
    // A link hangs away from its joint rather than straddling it. Which way is
    // implied by the joint offset: a negative Z origin means the child is below.
    const dir = j.origin[2] < 0 ? -1 : 1;
    mesh.position.z = (dir * spec.size[2]) / 2;
    if (spec.face) addFace(mesh, spec);
    g.add(mesh);

    groups[j.child] = g;
    jointGroups[j.name] = { group: g, joint: j };
    if ((model.groundLinks || []).includes(j.child)) groundMeshes.push(mesh);
  }
}

/** Apply one trace row: row[0] is t, row[1..10] are servo angles. */
function update(row) {
  if (!ready || !row) return;

  for (const name in jointGroups) {
    const { group, joint } = jointGroups[name];
    const angle = row[1 + joint.servo];
    if (angle == null) continue;
    group.rotation[AXIS[joint.axis]] = rad((angle - 90) * (joint.sign || 1));
  }

  // Settle the figure so the lowest foot rests on the floor.
  //
  // Poses like Jump (LF 100 / RF 45) are kinematically over-constrained — with
  // both feet flat the hips could not stay a fixed distance apart — so there is
  // no "correct" placement. Dropping the lowest foot to z=0 at least keeps the
  // figure standing on the grid instead of floating or sinking. It does NOT
  // mean the pose is stable; see the header note.
  root.position.z = 0;
  root.updateMatrixWorld(true);
  let lowest = Infinity;
  const box = new THREE.Box3();
  for (const m of groundMeshes) {
    box.setFromObject(m);
    if (box.min.z < lowest) lowest = box.min.z;
  }
  if (isFinite(lowest)) root.position.z = -lowest;
}

function resize(canvas) {
  const w = canvas.clientWidth || 640;
  const h = canvas.clientHeight || 480;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

function animate() {
  requestAnimationFrame(animate);
  if (!ready) return;
  controls.update();
  renderer.render(scene, camera);
}

/**
 * Snap the camera to a named viewpoint.
 *
 * The robot faces +X, so the FRONT view looks back along -X from in front of the
 * face, and the SIDE view looks along the Y axis at the profile. These match the
 * 2D panels: side shows hip pitch (the fore-aft leg swing), front shows ankle
 * roll (the weight shift).
 */
function view(which) {
  if (!ready) return;
  const d = 430;
  if (which === "front") camera.position.set(d, 0, 90);        // in front, looking at the eyes
  else if (which === "side") camera.position.set(0, -d, 90);   // off to the side, profile
  else if (which === "top") camera.position.set(0.01, 0, d);
  else camera.position.set(360, -330, 240);
  controls.target.set(0, 0, 60);
  controls.update();
}

window.Robot3D = { init, update, view, resize: () => resize(renderer.domElement) };

// Module scripts are deferred, so viewer.js (a classic script) has already run
// by now — it guards its calls until this exists. Self-initialise here rather
// than making viewer.js poll for the module.
const canvas = document.getElementById("three");
if (canvas) {
  init(canvas).then(() => {
    for (const b of document.querySelectorAll(".v3")) {
      b.onclick = () => view(b.dataset.v);
    }
    const note = document.getElementById("modelNote");
    if (note && model && model.estimated) {
      note.textContent = "proportions estimated — see robot-model.json";
    }
    addEventListener("resize", () => resize(canvas));
    if (window.ResizeObserver) new ResizeObserver(() => resize(canvas)).observe(canvas);
  }).catch((e) => {
    const note = document.getElementById("modelNote");
    if (note) note.textContent = "3D unavailable: " + e.message;
  });
}
