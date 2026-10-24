"""Rigged, animated stylised person used for every customer, guest and staff member.

The game clones this one skinned character many times (SkeletonUtils.clone), recolours the
Skin / Shirt / Pants / Hair / Hat / Shoes / Jacket materials per person and toggles accessory meshes:
  hair:  hair_short, hair_long, hair_bun, hair_curly, hair_pony, hair_buzz, hat_beanie, hat_cap
  tops:  longsleeve, hoodie, jacket            (the base body wears a t-shirt)
  extra: glasses, beard, apron
Animations (NLA tracks -> glTF animations): Idle, Walk, Sit, Wave, Talk, CarryWalk, CarryIdle

Everything is lofted from cross-section rings (see `loft`), so bodies are smooth single shapes with
real clothing layers: collars, cuffs, hems, sneakers with soles, mitten hands with thumbs.
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

HEAD_C = Vector((0, 0.005, 1.645))  # centre of the skull
HEAD_R = 0.152


def face_y(x, z, off=0.0):
    """Y of the front of the face at (x, z), pushed out by `off` (features sit on the skin, not in the air)."""
    dz = z - HEAD_C.z
    base = 1 - (x / HEAD_R) ** 2 - (dz / (HEAD_R * 1.08)) ** 2
    y = -HEAD_R * 0.97 * math.sqrt(max(0.0, base))
    if dz < 0:
        below = -dz / (HEAD_R * 1.08)
        y = y * (1 + 0.06 * below) - 0.008 * below
    return HEAD_C.y + y - off


# ----------------------------------------------------------------------------- geometry helpers

def _frame(t, ref):
    side = t.cross(ref)
    if side.length < 1e-4:
        side = t.cross(Vector((1, 0, 0)))
    side.normalize()
    front = side.cross(t)
    front.normalize()
    return side, front


def loft(rings, segs=16, cap0=None, cap1=None, ref=(0, 1, 0), arc=None, p=2.0):
    """Skin a tube through cross-section rings.

    rings: [(centre, rx, ry)] or [(centre, rx, ry, exponent)]; rx runs sideways, ry front/back.
    cap0/cap1: None (open), 'flat', or 'round' (a dome as deep as the ring is small).
    arc: (a0, a1) in turns to build an open shell (jackets) instead of a closed tube.
    exponent > 2 gives boxier (superellipse) sections.
    """
    ref = Vector(ref)
    pts = [Vector(r[0]) for r in rings]
    n = len(pts)
    main = (pts[-1] - pts[0]).normalized()
    tangents = []
    for i in range(n):
        d = (pts[min(i + 1, n - 1)] - pts[max(i - 1, 0)]).normalized()
        # a fold back on itself (a hem) keeps the main direction so rings don't twist
        tangents.append(d if d.dot(main) > 0.3 else main)
    closed = arc is None
    count = segs if closed else segs + 1

    def ring_pts(c, t, rx, ry, e):
        side, front = _frame(t, ref)
        out = []
        for k in range(count):
            u = k / segs if closed else arc[0] + (arc[1] - arc[0]) * k / segs
            a = u * math.tau
            ca, sa = math.cos(a), math.sin(a)
            x = math.copysign(abs(ca) ** (2 / e), ca) * rx
            y = math.copysign(abs(sa) ** (2 / e), sa) * ry
            out.append(c + side * x + front * y)
        return out

    rows = []
    for i, r in enumerate(rings):
        e = r[3] if len(r) > 3 else p
        rows.append((pts[i], tangents[i], r[1], r[2], e))

    def dome(row, sign):
        c, t, rx, ry, e = row
        depth = min(rx, ry)
        out = []
        for k in (1, 2, 3):
            th = k / 4 * math.pi / 2
            out.append((c + t * sign * math.sin(th) * depth, t, rx * math.cos(th), ry * math.cos(th), e))
        return out, c + t * sign * depth

    pole0 = pole1 = None
    if cap0 == "round":
        extra, pole0 = dome(rows[0], -1)
        rows = list(reversed(extra)) + rows
    if cap1 == "round":
        extra, pole1 = dome(rows[-1], 1)
        rows = rows + extra
    bm = bmesh.new()
    vrows = [[bm.verts.new(v) for v in ring_pts(*row)] for row in rows]
    for a, b in zip(vrows, vrows[1:]):
        for k in range(segs):
            k2 = (k + 1) % count
            bm.faces.new((a[k], a[k2], b[k2], b[k]))
    if closed:
        for which, pole, row, flip in ((0, pole0, vrows[0], True), (1, pole1, vrows[-1], False)):
            cap = cap0 if which == 0 else cap1
            if cap is None:
                continue
            centre = pole if pole is not None else sum((v.co for v in row), Vector()) / len(row)
            cv = bm.verts.new(centre)
            for k in range(segs):
                tri = (row[k], row[(k + 1) % segs], cv)
                bm.faces.new(tuple(reversed(tri)) if flip else tri)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


def tube(points, r, segs=8, r_end=None, caps="round"):
    """Constant (or tapering) round tube along a polyline."""
    pts = [Vector(q) for q in points]
    rings = []
    for i, q in enumerate(pts):
        f = i / max(1, len(pts) - 1)
        rr = r if r_end is None else r + (r_end - r) * f
        rings.append((q, rr, rr))
    return loft(rings, segs, caps, caps)


def ellipsoid(center, radii, segs=16, rings=10, cut=None):
    """cut: callable(co) -> True to delete the vertex (used for hair caps, eyelids, beards)."""
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=segs, v_segments=rings, radius=1.0)
    bmesh.ops.scale(bm, vec=Vector(radii), verts=bm.verts)
    bmesh.ops.translate(bm, vec=Vector(center), verts=bm.verts)
    if cut is not None:
        bmesh.ops.delete(bm, geom=[v for v in bm.verts if cut(v.co)], context="VERTS")
    return bm


def rbox(center, size, bevel=0.02, segments=3):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=Vector(size), verts=bm.verts)
    if bevel:
        bmesh.ops.bevel(bm, geom=list(bm.edges), offset=bevel, segments=segments, affect="EDGES", profile=0.5)
    bmesh.ops.translate(bm, vec=Vector(center), verts=bm.verts)
    return bm


def thicken(bm, thickness):
    """Give an open shell some thickness so it reads from the inside too (jackets, hems)."""
    bmesh.ops.solidify(bm, geom=list(bm.faces), thickness=thickness)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


def transform(bm, matrix):
    bmesh.ops.transform(bm, matrix=matrix, verts=bm.verts)
    return bm


def mirror_x(bm):
    out = bm.copy()
    bmesh.ops.scale(out, vec=(-1, 1, 1), verts=out.verts)
    bmesh.ops.reverse_faces(out, faces=out.faces)
    return out


# ----------------------------------------------------------------------------- skin weights

def _seg_dist(p, a, b):
    ab = b - a
    t = max(0.0, min(1.0, (p - a).dot(ab) / ab.length_squared))
    return (a + ab * t - p).length


def chain(*names, power=4):
    """Blend between bones by distance to each bone segment (soft at the joints)."""
    segs = [(n, Vector(BONES[n][0]), Vector(BONES[n][1])) for n in names]

    def f(co):
        ws = sorted(((n, 1.0 / (_seg_dist(co, a, b) ** power + 1e-9)) for n, a, b in segs), key=lambda x: -x[1])[:2]
        s = sum(w for _, w in ws)
        return [(n, w / s) for n, w in ws if w / s > 0.01]
    return f


def _smooth(a, b, x):
    t = max(0.0, min(1.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


def torso_weights(co):
    z = co.z
    if z < 1.0:
        w = [("hips", 1.0)]
    elif z < 1.1:
        t = _smooth(1.0, 1.1, z)
        w = [("hips", 1 - t), ("spine", t)]
    elif z < 1.24:
        w = [("spine", 1.0)]
    elif z < 1.32:
        t = _smooth(1.24, 1.32, z)
        w = [("spine", 1 - t), ("chest", t)]
    else:
        w = [("chest", 1.0)]
    # the outer shoulder follows the arm a little, so raised arms don't leave a crease
    k = 0.45 * _smooth(0.13, 0.2, abs(co.x)) * _smooth(1.27, 1.36, z)
    if k > 0.01:
        side = "L" if co.x > 0 else "R"
        w = [(b, v * (1 - k)) for b, v in w] + [(f"upperarm_{side}", k)]
    return w


def side_chain(co, left, right):
    return left(co) if co.x > 0 else right(co)


ARM = lambda co: side_chain(co, chain("chest", "upperarm_L", "forearm_L"), chain("chest", "upperarm_R", "forearm_R"))
LEG = lambda co: side_chain(co, chain("hips", "thigh_L", "shin_L"), chain("hips", "thigh_R", "shin_R"))
NECK = chain("chest", "neck", "head")


HEAD_SCALE = 1.1
HEAD_PIVOT = Vector((0, 0.0, 1.49))


def _obj(name, bm, material, groups, smooth=True):
    """groups: callable(co) -> list[(bone, weight)] or a bone name. Head parts are scaled up around the neck."""
    if groups == "head":
        for v in bm.verts:
            v.co = HEAD_PIVOT + (v.co - HEAD_PIVOT) * HEAD_SCALE
    me = bpy.data.meshes.new(name)
    for f in bm.faces:
        f.smooth = smooth
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


def join_objs(objs, name):
    target = objs[0]
    if len(objs) > 1:
        with bpy.context.temp_override(active_object=target, object=target, selected_objects=objs,
                                       selected_editable_objects=objs):
            bpy.ops.object.join()
    target.name = name
    target.data.name = name
    return target


# ----------------------------------------------------------------------------- body parts

def head_shape():
    """Skull with a softer jaw and fuller cheeks, smooth enough for close-ups at the counter."""
    bm = ellipsoid(HEAD_C, (HEAD_R, HEAD_R * 0.97, HEAD_R * 1.08), 28, 18)
    for v in bm.verts:
        d = v.co - HEAD_C
        below = max(0.0, -d.z) / (HEAD_R * 1.08)
        # narrow the jaw and pull the chin a touch forward
        v.co.x = HEAD_C.x + d.x * (1 - 0.2 * below ** 1.4)
        if d.y < 0:
            v.co.y = HEAD_C.y + d.y * (1 + 0.06 * below) - 0.008 * below
        # flatter back of the head, slightly fuller cheeks
        if d.y > 0:
            v.co.y = HEAD_C.y + d.y * 0.94
        cheek = math.exp(-((d.z + 0.03) / 0.04) ** 2) * math.exp(-((abs(d.x) - 0.09) / 0.05) ** 2)
        v.co.x += math.copysign(0.006 * cheek, d.x)
    return bm


def face(M):
    parts = []
    ez, ex = 1.662, 0.056
    for sx in (1, -1):
        c = Vector((sx * ex, face_y(ex, ez, -0.006), ez))
        # eye white, iris, highlight
        parts.append(_obj(f"sclera{sx}", ellipsoid(c, (0.029, 0.016, 0.033), 14, 10), M["EyeWhite"], "head"))
        parts.append(_obj(f"iris{sx}", ellipsoid(c + Vector((sx * -0.003, -0.011, -0.004)), (0.018, 0.008, 0.021), 12, 8),
                          M["Eyes"], "head"))
        parts.append(_obj(f"glint{sx}", ellipsoid(c + Vector((sx * -0.009, -0.019, 0.006)), (0.0055, 0.003, 0.0055), 8, 6),
                          M["EyeWhite"], "head"))
        # relaxed upper eyelid (skin) over the top of the eye: chill, not sleepy
        lid = ellipsoid(c + Vector((0, -0.001, 0.002)), (0.033, 0.0195, 0.036), 16, 10,
                        cut=lambda co, cz=ez: co.z < cz + 0.012)
        parts.append(_obj(f"lid{sx}", lid, M["Skin"], "head"))
        # eyebrow: tapered arc sitting on the brow ridge
        brow = []
        for k in range(5):
            x = sx * (ex + (k - 2) * 0.015)
            z = ez + 0.046 - ((k - 2) * 0.0075) ** 2 * 28 + (0.003 if sx * (k - 2) < 0 else 0)
            brow.append(Vector((x, face_y(x, z, 0.002), z)))
        parts.append(_obj(f"brow{sx}", tube(brow, 0.0072, 6, 0.0038), M["Hair"], "head"))
        # ear
        ear = ellipsoid((sx * 0.148, 0.018, 1.638), (0.018, 0.034, 0.045), 12, 8)
        transform(ear, Matrix.Translation((sx * 0.148, 0.018, 1.638)) @ Matrix.Rotation(sx * -0.25, 4, "Z")
                  @ Matrix.Translation((-sx * 0.148, -0.018, -1.638)))
        parts.append(_obj(f"ear{sx}", ear, M["Skin"], "head"))
    # nose: soft bulb with a little bridge
    parts.append(_obj("nose", ellipsoid((0, face_y(0, 1.614, 0.012), 1.614), (0.022, 0.02, 0.024), 12, 8), M["Skin"], "head"))
    parts.append(_obj("bridge", tube([(0, face_y(0, 1.66, 0.0), 1.66), (0, face_y(0, 1.625, 0.01), 1.625)], 0.011, 8),
                      M["Skin"], "head"))
    # smile
    smile = []
    for k in range(7):
        x = (k - 3) * 0.0105
        z = 1.578 + x * x * 7
        smile.append(Vector((x, face_y(x, z, 0.0015), z)))
    parts.append(_obj("mouth", tube(smile, 0.0042, 6, None), M["Mouth"], "head"))
    return parts


def torso(M):
    """T-shirt torso with crew collar and a hem that has some thickness."""
    rings = [
        ((0, 0.0, 0.975), 0.152, 0.11, 2.3),
        ((0, 0.0, 0.955), 0.172, 0.123, 2.3),
        ((0, 0.0, 1.0), 0.166, 0.119, 2.4),
        ((0, 0.0, 1.08), 0.161, 0.115, 2.4),
        ((0, 0.002, 1.17), 0.172, 0.123, 2.5),
        ((0, 0.004, 1.26), 0.186, 0.13, 2.5),
        ((0, 0.006, 1.33), 0.192, 0.126, 2.6),
        ((0, 0.008, 1.375), 0.178, 0.114, 2.4),
        ((0, 0.01, 1.41), 0.135, 0.095, 2.2),
        ((0, 0.012, 1.432), 0.09, 0.077, 2.0),
        ((0, 0.012, 1.44), 0.073, 0.066, 2.0),
    ]
    shirt = _obj("torso", loft(rings, 24), M["Shirt"], torso_weights)
    collar = loft([((0, 0.012, 1.428), 0.08, 0.072), ((0, 0.012, 1.444), 0.081, 0.073),
                   ((0, 0.012, 1.452), 0.071, 0.064)], 20)
    return [shirt, _obj("collar", collar, M["Shirt"], torso_weights)]


def arms(M):
    parts = []
    for sx, side in ((1, "L"), (-1, "R")):
        X = lambda x: sx * x
        # bare arm: upper arm (mostly hidden), elbow, forearm, wrist
        arm = loft([((X(0.235), 0.0, 1.3), 0.05, 0.049), ((X(0.248), 0.0, 1.16), 0.046, 0.045),
                    ((X(0.255), 0.0, 1.11), 0.043, 0.042), ((X(0.26), 0.0, 1.02), 0.042, 0.04),
                    ((X(0.264), 0.0, 0.93), 0.034, 0.031), ((X(0.266), 0.0, 0.885), 0.031, 0.029)], 12, "round", "round")
        parts.append(_obj(f"arm{side}", arm, M["Skin"], ARM))
        # mitten hand with a thumb; palms face the body
        hc = Vector((X(0.268), -0.004, 0.828))
        hand = loft([(hc + Vector((0, 0, 0.05)), 0.021, 0.03), (hc + Vector((0, 0, 0.025)), 0.025, 0.04),
                     (hc + Vector((0, 0, -0.01)), 0.024, 0.042), (hc + Vector((0, 0, -0.04)), 0.02, 0.036),
                     (hc + Vector((0, 0, -0.052)), 0.016, 0.028)], 12, "round", "round")
        parts.append(_obj(f"hand{side}", hand, M["Skin"], f"forearm_{side}"))
        thumb = tube([hc + Vector((X(-0.012), -0.03, 0.02)), hc + Vector((X(-0.018), -0.045, -0.005)),
                      hc + Vector((X(-0.016), -0.048, -0.022))], 0.011, 8, 0.009)
        parts.append(_obj(f"thumb{side}", thumb, M["Skin"], f"forearm_{side}"))
    return parts


def tee_sleeves(M):
    parts = []
    for sx, side in ((1, "L"), (-1, "R")):
        X = lambda x: sx * x
        sleeve = loft([((X(0.19), 0.0, 1.352), 0.06, 0.06), ((X(0.228), 0.0, 1.335), 0.068, 0.066),
                       ((X(0.24), 0.0, 1.26), 0.066, 0.064), ((X(0.247), 0.0, 1.18), 0.063, 0.061),
                       ((X(0.247), 0.0, 1.185), 0.054, 0.052)], 14, "round", None)
        parts.append(_obj(f"sleeve{side}", sleeve, M["Shirt"], ARM))
    return join_objs(parts, "tee_sleeves")


def legs(M):
    parts = []
    pelvis = loft([((0, 0.0, 0.845), 0.12, 0.095), ((0, 0.0, 0.87), 0.158, 0.112), ((0, 0.0, 0.93), 0.166, 0.118),
                   ((0, 0.0, 1.03), 0.158, 0.113)], 22, "round", "flat", p=2.4)
    parts.append(_obj("pelvis", pelvis, M["Pants"], LEG))
    for sx, side in ((1, "L"), (-1, "R")):
        X = lambda x: sx * x
        leg = loft([((X(0.094), 0.0, 0.93), 0.08, 0.08), ((X(0.097), 0.0, 0.8), 0.083, 0.082),
                    ((X(0.099), 0.0, 0.62), 0.068, 0.068), ((X(0.1), 0.0, 0.49), 0.06, 0.061),
                    ((X(0.1), 0.004, 0.36), 0.061, 0.063), ((X(0.1), 0.0, 0.17), 0.055, 0.056),
                    ((X(0.1), -0.002, 0.11), 0.058, 0.06), ((X(0.1), -0.002, 0.115), 0.048, 0.05)],
                   14, "round", None)
        parts.append(_obj(f"leg{side}", leg, M["Pants"], LEG))
        parts += shoe(M, sx, side)
    return parts


def shoe(M, sx, side):
    X = lambda x: sx * x
    # sole: a rounded slab, toe at -Y
    sole = loft([((X(0.1), 0.085, 0.0), 0.045, 0.012, 3), ((X(0.1), 0.04, 0.0), 0.052, 0.012, 3),
                 ((X(0.1), -0.06, 0.0), 0.056, 0.012, 3), ((X(0.1), -0.13, 0.0), 0.042, 0.012, 3)],
                16, "round", "round", ref=(0, 0, 1))
    transform(sole, Matrix.Translation((0, 0, 0.016)))
    upper = loft([((X(0.1), 0.055, 0.07), 0.042, 0.045), ((X(0.1), 0.025, 0.075), 0.05, 0.062),
                  ((X(0.1), -0.03, 0.06), 0.053, 0.05), ((X(0.1), -0.08, 0.048), 0.05, 0.034),
                  ((X(0.1), -0.112, 0.042), 0.038, 0.024)], 16, "round", "round", ref=(0, 0, 1))
    collar = loft([((X(0.1), 0.03, 0.115), 0.052, 0.058), ((X(0.1), 0.03, 0.135), 0.05, 0.054)], 14, None, None)
    laces = []
    for k, (y, z) in enumerate(((-0.05, 0.1), (-0.025, 0.112), (0.0, 0.124))):
        laces.append(_obj(f"lace{side}{k}", rbox((X(0.1), y, z), (0.05, 0.008, 0.008), 0.003, 1), M["Sole"], f"shin_{side}"))
    return [_obj(f"sole{side}", sole, M["Sole"], f"shin_{side}"), _obj(f"shoe{side}", upper, M["Shoes"], f"shin_{side}"),
            _obj(f"shoecollar{side}", collar, M["Shoes"], f"shin_{side}")] + laces


def build_mesh(M):
    parts = []
    parts.append(_obj("head", head_shape(), M["Skin"], "head"))
    parts += face(M)
    neck = loft([((0, 0.012, 1.4), 0.054, 0.052), ((0, 0.01, 1.47), 0.05, 0.049), ((0, 0.01, 1.54), 0.05, 0.05)],
                14, None, None)
    parts.append(_obj("neck", neck, M["Skin"], NECK))
    parts += torso(M)
    parts += arms(M)
    parts += legs(M)
    return join_objs(parts, "body")


# ----------------------------------------------------------------------------- hair and hats

def _scalp(scale=1.04, cut=None, thick=0.007):
    """A shell hugging the skull (same deformation as the head) for hair and caps, with a little thickness."""
    bm = head_shape()
    for v in bm.verts:
        v.co = HEAD_C + (v.co - HEAD_C) * scale
    if cut is not None:
        bmesh.ops.delete(bm, geom=[v for v in bm.verts if cut(v.co - HEAD_C)], context="VERTS")
        if thick:
            thicken(bm, thick)
    return bm


def _hairline(d, front=0.045, side=0.0, back=-0.07, wave=0.0):
    """True for points below the hairline (relative to head centre): high at the forehead, low at the nape."""
    ang = math.atan2(d.x, -d.y)  # 0 = face, pi = back of the head
    t = abs(ang) / math.pi
    line = front + (side - front) * _smooth(0.0, 0.5, t) + (back - side) * _smooth(0.5, 1.0, t)
    if wave:
        line += wave * math.sin(ang * 9) * (1 - _smooth(0.3, 0.6, t))
    return d.z < line


def hair_styles(M):
    acc = {}
    H = M["Hair"]
    # short: a cap with a soft side-swept fringe and a few tufts on top
    short = [_obj("hs_cap", _scalp(1.06, lambda d: _hairline(d, 0.085, 0.02, -0.075, 0.012)), H, "head")]
    swoop = loft([((0.075, -0.09, 1.79), 0.02, 0.03), ((0.02, -0.112, 1.785), 0.03, 0.036),
                  ((-0.045, -0.105, 1.77), 0.024, 0.03), ((-0.09, -0.08, 1.75), 0.012, 0.02)], 10, "round", "round",
                 ref=(0, 0, 1))
    short.append(_obj("hs_swoop", swoop, H, "head"))
    for i, (x, y, z, r) in enumerate(((0.04, -0.05, 1.8, 0.05), (-0.04, -0.02, 1.81, 0.045), (0.0, 0.04, 1.805, 0.05))):
        short.append(_obj(f"hs_tuft{i}", ellipsoid((x, y, z), (r, r * 1.2, r * 0.6), 10, 6), H, "head"))
    acc["hair_short"] = join_objs(short, "hair_short")

    # buzz cut: barely there
    acc["hair_buzz"] = _obj("hair_buzz", _scalp(1.018, lambda d: _hairline(d, 0.1, 0.03, -0.08)), H, "head")

    # long: cap, fringe parted in the middle, curtains down to the shoulders
    longp = [_obj("hl_cap", _scalp(1.065, lambda d: _hairline(d, 0.095, -0.02, -0.2)), H, "head")]
    for sx in (1, -1):
        part = ellipsoid((sx * 0.06, -0.1, 1.755), (0.075, 0.035, 0.028), 12, 8)
        transform(part, Matrix.Translation((sx * 0.06, -0.1, 1.755)) @ Matrix.Rotation(sx * 0.35, 4, "Y")
                  @ Matrix.Translation((-sx * 0.06, 0.1, -1.755)))
        longp.append(_obj(f"hl_part{sx}", part, H, "head"))
        lock = loft([((sx * 0.13, -0.06, 1.7), 0.03, 0.05), ((sx * 0.155, -0.04, 1.6), 0.032, 0.055),
                     ((sx * 0.16, -0.01, 1.48), 0.03, 0.05), ((sx * 0.15, 0.01, 1.38), 0.018, 0.035)], 10, "round", "round")
        longp.append(_obj(f"hl_lock{sx}", lock, H, "head"))
    back = loft([((0, 0.05, 1.72), 0.15, 0.1), ((0, 0.07, 1.6), 0.165, 0.1), ((0, 0.085, 1.48), 0.16, 0.075),
                 ((0, 0.09, 1.37), 0.14, 0.05)], 18, "round", "round")
    longp.append(_obj("hl_back", back, H, "head"))
    acc["hair_long"] = join_objs(longp, "hair_long")

    # bun: slicked back with a top knot and a dark hair tie
    bun = [_obj("hb_cap", _scalp(1.035, lambda d: _hairline(d, 0.1, 0.02, -0.08)), H, "head"),
           _obj("hb_bun", ellipsoid((0, 0.06, 1.825), (0.07, 0.066, 0.06), 14, 10), H, "head"),
           _obj("hb_tie", loft([((0, 0.04, 1.775), 0.045, 0.042), ((0, 0.042, 1.79), 0.046, 0.043)], 12), M["Eyes"], "head")]
    acc["hair_bun"] = join_objs(bun, "hair_bun")

    # ponytail: slicked back, tail hanging behind
    pony = [_obj("hp_cap", _scalp(1.035, lambda d: _hairline(d, 0.1, 0.02, -0.06)), H, "head"),
            _obj("hp_tie", loft([((0, 0.15, 1.69), 0.03, 0.03), ((0, 0.162, 1.68), 0.03, 0.03)], 10), M["Eyes"], "head"),
            _obj("hp_tail", loft([((0, 0.155, 1.69), 0.035, 0.035), ((0, 0.19, 1.62), 0.05, 0.045),
                                  ((0, 0.2, 1.52), 0.045, 0.04), ((0, 0.19, 1.43), 0.02, 0.02)], 12, "round", "round"),
                 H, "head")]
    acc["hair_pony"] = join_objs(pony, "hair_pony")

    # curly: a round crown of puffs (fibonacci spread over the top of the head)
    curly = [_obj("hc_cap", _scalp(1.07, lambda d: _hairline(d, 0.09, 0.0, -0.08)), H, "head")]
    n = 46
    for i in range(n):
        y = 1 - (i + 0.5) / n * 1.15
        if y < -0.15:
            continue
        r = math.sqrt(max(0.0, 1 - y * y))
        a = i * math.pi * (3 - math.sqrt(5))
        d = Vector((math.cos(a) * r, math.sin(a) * r, y))
        if d.y < -0.45 and d.z < 0.35:  # keep the face clear
            continue
        c = HEAD_C + Vector((d.x * 0.17, d.y * 0.165, d.z * 0.18 + 0.03))
        curly.append(_obj(f"hc{i}", ellipsoid(c, (0.052, 0.052, 0.048), 10, 7), H, "head"))
    acc["hair_curly"] = join_objs(curly, "hair_curly")

    # beanie: dome, folded ribbed cuff, pom-pom, hair peeking out at the back
    hat = M["Hat"]
    tilt = 0.24
    dome = _scalp(1.1, lambda d: d.z < 0.03 - math.tan(tilt) * d.y)
    cuff_rings = []
    for k in range(5):
        z = 1.643 + k * 0.016
        bulge = 0.004 if k in (1, 2, 3) else 0
        cuff_rings.append(((0, 0.005, z), 0.164 + bulge, 0.16 + bulge))
    cuff = loft(cuff_rings, 28)
    pivot = Vector((0, 0.005, 1.675))
    transform(cuff, Matrix.Translation(pivot) @ Matrix.Rotation(-tilt, 4, "X") @ Matrix.Translation(-pivot))
    beanie = [_obj("bn_dome", dome, hat, "head"), _obj("bn_cuff", cuff, hat, "head"),
              _obj("bn_pom", ellipsoid((0, 0.01, 1.84), (0.045, 0.045, 0.04), 12, 8), hat, "head"),
              _obj("bn_hair", _scalp(1.045, lambda d: d.z > -0.01 or d.y < 0.02 or d.z < -0.09), H, "head")]
    acc["hat_beanie"] = join_objs(beanie, "hat_beanie")

    # cap: six-panel crown with a button, curved visor, short hair at the sides
    crown = _scalp(1.085, lambda d: d.z < 0.075 - 0.075 * (d.y / HEAD_R + 1) / 2)
    visor = loft([((0, -0.12, 1.722), 0.13, 0.004, 2.0), ((0, -0.19, 1.714), 0.12, 0.004, 2.0),
                  ((0, -0.235, 1.703), 0.09, 0.004, 2.0)], 18, None, "round", ref=(0, 0, 1))
    for v in visor.verts:  # curve the brim
        v.co.z -= (v.co.x / 0.13) ** 2 * 0.018
    thicken(visor, 0.008)
    cap = [_obj("cp_crown", crown, hat, "head"), _obj("cp_visor", visor, hat, "head"),
           _obj("cp_button", ellipsoid((0, 0.004, 1.815), (0.014, 0.014, 0.008), 8, 6), hat, "head"),
           _obj("cp_hair", _scalp(1.04, lambda d: d.z > 0.0 or d.y < -0.05 or d.z < -0.085), H, "head")]
    acc["hat_cap"] = join_objs(cap, "hat_cap")
    return acc


# ----------------------------------------------------------------------------- tops, beard, glasses, apron

def long_sleeves(material, extra=0.0, name="ls"):
    parts = []
    for sx, side in ((1, "L"), (-1, "R")):
        X = lambda x: sx * x
        sl = loft([((X(0.215), 0.0, 1.33), 0.062 + extra, 0.06 + extra), ((X(0.238), 0.0, 1.22), 0.061 + extra, 0.059 + extra),
                   ((X(0.25), 0.0, 1.12), 0.055 + extra, 0.054 + extra), ((X(0.259), 0.0, 1.0), 0.05 + extra, 0.048 + extra),
                   ((X(0.264), 0.0, 0.93), 0.046 + extra, 0.044 + extra), ((X(0.265), 0.0, 0.905), 0.047 + extra, 0.045 + extra),
                   ((X(0.265), 0.0, 0.91), 0.037, 0.035)], 14, "round", None)
        parts.append(_obj(f"{name}{side}", sl, material, ARM))
    return parts


def tops(M):
    acc = {}
    S = M["Shirt"]
    acc["longsleeve"] = join_objs(long_sleeves(S), "longsleeve")

    # hoodie: long sleeves, hood bunched at the back, kangaroo pocket, drawstrings, ribbed hem
    roll = [Vector((math.sin(a) * 0.098, 0.012 - math.cos(a) * 0.085 + 0.012, 1.44 + 0.02 * (1 - math.cos(a))))
            for a in [math.radians(x) for x in range(-150, 151, 25)]]
    hood = tube(roll, 0.032, 10)
    sack = ellipsoid((0, 0.135, 1.43), (0.11, 0.05, 0.1), 16, 10)
    pocket = loft([((0, -0.124, 0.99), 0.12, 0.012, 3), ((0, -0.13, 1.06), 0.13, 0.012, 3),
                   ((0, -0.124, 1.12), 0.1, 0.01, 3)], 16, "round", "round")
    strings = [tube([(sx * 0.03, -0.1, 1.425), (sx * 0.034, -0.128, 1.36), (sx * 0.036, -0.135, 1.29)], 0.0045, 6)
               for sx in (1, -1)]
    hem = loft([((0, 0.0, 0.955), 0.176, 0.127, 2.3), ((0, 0.0, 0.99), 0.171, 0.123, 2.3)], 24)
    hoodie = long_sleeves(S, 0.002, "hd") + [_obj("hd_hood", hood, S, "chest"), _obj("hd_sack", sack, S, "chest"),
                                             _obj("hd_pocket", pocket, S, torso_weights),
                                             _obj("hd_hem", hem, S, torso_weights)]
    hoodie += [_obj(f"hd_string{i}", s, M["EyeWhite"], torso_weights) for i, s in enumerate(strings)]
    acc["hoodie"] = join_objs(hoodie, "hoodie")

    # jacket: open shell over the tee (its own colour), collar, long sleeves
    J = M["Jacket"]
    rings = [((0, 0.0, 0.92), 0.186, 0.135, 2.4), ((0, 0.0, 1.0), 0.18, 0.131, 2.4), ((0, 0.0, 1.08), 0.176, 0.128, 2.4),
             ((0, 0.002, 1.17), 0.186, 0.135, 2.5), ((0, 0.004, 1.26), 0.2, 0.142, 2.5), ((0, 0.006, 1.33), 0.206, 0.138, 2.6),
             ((0, 0.008, 1.375), 0.19, 0.126, 2.4), ((0, 0.01, 1.41), 0.145, 0.104, 2.2), ((0, 0.012, 1.44), 0.09, 0.08, 2.0)]
    # arc leaves a gap at the front (-Y is at 0.75 turns in this frame)
    shell = loft(rings, 26, arc=(0.79, 0.79 + 0.92))
    thicken(shell, 0.008)
    collar = loft([((0, 0.02, 1.43), 0.095, 0.085), ((0, 0.03, 1.47), 0.1, 0.09)], 20, arc=(0.82, 0.82 + 0.86))
    thicken(collar, 0.008)
    jacket = long_sleeves(J, 0.01, "jk") + [_obj("jk_shell", shell, J, torso_weights), _obj("jk_collar", collar, J, NECK)]
    acc["jacket"] = join_objs(jacket, "jacket")
    return acc


def beard(M):
    def cut(co):
        d = co - HEAD_C
        line = -0.045 + 0.06 * (abs(d.x) / HEAD_R) ** 1.6
        return d.z > line or d.y > 0.04
    bm = _scalp(1.06, None)
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if cut(v.co)], context="VERTS")
    tache = tube([(x, face_y(x, z, 0.004), z) for x, z in ((0.036, 1.588), (0.013, 1.598), (-0.013, 1.598), (-0.036, 1.588))],
                 0.0085, 8)
    # the lip stays visible: push the beard below the mouth
    for v in bm.verts:
        if abs(v.co.x) < 0.04 and v.co.z > 1.555 and v.co.y < -0.1:
            v.co.z = 1.555
    return join_objs([_obj("beard_main", bm, M["Hair"], "head"), _obj("beard_tache", tache, M["Hair"], "head")], "beard")


def rim(center, rx, rz, r, segs=24, tsegs=6):
    """An elliptical frame ring in the XZ plane (glasses)."""
    bm = bmesh.new()
    rows = []
    for i in range(segs):
        a = i / segs * math.tau
        c = Vector(center) + Vector((math.cos(a) * rx, 0, math.sin(a) * rz))
        radial = Vector((math.cos(a), 0, math.sin(a)))
        row = []
        for j in range(tsegs):
            b = j / tsegs * math.tau
            row.append(bm.verts.new(c + radial * math.cos(b) * r + Vector((0, math.sin(b) * r * 1.4, 0))))
        rows.append(row)
    for i in range(segs):
        a, b = rows[i], rows[(i + 1) % segs]
        for j in range(tsegs):
            bm.faces.new((a[j], a[(j + 1) % tsegs], b[(j + 1) % tsegs], b[j]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


def glasses(M):
    parts = []
    G = M["Glasses"]
    ez = 1.662
    for sx in (1, -1):
        y = face_y(0.057, ez, 0.03)
        parts.append(_obj(f"rim{sx}", rim((sx * 0.057, y, ez), 0.033, 0.029, 0.0045), G, "head"))
        temple = tube([(sx * 0.09, y + 0.004, ez + 0.004), (sx * 0.15, -0.08, ez + 0.004), (sx * 0.155, 0.01, ez - 0.02)],
                      0.0035, 6)
        parts.append(_obj(f"temple{sx}", temple, G, "head"))
    y0 = face_y(0.0, ez, 0.034)
    parts.append(_obj("gl_bridge", tube([(0.024, y0 + 0.004, ez + 0.006), (0.0, y0, ez + 0.012), (-0.024, y0 + 0.004, ez + 0.006)],
                                        0.0035, 6), G, "head"))
    return join_objs(parts, "glasses")


def apron(M):
    A = M["Apron"]
    rings = []
    for k in range(9):
        z = 0.76 + k * 0.07
        w = 0.15 if z < 1.2 else 0.15 - (z - 1.2) * 0.45
        rings.append(((0, -0.0, z), w, 0.0))
    # a curved panel that wraps the body a little
    panel = bmesh.new()
    cols = 9
    grid = []
    for k, (c, w, _) in enumerate(rings):
        z = c[2]
        body_r = 0.125 if z > 1.0 else 0.122
        row = []
        for j in range(cols):
            u = (j / (cols - 1)) * 2 - 1
            x = u * w
            y = -(body_r + 0.022) + (abs(x) / 0.2) ** 2 * 0.07 - (0.01 if z < 0.95 else 0)
            row.append(panel.verts.new((x, y, z)))
        grid.append(row)
    for a, b in zip(grid, grid[1:]):
        for j in range(cols - 1):
            panel.faces.new((a[j], b[j], b[j + 1], a[j + 1]))
    thicken(panel, 0.008)
    pocket = rbox((0, -0.162, 0.92), (0.16, 0.012, 0.1), 0.006, 2)
    neck_strap = tube([(0.06, -0.135, 1.33), (0.07, -0.08, 1.43), (0.0, 0.07, 1.45), (-0.07, -0.08, 1.43),
                       (-0.06, -0.135, 1.33)], 0.008, 6)
    ties = [tube([(sx * 0.15, -0.13, 1.06), (sx * 0.19, 0.0, 1.06), (sx * 0.06, 0.14, 1.06), (sx * 0.03, 0.15, 0.96)],
                 0.008, 6) for sx in (1, -1)]
    parts = [_obj("ap_panel", panel, A, torso_weights), _obj("ap_pocket", pocket, A, torso_weights),
             _obj("ap_strap", neck_strap, A, NECK)] + [_obj(f"ap_tie{i}", t, A, torso_weights) for i, t in enumerate(ties)]
    logo = text("apron_logo", "KRONKEL", (0, 1.12, 0.162), 0.05, M["ApronText"], 0.0, font_kind="sans")
    lb = bmesh.new()
    lb.from_mesh(logo.data)
    bpy.data.objects.remove(logo)
    parts.append(_obj("ap_logo", lb, M["ApronText"], torso_weights, False))
    return join_objs(parts, "apron")


def accessories(M):
    acc = hair_styles(M)
    acc.update(tops(M))
    acc["tee_sleeves"] = tee_sleeves(M)
    acc["glasses"] = glasses(M)
    acc["beard"] = beard(M)
    acc["apron"] = apron(M)
    return acc


# ----------------------------------------------------------------------------- rig + animation

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


# Rotations are given in armature space (rest frame) degrees.
# Character faces -Y. -X rotation swings a hanging limb forward; +X bends a knee back.

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


def relaxed_arms(a, out=7, bend=10):
    set_rot(a, "upperarm_L", 0, -out, 0)
    set_rot(a, "upperarm_R", 0, out, 0)
    set_rot(a, "forearm_L", -bend)
    set_rot(a, "forearm_R", -bend)


def walk_legs(arm, phase, stride=26, knee=42, arms=True, bob=True):
    """phase 0..1 through one step cycle."""
    s = math.sin(phase * math.tau)
    c = math.cos(phase * math.tau)
    set_rot(arm, "thigh_L", -stride * s)
    set_rot(arm, "thigh_R", stride * s)
    # knees bend while the leg swings forward
    set_rot(arm, "shin_L", 5 + knee * max(0.0, c) ** 1.3)
    set_rot(arm, "shin_R", 5 + knee * max(0.0, -c) ** 1.3)
    if arms:
        set_rot(arm, "upperarm_L", stride * 0.75 * s, -6, 0)
        set_rot(arm, "upperarm_R", -stride * 0.75 * s, 6, 0)
        set_rot(arm, "forearm_L", -16 - 14 * max(0, -s))
        set_rot(arm, "forearm_R", -16 - 14 * max(0, s))
    if bob:
        set_loc(arm, "hips", 0, 0, 0.028 * abs(math.cos(phase * math.tau)) - 0.022)
    set_rot(arm, "hips", 0, 3 * c, 6 * s)
    set_rot(arm, "chest", -4, 0, -8 * s)
    set_rot(arm, "head", 2, 0, 3 * s)


def animate(arm):
    fps = 24
    bpy.context.scene.render.fps = fps

    def idle(t):
        def f(a):
            w = math.sin(t * math.tau)
            set_loc(a, "hips", 0.008 * w, 0, -0.003)
            set_rot(a, "hips", 0, -1.5 * w, 0)
            set_rot(a, "spine", 0, 1.5 * w, 0)
            set_rot(a, "chest", -2 * math.sin(t * math.tau * 2), 0, 0)
            set_rot(a, "head", 3 * math.sin(t * math.tau), 0, 7 * math.sin(t * math.tau + 1))
            relaxed_arms(a, 7 + 1.5 * w, 10)
            set_rot(a, "thigh_L", 0, -1.5 * w, 0)
            set_rot(a, "thigh_R", 0, -1.5 * w, 0)
        return f

    new_action(arm, "Idle", [(i * 15, idle(i / 4)) for i in range(5)])

    def walk(t):
        return lambda a: walk_legs(a, t)

    new_action(arm, "Walk", [(i * 3, walk(i / 8)) for i in range(9)])

    def sit(t):
        def f(a):
            set_loc(a, "hips", 0, 0.06, -0.39)
            set_rot(a, "thigh_L", -88, 0, 4)
            set_rot(a, "thigh_R", -88, 0, -4)
            set_rot(a, "shin_L", 86)
            set_rot(a, "shin_R", 86)
            set_rot(a, "spine", -5 + 2 * math.sin(t * math.tau))
            set_rot(a, "chest", 5)
            set_rot(a, "upperarm_L", -32, 10, 0)
            set_rot(a, "upperarm_R", -32, -10, 0)
            set_rot(a, "forearm_L", -50, -12, 0)
            set_rot(a, "forearm_R", -50, 12, 0)
            set_rot(a, "head", 4 * math.sin(t * math.tau), 0, 12 * math.sin(t * math.tau + 0.5))
        return f

    new_action(arm, "Sit", [(i * 18, sit(i / 4)) for i in range(5)])

    def wave(t):
        def f(a):
            set_rot(a, "upperarm_R", 0, 150, 0)
            set_rot(a, "forearm_R", 0, 22 * math.sin(t * math.tau * 2), 0)
            set_rot(a, "upperarm_L", 0, -7, 0)
            set_rot(a, "forearm_L", -10)
            set_rot(a, "head", 0, 0, -8)
            set_rot(a, "chest", 0, -5, 0)
        return f

    new_action(arm, "Wave", [(i * 4, wave(i / 6)) for i in range(7)])

    def talk(t):
        def f(a):
            s = math.sin(t * math.tau)
            set_rot(a, "upperarm_R", -22 - 10 * s, -10, 0)
            set_rot(a, "forearm_R", -62 - 18 * s, 0, 0)
            set_rot(a, "upperarm_L", -10, 8, 0)
            set_rot(a, "forearm_L", -28 + 12 * s)
            set_rot(a, "head", 5 * math.sin(t * math.tau * 2), 0, 6 * s)
            set_rot(a, "chest", -2 * s, 0, 4 * s)
        return f

    new_action(arm, "Talk", [(i * 6, talk(i / 4)) for i in range(5)])

    def carry(a):
        set_rot(a, "upperarm_L", -38, 12, 0)
        set_rot(a, "upperarm_R", -38, -12, 0)
        set_rot(a, "forearm_L", -52, -20, 0)
        set_rot(a, "forearm_R", -52, 20, 0)

    def carry_walk(t):
        def f(a):
            walk_legs(a, t, 20, 32, arms=False)
            carry(a)
        return f

    new_action(arm, "CarryWalk", [(i * 3, carry_walk(i / 8)) for i in range(9)])

    def carry_idle(t):
        def f(a):
            carry(a)
            set_rot(a, "chest", -1.5 * math.sin(t * math.tau))
            set_rot(a, "head", 0, 0, 5 * math.sin(t * math.tau))
        return f

    new_action(arm, "CarryIdle", [(i * 12, carry_idle(i / 4)) for i in range(5)])


def materials():
    return {
        "Skin": mat("Skin", "#e0ac84", 0.62),
        "Shirt": mat("Shirt", "#3f7a52", 0.9),
        "Jacket": mat("Jacket", "#2a2f3a", 0.75),
        "Pants": mat("Pants", "#2d3a52", 0.9),
        "Shoes": mat("Shoes", "#e8e4dc", 0.6),
        "Sole": mat("Sole", "#f4f1ea", 0.7),
        "Hair": mat("Hair", "#3a2618", 0.75),
        "Eyes": mat("Eyes", "#1a1410", 0.25),
        "EyeWhite": mat("EyeWhite", "#f7f4ee", 0.3),
        "Mouth": mat("Mouth", "#6b2a2a", 0.6),
        "Hat": mat("Hat", "#b8322f", 0.9),
        "Glasses": mat("Glasses", "#151515", 0.3, 0.4),
        "Apron": mat("Apron", "#1d4a2f", 0.85),
        "ApronText": mat("ApronText", "#e9d9a8", 0.6),
    }


ACCESSORY_NAMES = ["hair_short", "hair_long", "hair_bun", "hair_curly", "hair_pony", "hair_buzz", "hat_beanie",
                   "hat_cap", "tee_sleeves", "longsleeve", "hoodie", "jacket", "glasses", "beard", "apron"]


def build():
    M = materials()
    arm = make_armature()
    body = build_mesh(M)
    acc = accessories(M)
    for o in [body] + list(acc.values()):
        skin(o, arm)
    animate(arm)
    print("[people] verts:", len(body.data.vertices), {k: len(v.data.vertices) for k, v in acc.items()})
    return [arm, body] + list(acc.values())


def preview_lineup(path, samples=48, looks=None, cam=None):
    """Duplicate the rig a few times with different outfits for a showcase render."""
    from lib import render_preview, G
    arm = bpy.data.objects["Person"]
    meshes = [o for o in bpy.data.objects if o.parent == arm]
    looks = looks or [
        dict(skin="#f1c7a3", shirt="#efe6cf", pants="#2d3a52", hair="#3a2618", acc=["hair_short", "apron"], pose="Idle",
             frame=0),
        dict(skin="#8a5a3c", shirt="#d9772b", pants="#3b3b3b", hair="#1b1210", acc=["hair_curly", "hoodie"], pose="Wave",
             frame=6),
        dict(skin="#c68a5e", shirt="#efe6cf", pants="#4a5d7a", hair="#151010", acc=["hat_beanie", "beard", "jacket"],
             pose="Walk", frame=3, hat="#2f5b8f", jacket="#5a3a2a"),
        dict(skin="#f3d2b8", shirt="#b8322f", pants="#2a2a2a", hair="#d9b46a", acc=["hair_long", "glasses"],
             pose="Talk", frame=6),
        dict(skin="#e0ac84", shirt="#6b3f8f", pants="#5a4a3a", hair="#6b3a1e", acc=["hair_pony", "longsleeve"],
             pose="Idle", frame=24),
        dict(skin="#b07a55", shirt="#2f5b8f", pants="#c9b38f", hair="#222", acc=["hat_cap"], pose="CarryIdle", frame=0,
             hat="#1d4a2f", shoes="#c0392b"),
        dict(skin="#5c3a26", shirt="#e3b23c", pants="#1e2a3a", hair="#111", acc=["hair_buzz", "beard"], pose="Idle",
             frame=12),
    ]
    for i, look in enumerate(looks):
        if not any(t in look["acc"] for t in ("hoodie", "jacket")):
            look["acc"] = look["acc"] + ["tee_sleeves"]
        a2 = arm.copy()
        a2.data = arm.data.copy()
        a2.animation_data_clear()
        bpy.context.scene.collection.objects.link(a2)
        a2.location = look.get("loc", (-3.0 + i * 1.0, 0, 0))
        a2.rotation_euler = (0, 0, math.radians(look.get("rot", -15 + i * 5)))
        mats = {}
        for key, col in (("Skin", look["skin"]), ("Shirt", look["shirt"]), ("Pants", look["pants"]),
                         ("Hair", look["hair"]), ("Hat", look.get("hat", "#b8322f")), ("Shoes", look.get("shoes", "#e8e4dc")),
                         ("Jacket", look.get("jacket", "#2a2f3a"))):
            m = bpy.data.materials[key].copy()
            m.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = rgb(col)
            mats[key] = m
        for o in meshes:
            if o.name in ACCESSORY_NAMES and o.name not in look["acc"]:
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
    pos, target, lens = cam or ((0.0, 1.3, 7.4), (0.0, 0.9, 0.0), 36)
    render_preview(path, pos, target, lens, size=(1280, 640), samples=samples, sun=True,
                   world="#d9e2ea", world_strength=0.8)
