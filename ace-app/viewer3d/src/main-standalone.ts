// Standalone build of the ACE 3D viewer — everything inlined, no server, no fetch.
// The GLB is embedded (base64, decoder-free: KHR_mesh_quantization + WebP, which
// GLTFLoader handles natively), so the built single HTML opens by double-click.
//
// Visual/behaviour is identical to main.ts; only model loading differs.

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { GLB_B64 } from "./embeddedGlb";

type Mode = "idle" | "listening" | "thinking" | "speaking";
const PARAMS: Record<Mode, { spin: number; bloom: number; speaking: boolean }> = {
  idle: { spin: 0.15, bloom: 1.05, speaking: false },
  listening: { spin: 0.25, bloom: 1.35, speaking: false },
  thinking: { spin: 0.6, bloom: 1.8, speaking: false },
  speaking: { spin: 0.3, bloom: 1.55, speaking: true },
};
let mode: Mode = "idle";

// Skeletal animation (the embedded GLB is rigged with 4 clips).
let mixer: THREE.AnimationMixer | null = null;
const actions: Record<string, THREE.AnimationAction> = {};
let current: THREE.AnimationAction | null = null;
const animClock = new THREE.Clock();
const CLIP_KEYWORD: Record<Mode, string> = {
  idle: "idle", listening: "listen", thinking: "think", speaking: "speak",
};
function playClip(m: Mode) {
  if (!mixer) return;
  const names = Object.keys(actions);
  const name = names.find((n) => n.toLowerCase().includes(CLIP_KEYWORD[m])) ?? names[0];
  const next = name ? actions[name] : null;
  if (!next || next === current) return;
  next.reset().fadeIn(0.4).play();
  if (current) current.fadeOut(0.4);
  current = next;
}

const app = document.getElementById("app")!;
const loadingEl = document.getElementById("loading")!;

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);
scene.fog = new THREE.FogExp2(0x000308, 0.06);

const camera = new THREE.PerspectiveCamera(35, innerWidth / innerHeight, 0.1, 100);
camera.position.set(0, 0.1, 4.2);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.autoRotate = false; // face forward, no spin (drag to orbit manually)
controls.minDistance = 2;
controls.maxDistance = 8;

scene.add(new THREE.AmbientLight(0x223355, 0.6));
const key = new THREE.DirectionalLight(0xaaccff, 1.1);
key.position.set(2, 3, 4);
scene.add(key);
const rim = new THREE.DirectionalLight(0x4070ff, 0.8);
rim.position.set(-3, 1, -2);
scene.add(rim);

const root = new THREE.Group();
scene.add(root);

// decode the embedded base64 GLB → ArrayBuffer
function b64ToArrayBuffer(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

let modelReady = false;
new GLTFLoader().parse(
  b64ToArrayBuffer(GLB_B64),
  "",
  (g) => {
    const obj = g.scene;
    const box = new THREE.Box3().setFromObject(obj);
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);
    const scale = 2.4 / Math.max(size.x, size.y, size.z);
    obj.scale.setScalar(scale);
    obj.position.sub(center.multiplyScalar(scale));
    obj.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.frustumCulled = false;
        const mat = m.material as THREE.MeshStandardMaterial;
        if (mat && "emissive" in mat) {
          mat.emissive = new THREE.Color(0x6fa8ff);
          mat.emissiveIntensity = 0.35;
          if (mat.map) mat.emissiveMap = mat.map;
        }
      }
    });
    root.add(obj);
    buildNeuralPoints(obj); // glowing node dots over the surface (neural look)
    if (g.animations && g.animations.length) {
      mixer = new THREE.AnimationMixer(obj);
      for (const clip of g.animations) actions[clip.name] = mixer.clipAction(clip);
      playClip(mode);
    }
    modelReady = true;
    loadingEl.style.display = "none";
  },
  (err) => {
    loadingEl.textContent = "FAILED TO PARSE MESH";
    console.error(err);
  },
);

