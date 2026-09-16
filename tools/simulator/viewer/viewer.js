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

async function fetchTrace(name) {
  const res = await fetch(`../traces/${name}`);
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  load(await res.json());
}

async function boot() {
  // Populate the picker from whatever is in traces/, so new runs show up on reload.
  let names = [];
  try {
    const res = await fetch("../api/traces");
    if (res.ok) names = await res.json();
  } catch (e) { /* file:// — fall back to drag-and-drop */ }

  const sel = $("trace");
  if (names.length) {
    sel.innerHTML = names.map((n) => `<option value="${n}">${n.replace(/\.json$/, "")}</option>`).join("");
    // ?trace=dance-B-beat.json selects a specific one.
    const want = new URLSearchParams(location.search).get("trace");
    const pick = names.includes(want) ? want
      : names.includes(`${want}.json`) ? `${want}.json`
      : names.includes("moonwalk.json") ? "moonwalk.json"
      : names[0];
    sel.value = pick;
    sel.onchange = () => fetchTrace(sel.value).catch((e) => ($("hdr").textContent = e.message));
    try { return await fetchTrace(pick); }
    catch (e) { $("hdr").textContent = e.message; return; }
  }

  sel.style.display = "none";
  $("hdr").textContent = "no trace loaded — open or drop a trace .json";
}

