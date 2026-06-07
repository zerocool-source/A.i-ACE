// Copy the runtime binaries the viewer needs into public/ (kept out of git):
//   • the ACE GLB (canonical copy lives in ../app/assets/ace-3d/ace.glb)
//   • Three.js's gltf-optimized Draco decoder (from node_modules after install)
import { cp, mkdir, access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

const glbSrc = path.resolve(root, "../app/assets/ace-3d/ace.glb");
const glbDest = path.resolve(root, "public/models/ace.glb");
const dracoSrc = path.resolve(root, "node_modules/three/examples/jsm/libs/draco/gltf");
const dracoDest = path.resolve(root, "public/draco");

async function exists(p) {
  try { await access(p); return true; } catch { return false; }
}

await mkdir(path.dirname(glbDest), { recursive: true });
await mkdir(dracoDest, { recursive: true });

if (await exists(glbSrc)) {
  await cp(glbSrc, glbDest);
  console.log("✔ ace.glb");
} else {
  console.warn(`⚠ missing ${path.relative(root, glbSrc)} — generate it first (see 3D-PIPELINE.md)`);
}

if (await exists(dracoSrc)) {
  await cp(dracoSrc, dracoDest, { recursive: true });
  console.log("✔ draco decoder");
} else {
  console.warn("⚠ run `npm install` first (Draco decoder comes from the three package)");
}