// speaking particle stream
const COUNT = 1500;
const pGeo = new THREE.BufferGeometry();
const pPos = new Float32Array(COUNT * 3);
const pVel = new Float32Array(COUNT * 3);
const pLife = new Float32Array(COUNT);
function seed(i: number, reset = false) {
  // emit from the mouth (≈ -0.34 y, front +z) as a forward-widening jet
  pPos[i * 3] = (Math.random() - 0.5) * 0.07;
  pPos[i * 3 + 1] = -0.34 + (Math.random() - 0.5) * 0.05;
  pPos[i * 3 + 2] = 0.82 + (reset ? 0 : Math.random() * 1.7);
  const spread = 0.009;
  pVel[i * 3] = (Math.random() - 0.5) * spread;
  pVel[i * 3 + 1] = (Math.random() - 0.5) * spread - 0.0015; // slight droop like the reference
  pVel[i * 3 + 2] = 0.016 + Math.random() * 0.028;
  pLife[i] = Math.random();
}
for (let i = 0; i < COUNT; i++) seed(i);
pGeo.setAttribute("position", new THREE.BufferAttribute(pPos, 3));
const pMat = new THREE.PointsMaterial({
  color: 0xeaf5ff,
  size: 0.028,
  transparent: true,
  opacity: 0,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
});
scene.add(new THREE.Points(pGeo, pMat));

// --- neural nodes + constellation edges, SKINNED to the head ----------------
let neuralMesh: THREE.SkinnedMesh | null = null;
let neuralGeo: THREE.BufferGeometry | null = null;
let neuralIdx: number[] = [];
let edgeGeo: THREE.BufferGeometry | null = null;
let edgePairs: [number, number][] = []; // index pairs into the points buffer
const _nv = new THREE.Vector3();

const POINT_COUNT = 11000; // glowing nodes sampled over the surface
const EDGE_NODES = 3600;   // subset used to wire the constellation
const EDGE_K = 3;          // neighbours per node

// --- face glows (eyes + ACE chip), pinned to the head ----------------------
const eyeSprites: THREE.Sprite[] = [];
function glowTexture(): THREE.Texture {
  const c = document.createElement("canvas"); c.width = c.height = 64;
  const g = c.getContext("2d")!;
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, "rgba(255,255,255,1)");
  grd.addColorStop(0.22, "rgba(214,236,255,0.92)");
  grd.addColorStop(0.55, "rgba(150,196,255,0.32)");
  grd.addColorStop(1, "rgba(120,180,255,0)");
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}
const GLOW_TEX = glowTexture();
function addGlow(parent: THREE.Object3D, x: number, y: number, z: number, size: number, color: number): THREE.Sprite {
  const mat = new THREE.SpriteMaterial({
    map: GLOW_TEX, color, transparent: true, blending: THREE.AdditiveBlending,
    depthWrite: false, depthTest: false,
  });
  const s = new THREE.Sprite(mat);
  s.position.set(x, y, z); s.scale.setScalar(size);
  parent.add(s);
  return s;
}

