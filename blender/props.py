"""Small props the game spawns: drinks, food, products, board games, tray, ID card.

Each prop is one top-level node named prop_<id>, origin at the bottom centre. Materials named
ShakeFill / GameBox are recoloured per instance in the game. Round things are turned on a lathe
(`lathe`), so glasses have real walls and rims, plates have a foot and a well, cream is swirled.
"""
import math
import random

import bmesh
import bpy
from mathutils import Matrix, Vector

from lib import box, boxc, cyl, join, mat, render_preview, sphere, text, torus, tube, _finish, G

rnd = random.Random(42)
M = {}


# ----------------------------------------------------------------------------- helpers (game coords: y up)

def lathe(name, profile, material, center=(0, 0, 0), segs=24, smooth=40, scale_z=1.0, phase=0.0):
    """Revolve [(radius, height)] around the vertical axis. A radius of 0 closes the end."""
    bm = bmesh.new()
    rows = []
    c = G(*center)
    for r, y in profile:
        if r <= 1e-6:
            rows.append([bm.verts.new(c + Vector((0, 0, y)))])
            continue
        row = []
        for k in range(segs):
            a = (k / segs + phase) * math.tau
            row.append(bm.verts.new(c + Vector((math.cos(a) * r, math.sin(a) * r * scale_z, y))))
        rows.append(row)
    for a, b in zip(rows, rows[1:]):
        if len(a) == 1 and len(b) == 1:
            continue
        if len(a) == 1:
            for k in range(segs):
                bm.faces.new((a[0], b[k], b[(k + 1) % segs]))
        elif len(b) == 1:
            for k in range(segs):
                bm.faces.new((a[k], b[0], a[(k + 1) % segs]))
        else:
            for k in range(segs):
                bm.faces.new((a[k], a[(k + 1) % segs], b[(k + 1) % segs], b[k]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return _finish(bm, name, material, smooth)


def glass_profile(r_bot, r_top, h, wall=0.0035, base=0.008, flare=None):
    """Outer wall up, rim, inner wall down to a thick base: a tumbler with real thickness."""
    out = [(0, 0), (r_bot, 0), (r_bot + 0.001, 0.003)]
    mid = flare or []
    out += [(r, y) for r, y in mid]
    out += [(r_top, h), (r_top - wall * 0.5, h + 0.0015), (r_top - wall, h)]
    out += [(r - wall, y) for r, y in reversed(mid)]
    out += [(r_bot - wall, base), (0, base)]
    return out


def fill_profile(r_bot, r_top, h_glass, level, base=0.008, wall=0.0035, meniscus=0.0):
    r_at = lambda y: r_bot + (r_top - r_bot) * (y / h_glass)
    top = base + level
    return [(0, base + 0.0005), (r_at(base) - wall - 0.0005, base + 0.0005),
            (r_at(top) - wall - 0.0005, top), (r_at(top) * 0.6, top + meniscus), (0, top + meniscus)]


def plate(parts, name, r=0.12, well=0.7):
    """Porcelain plate: foot ring, sloped rim, flat well."""
    prof = [(0, 0.004), (r * 0.55, 0.004), (r * 0.58, 0.0), (r * 0.62, 0.0), (r * 0.64, 0.005), (r * well, 0.007),
            (r * 0.98, 0.014), (r, 0.017), (r * 0.99, 0.019), (r * 0.96, 0.017), (r * well - 0.004, 0.0095),
            (0, 0.0095)]
    parts.append(lathe(name + "plate", prof, M["white"], segs=28))


def swirl(name, center, r, h, material, turns=2.5, tube_r=None):
    """Whipped cream: a stack of shrinking rings topped with a peak."""
    parts = []
    n = 4
    for i in range(n):
        f = i / n
        rr = r * (1 - f * 0.75)
        tr = (tube_r or r * 0.42) * (1 - f * 0.35)
        parts.append(torus(f"{name}{i}", (center[0], center[1] + tr + f * h * 0.75, center[2]), rr * 0.75, tr, material,
                           16, 8, axis="Y"))
    parts.append(lathe(f"{name}pk", [(0, h * 0.7), (r * 0.25, h * 0.72), (0, h * 1.05)], material,
                       (center[0], center[1], center[2]), 10))
    return parts


def leaf(name, center, size, yaw, tilt, material):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=8, v_segments=5, radius=1.0)
    bmesh.ops.scale(bm, vec=Vector((size * 0.45, size, size * 0.12)), verts=bm.verts)
    bmesh.ops.translate(bm, vec=Vector((0, size * 0.9, 0)), verts=bm.verts)
    bmesh.ops.rotate(bm, cent=(0, 0, 0), matrix=Matrix.Rotation(tilt, 3, "X"), verts=bm.verts)
    bmesh.ops.rotate(bm, cent=(0, 0, 0), matrix=Matrix.Rotation(yaw, 3, "Z"), verts=bm.verts)
    bmesh.ops.translate(bm, vec=G(*center), verts=bm.verts)
    return _finish(bm, name, material, 80)


def rounded_box(name, center, size, material, bevel=0.004, rot_y=0.0, segments=3):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=Vector((size[0], size[2], size[1])), verts=bm.verts)
    bmesh.ops.bevel(bm, geom=list(bm.edges), offset=min(bevel, min(size) * 0.45), segments=segments,
                    affect="EDGES", profile=0.5)
    bmesh.ops.rotate(bm, cent=(0, 0, 0), matrix=Matrix.Rotation(rot_y, 3, "Z"), verts=bm.verts)
    bmesh.ops.translate(bm, vec=G(*center), verts=bm.verts)
    return _finish(bm, name, material, 35)


