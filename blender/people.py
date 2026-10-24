"""Rigged, animated stylised person used for every customer, guest and staff member.

The game clones this one skinned character many times (SkeletonUtils.clone), recolours the
Skin / Shirt / Pants / Hair / Shoes materials per person and toggles accessory meshes:
  hair_short, hair_long, hair_bun, hair_curly, hat_beanie, hat_cap, glasses, beard, apron
Animations (NLA tracks -> glTF animations): Idle, Walk, Sit, Wave, Talk, CarryWalk, CarryIdle
Blender space here (Z up, character faces -Y); glTF export turns that into +Z facing in three.js.
"""
import math

import bmesh
import bpy
from mathutils import Euler, Matrix, Vector

from lib import mat, rgb, text

BONES = {
    # name: (head, tail, parent)
    "hips": ((0, 0, 0.92), (0, 0, 1.02), None),
    "spine": ((0, 0, 1.02), (0, 0, 1.22), "hips"),
    "chest": ((0, 0, 1.22), (0, 0, 1.42), "spine"),
    "neck": ((0, 0, 1.42), (0, 0, 1.5), "chest"),
    "head": ((0, 0, 1.5), (0, 0, 1.8), "neck"),
    "upperarm_L": ((0.235, 0, 1.37), (0.255, 0, 1.12), "chest"),
    "forearm_L": ((0.255, 0, 1.12), (0.265, 0, 0.88), "upperarm_L"),
    "upperarm_R": ((-0.235, 0, 1.37), (-0.255, 0, 1.12), "chest"),
    "forearm_R": ((-0.255, 0, 1.12), (-0.265, 0, 0.88), "upperarm_R"),
    "thigh_L": ((0.1, 0, 0.9), (0.1, 0, 0.48), "hips"),
    "shin_L": ((0.1, 0, 0.48), (0.1, 0, 0.08), "thigh_L"),
    "thigh_R": ((-0.1, 0, 0.9), (-0.1, 0, 0.48), "hips"),
    "shin_R": ((-0.1, 0, 0.48), (-0.1, 0, 0.08), "thigh_R"),
}


def _obj(name, bm, material, groups, smooth=True):
    """groups: callable(co) -> list[(bone, weight)] or a bone name."""
    me = bpy.data.meshes.new(name)
    if smooth:
        for f in bm.faces:
            f.smooth = True
    bm.to_mesh(me)
    bm.free()
    me.materials.append(material)
    o = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(o)
    for v in me.vertices:
        assign = [(groups, 1.0)] if isinstance(groups, str) else groups(v.co)
        for bone, w in assign:
            vg = o.vertex_groups.get(bone) or o.vertex_groups.new(name=bone)
            vg.add([v.index], w, "REPLACE")
    return o


def _sphere(r, center, scale=(1, 1, 1), segs=16, rings=10, cut_below=None, cut_above=None):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=segs, v_segments=rings, radius=r)
    bmesh.ops.scale(bm, vec=Vector(scale), verts=bm.verts)
    bmesh.ops.translate(bm, vec=Vector(center), verts=bm.verts)
    if cut_below is not None:
        bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.z < cut_below - 1e-4], context="VERTS")
    if cut_above is not None:
        bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.z > cut_above + 1e-4], context="VERTS")
    return bm


def _limb(a, b, r1, r2, segs=12):
    a, b = Vector(a), Vector(b)
    d = b - a
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=segs, radius1=r1, radius2=r2, depth=d.length)
    q = Vector((0, 0, 1)).rotation_difference(d.normalized())
    bmesh.ops.rotate(bm, cent=(0, 0, 0), matrix=q.to_matrix(), verts=bm.verts)
    bmesh.ops.translate(bm, vec=(a + b) / 2, verts=bm.verts)
    return bm


def _box(center, size, bevel=0.02):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=Vector(size), verts=bm.verts)
    if bevel:
        bmesh.ops.bevel(bm, geom=list(bm.edges), offset=bevel, segments=3, affect="EDGES", profile=0.5)
    bmesh.ops.translate(bm, vec=Vector(center), verts=bm.verts)
    return bm