function buildNeuralPoints(obj: THREE.Object3D) {
  let mesh: THREE.Mesh | null = null;
  obj.traverse((o) => { if ((o as THREE.SkinnedMesh).isSkinnedMesh && !mesh) mesh = o as THREE.Mesh; });
  if (!mesh) obj.traverse((o) => { if ((o as THREE.Mesh).isMesh && !mesh) mesh = o as THREE.Mesh; });
  if (!mesh) return;

  // dim the solid mesh so it reads as a translucent web of nodes (reference look)
  const mat = (mesh as THREE.Mesh).material as THREE.MeshStandardMaterial;
  if (mat) { mat.transparent = true; mat.opacity = 0.12; mat.depthWrite = false; }

  // glowing eyes + ACE chip, placed by bounding box (face is +Z)
  (mesh as THREE.Mesh).geometry.computeBoundingBox();
  const bb = (mesh as THREE.Mesh).geometry.boundingBox!;
  const cx = (bb.min.x + bb.max.x) / 2, cy = (bb.min.y + bb.max.y) / 2;
  const W = bb.max.x - bb.min.x, H = bb.max.y - bb.min.y, fz = bb.max.z;
  eyeSprites.push(addGlow(mesh, cx - 0.145 * W, cy + 0.12 * H, fz * 0.62, 0.13, 0xffffff));
  eyeSprites.push(addGlow(mesh, cx + 0.145 * W, cy + 0.12 * H, fz * 0.62, 0.13, 0xffffff));
  addGlow(mesh, cx, cy + 0.235 * H, fz * 0.6, 0.24, 0x9fc4ff); // ACE chip aura (forehead)

  const pos = (mesh as THREE.Mesh).geometry.getAttribute("position");
  const stride = Math.max(1, Math.floor(pos.count / POINT_COUNT));
  neuralIdx = [];
  const arr: number[] = [];
  for (let i = 0; i < pos.count; i += stride) {
    neuralIdx.push(i);
    arr.push(pos.getX(i), pos.getY(i), pos.getZ(i));
  }
  neuralGeo = new THREE.BufferGeometry();
  neuralGeo.setAttribute("position", new THREE.Float32BufferAttribute(arr, 3));
  const pm = new THREE.PointsMaterial({
    color: 0xeaf4ff, size: 0.012, sizeAttenuation: true, transparent: true,
    opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false,
  });
  (mesh as THREE.Mesh).add(new THREE.Points(neuralGeo, pm));

  // ---- constellation edges: connect each of EDGE_NODES to its nearest few ----
  const n = Math.min(EDGE_NODES, neuralIdx.length);
  // bbox of the edge node subset → adaptive connection radius
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < n; i++) {
    const x = arr[i * 3], y = arr[i * 3 + 1], z = arr[i * 3 + 2];
    if (x < minX) minX = x; if (y < minY) minY = y; if (z < minZ) minZ = z;
    if (x > maxX) maxX = x; if (y > maxY) maxY = y; if (z > maxZ) maxZ = z;
  }
  const diag = Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) || 1;
  const radius = diag * 0.035;
  const cell = radius;
  const grid = new Map<string, number[]>();
  const key = (x: number, y: number, z: number) =>
    `${Math.floor(x / cell)},${Math.floor(y / cell)},${Math.floor(z / cell)}`;
  for (let i = 0; i < n; i++) {
    const k = key(arr[i * 3], arr[i * 3 + 1], arr[i * 3 + 2]);
    (grid.get(k) ?? grid.set(k, []).get(k)!).push(i);
  }
  const seen = new Set<number>();
  edgePairs = [];
  const r2 = radius * radius;
  for (let i = 0; i < n && edgePairs.length < 16000; i++) {
    const x = arr[i * 3], y = arr[i * 3 + 1], z = arr[i * 3 + 2];
    const cx = Math.floor(x / cell), cy = Math.floor(y / cell), cz = Math.floor(z / cell);
    const cand: { j: number; d: number }[] = [];
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      const bucket = grid.get(`${cx + dx},${cy + dy},${cz + dz}`);
      if (!bucket) continue;
      for (const j of bucket) {
        if (j === i) continue;
        const d = (arr[j * 3] - x) ** 2 + (arr[j * 3 + 1] - y) ** 2 + (arr[j * 3 + 2] - z) ** 2;
        if (d <= r2) cand.push({ j, d });
      }
    }
    cand.sort((a, b) => a.d - b.d);
    for (let c = 0; c < Math.min(EDGE_K, cand.length); c++) {
      const j = cand[c].j;
      const pk = i < j ? i * 1e6 + j : j * 1e6 + i;
      if (seen.has(pk)) continue;
      seen.add(pk);
      edgePairs.push([i, j]);
    }
  }
  edgeGeo = new THREE.BufferGeometry();
  edgeGeo.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(edgePairs.length * 6), 3));
  const em = new THREE.LineBasicMaterial({
    color: 0x6fa6e6, transparent: true, opacity: 0.28, blending: THREE.AdditiveBlending, depthWrite: false,
  });
  (mesh as THREE.Mesh).add(new THREE.LineSegments(edgeGeo, em));

  if ((mesh as THREE.SkinnedMesh).isSkinnedMesh) neuralMesh = mesh as THREE.SkinnedMesh;
  updateNeural(); // seed positions
}