def materials():
    M["white"] = mat("Porcelain", "#f6f3ec", 0.25)
    M["glass"] = mat("Glass", "#d6eef5", 0.05, alpha=0.3)
    M["shake"] = mat("ShakeFill", "#f2a0b4", 0.55)
    M["cream"] = mat("WhippedCream", "#fffaf0", 0.75)
    M["straw"] = mat("Straw", "#2f8f4a", 0.45)
    M["strawred"] = mat("StrawRed", "#d62f2f", 0.45)
    M["cherry"] = mat("Cherry", "#c4161c", 0.2)
    M["stem"] = mat("Stem", "#4b6b2a", 0.7)
    M["tea"] = mat("Tea", "#c9a03a", 0.2, alpha=0.75)
    M["mint"] = mat("Mint", "#3f9a3a", 0.55)
    M["coffee"] = mat("Coffee", "#6b4024", 0.4)
    M["foam"] = mat("Foam", "#e9d6b8", 0.8)
    M["cocoa"] = mat("Cocoa", "#8a5a36", 0.9)
    M["cola"] = mat("Cola", "#3a1a10", 0.15)
    M["ice"] = mat("Ice", "#e8f6ff", 0.05, alpha=0.6)
    M["lemon"] = mat("Lemon", "#f2d53c", 0.5)
    M["rind"] = mat("Rind", "#e8c21a", 0.45)
    M["crust"] = mat("PieCrust", "#c88b46", 0.8)
    M["crustdark"] = mat("PieCrustDark", "#a86a2e", 0.8)
    M["apple"] = mat("AppleFill", "#e0b45a", 0.6)
    M["toast"] = mat("Toast", "#d8a35a", 0.85)
    M["grill"] = mat("GrillMark", "#7a4a20", 0.9)
    M["cheese"] = mat("Cheese", "#f2c94c", 0.55)
    M["ham"] = mat("Ham", "#e39a8f", 0.6)
    M["ketchup"] = mat("Ketchup", "#b3241c", 0.3)
    M["fries"] = mat("Fries", "#f0c75e", 0.7)
    M["paper"] = mat("Paper", "#efe6cf", 0.9)
    M["paperred"] = mat("PaperRed", "#c0392b", 0.8)
    M["mayo"] = mat("Mayo", "#fbf3d5", 0.4)
    M["wood"] = mat("ForkWood", "#d9b98a", 0.8)
    M["bun"] = mat("Bun", "#c98a3e", 0.55)
    M["sesame"] = mat("Sesame", "#f3e3b8", 0.6)
    M["patty"] = mat("Patty", "#5a3220", 0.85)
    M["lettuce"] = mat("Lettuce", "#6fb84a", 0.7)
    M["tomato"] = mat("Tomato", "#d9452c", 0.45)
    M["game"] = mat("GameBox", "#2f5b8f", 0.6)
    M["label"] = mat("Label", "#f4f1ea", 0.7)
    M["ink"] = mat("PrintInk", "#1e1e20", 0.6)
    M["bag"] = mat("Baggie", "#eaf4ee", 0.2, alpha=0.45)
    M["weed"] = mat("Bud", "#6f9a3b", 0.95)
    M["weed2"] = mat("BudDark", "#4f7a2b", 0.95)
    M["hair"] = mat("BudHairs", "#d98a3a", 0.9)
    M["sticker"] = mat("Sticker", "#1d4a2f", 0.6)
    M["yellow"] = mat("StickerYellow", "#ffc814", 0.5)
    M["roll"] = mat("RollPaper", "#f3efe4", 0.85)
    M["filter"] = mat("Filter", "#d9c49a", 0.85)
    M["tubeclear"] = mat("Ice", "#e8f6ff", 0.05, alpha=0.6)
    M["cake"] = mat("CakeBrown", "#6b4a2b", 0.8)
    M["black"] = mat("BlackMetal", "#1e1e20", 0.45, 0.6)
    M["cork"] = mat("Cork", "#b88a5a", 0.95)
    M["lighter"] = mat("LighterBody", "#d9452c", 0.35)
    M["steel"] = mat("Steel", "#c3c7cc", 0.3, 0.9)
    M["card"] = mat("IdCard", "#dce8f2", 0.4)
    M["cardblue"] = mat("IdBlue", "#2b4c8c", 0.5)
    M["chip"] = mat("Chip", "#d9b24a", 0.3, 0.8)
    M["note"] = mat("Banknote", "#9cc9a3", 0.8)
    M["notedark"] = mat("BanknoteDark", "#6f9a78", 0.8)
    M["crumbs"] = mat("Crumbs", "#b58a4a", 0.9)
    M["gold"] = mat("Coins", "#d9b24a", 0.3, 0.9)
    M["skinphoto"] = mat("PhotoSkin", "#d9a27c", 0.6)


