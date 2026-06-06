# A.i-ACE

Production-ready 3D assets and a React Three Fiber loader for the **ACE** neural
avatar.

## Layout

```
assets/
  source/        ACE_EXPORT.glb, ACE_ANIMATED.glb   — original Blender exports (provenance)
  production/    ACE_EXPORT_PRODUCTION.glb           — cleaned static hero mesh
                 ACE_ANIMATED_PRODUCTION.glb         — cleaned + repaired + decimated, 4 clips
reports/         PRODUCTION_VALIDATION_REPORT.md + per-file Khronos validator JSON
scripts/         optimize-ace.mjs                    — reproducible optimization pipeline
design_handoff_ace_avatar/                           — React/Vite app + R3F loader scaffold
```

> **ACE_MASTER.glb** from the original drop was an empty 132-byte scene (0 meshes) and
> is intentionally excluded (see `.gitignore`). It is not a deployable asset.

## Production assets at a glance

| File | Size | Triangles | Clips | Validator |
|---|---|---|---|---|
| ACE_EXPORT_PRODUCTION.glb | 754.6 KB | 186,551 | — | 0 errors / 0 warnings |
| ACE_ANIMATED_PRODUCTION.glb | 659.5 KB | 144,021 | 4 | 0 errors / 0 warnings |

Both are Draco-compressed (`KHR_draco_mesh_compression`), use
`KHR_materials_emissive_strength`, and carry no textures. The remaining validator
`info` notices are benign Draco/instancing artifacts — see the report.

## Reproduce the optimization

The pipeline is deterministic. From the repo root:

```bash
npm install @gltf-transform/core @gltf-transform/extensions @gltf-transform/functions \
            draco3dgltf meshoptimizer
node scripts/optimize-ace.mjs        # reads assets/source/*, writes assets/production/*
```

It removes dead UVs/orphans, repairs the skinned-mesh hierarchy, prunes + reorders,
disables back-face rendering on solid meshes, decimates the animated mesh under 150k
triangles, and re-applies Draco. See `reports/PRODUCTION_VALIDATION_REPORT.md` for the
full rationale and before/after numbers.

## Run the avatar app

```bash
cd design_handoff_ace_avatar
npm install
npm run dev      # /index.html = 2D avatar, /ace-3d.html = 3D R3F avatar
```