// Each frame, snap nodes to the skinned (deformed) vertex positions, then rebuild
// the edge endpoints from them — so the whole web moves with the head.
function updateNeural() {
  if (!neuralMesh || !neuralGeo || !neuralMesh.skeleton) return;
  const p = neuralGeo.getAttribute("position") as THREE.BufferAttribute;
  for (let i = 0; i < neuralIdx.length; i++) {
    neuralMesh.getVertexPosition(neuralIdx[i], _nv);
    p.setXYZ(i, _nv.x, _nv.y, _nv.z);
  }
  p.needsUpdate = true;
  if (edgeGeo) {
    const e = edgeGeo.getAttribute("position") as THREE.BufferAttribute;
    for (let k = 0; k < edgePairs.length; k++) {
      const [a, b] = edgePairs[k];
      e.setXYZ(k * 2, p.getX(a), p.getY(a), p.getZ(a));
      e.setXYZ(k * 2 + 1, p.getX(b), p.getY(b), p.getZ(b));
    }
    e.needsUpdate = true;
  }
}

// --- ambient particles drifting off the avatar -----------------------------
const AMB = 280;
const ambGeo = new THREE.BufferGeometry();
const ambPos = new Float32Array(AMB * 3);
const ambVel = new Float32Array(AMB * 3);
function seedAmb(i: number) {
  const r = 0.85 + Math.random() * 0.35;
  const th = Math.random() * Math.PI * 2;
  const ph = Math.acos(2 * Math.random() - 1);
  const x = r * Math.sin(ph) * Math.cos(th);
  const y = r * Math.cos(ph) * 0.95;
  const z = r * Math.sin(ph) * Math.sin(th);
  ambPos[i * 3] = x; ambPos[i * 3 + 1] = y; ambPos[i * 3 + 2] = z;
  const s = 0.0012 + Math.random() * 0.0022;
  ambVel[i * 3] = x * s; ambVel[i * 3 + 1] = 0.0008 + Math.random() * 0.0014; ambVel[i * 3 + 2] = z * s;
}
for (let i = 0; i < AMB; i++) seedAmb(i);
ambGeo.setAttribute("position", new THREE.BufferAttribute(ambPos, 3));
const ambMat = new THREE.PointsMaterial({
  color: 0x9fd0ff, size: 0.02, transparent: true, opacity: 0.5,
  blending: THREE.AdditiveBlending, depthWrite: false,
});
const ambient = new THREE.Points(ambGeo, ambMat);
scene.add(ambient);
function updateAmbient() {
  for (let i = 0; i < AMB; i++) {
    ambPos[i * 3] += ambVel[i * 3];
    ambPos[i * 3 + 1] += ambVel[i * 3 + 1];
    ambPos[i * 3 + 2] += ambVel[i * 3 + 2];
    const d = Math.hypot(ambPos[i * 3], ambPos[i * 3 + 1], ambPos[i * 3 + 2]);
    if (d > 2.3) seedAmb(i);
  }
  ambGeo.attributes.position.needsUpdate = true;
}

// --- ambient knowledge network around the avatar (reference style) ----------
// deep-blue gradient backdrop
function bgGradient(): THREE.Texture {
  const c = document.createElement("canvas"); c.width = c.height = 512;
  const g = c.getContext("2d")!;
  const grd = g.createRadialGradient(256, 235, 30, 256, 256, 360);
  grd.addColorStop(0, "#13284f"); grd.addColorStop(0.5, "#081530"); grd.addColorStop(1, "#01030a");
  g.fillStyle = grd; g.fillRect(0, 0, 512, 512);
  return new THREE.CanvasTexture(c);
}
scene.background = bgGradient();
scene.fog = new THREE.FogExp2(0x030a1e, 0.05);

// wide starfield
const STARS = 1700;
const starGeo = new THREE.BufferGeometry();
const starPos = new Float32Array(STARS * 3);
for (let i = 0; i < STARS; i++) {
  const r = 3.2 + Math.random() * 7, th = Math.random() * Math.PI * 2, ph = Math.acos(2 * Math.random() - 1);
  starPos[i * 3] = r * Math.sin(ph) * Math.cos(th);
  starPos[i * 3 + 1] = r * Math.cos(ph) * 0.72;
  starPos[i * 3 + 2] = r * Math.sin(ph) * Math.sin(th);
}
starGeo.setAttribute("position", new THREE.BufferAttribute(starPos, 3));
const starfield = new THREE.Points(starGeo, new THREE.PointsMaterial({
  color: 0xbcd4ff, size: 0.02, transparent: true, opacity: 0.7,
  blending: THREE.AdditiveBlending, depthWrite: false,
}));
scene.add(starfield);