def torso_weights(co):
    z = co.z
    if z < 1.0:
        return [("hips", 1.0)]
    if z < 1.1:
        t = (z - 1.0) / 0.1
        return [("hips", 1 - t), ("spine", t)]
    if z < 1.24:
        return [("spine", 1.0)]
    if z < 1.32:
        t = (z - 1.24) / 0.08
        return [("spine", 1 - t), ("chest", t)]
    return [("chest", 1.0)]


def build_mesh(M):
    parts = []
    # Torso (shirt) + pelvis (pants)
    parts.append(_obj("torso", _sphere(1.0, (0, 0, 1.17), (0.205, 0.135, 0.27), 20, 14), M["Shirt"], torso_weights))
    parts.append(_obj("pelvis", _sphere(1.0, (0, 0, 0.93), (0.18, 0.125, 0.12), 18, 10), M["Pants"], torso_weights))
    # Legs
    for side, sx in (("L", 1), ("R", -1)):
        parts.append(_obj(f"thigh{side}", _limb((sx * 0.1, 0, 0.95), (sx * 0.1, 0, 0.47), 0.078, 0.066), M["Pants"],
                          f"thigh_{side}"))
        parts.append(_obj(f"shin{side}", _limb((sx * 0.1, 0, 0.49), (sx * 0.1, 0, 0.09), 0.064, 0.052), M["Pants"],
                          f"shin_{side}"))
        parts.append(_obj(f"shoe{side}", _box((sx * 0.1, -0.035, 0.05), (0.115, 0.25, 0.1), 0.04), M["Shoes"],
                          f"shin_{side}"))
        # Arms: sleeve, forearm, hand
        sh = Vector((sx * 0.235, 0, 1.37))
        el = Vector((sx * 0.255, 0, 1.12))
        wr = Vector((sx * 0.265, 0, 0.88))
        parts.append(_obj(f"sleeve{side}", _limb(sh + Vector((0, 0, 0.03)), el, 0.062, 0.05), M["Shirt"],
                          f"upperarm_{side}"))
        parts.append(_obj(f"shoulder{side}", _sphere(0.064, sh + Vector((0, 0, 0.02)), segs=12, rings=8), M["Shirt"],
                          f"upperarm_{side}"))
        parts.append(_obj(f"forearm{side}", _limb(el, wr, 0.043, 0.036), M["Skin"], f"forearm_{side}"))
        parts.append(_obj(f"hand{side}", _sphere(0.048, wr + Vector((0, 0, -0.035)), (0.9, 0.7, 1.15), 12, 8),
                          M["Skin"], f"forearm_{side}"))
    # Neck + head
    parts.append(_obj("neck", _limb((0, 0, 1.38), (0, 0, 1.52), 0.052, 0.05), M["Skin"], "neck"))
    parts.append(_obj("head", _sphere(0.155, (0, 0, 1.64), (1.0, 0.95, 1.05), 20, 14), M["Skin"], "head"))
    parts.append(_obj("nose", _sphere(0.026, (0, -0.15, 1.615), (1, 0.8, 1.1), 10, 6), M["Skin"], "head"))
    for sx in (1, -1):
        parts.append(_obj(f"ear{sx}", _sphere(0.03, (sx * 0.152, 0.0, 1.63), (0.6, 1, 1.2), 10, 6), M["Skin"], "head"))
        parts.append(_obj(f"eye{sx}", _sphere(0.02, (sx * 0.055, -0.133, 1.66), (1, 0.6, 1.25), 10, 6), M["Eyes"],
                          "head"))
        parts.append(_obj(f"brow{sx}", _box((sx * 0.056, -0.142, 1.705), (0.05, 0.012, 0.012), 0.004), M["Hair"],
                          "head", False))
    parts.append(_obj("mouth", _box((0, -0.143, 1.575), (0.045, 0.01, 0.008), 0.003), M["Eyes"], "head", False))
    body = join_objs(parts, "body")
    return body


