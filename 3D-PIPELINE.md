# ACE — 3D avatar pipeline

ACE can have a real 3D head, not just the 2D neural face. There are **three ways**
to get a 3D model in, and they all converge on the same loader.

```
  (A) your rigged Blender build  ──┐
  (B) Meshy API (image/text→3D)  ──┼──►  optimize  ──►  GLB in            ──►  R3F loader
  (C) the GLBs already in repo   ──┘   (scripts/      design_handoff_       (design_handoff_
                                        optimize-ace)  ace_avatar/public/    ace_avatar/src/three)
                                                       models/
```

The loader (`design_handoff_ace_avatar/src/three/AceModel.tsx`) crossfades between
behavioural states (idle / listening / thinking / speaking) and now **resolves clip
names fuzzily** — your Blender actions can be named anything containing "idle",
"listen", "think", or "speak" (case-insensitive) and they'll drive the avatar
without re-baking. If it can't match, it plays the first clip in the file.

---

## (A) Your rigged + animated Blender build  ⭐ best

A real rig with animation clips is the highest-quality source. I can't open `.blend`
files or reach your Desktop — export a **GLB** from Blender and bring that in.

### Export from Blender
1. Open `ACE_MASTER.glb.blend`.
2. Select the Armature + meshes (or just have nothing hidden).
3. **File → Export → glTF 2.0 (.glb/.gltf)**.
4. In the export panel (right side):
   - **Format:** `glTF Binary (.glb)`
   - **Include → Limit to:** *Selected Objects* off (export everything) — or select your rig.
   - **Include → Animation:** ✅ (and ✅ *Animation*, *Shape Keys*, *Skinning*).
   - Under **Animation → Animation mode:** `Actions` (exports each action as a clip),
     and enable **NLA Strips** if your clips live in the NLA editor.
   - **Transform:** `+Y Up` (default) is correct for three.js.
   - **Apply Modifiers:** ✅.
5. Save as **`ACE_ANIMATED.glb`**.

> Tip: name your actions `Idle`, `Listening`, `Thinking`, `Speaking` (or anything
> containing those words) so the loader maps them to ACE's states automatically.

### Bring it into the repo
Pick whichever is easiest:
- **Attach it in chat** — drag `ACE_ANIMATED.glb` into the conversation and I'll
  drop it in `assets/source/` and run the pipeline.
- **Or commit it yourself** to `assets/source/ACE_ANIMATED.glb` and push.

### Optimize → production GLBs (already built)
The repo's deterministic pipeline cleans, repairs the skinned hierarchy, decimates,
and Draco-compresses, emitting the files the loader reads:

```bash
# from repo root
npm install @gltf-transform/core @gltf-transform/extensions @gltf-transform/functions \
            draco3dgltf meshoptimizer
node scripts/optimize-ace.mjs     # → assets/production/ACE_ANIMATED_PRODUCTION.glb
node scripts/make-mobile-lod.mjs  # → assets/production/ACE_ANIMATED_MOBILE.glb
```

Then copy the production GLBs into `design_handoff_ace_avatar/public/models/` (same
filenames the loader already expects) and run the 3D app:

```bash
cd design_handoff_ace_avatar && npm install && npm run dev   # /ace-3d.html
```

> Note: the repo's original `ACE_MASTER.glb` was an empty 132-byte scene and is
> git-ignored. Your rigged build is the real thing — it supersedes that.

---

## (B) Meshy API (image-to-3D / text-to-3D)

Turn ACE's 2D neural face into a 3D head, or generate from a prompt.
Script: `ace-app/scripts/meshy-generate.mjs` (no deps; needs a Meshy key + credits).

```bash
# image-to-3D from the avatar PNG (default)
MESHY_API_KEY=msy-... node ace-app/scripts/meshy-generate.mjs

# text-to-3D
MESHY_API_KEY=msy-... node ace-app/scripts/meshy-generate.mjs \
  --text "a glowing holographic AI head, neural wireframe, dark blue, symmetrical"
```