// glowing orb nodes drifting around the head, wired by thin lines
const ORB_COLORS = [0xff5ad0, 0x40d8ff, 0x6c8cff, 0xffc060, 0x6affb0, 0xb070ff];
const ORBN = 9;
interface Orb { s: THREE.Sprite; ang: number; rad: number; y: number; spd: number; bob: number; }
const orbs: Orb[] = [];
for (let i = 0; i < ORBN; i++) {
  const s = addGlow(scene, 0, 0, 0, 0.34, ORB_COLORS[i % ORB_COLORS.length]);
  orbs.push({
    s, ang: Math.random() * Math.PI * 2, rad: 2.4 + Math.random() * 1.7,
    y: (Math.random() - 0.5) * 2.6, spd: (0.05 + Math.random() * 0.13) * (Math.random() < 0.5 ? 1 : -1),
    bob: Math.random() * Math.PI * 2,
  });
}
const orbLineGeo = new THREE.BufferGeometry();
orbLineGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(ORBN * 2 * 2 * 3), 3));
scene.add(new THREE.LineSegments(orbLineGeo, new THREE.LineBasicMaterial({
  color: 0x6a86c8, transparent: true, opacity: 0.32, blending: THREE.AdditiveBlending, depthWrite: false,
})));

function updateNetwork(t: number) {
  for (const o of orbs) {
    o.ang += o.spd * 0.016;
    o.s.position.set(Math.cos(o.ang) * o.rad, o.y + Math.sin(t * 0.5 + o.bob) * 0.28, Math.sin(o.ang) * o.rad);
    o.s.scale.setScalar(0.32 * (0.85 + 0.15 * Math.sin(t * 2 + o.bob)));
  }
  const lp = orbLineGeo.getAttribute("position") as THREE.BufferAttribute;
  let li = 0;
  for (let i = 0; i < orbs.length && li < ORBN * 2; i++) {
    const near = orbs
      .map((o, j) => ({ j, d: orbs[i].s.position.distanceToSquared(o.s.position) }))
      .filter((x) => x.j !== i).sort((a, b) => a.d - b.d).slice(0, 2);
    for (const { j } of near) {
      if (li >= ORBN * 2) break;
      const a = orbs[i].s.position, b = orbs[j].s.position;
      lp.setXYZ(li * 2, a.x, a.y, a.z); lp.setXYZ(li * 2 + 1, b.x, b.y, b.z); li++;
    }
  }
  for (let k = li; k < ORBN * 2; k++) { lp.setXYZ(k * 2, 0, 0, 0); lp.setXYZ(k * 2 + 1, 0, 0, 0); }
  lp.needsUpdate = true;
  starfield.rotation.y = t * 0.012;
}

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), PARAMS[mode].bloom, 0.7, 0.85);
composer.addPass(bloom);

function setMode(next: Mode) {
  mode = next;
  document.querySelectorAll<HTMLElement>(".mode .tag").forEach((t) =>
    t.classList.toggle("active", t.dataset.mode === mode));
  document.getElementById("status")!.textContent =
    mode === "speaking" ? "RESPONSE OUTPUT" : mode === "thinking" ? "PROCESSING…" :
    mode === "listening" ? "LISTENING" : "NEURAL CORE ONLINE";
  playClip(mode);
}

/* ---------- ACE app: ask → think → speak, driving the 3D clips ---------- */
const $ = (id: string) => document.getElementById(id)!;
const askScrim = $("askScrim"), brainScrim = $("brainScrim");
const askText = $("askText") as HTMLTextAreaElement;
const askReply = $("askReply");
const brainInput = $("brainurl") as HTMLInputElement;