def build_prop(name, parts, x):
    flat = []
    for p in parts:
        if isinstance(p, list):
            flat += p
        elif p is not None:
            flat.append(p)
    o = join(flat, f"prop_{name}")
    o.location = (x, 0, 0)
    return o


# ----------------------------------------------------------------------------- drinks

def shake():
    p = []
    # classic soda-fountain glass: foot, slim waist, tall flared bowl
    prof = [(0, 0), (0.034, 0), (0.035, 0.006), (0.02, 0.012), (0.016, 0.03), (0.03, 0.05), (0.041, 0.12),
            (0.05, 0.19), (0.0505, 0.192), (0.047, 0.19), (0.038, 0.12), (0.027, 0.055), (0.015, 0.04), (0, 0.04)]
    p.append(lathe("sg", prof, M["glass"], segs=24))
    p.append(lathe("sf", [(0, 0.041), (0.014, 0.041), (0.026, 0.056), (0.037, 0.12), (0.045, 0.18), (0.03, 0.182),
                          (0, 0.183)], M["shake"], segs=20))
    p += swirl("sc", (0, 0.178, 0), 0.046, 0.075, M["cream"])
    p.append(sphere("ch", (0.004, 0.262, 0.0), 0.014, M["cherry"], 12, 8))
    p.append(tube("chs", [(0.004, 0.274, 0), (0.01, 0.29, 0.004), (0.018, 0.3, 0.004)], 0.0015, M["stem"], 5))
    p.append(tube("st", [(-0.012, 0.06, 0.004), (-0.022, 0.2, 0.012), (-0.03, 0.29, 0.02)], 0.0055, M["strawred"], 10))
    return p


def tea():
    p = [lathe("sau", [(0, 0.0), (0.04, 0.0), (0.042, 0.003), (0.068, 0.009), (0.07, 0.012), (0.066, 0.012),
                       (0.045, 0.007), (0, 0.007)], M["white"], segs=24)]
    # Dutch "verse muntthee": tall glass stuffed with a mint sprig
    p.append(lathe("tg", glass_profile(0.03, 0.038, 0.12, base=0.012), M["glass"], (0, 0.007, 0), 20))
    p.append(lathe("tt", fill_profile(0.03, 0.038, 0.12, 0.085, 0.012), M["tea"], (0, 0.007, 0), 18))
    p.append(tube("ms", [(0.004, 0.03, 0.0), (0.0, 0.1, 0.004), (-0.004, 0.16, 0.0)], 0.0025, M["stem"], 5))
    for i in range(9):
        a = i * 2.4
        y = 0.07 + i * 0.011
        p.append(leaf(f"m{i}", (math.sin(a) * 0.006, y, math.cos(a) * 0.006), 0.018 - i * 0.0006, a, 0.9 - i * 0.04,
                      M["mint"]))
    return p


