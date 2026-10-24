"""Shared helpers for the Kronkel Blender build scripts.

Everything here works headless (bpy as a Python module or `blender -b -P`).
Coordinates: helpers take *game* coordinates (x right, y up, z toward the
street) and convert to Blender's Z-up space with G(). The glTF exporter
converts back to Y-up, so positions in layout.json line up 1:1 in the game.
"""
import math
import os
import json

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS = os.path.join(ROOT, "assets")


def load_json(name):
    with open(os.path.join(ASSETS, name), encoding="utf-8") as f:
        return json.load(f)


def G(x, y, z):
    """Game coords (y up, z toward street) -> Blender coords (z up, -y toward street)."""
    return Vector((x, -z, y))


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    _MATS.clear()
    _FONTS.clear()
    for coll in (bpy.data.meshes, bpy.data.materials, bpy.data.images, bpy.data.curves):
        for item in list(coll):
            coll.remove(item)


def rgb(hexstr):
    h = hexstr.lstrip("#")
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    srgb = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    # Blender colour inputs are linear; convert from sRGB so hex values match the art.
    return tuple(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in srgb) + (1.0,)


_MATS = {}


def mat(name, color="#ffffff", rough=0.7, metal=0.0, emit=None, strength=1.0, tex=None, alpha=None):
    """Get or create a Principled material. `tex` is an image used as base colour."""
    if name in _MATS:
        return _MATS[name]
    m = bpy.data.materials.new(name)
    if m.node_tree is None:
        m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = rgb(color)
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    if emit:
        bsdf.inputs["Emission Color"].default_value = rgb(emit)
        bsdf.inputs["Emission Strength"].default_value = strength
    if alpha is not None:
        bsdf.inputs["Alpha"].default_value = alpha
        try:
            m.surface_render_method = "BLENDED"
        except Exception:
            pass
    if tex is not None:
        node = nt.nodes.new("ShaderNodeTexImage")
        node.image = tex
        nt.links.new(node.outputs["Color"], bsdf.inputs["Base Color"])
    m.diffuse_color = rgb(color)
    _MATS[name] = m
    return m


# --------------------------------------------------------------------------
# Procedural textures (numpy -> packed Blender image -> JPEG inside the .glb)
# --------------------------------------------------------------------------

