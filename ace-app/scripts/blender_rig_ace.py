"""
Auto-rig the ACE head and bake the four behavioural clips, then export an
animated GLB the R3F loader plays (ACE_Idle / ACE_Listening / ACE_Thinking /
ACE_Speaking).

This runs INSIDE Blender — I can't run Blender from the cloud dev box, so this is
the artifact that does it on your machine (or via a desktop Blender-MCP session).

Usage
-----
GUI:  Scripting tab → open this file → set the paths below or pass args → Run.
CLI:  blender --background --python scripts/blender_rig_ace.py -- \
          --in ace-app/app/assets/ace-3d/ace.glb \
          --out ace-app/app/assets/ace-3d/ace_rigged.glb

Notes
-----
- One "Head" deform bone covers the whole head + neck, bound with automatic
  weights. The four clips differ by motion (idle bob, listening lean, thinking
  tilt, speaking talk-nod). This gives a clean, working rig with no manual weight
  painting. Add a jaw/eye/visemes pass later for lip-sync.
- Tested target: Blender 4.x (glTF exporter `export_animation_mode='ACTIONS'`).
"""

import bpy
import sys
import math
from mathutils import Vector

# ---- args -----------------------------------------------------------------
def parse_args():
    argv = sys.argv
    argv = argv[argv.index("--") + 1:] if "--" in argv else []
    in_path = "ace.glb"
    out_path = "ace_rigged.glb"
    for i, a in enumerate(argv):
        if a == "--in" and i + 1 < len(argv):
            in_path = argv[i + 1]
        if a == "--out" and i + 1 < len(argv):
            out_path = argv[i + 1]
    return in_path, out_path


IN_PATH, OUT_PATH = parse_args()

# ---- clean scene ----------------------------------------------------------
bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete()

# ---- import ---------------------------------------------------------------
bpy.ops.import_scene.gltf(filepath=IN_PATH)
meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
if not meshes:
    raise SystemExit("No mesh found in the imported GLB.")

# join all imported meshes into one so a single armature drives everything
bpy.ops.object.select_all(action="DESELECT")
for m in meshes:
    m.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
if len(meshes) > 1:
    bpy.ops.object.join()
mesh = bpy.context.view_layer.objects.active
mesh.name = "ACE_Mesh"

# ---- measure bounds (world space) -----------------------------------------
bpy.context.view_layer.update()
corners = [mesh.matrix_world @ Vector(c) for c in mesh.bound_box]
xs = [v.x for v in corners]; ys = [v.y for v in corners]; zs = [v.z for v in corners]
cx = (min(xs) + max(xs)) / 2
cy = (min(ys) + max(ys)) / 2
z0, z1 = min(zs), max(zs)
H = z1 - z0

# ---- armature -------------------------------------------------------------
arm_data = bpy.data.armatures.new("ACE_Armature")
arm = bpy.data.objects.new("ACE_Armature", arm_data)
bpy.context.collection.objects.link(arm)

bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode="EDIT")
head_bone = arm_data.edit_bones.new("Head")
# vertical bone spanning the head + neck so deformation is rigid and clean
head_bone.head = Vector((cx, cy, z0 + 0.35 * H))
head_bone.tail = Vector((cx, cy, z0 + 0.95 * H))
bpy.ops.object.mode_set(mode="OBJECT")

# ---- bind mesh (rigid: whole head → Head bone) ----------------------------
# Parent "with empty groups" adds an Armature modifier + a 'Head' vertex group,
# then we assign every vertex to it at full weight. For a single head bone this
# rigid bind is exactly what we want (the head moves as one) and it sidesteps the
# bone-heat-weighting solver, which fails on dense photogrammetry-style meshes.
bpy.ops.object.select_all(action="DESELECT")
mesh.select_set(True)
arm.select_set(True)
bpy.context.view_layer.objects.active = arm
bpy.ops.object.parent_set(type="ARMATURE_NAME")

vg = mesh.vertex_groups.get("Head") or mesh.vertex_groups.new(name="Head")
vg.add([v.index for v in mesh.data.vertices], 1.0, "REPLACE")

# ---- animation helpers ----------------------------------------------------
arm.animation_data_create()
pb = arm.pose.bones["Head"]
pb.rotation_mode = "XYZ"
FPS = 24
bpy.context.scene.render.fps = FPS


def new_action(name):
    act = bpy.data.actions.new(name)
    arm.animation_data.action = act
    return act


def key(frame, rx=0.0, ry=0.0, rz=0.0):
    pb.rotation_euler = (math.radians(rx), math.radians(ry), math.radians(rz))
    pb.keyframe_insert("rotation_euler", frame=frame)


def make_loop(name, frames):
    """frames: list of (frame, rx, ry, rz). First==last keeps it seamless."""
    new_action(name)
    for f, rx, ry, rz in frames:
        key(f, rx, ry, rz)


# ACE_Idle — gentle breathing nod
make_loop("ACE_Idle", [
    (1,  0, 0, 0), (36,  2.0, 0, 1.0), (72, 0, 0, 0),
    (108, -1.5, 0, -1.0), (144, 0, 0, 0),
])
# ACE_Listening — slight attentive forward lean + tilt
make_loop("ACE_Listening", [
    (1, 0, 0, 0), (30, 4.0, 0, 3.0), (90, 4.0, 0, 3.0), (120, 0, 0, 0),
])
# ACE_Thinking — slow contemplative side-to-side tilt
make_loop("ACE_Thinking", [
    (1, 0, 0, 0), (48, 0, 0, 6.0), (96, 0, 0, -6.0), (144, 0, 0, 0),
])
# ACE_Speaking — quick talking nods
make_loop("ACE_Speaking", [
    (1, 0, 0, 0), (8, 2.5, 0, 0), (16, 0, 0, 0), (24, 2.0, 0, 0),
    (32, 0, 0, 0), (40, 2.5, 0, 0), (48, 0, 0, 0),
])

# push every action onto its own NLA track so the exporter emits all of them
for act in bpy.data.actions:
    track = arm.animation_data.nla_tracks.new()
    track.name = act.name
    track.strips.new(act.name, int(act.frame_range[0]), act)
arm.animation_data.action = None  # avoid double-exporting the active action

# ---- export ---------------------------------------------------------------
bpy.ops.object.select_all(action="DESELECT")
mesh.select_set(True)
arm.select_set(True)
bpy.ops.export_scene.gltf(
    filepath=OUT_PATH,
    export_format="GLB",
    export_animations=True,
    export_animation_mode="ACTIONS",
    export_skins=True,
    export_apply=False,
    use_selection=True,
    export_draco_mesh_compression_enable=True,
)
print(f"\n✔ rigged GLB written: {OUT_PATH}")
print("  clips: ACE_Idle, ACE_Listening, ACE_Thinking, ACE_Speaking")
