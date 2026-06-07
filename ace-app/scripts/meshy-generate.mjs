#!/usr/bin/env node
// Generate a 3D model with the Meshy API and download the GLB.
//
// Two modes:
//   • image-to-3D (default) — turn ACE's avatar PNG into a 3D head.
//   • text-to-3D            — generate from a text prompt (preview → refine).
//
// Usage:
//   MESHY_API_KEY=msy-... node scripts/meshy-generate.mjs
//   MESHY_API_KEY=msy-... node scripts/meshy-generate.mjs --image app/assets/ace-avatar.png
//   MESHY_API_KEY=msy-... node scripts/meshy-generate.mjs --text "a glowing holographic AI head, neural wireframe, dark blue"
//
// Options:
//   --image <path>      input image for image-to-3D (default: app/assets/ace-avatar.png)
//   --text  "<prompt>"  switch to text-to-3D with this prompt
//   --out   <path>      output GLB path (default: app/assets/ace-3d/ace.glb)
//   --pose  <mode>      "t-pose" | "a-pose" | "" (default: "")
//   --polycount <n>     target polycount 100..300000 (default: 50000)
//   --lowpoly           use the low-poly model type
//   --no-texture        skip texturing (image-to-3D only; faster/cheaper)
//   --pbr               generate PBR maps (metallic/roughness/normal)
//
// Requires Node 18+ (global fetch). Consumes Meshy credits.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const BASE = "https://api.meshy.ai/openapi";
const API_KEY = process.env.MESHY_API_KEY;

// --- arg parsing -----------------------------------------------------------
const argv = process.argv.slice(2);
function flag(name) {
  return argv.includes(name);
}
function opt(name, fallback) {
  const i = argv.indexOf(name);
  return i !== -1 && argv[i + 1] ? argv[i + 1] : fallback;
}

const HERE = path.dirname(new URL(import.meta.url).pathname);
const ROOT = path.resolve(HERE, ".."); // ace-app/

const text = opt("--text", null);
const imagePath = path.resolve(ROOT, opt("--image", "app/assets/ace-avatar.png"));
const outPath = path.resolve(ROOT, opt("--out", "app/assets/ace-3d/ace.glb"));
const pose = opt("--pose", "");
const polycount = Number(opt("--polycount", "50000"));
const modelType = flag("--lowpoly") ? "lowpoly" : "standard";
const shouldTexture = !flag("--no-texture");
const enablePbr = flag("--pbr");

// --- helpers ---------------------------------------------------------------
const headers = {
  Authorization: `Bearer ${API_KEY}`,
  "Content-Type": "application/json",
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`${method} ${url} → ${res.status}: ${JSON.stringify(json)}`);
  }
  return json;
}

/** Poll a task until it leaves PENDING/IN_PROGRESS. Returns the final task. */
async function poll(taskUrl, label) {
  let last = -1;
  for (;;) {
    const task = await api("GET", taskUrl);
    if (typeof task.progress === "number" && task.progress !== last) {
      last = task.progress;
      process.stdout.write(`\r  ${label}: ${task.status} ${task.progress}%   `);
    }
    if (["SUCCEEDED", "FAILED", "CANCELED"].includes(task.status)) {
      process.stdout.write("\n");
      if (task.status !== "SUCCEEDED") {
        throw new Error(`${label} ${task.status}: ${JSON.stringify(task.task_error ?? {})}`);
      }
      return task;
    }
    await sleep(5000);
  }
}

async function downloadGlb(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await mkdir(path.dirname(dest), { recursive: true });
  await writeFile(dest, buf);
  return buf.length;
}

function mimeFor(p) {
  const ext = path.extname(p).toLowerCase();
  return ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : "image/png";
}

// --- modes -----------------------------------------------------------------
async function imageTo3D() {
  const bytes = await readFile(imagePath);
  const dataUri = `data:${mimeFor(imagePath)};base64,${bytes.toString("base64")}`;
  console.log(`image-to-3D ← ${path.relative(ROOT, imagePath)} (${(bytes.length / 1024).toFixed(0)} KB)`);

  const { result: id } = await api("POST", `${BASE}/v1/image-to-3d`, {
    image_url: dataUri,
    ai_model: "latest",
    model_type: modelType,
    should_texture: shouldTexture,
    enable_pbr: enablePbr,
    target_polycount: polycount,
    pose_mode: pose,
    target_formats: ["glb"],
  });
  console.log(`  task ${id}`);
  return poll(`${BASE}/v1/image-to-3d/${id}`, "generating");
}

async function textTo3D() {
  console.log(`text-to-3D ← "${text}"`);
  // 1) preview (geometry)
  const { result: previewId } = await api("POST", `${BASE}/v2/text-to-3d`, {
    mode: "preview",
    prompt: text,
    ai_model: "latest",
    model_type: modelType,
    target_polycount: polycount,
    pose_mode: pose,
    target_formats: ["glb"],
  });
  console.log(`  preview task ${previewId}`);
  await poll(`${BASE}/v2/text-to-3d/${previewId}`, "preview");

  // 2) refine (texture)
  const { result: refineId } = await api("POST", `${BASE}/v2/text-to-3d`, {
    mode: "refine",
    preview_task_id: previewId,
    enable_pbr: enablePbr,
    target_formats: ["glb"],
  });
  console.log(`  refine task ${refineId}`);
  return poll(`${BASE}/v2/text-to-3d/${refineId}`, "refine");
}

// --- main ------------------------------------------------------------------
async function main() {
  if (!API_KEY) {
    console.error(
      "✖ MESHY_API_KEY is not set.\n" +
        "  Get a key at https://www.meshy.ai (Settings → API), then:\n" +
        "  MESHY_API_KEY=msy-... node scripts/meshy-generate.mjs",
    );
    process.exit(1);
  }

  const task = text ? await textTo3D() : await imageTo3D();
  const glbUrl = task.model_urls?.glb;
  if (!glbUrl) throw new Error("no GLB in model_urls");

  const size = await downloadGlb(glbUrl, outPath);
  console.log(`✔ saved ${path.relative(ROOT, outPath)} (${(size / 1024).toFixed(0)} KB)`);
  if (typeof task.consumed_credits === "number") {
    console.log(`  credits consumed: ${task.consumed_credits}`);
  }
  if (task.thumbnail_url) console.log(`  preview image: ${task.thumbnail_url}`);
}

main().catch((err) => {
  console.error(`\n✖ ${err.message}`);
  process.exit(1);
});
