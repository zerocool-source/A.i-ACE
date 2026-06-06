# ACE — Production Validation Report

**Date:** 2026-06-06
**Validator:** Khronos `gltf-validator` 2.0.0-dev.3.10 (glTF 2.0 / GLB)
**Pipeline:** `scripts/optimize-ace.mjs` (@gltf-transform + meshoptimizer + draco3dgltf)

This report covers the two production assets produced from the source exports.
Raw machine-readable validator output is archived alongside this file:
`ACE_EXPORT_PRODUCTION.validator.json`, `ACE_ANIMATED_PRODUCTION.validator.json`.

---

## 1. Production files

| Metric | ACE_EXPORT_PRODUCTION.glb | ACE_ANIMATED_PRODUCTION.glb |
|---|---|---|
| **File size** | **772,740 B** (754.6 KB) | **675,332 B** (659.5 KB) |
| **Errors** | **0** | **0** |
| **Warnings** | **0** | **0** |
| Infos (Draco/instancing, benign) | 12 | 8 |
| **Mesh count** | 7 draw primitives | 7 draw primitives |
| **Material count** | 5 | 5 |
| **Animation count** | 0 | **4** (all clips preserved) |
| **Texture count** | 0 | 0 |
| **Draw-call estimate** | 7 | 7 |
| Triangles | 186,551 | **144,021** |
| Vertices | 124,458 | 110,960 |
| Skins / joints | 0 | 1 / 6 |
| Compression | Draco (required) | Draco (required) |

### Before → after

| | Source | Production | Δ |
|---|---|---|---|
| ACE_EXPORT size | 783,820 B | 772,740 B | −1.4% |
| ACE_ANIMATED size | 917,392 B | 675,332 B | **−26.4%** |
| ACE_ANIMATED triangles | 255,371 | 144,021 | **−43.6% (under 150k target)** |
| ACE_ANIMATED warnings | 3 | **0** | resolved |

---

## 2. What was changed (clean / optimize / repair only — no redesign)

1. **ACE_MASTER.glb removed.** The source was a 132-byte empty scene (0 meshes). It
   is excluded from the repo and from production; see `.gitignore`. It is not a
   usable asset and must not be deployed.

2. **`NODE_SKINNED_MESH_NON_ROOT` (×3) resolved** in the animated model. The three
   skinned mesh nodes (`ACE_ANIM_Head`, `ACE_ANIM_Connections`, `ACE_ANIM_Nodes`)
   were reparented to the scene root with identity transforms, so parent transforms
   can no longer be silently ignored. Skinning is unaffected — deformation is driven
   by the skin's joints and inverse-bind matrices, which are untouched.

3. **All 4 animation clips preserved**, full fidelity, all 18 channels each:
   `ACE_Idle`, `ACE_Listening`, `ACE_Thinking`, `ACE_Speaking` (~4.17 s each).
   Verified that every channel targets skeleton joints only (`root, neck, head, jaw,
   eye_L, eye_R`) — none target the reparented mesh nodes, so motion is identical.

4. **Unused `TEXCOORD_0` attributes removed** (3 per file) plus all orphan accessors
   and bufferViews pruned. No material samples a texture, so UVs were dead weight.

5. **Mobile cost reduced:**
   - `doubleSided` disabled on `NodeMat`, `EyeMat`, `ConnMat` (closed/solid
     geometry — backfaces never visible, so culling them is visually identical and
     halves fragment/cull cost).
   - `doubleSided` **kept** on `ChipMat` (drives the flat Label + 2-tri chip body —
     must remain visible from both sides) and on `HeadMat`.
   - **HeadMat transparency kept.** Its base color alpha is **0.18** (`BLEND`) — the
     translucent glass head showing the glowing internals is core to ACE's identity,
     so it was preserved exactly (double-sided retained so the back shell still reads
     through the front).
   - Animated model decimated **255,371 → 144,021 triangles** (meshoptimizer,
     ratio 0.45, error 0.8% of AABB, border-locked to prevent holes). Skinning
     weights are preserved through simplification.

6. **Draco kept** (not meshopt). The assets were authored with Draco and it is listed
   in `extensionsRequired`; for this geometry-only model Draco remains compact and is
   the established pipeline, so it was re-encoded rather than swapped.

7. **GPU optimizations:** mesh dedup (the two identical eye meshes now share one
   buffer, referenced by both eye nodes) and vertex-cache reorder (meshoptimizer).

---

## 3. The remaining "infos" are expected and must not be "fixed"

The validator reports `UNUSED_OBJECT` on several bufferViews/accessors and
`UNSUPPORTED_EXTENSION` on Draco / `EXT_mesh_gpu_instancing`. These are **false
positives**: the validator does not parse those extensions, so it cannot see that the
flagged bufferViews **hold the actual Draco-compressed geometry and the instancing
transforms**. Deleting them would destroy the mesh. `0 errors / 0 warnings` is the
clean production state for a Draco asset.

---

## 4. Runtime compatibility

| Target | Status | Notes |
|---|---|---|
| **React Three Fiber** | ✅ Scaffolded & build-verified | `design_handoff_ace_avatar` loads the GLB via `useGLTF` with a **self-hosted** Draco decoder (`/public/draco`). 4 clips wired with crossfade. |
| **Three.js** | ✅ r155+ | `GLTFLoader` + `DRACOLoader`; `KHR_materials_emissive_strength` (r151+) and `EXT_mesh_gpu_instancing` (r155+) supported. |
| **Electron** | ✅ Offline-safe | Decoder + models are bundled into the build (no CDN). `vite base: "./"` keeps paths working under custom/file protocols. |
| **Mobile (WebGL2)** | ✅ Improved | No textures (low VRAM); 144k tris is within mid-range mobile budget; backface culling restored on the heavy opaque meshes; `dpr` capped at 2. One-time Draco WASM decode at load. |

---

## 5. Files

```
assets/source/        ACE_EXPORT.glb, ACE_ANIMATED.glb        (originals, provenance)
assets/production/     ACE_EXPORT_PRODUCTION.glb               (cleaned, hero quality)
                       ACE_ANIMATED_PRODUCTION.glb             (cleaned + decimated + repaired)
reports/               this report + per-file validator JSON
scripts/optimize-ace.mjs   reproducible pipeline
design_handoff_ace_avatar/ R3F loader scaffold (public/models, public/draco)
```