def coffee():
    p = [lathe("sau", [(0, 0.0), (0.04, 0.0), (0.042, 0.003), (0.068, 0.009), (0.07, 0.012), (0.066, 0.012),
                       (0.045, 0.007), (0, 0.007)], M["white"], segs=24)]
    cup = [(0, 0.007), (0.026, 0.007), (0.028, 0.012), (0.04, 0.035), (0.046, 0.07), (0.047, 0.075), (0.044, 0.075),
           (0.042, 0.068), (0, 0.068)]
    p.append(lathe("cup", cup, M["white"], segs=24))
    p.append(lathe("cof", [(0, 0.0675), (0.043, 0.0675), (0.035, 0.0695), (0, 0.07)], M["foam"], segs=20))
    # latte-art heart in cocoa
    p.append(sphere("heart1", (-0.006, 0.0702, 0.003), 0.008, M["cocoa"], 10, 4, (1, 0.12, 1)))
    p.append(sphere("heart2", (0.006, 0.0702, 0.003), 0.008, M["cocoa"], 10, 4, (1, 0.12, 1)))
    p.append(sphere("heart3", (0.0, 0.0702, -0.006), 0.009, M["cocoa"], 10, 4, (0.8, 0.12, 0.8)))
    p.append(torus("handle", (0.05, 0.045, 0), 0.016, 0.0045, M["white"], 14, 6, axis="Z"))
    # little spoon on the saucer and a speculaas biscuit, as you get in NL
    p.append(boxc("spoon", (-0.052, 0.012, 0.012), (0.004, 0.003, 0.05), M["steel"], 0.001, 0.4))
    p.append(rounded_box("koek", (0.03, 0.012, -0.045), (0.035, 0.005, 0.022), M["crustdark"], 0.002, 0.3))
    return p


def cola():
    prof = glass_profile(0.033, 0.04, 0.14, base=0.01)
    p = [lathe("cg", prof, M["glass"], segs=20)]
    p.append(lathe("cl", fill_profile(0.033, 0.04, 0.14, 0.11, 0.01), M["cola"], segs=18))
    for i in range(3):
        p.append(rounded_box(f"ice{i}", (0.012 * (i - 1), 0.112 + i * 0.008, 0.007 * (i - 1)), (0.022, 0.022, 0.022), M["ice"],
                             0.005, i * 0.6))
    # lemon wheel on the rim
    p.append(cyl("lem", (0.036, 0.14, -0.012), 0.022, 0.006, M["rind"], 16, axis="X"))
    p.append(cyl("lem2", (0.0365, 0.14, -0.012), 0.019, 0.007, M["lemon"], 16, axis="X"))
    p.append(tube("st", [(-0.004, 0.04, 0.0), (0.008, 0.16, -0.01), (0.01, 0.2, -0.014)], 0.0045, M["strawred"], 8))
    return p


# ----------------------------------------------------------------------------- food