def accessories(M):
    acc = {}
    cap = lambda r=0.162, cut=1.6, center=(0, 0.008, 1.645), sc=(1.0, 1.0, 0.98): _sphere(r, center, sc, 20, 14,
                                                                                           cut_below=cut)
    acc["hair_short"] = _obj("hair_short", cap(), M["Hair"], "head")
    long_parts = [_obj("hl_top", cap(), M["Hair"], "head"),
                  _obj("hl_back", _box((0, 0.07, 1.5), (0.31, 0.12, 0.34), 0.05), M["Hair"], "head")]
    acc["hair_long"] = join_objs(long_parts, "hair_long")
    bun = [_obj("hb_top", cap(), M["Hair"], "head"),
           _obj("hb_bun", _sphere(0.07, (0, 0.09, 1.8), segs=12, rings=8), M["Hair"], "head")]
    acc["hair_bun"] = join_objs(bun, "hair_bun")
    curly = [_obj("hc_top", cap(0.165), M["Hair"], "head")]
    for i in range(16):
        a = i / 16 * math.tau
        rr = 0.13 + (i % 2) * 0.02
        z = 1.7 + (i % 3) * 0.03
        curly.append(_obj(f"hc{i}", _sphere(0.055, (math.sin(a) * rr, math.cos(a) * rr * 0.9 + 0.01, z), segs=8, rings=6),
                          M["Hair"], "head"))
    acc["hair_curly"] = join_objs(curly, "hair_curly")
    beanie = [_obj("bn_top", _sphere(0.17, (0, 0.005, 1.66), (1, 1, 1.05), 20, 12, cut_below=1.64), M["Hat"], "head"),
              _obj("bn_band", _limb((0, 0.005, 1.63), (0, 0.005, 1.69), 0.172, 0.172, 20), M["Hat"], "head"),
              _obj("bn_pom", _sphere(0.04, (0, 0.0, 1.84), segs=10, rings=6), M["Hat"], "head")]
    acc["hat_beanie"] = join_objs(beanie, "hat_beanie")
    capp = [_obj("cp_top", _sphere(0.166, (0, 0.005, 1.66), (1, 1, 0.95), 20, 12, cut_below=1.66), M["Hat"], "head"),
            _obj("cp_visor", _box((0, -0.19, 1.665), (0.24, 0.14, 0.015), 0.006), M["Hat"], "head")]
    acc["hat_cap"] = join_objs(capp, "hat_cap")
    gl = []
    for sx in (1, -1):
        bm = bmesh.new()
        bmesh.ops.create_circle(bm, cap_ends=False, segments=14, radius=0.035)
        bmesh.ops.rotate(bm, cent=(0, 0, 0), matrix=Matrix.Rotation(math.pi / 2, 3, "X"), verts=bm.verts)
        ring = bmesh.ops.extrude_edge_only(bm, edges=list(bm.edges))
        bmesh.ops.scale(bm, vec=(0.75, 1, 0.75), verts=[v for v in ring["geom"] if isinstance(v, bmesh.types.BMVert)])
        bmesh.ops.translate(bm, vec=(sx * 0.058, -0.155, 1.66), verts=bm.verts)
        gl.append(_obj(f"gl{sx}", bm, M["Glasses"], "head", False))
    gl.append(_obj("gl_bridge", _box((0, -0.155, 1.665), (0.04, 0.008, 0.008), 0.002), M["Glasses"], "head", False))
    acc["glasses"] = join_objs(gl, "glasses")
    acc["beard"] = _obj("beard", _sphere(0.152, (0, -0.016, 1.615), (1.02, 1.0, 0.95), 20, 14, cut_above=1.562),
                        M["Hair"], "head")
    apron = _obj("apron", _box((0, -0.125, 0.98), (0.34, 0.04, 0.6), 0.02), M["Apron"], torso_weights)
    acc["apron"] = apron
    return acc


def join_objs(objs, name):
    target = objs[0]
    if len(objs) > 1:
        with bpy.context.temp_override(active_object=target, object=target, selected_objects=objs,
                                       selected_editable_objects=objs):
            bpy.ops.object.join()
    target.name = name
    target.data.name = name
    return target


def make_armature():
    arm_data = bpy.data.armatures.new("PersonRig")
    arm = bpy.data.objects.new("Person", arm_data)
    bpy.context.scene.collection.objects.link(arm)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="EDIT")
    for name, (h, t, parent) in BONES.items():
        b = arm_data.edit_bones.new(name)
        b.head, b.tail = Vector(h), Vector(t)
        b.roll = 0
        if parent:
            b.parent = arm_data.edit_bones[parent]
            b.use_connect = False
    bpy.ops.object.mode_set(mode="OBJECT")
    return arm


