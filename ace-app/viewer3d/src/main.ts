// ACE 3D viewer — local dev.
// Loads the Meshy-generated head and animates it procedurally to match the
// reference art: glowing eyes + ACE chip (via bloom), breathing/sway, and a
// "response output" particle stream from the mouth in the speaking state.
//
// True skeletal animation needs a rig (Blender / Meshy auto-rig). This viewer
// gives an animated, mode-reactive talking head with no bones.

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";

type Mode = "idle" | "listening" | "thinking" | "speaking";
const PARAMS: Record<Mode, { spin: number; bloom: number; speaking: boolean }> = {
  idle: { spin: 0.15, bloom: 0.9, speaking: false },
  listening: { spin: 0.25, bloom: 1.25, speaking: false },
  thinking: { spin: 0.6, bloom: 1.7, speaking: false },
  speaking: { spin: 0.3, bloom: 1.45, speaking: true },
};
let mode: Mode = "idle";

const app = document.getElementById("app")!;
const loadingEl = document.getElementById("loading")!;

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
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
controls.autoRotate = true;
controls.autoRotateSpeed = PARAMS[mode].spin;
controls.minDistance = 2;
controls.maxDistance = 8;

// rim + fill so the wireframe reads against pure black
scene.add(new THREE.AmbientLight(0x223355, 0.6));
const key = new THREE.DirectionalLight(0xaaccff, 1.1);
key.position.set(2, 3, 4);
scene.add(key);
const rim = new THREE.DirectionalLight(0x4070ff, 0.8);
rim.position.set(-3, 1, -2);
scene.add(rim);

// --- model ----------------------------------------------------------------
const root = new THREE.Group();
scene.add(root);

const draco = new DRACOLoader();
draco.setDecoderPath("/draco/"); // gltf-optimized decoder copied into public/draco
const gltf = new GLTFLoader();
gltf.setDRACOLoader(draco);

let modelReady = false;
gltf.load(
  "/models/ace.glb",
  (g) => {
    const obj = g.scene;
    // center + scale to a ~2.4 unit tall head
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
          // let bright texels bloom (the neural points + eyes + chip)
          mat.emissive = new THREE.Color(0x6fa8ff);
          mat.emissiveIntensity = 0.35;
          if (mat.map) mat.emissiveMap = mat.map;
        }
      }
    });
    root.add(obj);
    modelReady = true;
    loadingEl.style.display = "none";
  },
  undefined,
  (err) => {
    loadingEl.textContent = "FAILED TO LOAD MESH";
    console.error(err);
  },
);

// --- speaking particle stream (reference: side-view "response output") -----
const COUNT = 600;
const pGeo = new THREE.BufferGeometry();
const pPos = new Float32Array(COUNT * 3);
const pVel = new Float32Array(COUNT * 3);
const pLife = new Float32Array(COUNT);
function seed(i: number, reset = false) {
  pPos[i * 3] = (Math.random() - 0.5) * 0.15;
  pPos[i * 3 + 1] = -0.35 + (Math.random() - 0.5) * 0.1; // mouth height
  pPos[i * 3 + 2] = 1.0 + (reset ? 0 : Math.random() * 1.5); // in front of face
  pVel[i * 3] = (Math.random() - 0.5) * 0.01;
  pVel[i * 3 + 1] = (Math.random() - 0.5) * 0.01;
  pVel[i * 3 + 2] = 0.012 + Math.random() * 0.02; // stream forward
  pLife[i] = Math.random();
}
for (let i = 0; i < COUNT; i++) seed(i);
pGeo.setAttribute("position", new THREE.BufferAttribute(pPos, 3));
const pMat = new THREE.PointsMaterial({
  color: 0xcfe4ff,
  size: 0.022,
  transparent: true,
  opacity: 0,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
});
const particles = new THREE.Points(pGeo, pMat);
scene.add(particles);

// --- post: bloom for the neural glow ---------------------------------------
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), PARAMS[mode].bloom, 0.7, 0.85);
composer.addPass(bloom);

// --- UI --------------------------------------------------------------------
function setMode(next: Mode) {
  mode = next;
  document.querySelectorAll<HTMLElement>(".mode .tag").forEach((t) =>
    t.classList.toggle("active", t.dataset.mode === mode));
  document.querySelectorAll<HTMLElement>(".controls .btn[data-set]").forEach((b) =>
    b.classList.toggle("on", b.dataset.set === mode));
  document.getElementById("status")!.textContent =
    mode === "speaking" ? "RESPONSE OUTPUT" : mode === "thinking" ? "PROCESSING…" :
    mode === "listening" ? "LISTENING" : "NEURAL CORE ONLINE";
}
document.querySelectorAll<HTMLElement>(".controls .btn[data-set]").forEach((b) =>
  b.addEventListener("click", () => setMode(b.dataset.set as Mode)));
let hudOn = true;
document.getElementById("hudToggle")!.addEventListener("click", () => {
  hudOn = !hudOn;
  document.querySelector<HTMLElement>(".hud")!.style.display = hudOn ? "block" : "none";
  document.getElementById("hudToggle")!.classList.toggle("on", hudOn);
});
setMode("idle");

// --- loop ------------------------------------------------------------------
const clock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);
  const t = clock.getElapsedTime();
  const p = PARAMS[mode];

  controls.autoRotateSpeed = p.spin * 10;
  // ease bloom toward the mode target, with a thinking/speaking pulse
  const pulse = (mode === "thinking" || mode === "speaking") ? 0.18 * Math.sin(t * 6) : 0;
  bloom.strength += (p.bloom + pulse - bloom.strength) * 0.08;

  if (modelReady) {
    // breathing + subtle sway so it feels alive
    const s = 1 + Math.sin(t * 1.1) * 0.012;
    root.scale.setScalar(s);
    root.position.y = Math.sin(t * 0.6) * 0.03;
  }

  // speaking particle stream
  const target = p.speaking ? 0.9 : 0;
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