def wedge(name, center, r, h, angle, material, round_back=True):
    """Pie/sandwich wedge: apex at center, opening toward +z, with a curved back."""
    bm = bmesh.new()
    n = 8 if round_back else 1
    pts = [(0.0, 0.0)] + [(math.sin(-angle / 2 + angle * k / n) * r, math.cos(-angle / 2 + angle * k / n) * r)
                          for k in range(n + 1)]
    lo = [bm.verts.new(G(center[0] + x, center[1], center[2] + z)) for x, z in pts]
    hi = [bm.verts.new(G(center[0] + x, center[1] + h, center[2] + z)) for x, z in pts]
    bm.faces.new(lo)
    bm.faces.new(list(reversed(hi)))
    for i in range(len(pts)):
        j = (i + 1) % len(pts)
        bm.faces.new((lo[i], lo[j], hi[j], hi[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bmesh.ops.bevel(bm, geom=[e for e in bm.edges if e.calc_face_angle(0) > 0.6], offset=0.004, segments=2,
                    affect="EDGES")
    return _finish(bm, name, material, 40)


def pie():
    p = []
    plate(p, "pp", 0.1)
    # tall Dutch appeltaart slice: crust, apple filling showing on the cut, lattice on top
    ang = math.radians(48)
    p.append(wedge("crust", (0, 0.0095, -0.055), 0.115, 0.055, ang, M["crust"]))
    p.append(wedge("fill", (0, 0.016, -0.0565), 0.1, 0.042, ang - 0.12, M["apple"]))
    for i in range(3):
        z = -0.035 + i * 0.03
        w = 2 * (z + 0.055) * math.tan(ang / 2) + 0.004
        p.append(rounded_box(f"lat{i}", (0, 0.066, z), (w, 0.006, 0.009), M["crustdark"], 0.002))
    p.append(rounded_box("latc", (0, 0.067, -0.0), (0.008, 0.006, 0.09), M["crustdark"], 0.002))
    p += swirl("cr", (0.045, 0.0095, 0.03), 0.022, 0.035, M["cream"])
    return p


def slab(name, pts, y, h, material, rot=0.0, offset=(0, 0), bevel=0.003):
    """A bevelled prism from a 2D outline [(x, z)] in game space (sandwich halves, cheese)."""
    bm = bmesh.new()
    ca, sa = math.cos(rot), math.sin(rot)
    xz = [(x * ca - z * sa + offset[0], x * sa + z * ca + offset[1]) for x, z in pts]
    lo = [bm.verts.new(G(x, y, z)) for x, z in xz]
    hi = [bm.verts.new(G(x, y + h, z)) for x, z in xz]
    bm.faces.new(lo)
    bm.faces.new(list(reversed(hi)))
    for i in range(len(xz)):
        j = (i + 1) % len(xz)
        bm.faces.new((lo[i], lo[j], hi[j], hi[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    if bevel:
        bmesh.ops.bevel(bm, geom=list(bm.edges), offset=bevel, segments=2, affect="EDGES")
    return _finish(bm, name, material, 40)


def tosti():
    # a ham-and-cheese tosti cut corner to corner, the halves pulled apart, ketchup on the side
    p = []
    plate(p, "tp", 0.12)
    tri = [(-0.045, -0.045), (0.045, -0.045), (-0.045, 0.045)]
    for i, (rot, off) in enumerate(((0.0, (-0.012, -0.004)), (math.pi, (0.012, 0.004)))):
        y = 0.0095
        p.append(slab(f"tb{i}", tri, y, 0.011, M["toast"], rot, off))
        p.append(slab(f"ham{i}", [(x * 0.97, z * 0.97) for x, z in tri], y + 0.011, 0.004, M["ham"], rot, off, 0.001))
        p.append(slab(f"ch{i}", [(x * 1.0, z * 1.0) for x, z in tri], y + 0.015, 0.003, M["cheese"], rot, off, 0.001))
        p.append(slab(f"tt{i}", tri, y + 0.018, 0.011, M["toast"], rot, off))
        for k in range(3):
            z0 = -0.03 + k * 0.02
            pts = [(-0.04, z0), (0.02 - k * 0.02, z0), (0.02 - k * 0.02, z0 + 0.004), (-0.04, z0 + 0.004)]
            p.append(slab(f"gm{i}{k}", pts, y + 0.029, 0.0008, M["grill"], rot, off, 0))
        # cheese oozing out of the cut
        p.append(sphere(f"ooze{i}", (off[0] * 0.3, y + 0.016, off[1] * 0.3), 0.008, M["cheese"], 8, 5, (1.8, 0.45, 0.6)))
    p.append(lathe("kc", [(0, 0.0095), (0.018, 0.0095), (0.022, 0.026), (0.019, 0.026), (0.016, 0.014), (0, 0.014)],
                   M["white"], (0.07, 0, 0.06), 16))
    p.append(lathe("k", [(0, 0.014), (0.017, 0.014), (0.018, 0.022), (0, 0.024)], M["ketchup"], (0.07, 0, 0.06), 14))
    return p


def fries():
    # paper tray, a pile of fries, a fat dollop of mayo and the little wooden fork ("vorkje")
    p = [lathe("tray", [(0, 0), (0.05, 0), (0.06, 0.04), (0.058, 0.041), (0.048, 0.003), (0, 0.003)], M["paperred"],
               segs=4, smooth=None, scale_z=0.72, phase=0.125)]
    for i in range(30):
        x = rnd.uniform(-0.04, 0.04)
        z = rnd.uniform(-0.026, 0.026)
        h = 0.045 + rnd.uniform(0, 0.035)
        p.append(rounded_box(f"f{i}", (x, 0.004 + h * 0.5 + rnd.uniform(0, 0.012), z), (0.0095, h, 0.0095), M["fries"],
                             0.0025, rnd.uniform(0, 3), 1))
    p += swirl("mayo", (0.018, 0.055, 0.005), 0.022, 0.03, M["mayo"])
    p.append(rounded_box("fork", (-0.02, 0.075, 0.0), (0.008, 0.06, 0.003), M["wood"], 0.001))
    return p


def burger():
    p = []
    plate(p, "bp", 0.13)
    bun_bot = [(0, 0.0095), (0.055, 0.0095), (0.063, 0.015), (0.064, 0.026), (0.06, 0.031), (0, 0.031)]
    p.append(lathe("bb", bun_bot, M["bun"], segs=24))
    p.append(lathe("pat", [(0, 0.031), (0.064, 0.031), (0.069, 0.04), (0.066, 0.05), (0, 0.05)], M["patty"], segs=18))
    # melted cheese drooping over the edge
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=6, y_segments=6, size=0.06)
    for v in bm.verts:
        d = max(abs(v.co.x), abs(v.co.y)) / 0.06
        v.co.z = 0.052 - max(0.0, d - 0.75) * 0.06
    bmesh.ops.rotate(bm, cent=(0, 0, 0), matrix=Matrix.Rotation(0.4, 3, "Z"), verts=bm.verts)
    bmesh.ops.solidify(bm, geom=list(bm.faces), thickness=0.003)
    p.append(_finish(bm, "chs", M["cheese"], 50))
    # lettuce ruffle and tomato
    ruff = [(0, 0.053), (0.07, 0.053), (0.074, 0.056), (0.07, 0.059), (0, 0.059)]
    let = lathe("let", ruff, M["lettuce"], segs=24)
    for i, v in enumerate(let.data.vertices):
        a = math.atan2(v.co.y, v.co.x)
        v.co.z += 0.004 * math.sin(a * 9)
    p.append(let)
    p.append(lathe("tom", [(0, 0.059), (0.058, 0.059), (0.06, 0.066), (0, 0.066)], M["tomato"], segs=20))
    top = [(0, 0.066), (0.062, 0.066), (0.067, 0.075), (0.062, 0.095), (0.045, 0.11), (0.02, 0.116), (0, 0.117)]
    p.append(lathe("bt", top, M["bun"], segs=24))
    for i in range(12):
        a = i * 2.4
        rr = 0.015 + (i % 4) * 0.011
        y = 0.116 - (rr / 0.062) ** 2 * 0.04
        p.append(sphere(f"ses{i}", (math.cos(a) * rr, y, math.sin(a) * rr), 0.0035, M["sesame"], 6, 4, (1, 0.5, 1.6)))
    p.append(tube("pick", [(0, 0.09, 0), (0, 0.17, 0)], 0.0025, M["wood"], 5))
    p.append(boxc("flag", (0.02, 0.16, 0), (0.04, 0.022, 0.002), M["sticker"]))
    p.append(boxc("flagdot", (0.02, 0.16, 0.0012), (0.012, 0.012, 0.001), M["yellow"]))
    for i in range(10):
        a = i / 10 * math.tau
        p.append(rounded_box(f"fry{i}", (math.sin(a) * 0.03 + 0.08, 0.016 + (i % 3) * 0.006, math.cos(a) * 0.018 - 0.07),
                             (0.06, 0.0095, 0.0095), M["fries"], 0.0025, a, 1))
    return p


# ----------------------------------------------------------------------------- shop goods and table things

def gamebox():
    p = [rounded_box("gb", (0, 0.032, 0), (0.3, 0.064, 0.22), M["label"], 0.004)]
    p.append(rounded_box("lid", (0, 0.054, 0), (0.304, 0.034, 0.224), M["game"], 0.005))
    p.append(boxc("lab", (0, 0.0712, 0.0), (0.19, 0.001, 0.12), M["label"]))
    p.append(text("gtxt", "SPEL", (0, 0.072, -0.025), 0.045, M["game"], 0.0, facing="up"))
    for i, (x, z) in enumerate(((-0.05, 0.03), (0.0, 0.03), (0.05, 0.03))):
        p.append(rounded_box(f"die{i}", (x, 0.0725, z), (0.024, 0.002, 0.024), M["ink"], 0.003))
    return p


def bud(name, center, size):
    """A dense little nug: a cluster of lumps with orange hairs."""
    parts = []
    for i in range(5):
        off = (rnd.uniform(-1, 1) * size * 0.4, rnd.uniform(-0.3, 0.3) * size, rnd.uniform(-1, 1) * size * 0.5)
        parts.append(sphere(f"{name}l{i}", (center[0] + off[0], center[1] + off[1], center[2] + off[2]),
                            size * rnd.uniform(0.5, 0.75), M["weed"] if i % 2 else M["weed2"], 8, 6, (1, 0.8, 1.2)))
    for i in range(3):
        parts.append(sphere(f"{name}h{i}", (center[0] + rnd.uniform(-1, 1) * size * 0.4, center[1] + size * 0.45,
                                            center[2] + rnd.uniform(-1, 1) * size * 0.4), size * 0.12, M["hair"], 4, 3))
    return parts


def baggie():
    # flat zip bag lying down, buds inside, green Kronkel sticker
    p = [rounded_box("bag", (0, 0.009, 0.004), (0.075, 0.018, 0.1), M["bag"], 0.008)]
    p.append(rounded_box("zip", (0, 0.009, -0.047), (0.078, 0.02, 0.008), M["bag"], 0.003))
    p.append(boxc("zipline", (0, 0.0185, -0.047), (0.074, 0.001, 0.002), M["sticker"]))
    for i in range(3):
        p += bud(f"b{i}", (rnd.uniform(-0.018, 0.018), 0.009, -0.01 + i * 0.022), 0.013)
    p.append(boxc("st", (0.012, 0.0182, 0.03), (0.036, 0.0006, 0.024), M["sticker"]))
    p.append(cyl("std", (0.004, 0.0186, 0.03), 0.006, 0.0005, M["yellow"], 12))
    return p


def preroll():
    # Pre-rolls come in a clear doob tube; one lies next to it
    p = [cyl("pr", (0.0, 0.006, -0.045), 0.0045, 0.085, M["roll"], 12, r2=0.0068, axis="Z")]
    p.append(cyl("fl", (0.0, 0.006, -0.05), 0.0047, 0.016, M["filter"], 12, axis="Z"))
    p.append(sphere("tw", (0.0, 0.006, 0.044), 0.0068, M["roll"], 8, 5, (1, 1, 1.5)))
    p.append(cyl("tube", (0.03, 0.01, -0.06), 0.01, 0.115, M["tubeclear"], 14, axis="Z"))
    p.append(cyl("cap", (0.03, 0.01, 0.055), 0.0105, 0.012, M["sticker"], 14, axis="Z"))
    p.append(cyl("inside", (0.03, 0.01, -0.052), 0.005, 0.095, M["roll"], 10, axis="Z"))
    return p


def spacecake():
    p = [rounded_box("ck", (0, 0.02, 0), (0.08, 0.04, 0.08), M["cake"], 0.008)]
    p.append(rounded_box("wrap", (0, 0.021, 0), (0.086, 0.043, 0.086), M["bag"], 0.01))
    p.append(boxc("lab", (0, 0.0425, 0), (0.05, 0.001, 0.03), M["sticker"]))
    p.append(cyl("labd", (-0.012, 0.0431, 0.0), 0.007, 0.0005, M["yellow"], 12))
    return p


def papers():
    p = [rounded_box("pk", (0, 0.004, 0), (0.07, 0.008, 0.036), M["sticker"], 0.0015)]
    p.append(rounded_box("flap", (0, 0.0085, -0.006), (0.07, 0.0012, 0.022), M["sticker"], 0.0006))
    p.append(boxc("pl", (0, 0.0094, -0.006), (0.04, 0.0006, 0.01), M["yellow"]))
    p.append(boxc("leaf", (0, 0.0089, 0.013), (0.064, 0.001, 0.008), M["roll"]))
    return p


def lighter():
    # Clipper-style: rounded body, metal hood, flint wheel
    p = [rounded_box("lb", (0, 0.03, 0), (0.025, 0.06, 0.013), M["lighter"], 0.005)]
    p.append(rounded_box("lt", (0, 0.068, 0), (0.023, 0.016, 0.012), M["steel"], 0.002))
    p.append(cyl("wheel", (-0.006, 0.072, 0.0), 0.004, 0.012, M["black"], 10, axis="Z"))
    return p


def idcard():
    p = [rounded_box("card", (0, 0.001, 0), (0.0856, 0.0016, 0.054), M["card"], 0.0007)]
    p.append(boxc("band", (0, 0.0017, -0.021), (0.0856, 0.0004, 0.012), M["cardblue"]))
    p.append(boxc("photo", (-0.026, 0.0018, 0.008), (0.022, 0.0004, 0.028), M["skinphoto"]))
    p.append(boxc("chip", (0.03, 0.0018, 0.004), (0.011, 0.0004, 0.009), M["chip"]))
    for i in range(3):
        p.append(boxc(f"ln{i}", (0.005, 0.0018, -0.004 + i * 0.008), (0.03, 0.0004, 0.002), M["ink"]))
    return p


def banknote():
    p = [boxc("note", (0, 0.0005, 0), (0.13, 0.001, 0.067), M["note"])]
    p.append(boxc("band", (0.04, 0.0011, 0), (0.03, 0.0003, 0.067), M["notedark"]))
    p.append(cyl("win", (-0.025, 0.0011, 0.0), 0.016, 0.0003, M["notedark"], 16))
    return p


def tray():
    # round serving tray with a cork top and a lip
    p = [lathe("tr", [(0, 0.0), (0.195, 0.0), (0.2, 0.004), (0.205, 0.022), (0.2, 0.024), (0.193, 0.008), (0, 0.008)],
               M["black"], segs=36)]
    p.append(cyl("cork", (0, 0.008, 0), 0.19, 0.003, M["cork"], 32))
    return p


def bill():
    p = []
    plate(p, "bl", 0.08)
    p.append(boxc("rc", (0, 0.0105, 0), (0.06, 0.002, 0.1), M["paper"], 0, 0.3))
    for i in range(3):
        p.append(boxc(f"rl{i}", (0.004 * i - 0.004, 0.0117, -0.02 + i * 0.015), (0.04, 0.0004, 0.003), M["ink"], 0, 0.3))
    for i in range(2):
        p.append(cyl(f"coin{i}", (0.03 + i * 0.006, 0.0115 + i * 0.003, -0.03), 0.012, 0.003, M["gold"], 14))
    return p


def dirty():
    p = []
    plate(p, "dp", 0.11)
    for i in range(12):
        p.append(sphere(f"cr{i}", (rnd.uniform(-0.05, 0.05), 0.011, rnd.uniform(-0.05, 0.05)), 0.005, M["crumbs"], 6, 4))
    p.append(rounded_box("fork", (0.02, 0.0115, 0.0), (0.006, 0.003, 0.09), M["steel"], 0.001, 0.5))
    prof = glass_profile(0.033, 0.04, 0.14, base=0.01)
    p.append(lathe("eg", prof, M["glass"], (0.12, 0, 0.05), 18))
    p.append(lathe("res", fill_profile(0.033, 0.04, 0.14, 0.012, 0.01), M["shake"], (0.12, 0, 0.05), 16))
    p.append(sphere("nap", (-0.05, 0.022, 0.03), 0.028, M["paper"], 8, 5, (1.1, 0.6, 0.9)))
    return p


PROPS = [("shake", shake), ("tea", tea), ("coffee", coffee), ("cola", cola), ("pie", pie), ("tosti", tosti),
         ("fries", fries), ("burger", burger), ("gamebox", gamebox), ("baggie", baggie), ("preroll", preroll),
         ("spacecake", spacecake), ("papers", papers), ("lighter", lighter), ("idcard", idcard),
         ("banknote", banknote), ("tray", tray), ("bill", bill), ("dirty", dirty)]


def build():
    materials()
    objs = []
    for i, (name, fn) in enumerate(PROPS):
        objs.append(build_prop(name, fn(), (i % 7) * 0.32 - 0.96))
        objs[-1].location.y = -(i // 7) * 0.3 + 0.3
    return objs


def preview(path, samples=48):
    floor = box("pfloor", (-2, -0.01, -1.5), (2, 0, 1.5), mat("PreviewWood", "#7a4e2d", 0.6))
    render_preview(path, (0.0, 0.95, 1.25), (0.0, 0.0, 0.05), 30, size=(1280, 720), samples=samples, sun=True,
                   world="#e6ddd0", world_strength=0.9)
    bpy.data.objects.remove(floor)