def skin(obj, arm):
    obj.parent = arm
    mod = obj.modifiers.new("Armature", "ARMATURE")
    mod.object = arm


# ----------------------------------------------------------------------------
# Animation helpers: rotations are given in armature space (rest frame) degrees
# Character faces -Y. -X rotation swings a hanging limb forward; +X bends a knee back.
# ----------------------------------------------------------------------------

def set_rot(arm, bone, x=0.0, y=0.0, z=0.0):
    pb = arm.pose.bones[bone]
    rest = arm.data.bones[bone].matrix_local.to_3x3()
    R = Euler((math.radians(x), math.radians(y), math.radians(z)), "XYZ").to_matrix()
    local = rest.inverted() @ R @ rest
    pb.rotation_mode = "QUATERNION"
    pb.rotation_quaternion = local.to_quaternion()


def set_loc(arm, bone, x=0.0, y=0.0, z=0.0):
    """Translate a bone in armature space."""
    pb = arm.pose.bones[bone]
    rest = arm.data.bones[bone].matrix_local.to_3x3()
    pb.location = rest.inverted() @ Vector((x, y, z))


def key_all(arm, frame):
    for pb in arm.pose.bones:
        pb.keyframe_insert("rotation_quaternion", frame=frame)
        pb.keyframe_insert("location", frame=frame)


def reset_pose(arm):
    for pb in arm.pose.bones:
        pb.rotation_mode = "QUATERNION"
        pb.rotation_quaternion = (1, 0, 0, 0)
        pb.location = (0, 0, 0)


def new_action(arm, name, keys):
    """keys: list of (frame, fn(arm)) — each fn poses the rig from rest."""
    act = bpy.data.actions.new(name)
    arm.animation_data_create()
    arm.animation_data.action = act
    for frame, fn in keys:
        reset_pose(arm)
        fn(arm)
        key_all(arm, frame)
    track = arm.animation_data.nla_tracks.new()
    track.name = name
    strip = track.strips.new(name, int(keys[0][0]), act)
    strip.name = name
    track.mute = False
    arm.animation_data.action = None
    reset_pose(arm)
    return act


def walk_legs(arm, phase, stride=24, knee=38, arms=True, bob=True):
    """phase 0..1 through one step cycle."""
    s = math.sin(phase * math.tau)
    c = math.cos(phase * math.tau)
    set_rot(arm, "thigh_L", -stride * s)
    set_rot(arm, "thigh_R", stride * s)
    # knees bend while the leg swings forward
    set_rot(arm, "shin_L", 6 + knee * max(0.0, c))
    set_rot(arm, "shin_R", 6 + knee * max(0.0, -c))
    if arms:
        set_rot(arm, "upperarm_L", stride * 0.8 * s, 0, 0)
        set_rot(arm, "upperarm_R", -stride * 0.8 * s, 0, 0)
        set_rot(arm, "forearm_L", -18 - 8 * max(0, -s))
        set_rot(arm, "forearm_R", -18 - 8 * max(0, s))
    if bob:
        set_loc(arm, "hips", 0, 0, 0.025 * abs(math.cos(phase * math.tau)) - 0.02)
    set_rot(arm, "hips", 0, 0, 5 * s)
    set_rot(arm, "chest", -3, 0, -7 * s)


