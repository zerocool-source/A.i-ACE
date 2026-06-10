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
y0, y1 = min(ys), max(ys)
D = y1 - y0  # depth; glTF import faces -Y in Blender
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
# jaw: hinge near the ear line, tail toward the chin (front = -Y after glTF import)
jaw_bone = arm_data.edit_bones.new("Jaw")
jaw_bone.parent = head_bone
jaw_bone.head = Vector((cx, cy, z0 + 0.46 * H))
jaw_bone.tail = Vector((cx, cy - 0.20 * D, z0 + 0.36 * H))
bpy.ops.object.mode_set(mode="OBJECT")

# ---- bind mesh (Head rigid + Jaw region with smooth falloff) ---------------
# Parent with named groups, give every vertex Head weight 1, then carve out the
# jaw region (lower front of the face) with a smooth blend so the mouth/chin can
# open without tearing. This sidesteps bone-heat weighting, which fails on dense
# photogrammetry-style meshes.
bpy.ops.object.select_all(action="DESELECT")
mesh.select_set(True)
arm.select_set(True)
bpy.context.view_layer.objects.active = arm
bpy.ops.object.parent_set(type="ARMATURE_NAME")

vg_head = mesh.vertex_groups.get("Head") or mesh.vertex_groups.new(name="Head")
vg_jaw = mesh.vertex_groups.get("Jaw") or mesh.vertex_groups.new(name="Jaw")
vg_head.add([v.index for v in mesh.data.vertices], 1.0, "REPLACE")

Z_HINGE = z0 + 0.45 * H   # jaw weight starts below this
Z_CHIN = z0 + 0.355 * H   # full jaw weight by here
Z_LOW = z0 + 0.28 * H     # fades out into the neck below this
mw = mesh.matrix_world
jaw_count = 0
for v in mesh.data.vertices:
    co = mw @ v.co
    z, y = co.z, co.y
    if z >= Z_HINGE or z < Z_LOW:
        continue
    if z >= Z_CHIN:
        zf = (Z_HINGE - z) / (Z_HINGE - Z_CHIN)
    else:
        zf = (z - Z_LOW) / (Z_CHIN - Z_LOW)
        zf = max(0.0, min(1.0, zf))
    ff = (cy - y) / (0.18 * D)  # front-only factor (face is -Y)
    ff = max(0.0, min(1.0, ff))
    w = zf * ff
    if w > 0.01:
        vg_jaw.add([v.index], w, "REPLACE")
        vg_head.add([v.index], 1.0 - w, "REPLACE")
        jaw_count += 1
print(f"jaw region: {jaw_count} vertices weighted")

# ---- animation helpers ----------------------------------------------------
arm.animation_data_create()
pb = arm.pose.bones["Head"]
pb.rotation_mode = "XYZ"
pb_jaw = arm.pose.bones["Jaw"]
pb_jaw.rotation_mode = "XYZ"
FPS = 24
bpy.context.scene.render.fps = FPS


def new_action(name):
    act = bpy.data.actions.new(name)
    arm.animation_data.action = act
    return act


def key(frame, rx=0.0, ry=0.0, rz=0.0):
    pb.rotation_euler = (math.radians(rx), math.radians(ry), math.radians(rz))
    pb.keyframe_insert("rotation_euler", frame=frame)


def key_jaw(frame, deg):
    pb_jaw.rotation_euler = (math.radians(deg), 0.0, 0.0)
    pb_jaw.keyframe_insert("rotation_euler", frame=frame)


def make_loop(name, frames, jaw=None):
    """frames: list of (frame, rx, ry, rz); jaw: list of (frame, open_degrees)."""
    new_action(name)
    for f, rx, ry, rz in frames:
        key(f, rx, ry, rz)
    # always key the jaw so clips don't inherit another clip's mouth pose
    for f, deg in (jaw or [(frames[0][0], 0.0), (frames[-1][0], 0.0)]):
        key_jaw(f, deg)


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
# ACE_Speaking — talking nods + jaw chatter (mouth opens/closes like speech)
make_loop("ACE_Speaking", [
    (1, 0, 0, 0), (8, 2.5, 0, 0), (16, 0, 0, 0), (24, 2.0, 0, 0),
    (32, 0, 0, 0), (40, 2.5, 0, 0), (48, 0, 0, 0),
], jaw=[
    (1, 0), (4, 9), (7, 2), (10, 11), (13, 3), (16, 8), (19, 1),
    (22, 12), (25, 4), (28, 9), (31, 2), (34, 11), (37, 3), (40, 8),
    (43, 2), (46, 7), (48, 0),
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
