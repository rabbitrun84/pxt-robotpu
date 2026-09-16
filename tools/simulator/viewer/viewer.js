/* Robot PU trace viewer.
 *
 * Renders legs and head only (servos 0-5). Arms are recorded in the trace but
 * not drawn: they are optional hardware and the ServoJoint enum is unreliable
 * at indices 7-8, so drawing them would imply a confidence we do not have.
 *
 * The figure is a schematic stick model, not a likeness of the robot.
 */

const JOINTS = [
  { i: 0, name: "LeftFoot",  short: "LF", color: "var(--left)"  },
  { i: 1, name: "LeftLeg",   short: "LL", color: "var(--left)"  },
  { i: 2, name: "RightFoot", short: "RF", color: "var(--right)" },
  { i: 3, name: "RightLeg",  short: "RL", color: "var(--right)" },
  { i: 4, name: "HeadYaw",   short: "HY", color: "var(--head)"  },
  { i: 5, name: "HeadPitch", short: "HP", color: "var(--head)"  },
];
const COLORS = ["#4da3ff", "#2f7fd8", "#ff6b6b", "#d84f4f", "#9d7bff", "#7a5cd8"];

let trace = null, rows = [], idx = 0, playing = false, lastFrame = 0;

const $ = (id) => document.getElementById(id);
const rad = (d) => (d * Math.PI) / 180;

// ---------------------------------------------------------------------------
// Load
// ---------------------------------------------------------------------------

async function boot() {
  try {
    const res = await fetch("../traces/moonwalk-pu.json");
    if (res.ok) return load(await res.json());
  } catch (e) { /* served from file:// or no default trace */ }
  $("hdr").textContent = "no trace loaded — open or drop a trace .json";
}

function load(t) {
  trace = t;
  rows = t.rows || [];
  idx = 0;
  const secs = rows.length ? ((rows[rows.length - 1][0] - rows[0][0]) / 1000).toFixed(1) : "0";
  $("hdr").textContent =
    `${t.program} · seed ${t.seed} · boot ${t.bootMs ?? "?"}ms · ${rows.length} samples · ${secs}s`;
  $("scrub").max = Math.max(0, rows.length - 1);
  $("scrub").value = 0;
  drawChart();
  render();
}

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

function ctxOf(id) {
  const c = $(id), x = c.getContext("2d");
  x.clearRect(0, 0, c.width, c.height);
  return { c, x };
}

function ground(x, c, y) {
  x.strokeStyle = "#39404d";
  x.lineWidth = 1;
  x.beginPath(); x.moveTo(10, y); x.lineTo(c.width - 10, y); x.stroke();
  x.fillStyle = "#39404d";
  for (let gx = 14; gx < c.width - 10; gx += 16) x.fillRect(gx, y + 3, 7, 1);
}

function limb(x, x0, y0, x1, y1, color, w) {
  x.strokeStyle = color; x.lineWidth = w; x.lineCap = "round";
  x.beginPath(); x.moveTo(x0, y0); x.lineTo(x1, y1); x.stroke();
}

/** Side view: hip pitch (LL/RL) is the fore-aft swing, which is the gait. */
function drawSide(r) {
  const { c, x } = ctxOf("side");
  const gy = c.height - 46, cx = c.width / 2;
  const L = 74, T = 52;
  ground(x, c, gy);

  const hipY = gy - L, hipX = cx;

  // Legs. Angle is measured from vertical; positive swings forward (screen right).
  for (const [servo, color] of [[1, COLORS[0]], [3, COLORS[2]]]) {
    const a = rad(r[1 + servo] - 90);
    const fx = hipX + L * Math.sin(a), fy = hipY + L * Math.cos(a);
    limb(x, hipX, hipY, fx, fy, color, 7);
    // Foot: ankle roll is a frontal motion, so from the side just show a flat plate.
    limb(x, fx - 11, fy, fx + 13, fy, color, 5);
  }

  // Torso + head
  const topY = hipY - T;
  limb(x, hipX, hipY, hipX, topY, "#6b7484", 13);
  const pitch = rad(r[6] - 90);
  const hx = hipX + 20 * Math.sin(pitch), hy = topY - 19 * Math.cos(pitch);
  limb(x, hipX, topY, hx, hy, "#6b7484", 6);
  x.fillStyle = COLORS[4];
  x.beginPath(); x.arc(hx, hy, 15, 0, Math.PI * 2); x.fill();
  // Eye marks which way the head is pitched.
  x.fillStyle = "#14161a";
  x.beginPath(); x.arc(hx + 6 * Math.cos(pitch), hy + 6 * Math.sin(pitch), 3.5, 0, Math.PI * 2); x.fill();

  x.fillStyle = "#8b93a3"; x.font = "11px ui-monospace, monospace";
  x.fillText("forward →", c.width - 86, 18);
}