def animate(arm):
    fps = 24
    bpy.context.scene.render.fps = fps

    def idle(t):
        def f(a):
            set_rot(a, "chest", -2 * math.sin(t * math.tau), 0, 0)
            set_rot(a, "head", 2 * math.sin(t * math.tau), 0, 6 * math.sin(t * math.tau * 2 + 1))
            set_rot(a, "upperarm_L", 0, -6, 0)
            set_rot(a, "upperarm_R", 0, 6, 0)
            set_rot(a, "forearm_L", -8)
            set_rot(a, "forearm_R", -8)
        return f

    new_action(arm, "Idle", [(i * 12, idle(i / 4)) for i in range(5)])

    def walk(t):
        return lambda a: walk_legs(a, t)

    new_action(arm, "Walk", [(i * 3, walk(i / 8)) for i in range(9)])

    def sit(t):
        def f(a):
            set_loc(a, "hips", 0, 0.06, -0.39)
            set_rot(a, "thigh_L", -88, 0, 3)
            set_rot(a, "thigh_R", -88, 0, -3)
            set_rot(a, "shin_L", 88)
            set_rot(a, "shin_R", 88)
            set_rot(a, "spine", -4 + 2 * math.sin(t * math.tau))
            set_rot(a, "chest", 4)
            set_rot(a, "upperarm_L", -35, 8, 0)
            set_rot(a, "upperarm_R", -35, -8, 0)
            set_rot(a, "forearm_L", -45, -10, 0)
            set_rot(a, "forearm_R", -45, 10, 0)
            set_rot(a, "head", 3 * math.sin(t * math.tau), 0, 10 * math.sin(t * math.tau + 0.5))
        return f

    new_action(arm, "Sit", [(i * 18, sit(i / 4)) for i in range(5)])

    def wave(t):
        def f(a):
            set_rot(a, "upperarm_R", 0, 155, 0)
            set_rot(a, "forearm_R", 0, 25 * math.sin(t * math.tau * 2), 0)
            set_rot(a, "upperarm_L", 0, -6, 0)
            set_rot(a, "head", 0, 0, -8)
            set_rot(a, "chest", 0, -4, 0)
        return f

    new_action(arm, "Wave", [(i * 4, wave(i / 6)) for i in range(7)])

    def talk(t):
        def f(a):
            s = math.sin(t * math.tau)
            set_rot(a, "upperarm_R", -20 - 8 * s, -10, 0)
            set_rot(a, "forearm_R", -60 - 15 * s, 0, 0)
            set_rot(a, "upperarm_L", -8, 6, 0)
            set_rot(a, "forearm_L", -25 + 10 * s)
            set_rot(a, "head", 4 * math.sin(t * math.tau * 2), 0, 5 * s)
            set_rot(a, "chest", -2 * s, 0, 3 * s)
        return f

    new_action(arm, "Talk", [(i * 6, talk(i / 4)) for i in range(5)])

    def carry(a):
        set_rot(a, "upperarm_L", -38, 12, 0)
        set_rot(a, "upperarm_R", -38, -12, 0)
        set_rot(a, "forearm_L", -52, -20, 0)
        set_rot(a, "forearm_R", -52, 20, 0)

    def carry_walk(t):
        def f(a):
            walk_legs(a, t, 20, 30, arms=False)
            carry(a)
        return f

    new_action(arm, "CarryWalk", [(i * 3, carry_walk(i / 8)) for i in range(9)])

    def carry_idle(t):
        def f(a):
            carry(a)
            set_rot(a, "chest", -1.5 * math.sin(t * math.tau))
        return f

    new_action(arm, "CarryIdle", [(i * 12, carry_idle(i / 4)) for i in range(5)])


def materials():
    return {
        "Skin": mat("Skin", "#e0ac84", 0.7),
        "Shirt": mat("Shirt", "#3f7a52", 0.85),
        "Pants": mat("Pants", "#2d3a52", 0.85),
        "Shoes": mat("Shoes", "#e8e4dc", 0.6),
        "Hair": mat("Hair", "#3a2618", 0.8),
        "Eyes": mat("Eyes", "#151515", 0.3),
        "Hat": mat("Hat", "#b8322f", 0.9),
        "Glasses": mat("Glasses", "#151515", 0.3, 0.4),
        "Apron": mat("Apron", "#1d4a2f", 0.85),
        "ApronText": mat("ApronText", "#e9d9a8", 0.6),
    }


def build():
    M = materials()
    arm = make_armature()
    body = build_mesh(M)
    acc = accessories(M)
    # Apron logo
    logo = text("apron_logo", "KRONKEL", (0, 1.06, 0.147), 0.055, M["ApronText"], 0.0)
    logo_bm = bmesh.new()
    logo_bm.from_mesh(logo.data)
    logo_obj = _obj("apron_logo2", logo_bm, M["ApronText"], torso_weights, False)
    bpy.data.objects.remove(logo)
    acc["apron"] = join_objs([acc["apron"], logo_obj], "apron")
    for o in [body] + list(acc.values()):
        skin(o, arm)
    animate(arm)
    return [arm, body] + list(acc.values())