let graph = {
  nodes: [
    { id: "Project ACE", ghost: false }, { id: "Knowledge Graph", ghost: false },
    { id: "Ambient Listening", ghost: false }, { id: "Sam", ghost: false },
    { id: "Q3 Launch", ghost: true },
  ],
  edges: [
    { from: "Project ACE", to: "Knowledge Graph" }, { from: "Project ACE", to: "Ambient Listening" },
    { from: "Project ACE", to: "Q3 Launch" }, { from: "Sam", to: "Q3 Launch" },
  ],
};
function demoReply(q: string): string {
  const t = q.toLowerCase();
  if (/what.*do|think|take|next/.test(t))
    return "From what I've heard, the bottleneck is the launch date, not the build. I'd lock the Q3 scope today and have Sam own the graph-sync task.";
  if (/who|owner|sam/.test(t)) return "Sam picked up the launch thread, so the deadline call is really theirs. I'd get a yes/no from them first.";
  return "Noted. Ask me \"what do you think?\" while a conversation is fresh and I'll weigh in.";
}

function speak(text: string) {
  setMode("speaking");
  if (window.speechSynthesis) {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.0; u.pitch = 0.95;
    u.onend = () => setMode("idle");
    u.onerror = () => setMode("idle");
    speechSynthesis.speak(u);
  } else {
    setTimeout(() => setMode("idle"), 2600);
  }
}
async function engage(q: string) {
  q = q.trim(); if (!q) return;
  askReply.textContent = ""; setMode("thinking");
  let answer: string;
  const url = (brainInput.value || "").trim();
  if (url) {
    try {
      const r = await fetch(url.replace(/\/$/, "") + "/ask", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcript: [], question: q }),
      });
      answer = (await r.json()).reply;
    } catch { answer = "(couldn't reach the brain service) " + demoReply(q); }
  } else {
    await new Promise((r) => setTimeout(r, 900));
    answer = demoReply(q);
    const label = "Asked: " + q.slice(0, 16);
    graph.nodes.push({ id: label, ghost: false });
    graph.edges.push({ from: "Project ACE", to: label });
  }
  askReply.textContent = answer;
  speak(answer);
}

function renderGraph() {
  const svg = $("graphSvg");
  const w = svg.clientWidth || 520, h = svg.clientHeight || 360;
  const pos = new Map<string, { x: number; y: number }>();
  const n = graph.nodes.length;
  graph.nodes.forEach((nd, i) => {
    const a = (i / n) * Math.PI * 2;
    pos.set(nd.id, { x: w / 2 + Math.cos(a) * w * 0.3, y: h / 2 + Math.sin(a) * h * 0.32 });
  });
  const k = Math.sqrt((w * h) / Math.max(1, n)) * 0.55;
  for (let it = 0; it < 120; it++) {
    const disp = new Map(graph.nodes.map((nd) => [nd.id, { x: 0, y: 0 }]));
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      const a = graph.nodes[i].id, b = graph.nodes[j].id, pa = pos.get(a)!, pb = pos.get(b)!;
      let dx = pa.x - pb.x, dy = pa.y - pb.y, d = Math.hypot(dx, dy) || 0.01, f = (k * k) / d;
      dx = dx / d * f; dy = dy / d * f;
      disp.get(a)!.x += dx; disp.get(a)!.y += dy; disp.get(b)!.x -= dx; disp.get(b)!.y -= dy;
    }
    for (const e of graph.edges) {
      const pa = pos.get(e.from), pb = pos.get(e.to); if (!pa || !pb) continue;
      let dx = pa.x - pb.x, dy = pa.y - pb.y, d = Math.hypot(dx, dy) || 0.01, f = (d * d) / k;
      dx = dx / d * f; dy = dy / d * f;
      disp.get(e.from)!.x -= dx; disp.get(e.from)!.y -= dy; disp.get(e.to)!.x += dx; disp.get(e.to)!.y += dy;
    }
    for (const nd of graph.nodes) {
      const dp = disp.get(nd.id)!, d = Math.hypot(dp.x, dp.y) || 0.01, p = pos.get(nd.id)!;
      p.x += dp.x / d * Math.min(d, 6); p.y += dp.y / d * Math.min(d, 6);
      p.x = Math.max(24, Math.min(w - 24, p.x)); p.y = Math.max(24, Math.min(h - 24, p.y));
    }
  }
  const NS = "http://www.w3.org/2000/svg";
  svg.innerHTML = "";
  for (const e of graph.edges) {
    const a = pos.get(e.from), b = pos.get(e.to); if (!a || !b) continue;
    const l = document.createElementNS(NS, "line");
    l.setAttribute("x1", "" + a.x); l.setAttribute("y1", "" + a.y);
    l.setAttribute("x2", "" + b.x); l.setAttribute("y2", "" + b.y);
    l.setAttribute("stroke", "#2a4a7f"); svg.appendChild(l);
  }
  for (const nd of graph.nodes) {
    const p = pos.get(nd.id)!;
    const c = document.createElementNS(NS, "circle");
    c.setAttribute("cx", "" + p.x); c.setAttribute("cy", "" + p.y);
    c.setAttribute("r", nd.ghost ? "4" : "7");
    c.setAttribute("fill", nd.ghost ? "#1c345c" : "#7fb0ff"); svg.appendChild(c);
    const tx = document.createElementNS(NS, "text");
    tx.setAttribute("x", "" + (p.x + 9)); tx.setAttribute("y", "" + (p.y + 3));
    tx.setAttribute("font-size", "10"); tx.setAttribute("fill", "#9bb8e6");
    tx.textContent = nd.id; svg.appendChild(tx);
  }
}