/** Front view: the feet servos are ankle roll, i.e. the weight shift. */
function drawFront(r) {
  const { c, x } = ctxOf("front");
  const gy = c.height - 46, cx = c.width / 2;
  const L = 74;
  ground(x, c, gy);

  // Both foot servos move together; their mean is the body lean.
  const lean = rad(((r[1] + r[3]) / 2) - 90);
  const hipY = gy - L;
  const dx = Math.sin(lean) * L * 0.55;

  const lx = cx - 26, rx = cx + 26;
  limb(x, lx + dx, hipY, lx, gy, COLORS[0], 7);
  limb(x, rx + dx, hipY, rx, gy, COLORS[2], 7);
  limb(x, lx + dx, hipY, rx + dx, hipY, "#6b7484", 11);

  x.fillStyle = COLORS[4];
  x.beginPath(); x.arc(cx + dx * 1.6, hipY - 40, 15, 0, Math.PI * 2); x.fill();

  const side = ((r[1] + r[3]) / 2) > 90 ? "weight: RIGHT" : "weight: LEFT";
  x.fillStyle = "#8b93a3"; x.font = "11px ui-monospace, monospace";
  x.fillText(side, 12, 18);
}

function drawChart() {
  const { c, x } = ctxOf("chart");
  if (!rows.length) return;
  const pad = 4, h = c.height - pad * 2;
  const n = rows.length;
  for (let j = 0; j < 6; j++) {
    x.strokeStyle = COLORS[j]; x.lineWidth = 1.2; x.beginPath();
    for (let i = 0; i < n; i++) {
      const px = (i / (n - 1)) * c.width;
      const py = pad + h - (rows[i][1 + j] / 180) * h;
      i ? x.lineTo(px, py) : x.moveTo(px, py);
    }
    x.stroke();
  }
}

function drawPlayhead() {
  const c = $("chart"), x = c.getContext("2d");
  drawChart();
  if (!rows.length) return;
  const px = (idx / Math.max(1, rows.length - 1)) * c.width;
  x.strokeStyle = "#ff8a3d"; x.lineWidth = 1.5;
  x.beginPath(); x.moveTo(px, 0); x.lineTo(px, c.height); x.stroke();
}

function readout(r) {
  $("readout").innerHTML = JOINTS.map(
    (j) => `<tr><td><span class="sw" style="background:${COLORS[j.i]}"></span>${j.short}</td>
            <td style="color:var(--dim)">${j.name}</td><td class="v">${r[1 + j.i]}°</td></tr>`
  ).join("");
}

function render() {
  if (!rows.length) return;
  const r = rows[Math.min(idx, rows.length - 1)];
  drawSide(r); drawFront(r); readout(r); drawPlayhead();
  const t0 = rows[0][0];
  $("clock").textContent = `${((r[0] - t0) / 1000).toFixed(2)}s  (t=${r[0]})`;
  $("scrub").value = idx;
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

function tick(now) {
  requestAnimationFrame(tick);
  if (!playing || !rows.length) { lastFrame = now; return; }
  const sampleMs = (trace && trace.sampleMs) || 10;
  const speed = parseFloat($("speed").value);
  const dt = now - lastFrame;
  const advance = (dt * speed) / sampleMs;
  if (advance < 1) return;
  lastFrame = now;
  idx += Math.floor(advance);
  if (idx >= rows.length) { idx = 0; }
  render();
}

$("play").onclick = () => {
  playing = !playing;
  $("play").textContent = playing ? "❚❚ pause" : "▶ play";
  lastFrame = performance.now();
};
$("scrub").oninput = (e) => { idx = +e.target.value; render(); };
$("pick").onclick = () => $("file").click();
$("file").onchange = async (e) => {
  const f = e.target.files[0];
  if (f) load(JSON.parse(await f.text()));
};
document.addEventListener("dragover", (e) => e.preventDefault());
document.addEventListener("drop", async (e) => {
  e.preventDefault();
  const f = e.dataTransfer.files[0];
  if (f) load(JSON.parse(await f.text()));
});

requestAnimationFrame(tick);
boot();