def preview_lineup(path, samples=48):
    """Duplicate the rig a few times with different outfits for a showcase render."""
    from lib import render_preview, G
    arm = bpy.data.objects["Person"]
    meshes = [o for o in bpy.data.objects if o.parent == arm]
    looks = [
        dict(skin="#f1c7a3", shirt="#3f7a52", pants="#2d3a52", hair="#3a2618", acc=["hair_short", "apron"], pose="Idle",
             frame=0),
        dict(skin="#c68a5e", shirt="#d9772b", pants="#3b3b3b", hair="#1b1210", acc=["hair_curly"], pose="Wave", frame=6),
        dict(skin="#8a5a3c", shirt="#efe6cf", pants="#4a5d7a", hair="#151010", acc=["hat_beanie", "beard"],
             pose="Walk", frame=3, hat="#2f5b8f"),
        dict(skin="#f3d2b8", shirt="#b8322f", pants="#2a2a2a", hair="#d9b46a", acc=["hair_long", "glasses"],
             pose="Talk", frame=6),
        dict(skin="#e0ac84", shirt="#6b3f8f", pants="#5a4a3a", hair="#6b3a1e", acc=["hair_bun"], pose="Idle", frame=24),
        dict(skin="#b07a55", shirt="#2f5b8f", pants="#c9b38f", hair="#222", acc=["hat_cap"], pose="CarryIdle", frame=0,
             hat="#1d4a2f"),
    ]
    acc_names = ["hair_short", "hair_long", "hair_bun", "hair_curly", "hat_beanie", "hat_cap", "glasses", "beard",
                 "apron"]
    for i, look in enumerate(looks):
        a2 = arm.copy()
        a2.data = arm.data.copy()
        a2.animation_data_clear()
        bpy.context.scene.collection.objects.link(a2)
        a2.location = (-2.5 + i * 1.0, 0, 0)
        a2.rotation_euler = (0, 0, math.radians(-15 + i * 6))
        mats = {}
        for key, col in (("Skin", look["skin"]), ("Shirt", look["shirt"]), ("Pants", look["pants"]),
                         ("Hair", look["hair"]), ("Hat", look.get("hat", "#b8322f"))):
            m = bpy.data.materials[key].copy()
            m.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = rgb(col)
            mats[key] = m
        for o in meshes:
            if o.name in acc_names and o.name not in look["acc"]:
                continue
            o2 = o.copy()
            o2.data = o.data.copy()
            for si, slot in enumerate(o2.data.materials):
                base = slot.name.split(".")[0]
                if base in mats:
                    o2.data.materials[si] = mats[base]
            o2.parent = a2
            o2.modifiers["Armature"].object = a2
            bpy.context.scene.collection.objects.link(o2)
        act = bpy.data.actions[look["pose"]]
        a2.animation_data_create()
        a2.animation_data.action = act
        try:
            a2.animation_data.action_slot = act.slots[0]
        except Exception:
            pass
        bpy.context.scene.frame_set(look["frame"])
        bpy.context.view_layer.update()
        # Freeze this pose so every copy can show a different animation frame
        frozen = {pb.name: (pb.rotation_quaternion.copy(), pb.location.copy()) for pb in a2.pose.bones}
        a2.animation_data.action = None
        for pb in a2.pose.bones:
            pb.rotation_quaternion, pb.location = frozen[pb.name]
    # Hide the original
    arm.hide_render = True
    for o in meshes:
        o.hide_render = True
    floor = bpy.data.objects.new("floor", bpy.data.meshes.new("floor"))
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=8)
    bm.to_mesh(floor.data)
    floor.data.materials.append(mat("PreviewFloor", "#6b4a33", 0.8))
    bpy.context.scene.collection.objects.link(floor)
    render_preview(path, (0.0, 1.3, 6.6), (0.0, 0.9, 0.0), 38, size=(1280, 640), samples=samples, sun=True,
                   world="#d9e2ea", world_strength=0.8)