// listen (visual mode; mic optional)
let listening = false;
function toggleListen() {
  const btn = $("listenBtn");
  if (listening) { listening = false; btn.classList.remove("on"); setMode("idle"); return; }
  listening = true; btn.classList.add("on"); setMode("listening");
  navigator.mediaDevices?.getUserMedia({ audio: true }).catch(() => {});
}

$("askBtn").onclick = () => { askScrim.classList.add("show"); askText.focus(); };
$("askClose").onclick = () => askScrim.classList.remove("show");
$("askSend").onclick = () => { const q = askText.value; askText.value = ""; askScrim.classList.remove("show"); engage(q); };
$("brainBtn").onclick = () => { renderGraph(); brainScrim.classList.add("show"); };
$("brainClose").onclick = () => brainScrim.classList.remove("show");
$("listenBtn").onclick = toggleListen;
renderer.domElement.addEventListener("click", () => { askScrim.classList.add("show"); askText.focus(); });

setMode("idle");

const clock = new THREE.Clock();
let neuralFrame = 0;
function animate() {
  requestAnimationFrame(animate);
  const t = clock.getElapsedTime();
  const p = PARAMS[mode];
  controls.autoRotateSpeed = p.spin * 10;
  const pulse = (mode === "thinking" || mode === "speaking") ? 0.18 * Math.sin(t * 6) : 0;
  bloom.strength += (p.bloom + pulse - bloom.strength) * 0.08;
  if (mixer) {
    mixer.update(animClock.getDelta());
  } else if (modelReady) {
    root.scale.setScalar(1 + Math.sin(t * 1.1) * 0.012);
    root.position.y = Math.sin(t * 0.6) * 0.03;
  }
  const target = p.speaking ? 1.0 : 0;
  pMat.opacity += (target - pMat.opacity) * 0.1;
  if (pMat.opacity > 0.01) {
    for (let i = 0; i < COUNT; i++) {
      pPos[i * 3] += pVel[i * 3];
      pPos[i * 3 + 1] += pVel[i * 3 + 1];
      pPos[i * 3 + 2] += pVel[i * 3 + 2] * (p.speaking ? 1 : 0.3);
      pLife[i] -= 0.012;
      if (pLife[i] <= 0 || pPos[i * 3 + 2] > 3) { seed(i, true); pLife[i] = 1; }
    }
    pGeo.attributes.position.needsUpdate = true;
  }
  if (mixer && (neuralFrame++ & 1) === 0) updateNeural(); // every other frame (perf)
  // pulse + blink the eyes (brighter while listening/thinking/speaking)
  const boost = mode === "speaking" ? 0.3 : mode === "thinking" ? 0.22 : mode === "listening" ? 0.26 : 0;
  const blink = (t % 4.2) < 0.13 ? 0.0 : 1.0; // occasional blink
  const eyeO = Math.min(1, 0.8 + 0.18 * Math.sin(t * 3) + boost) * blink;
  for (const e of eyeSprites) {
    (e.material as THREE.SpriteMaterial).opacity = eyeO;
    e.scale.setScalar(0.135 + 0.02 * Math.sin(t * 3) + boost * 0.1);
  }
  updateAmbient();
  updateNetwork(t); // glowing orb network drifting around the avatar
  controls.update();
  composer.render();
}
animate();

addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
});