def _noise(size, scale, seed):
    """Cheap value noise in [0,1], tileable."""
    rng = np.random.default_rng(seed)
    n = max(2, size // scale)
    grid = rng.random((n, n))
    xs = np.linspace(0, n, size, endpoint=False)
    i0 = np.floor(xs).astype(int) % n
    i1 = (i0 + 1) % n
    t = xs - np.floor(xs)
    t = t * t * (3 - 2 * t)
    a = grid[i0][:, i0] * (1 - t)[None, :] + grid[i0][:, i1] * t[None, :]
    b = grid[i1][:, i0] * (1 - t)[None, :] + grid[i1][:, i1] * t[None, :]
    return a * (1 - t)[:, None] + b * t[:, None]


def fbm(size, seed, octaves=4, base=64):
    out = np.zeros((size, size))
    amp, total = 1.0, 0.0
    for o in range(octaves):
        out += _noise(size, max(2, base >> o), seed + o) * amp
        total += amp
        amp *= 0.5
    return out / total


def _srgb(c):
    return np.array([int(c.lstrip("#")[i:i + 2], 16) / 255 for i in (0, 2, 4)])


def make_image(name, arr):
    """arr: HxWx3 sRGB floats in [0,1], row 0 = top."""
    h, w, _ = arr.shape
    img = bpy.data.images.new(name, w, h, alpha=False)
    rgba = np.ones((h, w, 4), dtype=np.float32)
    rgba[:, :, :3] = np.clip(arr[::-1], 0, 1)
    img.pixels.foreach_set(rgba.ravel())
    # Save as a real .jpg so the glTF exporter (image format AUTO) keeps it JPEG; only the logo is PNG.
    tex_dir = os.path.join(ROOT, "blender", "out", "textures")
    os.makedirs(tex_dir, exist_ok=True)
    path = os.path.join(tex_dir, f"{name}.jpg")
    img.filepath_raw = path
    img.file_format = "JPEG"
    img.save(quality=88)
    bpy.data.images.remove(img)
    img = bpy.data.images.load(path)
    img.name = name
    img.pack()
    return img


def tex_brick(size=512, seed=1, base="#8c3f2b", mortar="#cbbfae", rows=16, per_row=4.5):
    rng = np.random.default_rng(seed)
    img = np.zeros((size, size, 3))
    bh = size / rows
    bw = size / per_row
    n = fbm(size, seed + 10, 4, 32)
    for r in range(rows):
        y0 = int(r * bh)
        y1 = int((r + 1) * bh)
        off = (bw / 2) if r % 2 else 0
        x = -off
        while x < size:
            c = _srgb(base) * (0.75 + 0.4 * rng.random()) + rng.normal(0, 0.03, 3)
            if rng.random() < 0.12:
                c = c * 0.7  # darker fired brick
            x0, x1 = int(max(0, x)), int(min(size, x + bw))
            img[y0:y1, x0:x1] = c
            x += bw
    img *= (0.85 + 0.3 * n)[:, :, None]
    m = _srgb(mortar)
    mw = max(2, int(bh * 0.14))
    for r in range(rows + 1):
        y = int(r * bh)
        img[max(0, y - mw // 2):y + mw // 2 + 1] = m * (0.9 + 0.1 * n[max(0, min(size - 1, y))].mean())
    for r in range(rows):
        y0, y1 = int(r * bh), int((r + 1) * bh)
        off = (bw / 2) if r % 2 else 0
        x = -off
        while x < size + bw:
            xi = int(x)
            if 0 <= xi < size:
                img[y0:y1, max(0, xi - mw // 2):xi + mw // 2 + 1] = m
            x += bw
    return img


def tex_planks(size=512, seed=2, base="#7a4a2a", planks=7, grain=True):
    rng = np.random.default_rng(seed)
    img = np.zeros((size, size, 3))
    pw = size / planks
    yy = np.arange(size)[:, None]
    for p in range(planks):
        x0, x1 = int(p * pw), int((p + 1) * pw)
        y = -rng.integers(0, size)
        while y < size:
            length = rng.integers(size // 3, size)
            c = _srgb(base) * (0.75 + 0.45 * rng.random())
            ya, yb = max(0, y), min(size, y + length)
            if yb <= ya:
                y += length
                continue
            seg = np.ones((yb - ya, x1 - x0, 3)) * c
            if grain:
                gx = np.arange(x1 - x0)[None, :]
                g = 0.5 + 0.5 * np.sin(gx * (0.35 + rng.random() * 0.2) + np.sin(yy[ya:yb] * 0.02 + p) * 3)
                seg *= (0.88 + 0.12 * g)[:, :, None]
            img[ya:yb, x0:x1] = seg
            if yb < size:
                img[yb:yb + 2, x0:x1] *= 0.55
            y += length
        img[:, x0:x0 + 2] *= 0.5
    n = fbm(size, seed + 5, 4, 48)
    img *= (0.9 + 0.2 * n)[:, :, None]
    return img


def tex_pavers(size=512, seed=3):
    """Dutch street 'klinkers': small red/grey bricks in a herringbone-ish running bond."""
    rng = np.random.default_rng(seed)
    img = np.zeros((size, size, 3))
    rows, per = 10, 5
    bh, bw = size / rows, size / per
    palette = [_srgb("#7d4b3e"), _srgb("#6b6461"), _srgb("#8a5a46"), _srgb("#5a5452")]
    for r in range(rows):
        off = (bw / 2) if r % 2 else 0
        x = -off
        while x < size:
            c = palette[rng.integers(0, len(palette))] * (0.8 + 0.35 * rng.random())
            img[int(r * bh):int((r + 1) * bh), int(max(0, x)):int(min(size, x + bw))] = c
            x += bw
    n = fbm(size, seed + 3, 4, 32)
    img *= (0.8 + 0.3 * n)[:, :, None]
    for r in range(rows + 1):
        y = int(r * bh)
        img[max(0, y - 2):y + 2] = _srgb("#2e2a28")
    for r in range(rows):
        off = (bw / 2) if r % 2 else 0
        x = -off
        while x < size + bw:
            xi = int(x)
            if 0 <= xi < size:
                img[int(r * bh):int((r + 1) * bh), max(0, xi - 2):xi + 2] = _srgb("#2e2a28")
            x += bw
    return img


def tex_tiles(size=256, color="#e9e4d8", grout="#9a948a", n=8):
    img = np.ones((size, size, 3)) * _srgb(color)
    nz = fbm(size, 9, 3, 32)
    img *= (0.94 + 0.08 * nz)[:, :, None]
    step = size / n
    for i in range(n + 1):
        p = int(i * step)
        img[max(0, p - 1):p + 2] = _srgb(grout)
        img[:, max(0, p - 1):p + 2] = _srgb(grout)
    return img


# --------------------------------------------------------------------------
# Geometry
# --------------------------------------------------------------------------

def _link(obj, parent=None, coll=None):
    (coll or bpy.context.scene.collection).objects.link(obj)
    if parent is not None:
        obj.parent = parent
    return obj


def empty(name, parent=None, loc=(0, 0, 0)):
    o = bpy.data.objects.new(name, None)
    o.location = loc
    return _link(o, parent)


def _finish(bm, name, material, smooth_angle=None, parent=None):
    me = bpy.data.meshes.new(name)
    if smooth_angle is not None:
        for f in bm.faces:
            f.smooth = True
        lim = math.radians(smooth_angle)
        for e in bm.edges:
            if len(e.link_faces) == 2:
                if e.link_faces[0].normal.angle(e.link_faces[1].normal, 0) > lim:
                    e.smooth = False
    bm.to_mesh(me)
    bm.free()
    if material is not None:
        me.materials.append(material)
    obj = bpy.data.objects.new(name, me)
    return _link(obj, parent)


def box(name, mn, mx, material, bevel=0.0, parent=None):
    """Axis-aligned box between game-space corners mn and mx (x, y, z)."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    a, b = G(*mn), G(*mx)
    lo = Vector((min(a.x, b.x), min(a.y, b.y), min(a.z, b.z)))
    hi = Vector((max(a.x, b.x), max(a.y, b.y), max(a.z, b.z)))
    size = hi - lo
    center = (lo + hi) / 2
    bmesh.ops.scale(bm, vec=size, verts=bm.verts)
    bmesh.ops.translate(bm, vec=center, verts=bm.verts)
    if bevel > 0:
        bmesh.ops.bevel(bm, geom=list(bm.edges), offset=min(bevel, min(size) * 0.45), segments=2,
                        affect="EDGES", profile=0.5)
    return _finish(bm, name, material, 30 if bevel > 0 else None, parent)


def boxc(name, center, size, material, bevel=0.0, rot_y=0.0, parent=None):
    """Box centered at game point with game-space size (sx, sy, sz), rotated around up axis."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=Vector((size[0], size[2], size[1])), verts=bm.verts)
    if bevel > 0:
        bmesh.ops.bevel(bm, geom=list(bm.edges), offset=min(bevel, min(size) * 0.45), segments=2,
                        affect="EDGES", profile=0.5)
    bmesh.ops.rotate(bm, cent=(0, 0, 0), matrix=Matrix.Rotation(rot_y, 3, "Z"), verts=bm.verts)
    bmesh.ops.translate(bm, vec=G(*center), verts=bm.verts)
    return _finish(bm, name, material, 30 if bevel > 0 else None, parent)


def cyl(name, center, r, h, material, segs=16, r2=None, parent=None, axis="Y", smooth=True, caps=True):
    """Cylinder/cone standing on game point `center` (bottom center) along game axis."""
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=caps, cap_tris=False, segments=segs, radius1=r,
                          radius2=r if r2 is None else r2, depth=h)
    bmesh.ops.translate(bm, vec=Vector((0, 0, h / 2)), verts=bm.verts)
    if axis == "X":
        bmesh.ops.rotate(bm, cent=(0, 0, 0), matrix=Matrix.Rotation(math.pi / 2, 3, "Y"), verts=bm.verts)
    elif axis == "Z":
        bmesh.ops.rotate(bm, cent=(0, 0, 0), matrix=Matrix.Rotation(-math.pi / 2, 3, "X"), verts=bm.verts)
    bmesh.ops.translate(bm, vec=G(*center), verts=bm.verts)
    return _finish(bm, name, material, 50 if smooth else None, parent)


def sphere(name, center, r, material, segs=16, rings=10, scale=(1, 1, 1), parent=None):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=segs, v_segments=rings, radius=r)
    bmesh.ops.scale(bm, vec=Vector((scale[0], scale[2], scale[1])), verts=bm.verts)
    bmesh.ops.translate(bm, vec=G(*center), verts=bm.verts)
    return _finish(bm, name, material, 80, parent)


def torus(name, center, R, r, material, segs=24, rsegs=8, axis="Y", parent=None):
    bm = bmesh.new()
    verts = []
    for i in range(segs):
        a = 2 * math.pi * i / segs
        ring = []
        for j in range(rsegs):
            b = 2 * math.pi * j / rsegs
            x = (R + r * math.cos(b)) * math.cos(a)
            y = (R + r * math.cos(b)) * math.sin(a)
            z = r * math.sin(b)
            ring.append(bm.verts.new((x, y, z)))
        verts.append(ring)
    for i in range(segs):
        for j in range(rsegs):
            a, b = verts[i][j], verts[(i + 1) % segs][j]
            c, d = verts[(i + 1) % segs][(j + 1) % rsegs], verts[i][(j + 1) % rsegs]
            bm.faces.new((a, b, c, d))
    if axis == "X":
        bmesh.ops.rotate(bm, cent=(0, 0, 0), matrix=Matrix.Rotation(math.pi / 2, 3, "Y"), verts=bm.verts)
    elif axis == "Z":
        bmesh.ops.rotate(bm, cent=(0, 0, 0), matrix=Matrix.Rotation(math.pi / 2, 3, "X"), verts=bm.verts)
    bmesh.ops.translate(bm, vec=G(*center), verts=bm.verts)
    return _finish(bm, name, material, 80, parent)


def tube(name, points, r, material, segs=6, parent=None):
    """A thin tube following game-space points (cables, railings, bike frames)."""
    objs = []
    for i in range(len(points) - 1):
        a, b = G(*points[i]), G(*points[i + 1])
        d = b - a
        L = d.length
        if L < 1e-5:
            continue
        bm = bmesh.new()
        bmesh.ops.create_cone(bm, cap_ends=True, segments=segs, radius1=r, radius2=r, depth=L)
        q = Vector((0, 0, 1)).rotation_difference(d.normalized())
        bmesh.ops.rotate(bm, cent=(0, 0, 0), matrix=q.to_matrix(), verts=bm.verts)
        bmesh.ops.translate(bm, vec=(a + b) / 2, verts=bm.verts)
        objs.append(_finish(bm, f"{name}_{i}", material, 60, parent))
    return join(objs, name) if len(objs) > 1 else (objs[0] if objs else None)


_FONTS = {}
# Same type as the game UI: Archivo Black for sign lettering, Barlow Condensed for menus and small print.
FONT_FILES = {"sans": "ArchivoBlack.ttf", "bold": "BarlowCondensed-800.ttf", "serif": "ArchivoBlack.ttf"}


def font(kind="sans"):
    if kind not in _FONTS:
        path = os.path.join(ASSETS, "fonts", FONT_FILES[kind])
        _FONTS[kind] = bpy.data.fonts.load(path) if os.path.exists(path) else None
    return _FONTS[kind]


def text(name, body, center, size, material, extrude=0.01, rot_y=0.0, facing="front", align="CENTER",
         parent=None, font_kind="sans"):
    """Flat text as a mesh. facing='front' faces +z (street side), 'back' faces -z, 'up' lies flat."""
    cu = bpy.data.curves.new(name, "FONT")
    cu.body = body
    cu.size = size
    # Small signage stays flat and coarse; it's read from metres away on a phone screen.
    cu.extrude = extrude if extrude > 0.005 else 0.0
    cu.resolution_u = 2 if size < 0.15 else 4
    cu.align_x = align
    cu.align_y = "CENTER"
    f = font(font_kind)
    if f is not None:
        cu.font = f
    tmp = bpy.data.objects.new(name + "_tmp", cu)
    bpy.context.scene.collection.objects.link(tmp)
    if facing == "front":
        tmp.rotation_euler = (math.pi / 2, 0, rot_y)
    elif facing == "back":
        tmp.rotation_euler = (math.pi / 2, 0, math.pi + rot_y)
    elif facing == "left":
        tmp.rotation_euler = (math.pi / 2, 0, -math.pi / 2)
    elif facing == "right":
        tmp.rotation_euler = (math.pi / 2, 0, math.pi / 2)
    else:
        tmp.rotation_euler = (0, 0, rot_y)
    tmp.location = G(*center)
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(tmp.evaluated_get(dg))
    me.transform(tmp.matrix_world)
    bpy.data.objects.remove(tmp)
    bpy.data.curves.remove(cu)
    me.materials.clear()
    me.materials.append(material)
    obj = bpy.data.objects.new(name, me)
    return _link(obj, parent)


def uv_box(obj, scale=1.0):
    """World-space box projection so textures tile at a constant real-world size (1 UV = 1/scale m)."""
    obj["uv_done"] = True
    me = obj.data
    bm = bmesh.new()
    bm.from_mesh(me)
    uv = bm.loops.layers.uv.verify()
    mw = obj.matrix_world
    for f in bm.faces:
        n = f.normal
        ax = max(range(3), key=lambda i: abs(n[i]))
        for loop in f.loops:
            p = mw @ loop.vert.co
            if ax == 0:
                u, v = p.y * (1 if n.x < 0 else -1), p.z
            elif ax == 1:
                u, v = p.x * (1 if n.y > 0 else -1), p.z
            else:
                u, v = p.x, p.y
            loop[uv].uv = (u * scale, v * scale)
    bm.to_mesh(me)
    bm.free()
    return obj


def join(objs, name, parent=None):
    """Join meshes (keeps materials). Objects must have identity parents/transforms or be top-level."""
    objs = [o for o in objs if o is not None and o.type == "MESH"]
    if not objs:
        return None
    for o in objs:
        if o.parent is not None:
            mw = o.matrix_world.copy()
            o.parent = None
            o.matrix_world = mw
    target = objs[0]
    if len(objs) > 1:
        with bpy.context.temp_override(active_object=target, object=target, selected_objects=objs,
                                       selected_editable_objects=objs):
            bpy.ops.object.join()
    target.name = name
    target.data.name = name
    if parent is not None:
        target.parent = parent
    return target


def merge_by_material(objs, prefix, parent=None):
    """Join a set of objects into one mesh per material (fewer draw calls on phones)."""
    buckets = {}
    for o in objs:
        if o is None or o.type != "MESH":
            continue
        key = o.data.materials[0].name if o.data.materials else "none"
        buckets.setdefault(key, []).append(o)
    out = []
    for key, group in buckets.items():
        out.append(join(group, f"{prefix}_{key}", parent))
    return out


def set_vertex_ao(obj_list, samples=24, distance=1.2):
    """Bake ambient occlusion into a colour attribute (multiplied in by three.js as vertex colours)."""
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = samples
    scene.world = scene.world or bpy.data.worlds.new("World")
    scene.world.light_settings.distance = distance
    for o in obj_list:
        if o.type != "MESH":
            continue
        if "AO" not in o.data.color_attributes:
            o.data.color_attributes.new("AO", "FLOAT_COLOR", "POINT")
        o.data.color_attributes.active_color = o.data.color_attributes["AO"]
    meshes = [o for o in obj_list if o.type == "MESH"]
    if not meshes:
        return
    with bpy.context.temp_override(active_object=meshes[0], object=meshes[0], selected_objects=meshes,
                                   selected_editable_objects=meshes):
        bpy.ops.object.bake(type="AO", target="VERTEX_COLORS")


def subdivide_long_faces(obj, max_len=0.5):
    """Split big flat faces into a grid so vertex AO has enough resolution."""
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    for _ in range(6):
        long_edges = [e for e in bm.edges if e.calc_length() > max_len]
        if not long_edges:
            break
        bmesh.ops.subdivide_edges(bm, edges=long_edges, cuts=1, use_grid_fill=True)
    bm.to_mesh(obj.data)
    bm.free()


def export_glb(path, objects=None, animations=False):
    for o in bpy.context.scene.objects:
        o.select_set(False)
    if objects is not None:
        for o in objects:
            o.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        use_selection=objects is not None,
        export_apply=True,
        export_yup=True,
        export_image_format="AUTO",  # generated textures are JPEG, the logo keeps its PNG alpha
        export_jpeg_quality=82,
        export_vertex_color="ACTIVE",
        export_animations=animations,
        export_animation_mode="NLA_TRACKS",
        export_skins=True,
        export_def_bones=False,
        export_lights=False,
        export_cameras=False,
        export_extras=False,
    )


def render_preview(path, cam_pos, target, lens=24, size=(1280, 720), samples=48, sun=True, world="#1a1a24",
                   world_strength=0.6, lights=()):
    """Cycles still for showing progress (game coords for camera and target)."""
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = samples
    scene.cycles.use_denoising = True
    scene.render.resolution_x, scene.render.resolution_y = size
    scene.render.image_settings.file_format = "PNG"
    scene.view_settings.view_transform = "AgX"
    if scene.world is None:
        scene.world = bpy.data.worlds.new("World")
    w = scene.world
    if w.node_tree is None:
        w.use_nodes = True
    bg = w.node_tree.nodes.get("Background")
    if bg:
        bg.inputs[0].default_value = rgb(world)
        bg.inputs[1].default_value = world_strength
    cam_data = bpy.data.cameras.new("PreviewCam")
    cam_data.lens = lens
    cam = bpy.data.objects.new("PreviewCam", cam_data)
    scene.collection.objects.link(cam)
    cam.location = G(*cam_pos)
    d = G(*target) - cam.location
    cam.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
    scene.camera = cam
    made = [cam]
    if sun:
        s = bpy.data.objects.new("PreviewSun", bpy.data.lights.new("PreviewSun", "SUN"))
        s.data.energy = 2.0
        s.rotation_euler = (math.radians(50), 0, math.radians(30))
        scene.collection.objects.link(s)
        made.append(s)
    for i, (pos, color, energy, radius) in enumerate(lights):
        ld = bpy.data.lights.new(f"PL{i}", "POINT")
        ld.energy = energy
        ld.color = rgb(color)[:3]
        ld.shadow_soft_size = radius
        lo = bpy.data.objects.new(f"PL{i}", ld)
        lo.location = G(*pos)
        scene.collection.objects.link(lo)
        made.append(lo)
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    for o in made:
        bpy.data.objects.remove(o)


def tex_concrete(size=512, seed=21, base="#8a847c"):
    """Trowelled plaster/concrete like Kronkel's walls: mottled grey with dark scrape marks."""
    rng = np.random.default_rng(seed)
    n1 = fbm(size, seed, 5, 128)
    n2 = fbm(size, seed + 7, 4, 32)
    img = np.ones((size, size, 3)) * _srgb(base)
    img *= (0.72 + 0.4 * n1 + 0.12 * n2)[:, :, None]
    for _ in range(70):
        y = rng.integers(0, size)
        x = rng.integers(0, size)
        L = rng.integers(10, 70)
        th = rng.integers(1, 4)
        img[y:y + th, x:min(size, x + L)] *= 0.55 + rng.random() * 0.2
    return img


def tex_barnwood(size=512, seed=31):
    """Reclaimed vertical barn planks: varied browns/greys, knots, nail holes."""
    rng = np.random.default_rng(seed)
    img = np.zeros((size, size, 3))
    planks = 5
    pw = size / planks
    palette = ["#5a4532", "#6e5843", "#4a3a2c", "#7d6a55", "#3e3128", "#685a4c"]
    yy, xx = np.mgrid[0:size, 0:size]
    for p in range(planks):
        x0, x1 = int(p * pw), int((p + 1) * pw)
        c = _srgb(palette[rng.integers(0, len(palette))])
        grain = 0.5 + 0.5 * np.sin(xx[:, x0:x1] * (0.5 + rng.random() * 0.3) + np.sin(yy[:, x0:x1] * 0.015 + p) * 4
                                   + fbm(size, seed + p, 3, 64)[:, x0:x1] * 6)
        img[:, x0:x1] = c * (0.78 + 0.3 * grain)[:, :, None]
        for _ in range(2):
            ky, kx = rng.integers(0, size), rng.integers(x0 + 10, x1 - 10)
            r = rng.integers(5, 12)
            m = ((yy - ky) / (r * 2.2)) ** 2 + ((xx - kx) / r) ** 2 < 1
            img[m] *= 0.45
        img[:, x0:x0 + 3] *= 0.35
    img *= (0.8 + 0.35 * fbm(size, seed + 50, 4, 64))[:, :, None]
    return img


def tex_ceiltiles(size=256):
    img = np.ones((size, size, 3)) * _srgb("#18181b")
    img *= (0.85 + 0.25 * fbm(size, 61, 3, 16))[:, :, None]
    for p in (0, size // 2):
        img[max(0, p - 2):p + 3] = _srgb("#3a3a40")
        img[:, max(0, p - 2):p + 3] = _srgb("#3a3a40")
    return img


def tex_vboards(size=256, base="#5d8686", boards=6):
    img = np.ones((size, size, 3)) * _srgb(base)
    img *= (0.9 + 0.15 * fbm(size, 71, 3, 32))[:, :, None]
    step = size / boards
    for i in range(boards):
        x = int(i * step)
        img[:, x:x + 3] *= 0.55
        img[:, x + 3:x + 5] *= 1.12
    return img


def logo_image():
    """Load the Kronkel logo, cut the white background away (flood fill from the border so the white
    eye highlights stay), save a transparent PNG for the web UI and return it as a Blender image."""
    if "kronkel_logo" in bpy.data.images:
        return bpy.data.images["kronkel_logo"]
    src = os.path.join(ASSETS, "images", "kronkel-logo-src.png")
    img = bpy.data.images.load(src)
    w, h = img.size
    a = np.array(img.pixels[:], dtype=np.float32).reshape(h, w, 4)
    white = a[:, :, :3].min(axis=2) > 0.82
    bg = np.zeros((h, w), dtype=bool)
    stack = [(y, x) for y in range(h) for x in (0, w - 1)] + [(y, x) for x in range(w) for y in (0, h - 1)]
    while stack:
        y, x = stack.pop()
        if bg[y, x] or not white[y, x]:
            continue
        bg[y, x] = True
        if y > 0:
            stack.append((y - 1, x))
        if y < h - 1:
            stack.append((y + 1, x))
        if x > 0:
            stack.append((y, x - 1))
        if x < w - 1:
            stack.append((y, x + 1))
    alpha = np.where(bg, 0.0, 1.0)
    # soften the anti-aliased edge next to the removed background
    edge = np.zeros_like(bg)
    edge[1:, :] |= bg[:-1, :]
    edge[:-1, :] |= bg[1:, :]
    edge[:, 1:] |= bg[:, :-1]
    edge[:, :-1] |= bg[:, 1:]
    edge &= ~bg
    lum = a[:, :, :3].min(axis=2)
    alpha[edge] = np.clip((1.0 - lum[edge]) / 0.5, 0.25, 1.0)
    a[:, :, 3] = alpha
    out = bpy.data.images.new("kronkel_logo", w, h, alpha=True)
    out.pixels.foreach_set(a.ravel())
    out.filepath_raw = os.path.join(ASSETS, "images", "kronkel-logo.png")
    out.file_format = "PNG"
    out.save()
    out.pack()
    bpy.data.images.remove(img)
    return out


def logo_material(name, lit=False):
    if name in _MATS:
        return _MATS[name]
    m = bpy.data.materials.new(name)
    if m.node_tree is None:
        m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = logo_image()
    nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    nt.links.new(tex.outputs["Alpha"], bsdf.inputs["Alpha"])
    bsdf.inputs["Roughness"].default_value = 0.45
    if lit:
        nt.links.new(tex.outputs["Color"], bsdf.inputs["Emission Color"])
        bsdf.inputs["Emission Strength"].default_value = 2.0
    try:
        m.surface_render_method = "DITHERED"
    except Exception:
        pass
    _MATS[name] = m
    return m


def image_plane(name, center, size, facing, material):
    """Square plane with 0..1 UVs, readable (not mirrored) from its facing side: front|back|left|right."""
    s = size / 2
    cx, cy, cz = center
    # corners in (u, v) order: bottom-left, bottom-right, top-right, top-left as seen by the viewer
    if facing == "front":      # viewer looks toward -z, image right = +x
        pts = [(cx - s, cy - s, cz), (cx + s, cy - s, cz), (cx + s, cy + s, cz), (cx - s, cy + s, cz)]
    elif facing == "back":     # viewer looks toward +z, image right = -x
        pts = [(cx + s, cy - s, cz), (cx - s, cy - s, cz), (cx - s, cy + s, cz), (cx + s, cy + s, cz)]
    elif facing == "right":    # faces +x, viewer looks toward -x, image right = -z
        pts = [(cx, cy - s, cz + s), (cx, cy - s, cz - s), (cx, cy + s, cz - s), (cx, cy + s, cz + s)]
    else:                      # left: faces -x, image right = +z
        pts = [(cx, cy - s, cz - s), (cx, cy - s, cz + s), (cx, cy + s, cz + s), (cx, cy + s, cz - s)]
    bm = bmesh.new()
    verts = [bm.verts.new(G(*p)) for p in pts]
    f = bm.faces.new(verts)
    uv = bm.loops.layers.uv.verify()
    for loop, (u, v) in zip(f.loops, ((0, 0), (1, 0), (1, 1), (0, 1))):
        loop[uv].uv = (u, v)
    bm.normal_update()
    obj = _finish(bm, name, material)
    obj["uv_done"] = True
    return obj