Options: `--image <path>`, `--out <path>`, `--pose t-pose|a-pose`,
`--polycount <n>`, `--lowpoly`, `--no-texture`, `--pbr`. The script submits the job,
polls with a progress bar, and downloads the GLB. Get a key at
<https://www.meshy.ai> (Settings → API). Feed the result through the same
`optimize-ace.mjs` pipeline before loading.

> Meshy output is unrigged (static geometry). For animation, use it as a base mesh
> and rig in Blender, or stick with source (A) for animated clips.

---

## (C) GLBs already in the repo

`assets/production/` already ships cleaned, validated, Draco-compressed models
(`ACE_EXPORT_PRODUCTION.glb`, `ACE_ANIMATED_PRODUCTION.glb`, + mobile LODs). The R3F
loader uses these today. See the root `README.md` for the validation report.

---

## Rigging the head — what works

A head needs a **skeletal/facial rig** to truly animate (jaw, blinks, visemes).

- **Meshy auto-rig does NOT work here.** Meshy's rigging API (`POST /openapi/v1/rigging`)
  only rigs **textured full humanoid/biped** models and **explicitly rejects head-only
  models**. So it can't rig the ACE head. (It's an option only if you want a *full body*.)
- **Blender is the path** — rig the head's mesh with an armature + shape keys, or use
  your existing `ACE_MASTER.glb.blend` rig, then export an animated GLB (source A).
  - **Fastest:** run `ace-app/scripts/blender_rig_ace.py` in Blender 4.x — it
    auto-rigs the head (single Head deform bone, automatic weights) and bakes the
    four clips the loader expects, then exports an animated GLB:
    ```bash
    blender --background --python ace-app/scripts/blender_rig_ace.py -- \
        --in ace-app/app/assets/ace-3d/ace.glb \
        --out ace-app/app/assets/ace-3d/ace_rigged.glb
    ```
    Drop the result into `design_handoff_ace_avatar/public/models/` and the R3F
    loader plays `ACE_Idle / ACE_Listening / ACE_Thinking / ACE_Speaking`. Add a
    jaw/viseme pass later for real lip-sync.
- **Right now** the `viewer3d` shows the head animated **procedurally** (breathing,
  sway, glow pulse, speaking particle stream) — no bones, but a live talking head.

### Driving Blender / Meshy via MCP (optional, powerful)
If you enable these MCP servers in your Claude client, an agent can drive the tools
directly instead of you doing it by hand:

- **Blender MCP** (`blender-mcp`, ahujasid/blender-mcp) — exposes Blender to Claude:
  create/modify objects, add armatures, run Python in Blender, export GLB. With this
  connected, the head can be rigged in-session. You install the addon + MCP server;
  the agent then issues the rig/export steps.
- **Meshy MCP** — wraps the Meshy API (text/image→3D, and rigging *for humanoids*) as
  MCP tools. Useful for generation; same head-only rigging limit applies.

These run on **your** machine and connect to your Claude client — they can't be
enabled from inside this cloud session. MCP servers attach per-client: enabling the
Blender MCP in your *desktop* Claude does **not** expose it to this cloud session
(they're separate), and a cloud server can't reach your local Blender regardless. So:
- to drive Blender live, run it from the **desktop** Claude session where the MCP is
  connected, or
- run `scripts/blender_rig_ace.py` yourself (no MCP needed) and bring the rigged GLB
  back here for optimizing + wiring.

## Which to use

| Source | Rig + animation | Effort | Best for |
|---|---|---|---|
| **(A) Blender build** | ✅ real clips | export + optimize | the production avatar |
| (B) Meshy | ❌ static | one command | quick 3D from the face / prompts |
| (C) repo GLBs | ✅ 4 clips | none | works right now |

Recommended: **(A)** — send me the exported `ACE_ANIMATED.glb` and I'll run the
optimize pipeline and wire it into the loader.