function load(t) {
  trace = t;
  rows = t.rows || [];
  idx = 0;
  const secs = rows.length ? ((rows[rows.length - 1][0] - rows[0][0]) / 1000).toFixed(1) : "0";
  $("hdr").textContent =
    `${t.program} · seed ${t.seed} · boot ${t.bootMs ?? "?"}ms · ${rows.length} samples · ${secs}s`;

  // Traces outlive the session that made them, so show what the program was.
  const about = $("about");
  if (t.description && t.description.trim()) {
    about.hidden = false;
    about.textContent = "";
    const name = document.createElement("b");
    name.textContent = t.program + " — ";
    about.appendChild(name);
    about.appendChild(document.createTextNode(t.description.trim()));
  } else {
    about.hidden = true;
  }
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
  //
  // The two legs are drawn with a small lateral offset. Without it, any pose
  // where both legs share an angle (Stand, Jump, Yoga all have LL=RL=90) draws
  // them exactly on top of each other and the robot appears to have one leg.
  for (const [servo, color, ox] of [[1, COLORS[0], -8], [3, COLORS[2], 8]]) {
    const a = rad(r[1 + servo] - 90);
    const hx = hipX + ox;
    const fx = hx + L * Math.sin(a), fy = hipY + L * Math.cos(a);
    limb(x, hx, hipY, fx, fy, color, 7);
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

/** A foot plate resting on the ground, rolled by its ankle servo. */
function footPlate(x, fx, gy, ang, color) {
  const w = 15;
  const dx = w * Math.cos(ang), dy = w * Math.sin(ang);
  limb(x, fx - dx, gy - dy, fx + dx, gy + dy, color, 5);
}

/**
 * Front view: ankle roll, drawn PER LEG.
 *
 * Earlier this averaged the two foot servos into one body lean. That works for
 * gaits where the ankles move together (the moonwalk), but it erases poses
 * built from a differential — Jump is LF 100 / RF 45, a 55° split that averages
 * to a bland -17.5° and rendered almost identically to standing.
 *
 * Each ankle is now independent: rolling a foot onto its edge shortens that
 * leg's effective height (L·cos) and shifts it sideways (L·sin), so an
 * asymmetric pose visibly drops one hip.
 */
function drawFront(r) {
  const { c, x } = ctxOf("front");
  const gy = c.height - 46, cx = c.width / 2;
  const L = 74;
  ground(x, c, gy);

  const la = rad(r[1] - 90);   // LeftFoot ankle roll
  const ra = rad(r[3] - 90);   // RightFoot ankle roll
  const roll = (la + ra) / 2;  // body roll = common-mode ankle
  const HW = 32;               // half hip width, rigid

  // The hip bar is rigid and rotates with the body; each leg then points along
  // its OWN ankle angle. Poses like Jump (LF 100 / RF 45) are kinematically
  // over-constrained — with both feet flat the hips could not stay a fixed
  // distance apart — so pinning the feet to the ground and solving for the hips
  // produced a broken-looking figure. Hanging the legs off a rigid body instead
  // always draws something coherent, and the ankle split stays plainly visible.
  const hcy = gy - L;
  let hlx = cx - HW * Math.cos(roll), hly = hcy - HW * Math.sin(roll);
  let hrx = cx + HW * Math.cos(roll), hry = hcy + HW * Math.sin(roll);

  let flx = hlx + L * Math.sin(la), fly = hly + L * Math.cos(la);
  let frx = hrx + L * Math.sin(ra), fry = hry + L * Math.cos(ra);

  // Settle the figure so whichever foot is lowest rests on the ground.
  const dy = gy - Math.max(fly, fry);
  hly += dy; hry += dy; fly += dy; fry += dy;

  limb(x, hlx, hly, flx, fly, COLORS[0], 7);
  limb(x, hrx, hry, frx, fry, COLORS[2], 7);
  footPlate(x, flx, fly, la, COLORS[0]);
  footPlate(x, frx, fry, ra, COLORS[2]);
  limb(x, hlx, hly, hrx, hry, "#6b7484", 11);

  const mhx = (hlx + hrx) / 2, mhy = (hly + hry) / 2;
  x.fillStyle = COLORS[4];
  x.beginPath();
  x.arc(mhx + 34 * Math.sin(roll), mhy - 34 * Math.cos(roll), 15, 0, Math.PI * 2);
  x.fill();

  const diff = r[1] - r[3];
  x.fillStyle = "#8b93a3"; x.font = "11px ui-monospace, monospace";
  x.fillText(`ankles ${r[1]}° / ${r[3]}°`, 12, 18);
  x.fillStyle = Math.abs(diff) >= 25 ? "#ff8a3d" : "#8b93a3";
  x.fillText(`split ${diff > 0 ? "+" : ""}${diff}°`, 12, 33);
}

// Wave shapes, by the WaveShape enum order.
const WAVE = ["Sine", "Sawtooth", "Triangle", "Square", "Noise"];
const WAVE_COLOR = ["#4ec9a8", "#d8a24e", "#c94ec9", "#4ec9c9", "#8a8f99"];

function drawChart() {
  const { c, x } = ctxOf("chart");
  if (!rows.length) return;

  const sounds = (trace && trace.sounds) || [];
  const lane = sounds.length ? 16 : 0;          // reserve a strip for audio
  const pad = 4, h = c.height - pad * 2 - lane;
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

  if (!lane) return;

  // Audio lane, on the same time axis as the traces above it. Sound is not
  // synthesised — these are the play() calls and how long each occupied the
  // micro:bit's single background channel.
  const t0 = rows[0][0], t1 = rows[n - 1][0];
  const span = Math.max(1, t1 - t0);
  const toX = (t) => ((t - t0) / span) * c.width;
  const y = c.height - lane + 3;

  x.fillStyle = "#1c1f26";
  x.fillRect(0, y - 2, c.width, lane - 1);
  for (const s of sounds) {
    const x0 = toX(s.t), x1 = toX(s.endT);
    if (x1 < 0 || x0 > c.width) continue;
    x.fillStyle = WAVE_COLOR[s.wave] || "#8a8f99";
    x.fillRect(x0, y, Math.max(1.5, x1 - x0), lane - 7);
  }
  x.fillStyle = "#8b93a3";
  x.font = "9px ui-monospace, monospace";
  x.fillText("audio", 3, c.height - 1);
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
  let html = JOINTS.map(
    (j) => `<tr><td><span class="sw" style="background:${COLORS[j.i]}"></span>${j.short}</td>
            <td style="color:var(--dim)">${j.name}</td><td class="v">${r[1 + j.i]}°</td></tr>`
  ).join("");

  // Whatever the speaker is doing at this instant.
  const sounds = (trace && trace.sounds) || [];
  if (sounds.length) {
    const now = r[0];
    const s = sounds.find((z) => now >= z.t && now < z.endT);
    const label = s
      ? `${WAVE[s.wave] || "?"} ${s.freq0}${s.freq1 !== s.freq0 ? "→" + s.freq1 : ""}Hz`
      : "—";
    const colour = s ? WAVE_COLOR[s.wave] || "#8a8f99" : "#39404d";
    html += `<tr><td style="padding-top:8px"><span class="sw" style="background:${colour}"></span>♪</td>
             <td style="color:var(--dim);padding-top:8px">audio</td>
             <td class="v" style="padding-top:8px">${label}</td></tr>`;
  }
  $("readout").innerHTML = html;
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
// Audio playback
// ---------------------------------------------------------------------------
//
// The simulator records what the speaker was asked to play; this synthesises it
// so you can actually hear the program. It is a reconstruction from the
// recorded parameters (wave, frequency sweep, volume envelope, effect), not a
// capture — close enough to judge timing and character, not a reference for
// exactly how the micro:bit's speaker sounds.

let audioCtx = null, soundOn = false, noiseBuf = null;

function ensureAudio() {
  if (!audioCtx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    audioCtx = new AC();
  }
  if (audioCtx.state === "suspended") audioCtx.resume();
  return audioCtx;
}

/** One second of white noise, reused for every Noise sound. */
function getNoise(ctx) {
  if (noiseBuf) return noiseBuf;
  const n = ctx.sampleRate;
  noiseBuf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  return noiseBuf;
}

const OSC_TYPE = ["sine", "sawtooth", "triangle", "square"];

function playSound(s, speed) {
  const ctx = ensureAudio();
  if (!ctx) return;

  // Compress the duration by the playback rate so audio stays lined up with
  // the visuals. Pitch is left alone — shifting it too would make a 4x replay
  // unrecognisable.
  const dur = Math.max(0.02, s.ms / 1000 / speed);
  const t0 = ctx.currentTime + 0.01;
  const t1 = t0 + dur;

  // 0-255 from the program, scaled well down: these are square waves and noise,
  // which are harsh at full amplitude.
  const amp = (v) => Math.max(0.0005, ((v == null ? 255 : v) / 255) * 0.18);

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(amp(s.vol0), t0);
  gain.gain.linearRampToValueAtTime(amp(s.vol1), t1);
  gain.connect(ctx.destination);

  let src;
  const lfos = [];
  if (s.wave === 4) {
    src = ctx.createBufferSource();
    src.buffer = getNoise(ctx);
    src.loop = true;
  } else {
    src = ctx.createOscillator();
    src.type = OSC_TYPE[s.wave] || "square";
    src.frequency.setValueAtTime(s.freq0, t0);
    if (s.freq1 !== s.freq0) src.frequency.linearRampToValueAtTime(s.freq1, t1);

    // Vibrato / Warble modulate pitch; Tremolo modulates level.
    if (s.effect === 1 || s.effect === 3) {
      const lfo = ctx.createOscillator(), depth = ctx.createGain();
      lfo.frequency.value = s.effect === 3 ? 18 : 6;
      depth.gain.value = s.effect === 3 ? Math.max(30, s.freq0 * 0.12) : 10;
      lfo.connect(depth); depth.connect(src.frequency);
      lfos.push(lfo);
    }
  }
  if (s.effect === 2) {
    const lfo = ctx.createOscillator(), depth = ctx.createGain();
    lfo.frequency.value = 11;
    depth.gain.value = 0.06;
    lfo.connect(depth); depth.connect(gain.gain);
    lfos.push(lfo);
  }

  src.connect(gain);
  src.start(t0); src.stop(t1);
  for (const l of lfos) { l.start(t0); l.stop(t1); }
}

/** Fire any sound whose start falls in (fromT, toT]. */
function playSoundsBetween(fromT, toT) {
  if (!soundOn || !trace || !trace.sounds) return;
  const speed = parseFloat($("speed").value) || 1;
  for (const s of trace.sounds) {
    if (s.t > fromT && s.t <= toT) playSound(s, speed);
  }
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

  const prevT = rows[Math.min(idx, rows.length - 1)][0];
  idx += Math.floor(advance);
  const looped = idx >= rows.length;
  if (looped) idx = 0;
  const curT = rows[Math.min(idx, rows.length - 1)][0];

  // Trigger sounds the playhead just crossed. On loop the window would run
  // backwards, so restart it from the top of the trace instead.
  if (looped) playSoundsBetween(rows[0][0] - 1, curT);
  else playSoundsBetween(prevT, curT);

  render();
}

$("play").onclick = () => {
  playing = !playing;
  $("play").textContent = playing ? "❚❚ pause" : "▶ play";
  lastFrame = performance.now();
};
$("scrub").oninput = (e) => { idx = +e.target.value; render(); };

// Browsers require a user gesture before audio can start, so the context is
// created here rather than on load.
$("mute").onclick = () => {
  soundOn = !soundOn;
  const btn = $("mute");
  if (soundOn) {
    const ok = ensureAudio();
    if (!ok) { soundOn = false; btn.textContent = "no Web Audio"; return; }
    btn.textContent = "🔊 sound on";
    btn.classList.add("primary");
  } else {
    btn.textContent = "🔇 sound off";
    btn.classList.remove("primary");
  }
};
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

// ---------------------------------------------------------------------------
// Code editor — build & run
// ---------------------------------------------------------------------------

const STORE_KEY = "robotpu.editor.code";

function problems(text, kind) {
  const el = $("problems");
  if (!text) { el.hidden = true; return; }
  el.hidden = false;
  el.className = kind || "";
  el.textContent = text;
}

/** Map a programs.json args array onto the option inputs. */
function applyArgs(args) {
  const get = (n) => { const i = args.indexOf("--" + n); return i >= 0 ? args[i + 1] : null; };
  $("optMs").value = get("ms") || 8000;
  $("optSound").value = get("sound") || "quiet";
  $("optButtons").value = get("buttons") || "";
  $("optI2c").value = get("i2c-us") || 0;
  $("optSkipBoot").checked = args.includes("--skip-boot");
}

function currentOpts(name) {
  return {
    name: name || "editor",
    ms: parseInt($("optMs").value, 10) || 8000,
    sound: $("optSound").value,
    buttons: $("optButtons").value.trim(),
    i2cUs: parseInt($("optI2c").value, 10) || 0,
    skipBoot: $("optSkipBoot").checked,
  };
}

async function buildAndRun() {
  const code = $("code").value;
  if (!code.trim()) { problems("Nothing to run — the editor is empty.", ""); return; }

  localStorage.setItem(STORE_KEY, code);
  $("runBtn").disabled = true;
  $("runStatus").textContent = "building…";
  problems("");

  try {
    const res = await fetch("../api/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code, opts: currentOpts() }),
    });
    const r = await res.json();

    const diag = (r.diagnostics || []).map((d) => `  line ${d.line}:${d.column}  ${d.message}`).join("\n");

    if (!r.ok) {
      problems([r.error, diag && "Compiler messages:\n" + diag, r.warning].filter(Boolean).join("\n\n"), "");
      $("runStatus").textContent = "failed";
      return;
    }

    load(r.trace);
    $("trace").value = "";   // showing an editor run, not a file on disk

    const rows = r.trace.rows.length;
    const notes = [];
    if (r.warning) notes.push(r.warning);
    if (diag) notes.push("Compiler messages (non-fatal):\n" + diag);
    problems(notes.length ? notes.join("\n\n") : `Ran in ${r.elapsedMs} ms — ${rows} samples.`,
             notes.length ? "warn" : "ok");
    $("runStatus").textContent = `${rows} samples in ${r.elapsedMs} ms`;
  } catch (e) {
    problems("Could not reach the build service: " + e.message +
             "\nIs serve.mjs still running?", "");
    $("runStatus").textContent = "error";
  } finally {
    $("runBtn").disabled = false;
  }
}

async function initEditor() {
  const saved = localStorage.getItem(STORE_KEY);
  if (saved) $("code").value = saved;

  $("toggleCode").onclick = () => {
    const p = $("codePanel");
    p.hidden = !p.hidden;
    if (!p.hidden) $("code").focus();
  };
  $("runBtn").onclick = buildAndRun;

  // Ctrl/Cmd+Enter runs, the way every code playground does.
  $("code").addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); buildAndRun(); }
    // Tab should indent, not move focus out of the editor.
    if (e.key === "Tab") {
      e.preventDefault();
      const el = e.target, s = el.selectionStart;
      el.value = el.value.slice(0, s) + "    " + el.value.slice(el.selectionEnd);
      el.selectionStart = el.selectionEnd = s + 4;
    }
  });

  try {
    const examples = await (await fetch("../api/examples")).json();
    const sel = $("example");
    for (const ex of examples) {
      const o = document.createElement("option");
      o.value = ex.name; o.textContent = ex.name; o.title = ex.note;
      sel.appendChild(o);
    }
    sel.onchange = () => {
      const ex = examples.find((x) => x.name === sel.value);
      if (!ex) return;
      $("code").value = ex.code;
      applyArgs(ex.args || []);
      localStorage.setItem(STORE_KEY, ex.code);
      problems(ex.note || "", "warn");
    };
  } catch (e) { /* examples are optional */ }
}

requestAnimationFrame(tick);
initEditor();
boot();
