"""Builds Coffeeshop Kronkel: the moody interior, the alley facade on Vlaamsegas, the rooftop
terrace, the alley itself and the city around it. Modelled after photos of the real shop.

Node naming contract with the game (src/world.js):
  static, static_far          always visible
  static_facade               front wall + upper floors (hidden in the top-down cutaway views)
  static_ceiling              drop ceiling, duct, drum lamps (hidden in the cutaway views)
  table_<ID>                  one per table in layout.json (seats come from layout.json)
  upg_<upgradeId>             toggled by tycoon upgrades; a node ending in _ceil is also hidden in cutaway
  clock_hour / clock_minute   rotated by in-game time (pivot at the clock centre, rotate around game X)
"""
import math
import random

import bmesh
from mathutils import Matrix, Vector

from lib import (G, box, boxc, cyl, empty, image_plane, load_json, logo_material, make_image, mat, merge_by_material,
                 sphere, subdivide_long_faces, tex_barnwood, tex_brick, tex_ceiltiles, tex_concrete, tex_pavers, tex_planks,
                 tex_tiles, tex_vboards, text, torus, tube, uv_box, _finish)

L = load_json("layout.json")
DATA = load_json("gamedata.json")
rnd = random.Random(1986)
CEIL = L["ceilingY"]


def blob(name, center, scale, mat_, rx=0.0, ry=0.0, segs=10, rings=6):
    """Rotated ellipsoid (leaves, cushions...)."""
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=segs, v_segments=rings, radius=1.0)
    bmesh.ops.scale(bm, vec=Vector((scale[0], scale[2], scale[1])), verts=bm.verts)
    bmesh.ops.rotate(bm, cent=(0, 0, 0), matrix=Matrix.Rotation(rx, 3, "X"), verts=bm.verts)
    bmesh.ops.rotate(bm, cent=(0, 0, 0), matrix=Matrix.Rotation(ry, 3, "Z"), verts=bm.verts)
    bmesh.ops.translate(bm, vec=G(*center), verts=bm.verts)
    return _finish(bm, name, mat_, 70)


def curved(name, cx, cz, r_in, r_out, a0, a1, y0, y1, mat_, segs=24, smooth=True):
    """Curved slab around (cx, cz): angles in degrees from +z toward +x."""
    bm = bmesh.new()
    rings = []
    for i in range(segs + 1):
        a = math.radians(a0 + (a1 - a0) * i / segs)
        s, c = math.sin(a), math.cos(a)
        ring = [bm.verts.new(G(cx + s * r, y, cz + c * r)) for r, y in ((r_in, y0), (r_out, y0), (r_out, y1), (r_in, y1))]
        rings.append(ring)
    for i in range(segs):
        a, b = rings[i], rings[i + 1]
        for k in range(4):
            k2 = (k + 1) % 4
            bm.faces.new((a[k], b[k], b[k2], a[k2]))
    bm.faces.new(rings[0])
    bm.faces.new(list(reversed(rings[-1])))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return _finish(bm, name, mat_, 35 if smooth else None)


def prism_roof(name, x0, x1, z0, z1, y0, ridge, mat_):
    bm = bmesh.new()
    xm = (x0 + x1) / 2
    pts = [(x0, y0), (xm, ridge), (x1, y0)]
    front = [bm.verts.new(G(px, py, z1)) for px, py in pts]
    back = [bm.verts.new(G(px, py, z0)) for px, py in pts]
    bm.faces.new(front)
    bm.faces.new(list(reversed(back)))
    for i in range(3):
        j = (i + 1) % 3
        bm.faces.new((front[i], back[i], back[j], front[j]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return _finish(bm, name, mat_)


# ----------------------------------------------------------------------------
# Soft-furnishing and turned-wood helpers (all in game coords, y up)
# ----------------------------------------------------------------------------

def lathe(name, profile, mat_, center=(0, 0, 0), segs=20, smooth=40):
    """Revolve [(radius, height)] around the vertical axis through `center`. Radius 0 closes an end."""
    bm = bmesh.new()
    c = G(*center)
    rows = []
    for r, y in profile:
        if r <= 1e-6:
            rows.append([bm.verts.new(c + Vector((0, 0, y)))])
        else:
            rows.append([bm.verts.new(c + Vector((math.cos(k / segs * math.tau) * r, math.sin(k / segs * math.tau) * r, y)))
                         for k in range(segs)])
    for a, b in zip(rows, rows[1:]):
        if len(a) == 1 and len(b) == 1:
            continue
        for k in range(segs):
            k2 = (k + 1) % segs
            if len(a) == 1:
                bm.faces.new((a[0], b[k], b[k2]))
            elif len(b) == 1:
                bm.faces.new((a[k], b[0], a[k2]))
            else:
                bm.faces.new((a[k], a[k2], b[k2], b[k]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return _finish(bm, name, mat_, smooth)


def arc_pad(name, cx, cz, r_mid, a0, a1, y0, y1, depth, mat_, segs=10, csegs=12, p=3.0, lean=0.0, taper=0.35):
    """A puffy upholstered pad bent around (cx, cz): channel-tufted backs, seat cushions, sofa arms.

    Angles in degrees from +z toward +x (like `curved`). `lean` pushes the top outward (reclined backs);
    `taper` slims the ends so each pad reads as a stuffed pillow.
    """
    bm = bmesh.new()
    hy, ym, hd = (y1 - y0) / 2, (y0 + y1) / 2, depth / 2
    rings = []
    for i in range(segs + 1):
        t = i / segs
        a = math.radians(a0 + (a1 - a0) * t)
        sa, ca = math.sin(a), math.cos(a)
        e = 1.0 - taper * abs(2 * t - 1) ** 4
        ring = []
        for k in range(csegs):
            th = k / csegs * math.tau
            ct, st = math.cos(th), math.sin(th)
            u = math.copysign(abs(ct) ** (2 / p), ct) * hd * e
            v = math.copysign(abs(st) ** (2 / p), st) * hy * (0.9 + 0.1 * e)
            r = r_mid + u + lean * (v + hy) / (2 * hy)
            ring.append(bm.verts.new(G(cx + sa * r, ym + v, cz + ca * r)))
        rings.append(ring)
    for a, b in zip(rings, rings[1:]):
        for k in range(csegs):
            k2 = (k + 1) % csegs
            bm.faces.new((a[k], b[k], b[k2], a[k2]))
    for ring in (rings[0], rings[-1]):
        cv = bm.verts.new(sum((v.co for v in ring), Vector()) / len(ring))
        for k in range(csegs):
            bm.faces.new((ring[k], ring[(k + 1) % csegs], cv))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return _finish(bm, name, mat_, 60)


def channels(out, name, cx, cz, r_mid, a0, a1, y0, y1, depth, mat_, n, gap=1.2, lean=0.08):
    """Channel-tufted back: n vertical stuffed pleats side by side."""
    step = (a1 - a0) / n
    for k in range(n):
        out.append(arc_pad(f"{name}{k}", cx, cz, r_mid, a0 + k * step + gap / 2, a0 + (k + 1) * step - gap / 2, y0, y1,
                           depth, mat_, 4, 12, 2.4, lean, 0.25))


def squircle(name, center, size, mat_, p=4.0, rot_y=0.0, segs=16, rings=10):
    """Rounded box (superellipsoid): cushions, pouf tops, device bodies."""
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=segs, v_segments=rings, radius=1.0)
    sx, sy, sz = size[0] / 2, size[2] / 2, size[1] / 2  # blender x, y(depth), z(up)
    for v in bm.verts:
        n = v.co.normalized()
        v.co = Vector((math.copysign(abs(n.x) ** (2 / p), n.x) * sx, math.copysign(abs(n.y) ** (2 / p), n.y) * sy,
                       math.copysign(abs(n.z) ** (2 / p), n.z) * sz))
    bmesh.ops.rotate(bm, cent=(0, 0, 0), matrix=Matrix.Rotation(rot_y, 3, "Z"), verts=bm.verts)
    bmesh.ops.translate(bm, vec=G(*center), verts=bm.verts)
    return _finish(bm, name, mat_, 50)


def xbox(name, center, size, mat_, bevel=0.0, yaw=0.0, pitch=0.0):
    """Box with yaw (around up) and pitch (tilt back) in game space: screens, terminals."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=Vector((size[0], size[2], size[1])), verts=bm.verts)
    if bevel > 0:
        bmesh.ops.bevel(bm, geom=list(bm.edges), offset=min(bevel, min(size) * 0.45), segments=2, affect="EDGES",
                        profile=0.5)
    bmesh.ops.rotate(bm, cent=(0, 0, 0), matrix=Matrix.Rotation(pitch, 3, "X"), verts=bm.verts)
    bmesh.ops.rotate(bm, cent=(0, 0, 0), matrix=Matrix.Rotation(yaw, 3, "Z"), verts=bm.verts)
    bmesh.ops.translate(bm, vec=G(*center), verts=bm.verts)
    return _finish(bm, name, mat_, 30 if bevel > 0 else None)


def leaf_blade(name, base, yaw, length, width, mat_, pitch=0.9, droop=1.6, fold=0.3, n=8):
    """A long tropical leaf: arched midrib, widest past the middle, folded along the rib."""
    bm = bmesh.new()
    d = Vector((math.sin(yaw), 0, math.cos(yaw)))
    side = Vector((math.cos(yaw), 0, -math.sin(yaw)))
    pos = Vector(base)
    rows = []
    for i in range(n + 1):
        t = i / n
        ang = pitch - droop * t * t
        w = width * math.sin(math.pi * min(1.0, t ** 0.75)) * (1 if i < n else 0.05)
        mid = pos.copy()
        rows.append([bm.verts.new(G(*(mid + side * w - Vector((0, w * fold, 0))))), bm.verts.new(G(*mid)),
                     bm.verts.new(G(*(mid - side * w - Vector((0, w * fold, 0)))))])
        step = length / n
        pos = pos + (d * math.cos(ang) + Vector((0, math.sin(ang), 0))) * step
    for a, b in zip(rows, rows[1:]):
        bm.faces.new((a[0], a[1], b[1], b[0]))
        bm.faces.new((a[1], a[2], b[2], b[1]))
    return _finish(bm, name, mat_, 70)


# ----------------------------------------------------------------------------
# Materials
# ----------------------------------------------------------------------------
M = {}


def materials():
    M["floor"] = mat("Laminate", "#ffffff", 0.5, tex=make_image("tex_floor", tex_planks(512, 2, "#8a7058", 5)))
    M["deck"] = mat("Deck", "#ffffff", 0.75, tex=make_image("tex_deck", tex_planks(512, 7, "#8f7a64", 6)))
    M["concrete"] = mat("Concrete", "#ffffff", 0.9, tex=make_image("tex_concrete", tex_concrete(512)))
    M["barnwood"] = mat("BarnWood", "#ffffff", 0.85, tex=make_image("tex_barnwood", tex_barnwood(512)))
    M["ceiltiles"] = mat("CeilingTiles", "#ffffff", 0.95, tex=make_image("tex_ceil", tex_ceiltiles(256)))
    M["teal"] = mat("TealBoards", "#ffffff", 0.7, tex=make_image("tex_teal", tex_vboards(256)))
    M["ybrick"] = mat("BrickCream", "#ffffff", 0.85,
                      tex=make_image("tex_ybrick", tex_brick(512, 5, "#d4bf86", "#ebe4d2")))
    M["brick"] = mat("Brick", "#ffffff", 0.85, tex=make_image("tex_brick", tex_brick(512, 1, "#8c3f2b")))
    M["brick2"] = mat("BrickDark", "#ffffff", 0.85, tex=make_image("tex_brick2", tex_brick(512, 4, "#5e2d22")))
    M["pavers"] = mat("Pavers", "#ffffff", 0.9, tex=make_image("tex_pavers", tex_pavers(512, 3)))
    M["tiles"] = mat("Tiles", "#ffffff", 0.3, tex=make_image("tex_tiles", tex_tiles(256)))
    M["plaster"] = mat("Plaster", "#d9d2c3", 0.9)
    M["greenpaint"] = mat("GreenPaint", "#36483a", 0.85)
    M["dark"] = mat("DarkPanel", "#16171a", 0.6)
    M["leather"] = mat("LeatherBlue", "#3a4552", 0.55)
    M["leather2"] = mat("LeatherDark", "#24282d", 0.5)
    M["cream"] = mat("LeatherCream", "#d8c4a0", 0.5)
    M["oak"] = mat("Oak", "#9a6a3c", 0.45)
    M["table"] = mat("TableWood", "#8b5a35", 0.35)
    M["wdark"] = mat("WoodDark", "#3a2618", 0.6)
    M["chrome"] = mat("Chrome", "#d6dadf", 0.18, 1.0)
    M["steel"] = mat("Steel", "#b9bec4", 0.3, 0.9)
    M["black"] = mat("BlackMetal", "#1b1b1d", 0.45, 0.6)
    M["gold"] = mat("Gold", "#d4a94a", 0.25, 1.0)
    M["glass"] = mat("Glass", "#bfe3ee", 0.05, alpha=0.18)
    M["tint"] = mat("GlassTint", "#2c3438", 0.05, alpha=0.55)
    M["etched"] = mat("Etched", "#ffffff", 0.4, alpha=0.55)
    M["glassdark"] = mat("WindowDark", "#1a2128", 0.15, 0.3)
    M["lit"] = mat("WindowLit", "#ffcf7a", 0.5, emit="#ffbf5e", strength=2.0)
    M["yellow"] = mat("FrameYellow", "#e3b52c", 0.5)
    M["awning"] = mat("AwningGrey", "#3c3f44", 0.5, 0.4)
    M["coping"] = mat("Coping", "#8d9095", 0.5, 0.5)
    M["stone"] = mat("Stone", "#c9c3b5", 0.85)
    M["roof"] = mat("Roof", "#36322f", 0.9)
    M["rooftile"] = mat("RoofTile", "#5a3229", 0.85)
    M["slate"] = mat("Slate", "#3a4250", 0.8)
    M["weed"] = mat("WeedGreen", "#6f9a3b", 0.9)
    M["hash"] = mat("HashBrown", "#6b4a2b", 0.8)
    M["signwhite"] = mat("SignWhite", "#f4f1ea", 0.5)
    M["signred"] = mat("SignRed", "#c8202a", 0.45)
    M["signyellow"] = mat("SignYellow", "#f2c81e", 0.45)
    M["signred_lit"] = mat("SignRedLit", "#ff3b3b", 0.4, emit="#ff2a2a", strength=4)
    M["signwhite_lit"] = mat("SignWhiteLit", "#fff8ea", 0.4, emit="#fff4dc", strength=1.6)
    M["signyellow_lit"] = mat("SignYellowLit", "#ffd84a", 0.4, emit="#ffcc22", strength=2.5)
    M["neonpink"] = mat("NeonPink", "#ff6fae", 0.4, emit="#ff4f9a", strength=6)
    M["led"] = mat("LedPurple", "#c25cff", 0.4, emit="#b040ff", strength=6)
    M["bulb"] = mat("Bulb", "#ffe2a8", 0.3, emit="#ffc76e", strength=9)
    M["downlight"] = mat("Downlight", "#fff6e6", 0.3, emit="#fff1d8", strength=12)
    M["drumglow"] = mat("DrumGlow", "#ff5a7a", 0.5, emit="#ff3f6a", strength=3.5)
    M["globe"] = mat("Globe", "#fff7e8", 0.3, emit="#ffe8bf", strength=3.0)
    M["fire"] = mat("Fire", "#ff8a2a", 0.5, emit="#ff6a10", strength=3.5)
    M["screen"] = mat("Screen", "#163b2b", 0.3, emit="#3fd18a", strength=1.2)
    M["tv"] = mat("TvScreen", "#0f2233", 0.3, emit="#2a6fb0", strength=1.4)
    M["fridge"] = mat("FridgeLight", "#e8f4ff", 0.3, emit="#d8ecff", strength=2.5)
    M["menu"] = mat("MenuBoard", "#151815", 0.6)
    M["menutext"] = mat("MenuText", "#f6efd2", 0.5, emit="#f6efd2", strength=1.6)
    M["menugreen"] = mat("MenuAccent", "#ffc814", 0.5, emit="#ffc014", strength=2.0)
    M["chalk"] = mat("Chalk", "#efefe8", 0.9, emit="#efefe8", strength=0.25)
    M["board"] = mat("Chalkboard", "#232a26", 0.9)
    M["leaf"] = mat("Leaf", "#3f7d3a", 0.7)
    M["leaf2"] = mat("LeafDark", "#2b5a2a", 0.7)
    M["banana"] = mat("BananaLeaf", "#4f8f3f", 0.6)
    M["pampas"] = mat("Pampas", "#d9b98a", 0.95)
    M["pampaspink"] = mat("PampasPink", "#d99a8f", 0.95)
    M["basket"] = mat("Basket", "#b58a55", 0.9)
    M["buddha"] = mat("BuddhaStone", "#8f8a80", 0.95)
    M["felt"] = mat("PoolFelt", "#1f7fae", 0.95)
    M["white"] = mat("White", "#f4f1ea", 0.6)
    M["red"] = mat("Red", "#b8322f", 0.6)
    M["yellowp"] = mat("YellowPaint", "#e9b434", 0.6)
    M["blue"] = mat("Blue", "#2f5b8f", 0.6)
    M["paper"] = mat("Paper", "#efe6cf", 0.9)
    M["parasol"] = mat("Parasol", "#2d3e4a", 0.8)
    M["heat"] = mat("HeatLamp", "#ff7b3a", 0.4, emit="#ff6a2a", strength=4)
    M["coins"] = mat("Coins", "#d9b24a", 0.3, 0.9)
    M["duct"] = mat("Duct", "#7c8086", 0.7, 0.2)
    M["tyre"] = mat("Tyre", "#111111", 0.9)
    M["bike1"] = mat("BikeBlack", "#1a1a1a", 0.5, 0.4)
    M["bike2"] = mat("BikeBlue", "#2f4f6f", 0.5, 0.4)
    M["bike3"] = mat("BikeRed", "#7a2a2a", 0.5, 0.4)
    M["church"] = mat("ChurchStone", "#b7a37f", 0.9)
    M["churchroof"] = mat("ChurchRoof", "#4b5e55", 0.7, 0.3)
    M["candle"] = mat("CandleLeather", "#8a4a22", 0.6)
    M["wax"] = mat("Wax", "#f3e6c8", 0.6)
    M["button"] = mat("Button", "#1a1c20", 0.4)
    M["label"] = mat("JarLabel", "#efe6cf", 0.8)
    M["uiyellow"] = mat("ScreenUI", "#ffd84a", 0.4, emit="#ffc814", strength=1.5)
    M["key"] = mat("KeyGrey", "#3a3d42", 0.5)
    M["keyred"] = mat("KeyRed", "#c8202a", 0.5)
    M["keygreen"] = mat("KeyGreen", "#2f9a4a", 0.5)
    M["keyyellow"] = mat("KeyYellow", "#e9b434", 0.5)
    M["cork"] = mat("Cork", "#b88a5a", 0.95)
    M["pocket"] = mat("PocketNet", "#141414", 0.9)


# ----------------------------------------------------------------------------
# Building shell: walls, floor, drop ceiling
# ----------------------------------------------------------------------------

def shell():
    out = []
    H = L["shop"]["height"]
    out.append(box("floor", (-7, -0.1, -6), (7, 0, 6), M["floor"]))
    T = 0.3
    # Back wall (concrete), kitchen pass x -4.6..-2.6 (y 1.05..1.95), kitchen door x -1.1..-0.2
    bw = [((-7.3, 0, -6 - T), (-4.6, H, -6)),
          ((-4.6, 0, -6 - T), (-2.6, 1.05, -6)), ((-4.6, 1.95, -6 - T), (-2.6, H, -6)),
          ((-2.6, 0, -6 - T), (-1.1, H, -6)), ((-1.1, 2.2, -6 - T), (-0.2, H, -6)),
          ((-0.2, 0, -6 - T), (7.3, H, -6))]
    for i, (a, b) in enumerate(bw):
        out.append(box(f"backwall{i}", a, b, M["concrete"]))
    out.append(box("leftwall", (-7 - T, 0, -6.3), (-7, H, 6.3), M["concrete"]))
    dz = L["stairs"]["doorGroundZ"]
    out.append(box("rightwall0", (7, 0, -6.3), (7 + T, H, dz - 0.5), M["concrete"]))
    out.append(box("rightwall1", (7, 2.2, dz - 0.5), (7 + T, H, dz + 0.5), M["concrete"]))
    out.append(box("rightwall2", (7, 0, dz + 0.5), (7 + T, H, 6.3), M["concrete"]))
    # Teal vertical-board wainscot (right wall, left wall front part, under the front windows)
    out.append(box("wainR0", (6.95, 0, -2.6), (7, 1.0, dz - 0.5), M["teal"]))
    out.append(box("wainR1", (6.95, 0, dz + 0.5), (7, 1.0, 6.0), M["teal"]))
    out.append(box("wainL", (-7, 0, -3.0), (-6.95, 1.0, 6.0), M["teal"]))
    out.append(box("wainF", (-7, 0, 5.95), (4.1, 0.55, 6.0), M["teal"]))
    for i, (a, b) in enumerate((((6.93, 0.98, -2.6), (7, 1.04, dz - 0.5)), ((6.93, 0.98, dz + 0.5), (7, 1.04, 6.0)),
                                ((-7, 0.98, -3.0), (-6.93, 1.04, 6.0)))):
        out.append(box(f"wainrail{i}", a, b, M["wdark"]))
    # Kitchen door
    out.append(box("kdoor", (-1.05, 0.02, -6.12), (-0.25, 2.15, -6.06), M["steel"]))
    out.append(box("kdoorwin", (-0.85, 1.35, -6.05), (-0.45, 1.75, -6.04), M["glassdark"]))
    # Warm wall-washer uplights along the left and back walls
    for i, z in enumerate((-5.0, -3.4, 3.6, 5.2)):
        out.append(boxc(f"uplightL{i}", (-6.92, 0.06, z), (0.12, 0.12, 0.3), M["black"]))
        out.append(boxc(f"uplightLg{i}", (-6.92, 0.125, z), (0.08, 0.01, 0.24), M["bulb"]))
    for i, x in enumerate((-6.2, 0.4, 1.0)):
        out.append(boxc(f"uplightB{i}", (x, 0.06, -5.92), (0.3, 0.12, 0.12), M["black"]))
        out.append(boxc(f"uplightBg{i}", (x, 0.125, -5.92), (0.24, 0.01, 0.08), M["bulb"]))
    return out


def ceiling():
    """Black tile drop ceiling, downlights, purple LED cove, fabric duct, drum lamps, bar swoosh."""
    out = []
    out.append(uv_box(box("ceiling", (-7, CEIL, -6), (7, CEIL + 0.05, 6), M["ceiltiles"]), 1 / 1.2))
    out.append(box("ceilingslab", (-7.3, L["shop"]["height"], -6.3), (7.3, L["shop"]["height"] + 0.15, 6.3),
                   M["roof"]))
    for x in (-5.4, -1.8, 1.8, 5.4):
        for z in (-4.8, -1.8, 1.0, 4.6):
            out.append(cyl(f"spot{x}{z}", (x, CEIL - 0.012, z), 0.075, 0.012, M["downlight"], 14))
            out.append(torus(f"spotr{x}{z}", (x, CEIL - 0.006, z), 0.085, 0.012, M["black"], 14, 5))
    # Purple LED cove along the walls
    for i, (a, b) in enumerate((((-6.98, CEIL - 0.06, -6), (-6.93, CEIL - 0.02, 6)),
                                ((6.93, CEIL - 0.06, -6), (6.98, CEIL - 0.02, 6)),
                                ((-7, CEIL - 0.06, -5.98), (7, CEIL - 0.02, -5.93)))):
        out.append(box(f"led{i}", a, b, M["led"]))
    # Round fabric duct running the length of the room
    out.append(cyl("duct", (-7.0, 2.98, 3.3), 0.3, 14.0, M["duct"], 20, axis="X"))
    for i in range(8):
        x = -6.2 + i * 1.8
        out.append(torus(f"ductband{i}", (x, 2.98, 3.3), 0.305, 0.012, M["black"], 20, 5, axis="X"))
        out.append(tube(f"ducthang{i}", [(x, 3.28, 3.3), (x, CEIL, 3.3)], 0.008, M["black"], 4))
    # Speakers in the corners
    for i, (x, z, r) in enumerate(((-6.75, -5.75, 0.8), (6.75, -1.0, -0.8), (-6.75, 5.6, 2.3), (6.75, 5.6, -2.3))):
        out.append(boxc(f"speaker{i}", (x, CEIL - 0.3, z), (0.25, 0.38, 0.22), M["black"], 0.02, r))
    # Drum pendants over the booth pods (black shade, pink glowing inside)
    for t in L["tables"]:
        if t["type"] != "pod":
            continue
        x, z = t["x"], t["z"]
        out.append(tube(f"drumcord{t['id']}", [(x, CEIL, z), (x, 2.55, z)], 0.007, M["black"], 5))
        out.append(cyl(f"drum{t['id']}", (x, 2.2, z), 0.46, 0.36, M["leather2"], 28, caps=False))
        out.append(cyl(f"druminner{t['id']}", (x, 2.2, z), 0.445, 0.355, M["drumglow"], 28, caps=False))
        out.append(cyl(f"drumtop{t['id']}", (x, 2.54, z), 0.46, 0.02, M["drumglow"], 28))
    # Curved wooden swoosh over the bar with lantern pendants
    A = L["bar"]["arc"]
    out.append(curved("swoosh", A["cx"], A["cz"], A["rOut"] - 0.3, A["rOut"] + 0.35, -40, 40, 2.95, 3.05, M["oak"], 30))
    out.append(curved("swooshedge", A["cx"], A["cz"], A["rOut"] + 0.32, A["rOut"] + 0.36, -40, 40, 2.7, 3.05, M["oak"],
                      30))
    for i, a in enumerate((-20, 0, 20)):
        ar = math.radians(a)
        x = A["cx"] + math.sin(ar) * (A["rOut"] + 0.05)
        z = A["cz"] + math.cos(ar) * (A["rOut"] + 0.05)
        out.append(tube(f"lantcord{i}", [(x, 2.95, z), (x, 2.45, z)], 0.006, M["gold"], 4))
        out.append(cyl(f"lant{i}", (x, 2.0, z), 0.13, 0.45, M["glass"], 8, smooth=False))
        out.append(sphere(f"lantglow{i}", (x, 2.22, z), 0.08, M["bulb"], 10, 6))
        for k in range(4):
            ka = k / 4 * math.tau
            out.append(tube(f"lantbar{i}{k}", [(x + math.sin(ka) * 0.13, 2.0, z + math.cos(ka) * 0.13),
                                                (x + math.sin(ka) * 0.13, 2.45, z + math.cos(ka) * 0.13)], 0.006,
                            M["gold"], 4))
        out.append(cyl(f"lanttop{i}", (x, 2.45, z), 0.15, 0.04, M["gold"], 8))
    return out


# ----------------------------------------------------------------------------
# Alley facade
# ----------------------------------------------------------------------------

def facade():
    out = []
    z0, z1 = 6.0, 6.3
    top = L["upper"]["top"]
    piers = [(-7.3, -6.6), (-3.5, -3.2), (-0.15, 0.15), (3.9, 4.15), (5.45, 5.7), (6.7, 7.3)]
    for i, (a, b) in enumerate(piers):
        out.append(uv_box(box(f"pier{i}", (a, 0, z0), (b, 3.0, z1), M["ybrick"]), 1.0))
    windows = [(-6.6, -3.5), (-3.2, -0.15), (0.15, 3.9), (5.7, 6.7)]
    for i, (a, b) in enumerate(windows):
        out.append(uv_box(box(f"plinth{i}", (a, 0, z0), (b, 0.55, z1), M["ybrick"]), 1.0))
        out.append(box(f"sill{i}", (a - 0.05, 0.5, z1 - 0.02), (b + 0.05, 0.56, z1 + 0.1), M["coping"]))
        out.append(box(f"glass{i}", (a, 0.55, z0 + 0.12), (b, 2.85, z0 + 0.14), M["tint"]))
        out.append(box(f"wfL{i}", (a, 0.55, z0 + 0.05), (a + 0.07, 2.85, z1), M["yellow"]))
        out.append(box(f"wfR{i}", (b - 0.07, 0.55, z0 + 0.05), (b, 2.85, z1), M["yellow"]))
        out.append(box(f"wfB{i}", (a, 0.55, z0 + 0.05), (b, 0.62, z1), M["yellow"]))
        out.append(box(f"wfT{i}", (a, 2.78, z0 + 0.05), (b, 2.85, z1), M["yellow"]))
        n = max(1, int((b - a) / 1.1))
        for k in range(1, n):
            m = a + (b - a) * k / n
            out.append(box(f"wfM{i}{k}", (m - 0.035, 0.55, z0 + 0.05), (m + 0.035, 2.85, z1), M["yellow"]))
        out.append(box(f"awn{i}", (a - 0.05, 2.85, z1), (b + 0.05, 3.15, z1 + 0.4), M["awning"], 0.01))
    out.append(box("doorframeL", (4.15, 0, z0), (4.22, 2.6, z1), M["yellow"]))
    out.append(box("doorframeR", (5.38, 0, z0), (5.45, 2.6, z1), M["yellow"]))
    out.append(box("doortop", (4.15, 2.55, z0), (5.45, 3.0, z1), M["yellow"]))
    out.append(box("doorglass", (4.25, 2.62, z0 + 0.12), (5.35, 2.95, z0 + 0.14), M["tint"]))
    out.append(box("doorawn", (4.0, 2.95, z1), (5.6, 3.2, z1 + 0.55), M["awning"], 0.01))
    out.append(image_plane("winlogo", (3.45, 1.55, z0 + 0.16), 0.5, "front", logo_material("KronkelLogo")))
    out.append(text("doorsign", "18+", (4.8, 2.75, z1 + 0.01), 0.16, M["signwhite"], 0.0))
    out.append(uv_box(box("lintel", (-7.3, 3.0, z0), (7.3, 3.6, z1), M["ybrick"]), 1.0))
    out.append(uv_box(box("upper", (-7.3, 3.6, z0), (7.3, top, z1), M["ybrick"]), 1.0))
    out.append(box("coping", (-7.35, top, z0 - 0.05), (7.35, top + 0.18, z1 + 0.08), M["coping"]))
    for x in (-5.4, -3.0, -0.6, 1.8):
        upper_window(out, x, 4.3, 1.0, 2.0, z1, lit=rnd.random() < 0.4)
    for i, x in enumerate((-7.15, 3.98)):
        out.append(cyl(f"pipe{i}", (x, 0, z1 + 0.08), 0.05, top + 0.1, M["coping"], 10))
    for i, x in enumerate((-2.0, 1.1)):
        out.append(boxc(f"ac{i}", (x, 3.35, z1 + 0.18), (0.8, 0.55, 0.3), M["white"], 0.02))
        out.append(cyl(f"acfan{i}", (x + 0.12, 3.35, z1 + 0.33), 0.18, 0.01, M["black"], 16, axis="Z"))
    for i, x in enumerate((-4.8, 0.6, 6.5)):
        wall_globe(out, f"glb{i}", x, 3.55, z1)
    out.append(tube("cammast", [(-6.8, top, z1), (-6.8, top + 1.2, z1 + 0.3)], 0.03, M["coping"], 6))
    out.append(sphere("camdome", (-6.8, top + 1.15, z1 + 0.35), 0.12, M["black"], 10, 6, (1, 0.8, 1)))
    zb = L["upper"]["minZ"]
    sx = L["stairs"]["doorTerraceX"]
    out.append(uv_box(box("upperback0", (-7.3, 3.6, zb - 0.3), (sx - 0.5, top, zb), M["ybrick"]), 1.0))
    out.append(uv_box(box("upperback1", (sx - 0.5, 6.0, zb - 0.3), (sx + 0.5, top, zb), M["ybrick"]), 1.0))
    out.append(uv_box(box("upperback2", (sx + 0.5, 3.6, zb - 0.3), (7.3, top, zb), M["ybrick"]), 1.0))
    out.append(box("upperroof", (-7.3, top, zb - 0.3), (7.3, top + 0.15, z1), M["roof"]))
    out.append(box("stairdoor", (sx - 0.45, 3.8, zb - 0.22), (sx + 0.45, 5.95, zb - 0.16), M["wdark"], 0.01))
    out.append(box("stairdoorwin", (sx - 0.3, 5.0, zb - 0.23), (sx + 0.3, 5.7, zb - 0.22), M["glassdark"]))
    for x in (-5.0, -2.2, 0.8, 3.2):
        upper_window(out, x, 4.6, 1.1, 1.7, zb - 0.3, lit=rnd.random() < 0.6, facing=-1)
    out += blade_sign(False)
    return out


def wall_globe(out, name, x, y, zface, facing=1):
    out.append(tube(name + "arm", [(x, y, zface), (x, y + 0.12, zface + 0.35 * facing)], 0.025, M["black"], 6))
    out.append(sphere(name + "g", (x, y, zface + 0.42 * facing), 0.17, M["globe"], 14, 10))
    out.append(cyl(name + "cap", (x, y + 0.14, zface + 0.42 * facing), 0.08, 0.06, M["black"], 10))


def blade_sign(lit):
    """The tall KRONKEL sign sticking out into the alley: red letters on white tiles, yellow disc on top."""
    out = []
    p = "lit_" if lit else ""
    x = 3.0
    zc = 7.05
    w = M["signwhite_lit"] if lit else M["signwhite"]
    r = M["signred_lit"] if lit else M["signred"]
    y_ = M["signyellow_lit"] if lit else M["signyellow"]
    if not lit:
        out.append(boxc("signpole", (x, 5.2, 6.65), (0.08, 6.4, 0.08), M["black"]))
        for i, yy in enumerate((2.6, 4.6, 6.8)):
            out.append(boxc(f"signarm{i}", (x, yy, 6.5), (0.06, 0.06, 0.45), M["black"]))
    size = 0.5
    for i, ch in enumerate("KRONKEL"):
        y = 7.35 - i * size
        if not lit:
            out.append(boxc(f"tile{i}", (x, y, zc), (0.16, size - 0.04, size - 0.04), M["signred"], 0.01))
        e = 0.012 if lit else 0.0
        out.append(boxc(f"{p}tileface{i}", (x, y, zc), (0.18 + e, size - 0.1, size - 0.1), w, 0.005))
        for side, facing in ((1, "right"), (-1, "left")):
            out.append(text(f"{p}let{i}{side}", ch, (x + side * (0.095 + e), y, zc), 0.36, r, 0.008, facing=facing))
    if not lit:
        out.append(boxc("cshopstrip", (x, 2.95, zc - 0.05), (0.12, 1.85, 0.3), M["black"], 0.01))
    for i, ch in enumerate("COFFEESHOP"):
        y = 3.78 - i * 0.18
        for side, facing in ((1, "right"), (-1, "left")):
            out.append(text(f"{p}cs{i}{side}", ch, (x + side * (0.065 + (0.006 if lit else 0)), y, zc - 0.05), 0.14, w,
                            0.0, facing=facing))
    # The Kronkel smiley with sunglasses on top, on both faces of a yellow disc
    yd = 8.15
    if not lit:
        out.append(cyl("disc", (x - 0.06, yd, zc - 0.05), 0.5, 0.12, M["signyellow"], 32, axis="X"))
    logo_m = logo_material("KronkelLogoLit" if lit else "KronkelLogo", lit)
    off = 0.075 if lit else 0.068
    out.append(image_plane(f"{p}logoR", (x + off, yd, zc - 0.05), 1.25, "right", logo_m))
    out.append(image_plane(f"{p}logoL", (x - off, yd, zc - 0.05), 1.25, "left", logo_m))
    return out


def upper_window(out, x, y, w, h, zface, lit=False, facing=1):
    f = facing
    fm = M["yellow"] if f > 0 else M["white"]
    out.append(box(f"uwframe{x}{y}{f}", (x - w / 2 - 0.07, y - 0.07, zface - 0.01 * f),
                   (x + w / 2 + 0.07, y + h + 0.07, zface + 0.04 * f), fm))
    out.append(box(f"uwglass{x}{y}{f}", (x - w / 2, y, zface + 0.04 * f), (x + w / 2, y + h, zface + 0.05 * f),
                   M["lit"] if lit else M["glassdark"]))
    out.append(box(f"uwbar{x}{y}{f}", (x - 0.03, y, zface + 0.04 * f), (x + 0.03, y + h, zface + 0.065 * f), fm))
    out.append(box(f"uwsill{x}{y}{f}", (x - w / 2 - 0.1, y - 0.14, zface - 0.01 * f),
                   (x + w / 2 + 0.1, y - 0.07, zface + 0.1 * f), M["coping"]))


# ----------------------------------------------------------------------------
# Counters
# ----------------------------------------------------------------------------

def jar(out, name, x, y, z, content, size=1.0):
    """Apothecary jar: glass with shoulders, the goods inside, a black lid with a knob and a paper label."""
    k = size
    out.append(lathe(name + "g", [(0, 0), (0.062 * k, 0), (0.066 * k, 0.012 * k), (0.066 * k, 0.15 * k), (0.056 * k, 0.178 * k),
                                  (0.042 * k, 0.188 * k), (0.042 * k, 0.2 * k)], M["glass"], (x, y, z), 14))
    fill = (0.07 + rnd.random() * 0.06) * k
    out.append(lathe(name + "c", [(0, 0.006 * k), (0.058 * k, 0.006 * k), (0.06 * k, fill), (0.035 * k, fill + 0.012 * k),
                                  (0, fill + 0.016 * k)], content, (x, y, z), 10))
    out.append(lathe(name + "l", [(0, 0.198 * k), (0.047 * k, 0.198 * k), (0.048 * k, 0.222 * k), (0.03 * k, 0.228 * k),
                                  (0.012 * k, 0.232 * k), (0.016 * k, 0.248 * k), (0, 0.252 * k)], M["black"], (x, y, z), 12))
    out.append(boxc(name + "lab", (x, y + 0.075 * k, z + 0.066 * k), (0.07 * k, 0.05 * k, 0.003), M["label"]))


def place(objs, pos, yaw=0.0, pitch=0.0):
    """Move parts modelled around the origin (game coords) into place, tilted and turned."""
    T = Matrix.Translation(G(*pos)) @ Matrix.Rotation(yaw, 4, "Z") @ Matrix.Rotation(pitch, 4, "X")
    for o in objs:
        o.data.transform(T)
    return objs


def pos_terminal(x, y, z):
    """Tablet till on a swivel stand; the screen faces the cashier (-z) and is tilted back."""
    base = [lathe("posbase", [(0, 0), (0.1, 0), (0.105, 0.008), (0.09, 0.016), (0.03, 0.022), (0, 0.022)], M["chrome"],
                  (x, y, z), 20),
            cyl("posneck", (x, y + 0.02, z), 0.018, 0.13, M["chrome"], 10)]
    tab = [squircle("posbezel", (0, 0, 0), (0.4, 0.27, 0.03), M["black"], 6, 0, 20, 8),
           boxc("posscreen", (0, 0, -0.0155), (0.36, 0.23, 0.002), M["screen"]),
           boxc("posui1", (-0.09, 0.07, -0.0168), (0.15, 0.035, 0.001), M["uiyellow"]),
           boxc("posui2", (0.09, 0.07, -0.0168), (0.12, 0.035, 0.001), M["menutext"]),
           boxc("posui3", (-0.09, 0.0, -0.0168), (0.15, 0.06, 0.001), M["menutext"]),
           boxc("posui4", (0.09, -0.04, -0.0168), (0.12, 0.08, 0.001), M["uiyellow"])]
    return base + place(tab, (x, y + 0.27, z), 0.35, 0.38)


def card_terminal(x, y, z):
    """PIN terminal in its dock: keypad (red / yellow / green bottom row), little screen, card slot."""
    dock = [squircle("pindock", (x, y + 0.015, z), (0.11, 0.03, 0.15), M["black"], 5)]
    body = [squircle("pinbody", (0, 0, 0), (0.085, 0.03, 0.17), M["key"], 5, 0, 16, 8),
            boxc("pinscreen", (0, 0.016, 0.045), (0.06, 0.002, 0.045), M["screen"])]
    cols = [M["keyred"], M["keyyellow"], M["keygreen"]]
    for r in range(4):
        for c in range(3):
            m = cols[c] if r == 3 else M["black"]
            body.append(boxc(f"pinkey{r}{c}", (-0.022 + c * 0.022, 0.0165, -0.005 - r * 0.017), (0.016, 0.004, 0.011), m,
                             0.0015))
    return dock + place(body, (x, y + 0.05, z), 0.0, -0.45)


def shop_counter():
    """The sales counter behind a glass partition with oak frames and the logo etched in the glass."""
    out = []
    C = L["counter"]
    x0, x1, z0, z1, h = C["minX"], C["maxX"], C["minZ"], C["maxZ"], C["height"]
    out.append(box("counterbody", (x0, 0, z0), (x1, h - 0.04, z1), M["dark"], 0.02))
    out.append(box("countertop", (x0 - 0.06, h - 0.04, z0 - 0.04), (x1 + 0.06, h + 0.02, z1 + 0.1), M["oak"], 0.015))
    out.append(box("counterstrip", (x0, 0.08, z1), (x1, 0.1, z1 + 0.01), M["led"]))
    rx, rz = L["register"]
    pz = z0 + 0.05
    out.append(box("partrail", (x0, 2.45, pz - 0.04), (x1, 2.55, pz + 0.04), M["oak"]))
    out.append(box("partsoffit", (x0 - 0.05, 2.55, pz - 0.1), (x1 + 0.05, CEIL, pz + 0.1), M["dark"]))
    posts = [x0, 2.45, 3.0, 4.6, 5.5, x1]
    for i, px in enumerate(posts):
        out.append(box(f"partpost{i}", (px - 0.035, h + 0.02, pz - 0.04), (px + 0.035, 2.45, pz + 0.04), M["oak"]))
    for i in range(len(posts) - 1):
        a, b = posts[i] + 0.035, posts[i + 1] - 0.035
        if abs(posts[i] - 3.0) < 0.01:
            out.append(box(f"talkrail{i}", (a, 1.95, pz - 0.04), (b, 2.01, pz + 0.04), M["oak"]))
            out.append(box(f"pane{i}", (a, 2.01, pz - 0.006), (b, 2.45, pz + 0.006), M["glass"]))
        else:
            out.append(box(f"pane{i}", (a, h + 0.02, pz - 0.006), (b, 2.45, pz + 0.006), M["glass"]))
    out.append(text("etched", "KRONKEL", (2.05, 1.9, pz + 0.01), 0.17, M["etched"], 0.0, font_kind="serif"))
    out.append(torus("etchring", (2.05, 1.95, pz + 0.01), 0.36, 0.008, M["etched"], 32, 4, axis="Z"))
    out.append(text("etched2", "COFFEESHOP", (2.05, 1.72, pz + 0.01), 0.07, M["etched"], 0.0))
    px_ = rx - 0.62
    out += pos_terminal(px_, h + 0.02, rz - 0.15)
    out += card_terminal(rx + 0.45, h + 0.02, rz + 0.12)
    out.append(squircle("printer", (px_ + 0.32, h + 0.08, rz - 0.1), (0.15, 0.12, 0.19), M["black"], 5, 0.35))
    out.append(xbox("printerpaper", (px_ + 0.31, h + 0.16, rz - 0.06), (0.08, 0.06, 0.002), M["paper"], 0, 0.35, -0.3))
    out.append(squircle("scalebase", (2.75, h + 0.05, -3.8), (0.3, 0.06, 0.26), M["black"], 6))
    out.append(lathe("scaleplate", [(0, 0.0), (0.125, 0.0), (0.13, 0.012), (0.12, 0.014), (0, 0.012)], M["steel"],
                     (2.75, h + 0.08, -3.83), 24))
    out.append(boxc("scaledisp", (2.75, h + 0.06, -3.95), (0.14, 0.03, 0.02), M["screen"]))
    out.append(text("scaletext", "0.0g", (2.75, h + 0.056, -3.961), 0.022, M["uiyellow"], 0.0, facing="back"))
    out.append(cyl("tipjar", (3.05, h + 0.02, -3.55), 0.07, 0.18, M["glass"], 14))
    out.append(cyl("tipcoins", (3.05, h + 0.025, -3.55), 0.06, 0.04, M["coins"], 14))
    out.append(boxc("idsign", (4.75, h + 0.13, -3.5), (0.32, 0.2, 0.012), M["white"], 0.005))
    out.append(text("idsigntext", "18+  ID", (4.75, h + 0.16, -3.49), 0.07, M["red"], 0.0))
    out.append(text("idsigntext2", "ALTIJD", (4.75, h + 0.08, -3.49), 0.045, M["black"], 0.0))
    out.append(box("display", (5.55, h + 0.02, z0 + 0.12), (6.5, h + 0.4, z1 - 0.05), M["glass"]))
    for i in range(3):
        jar(out, f"djar{i}", 5.75 + i * 0.3, h + 0.03, -3.8, M["weed"] if i != 1 else M["hash"], 1.25)
    out.append(box("backcab", (x0, 0, -6), (x1, 0.95, -5.5), M["dark"], 0.02))
    out.append(box("backcabtop", (x0 - 0.03, 0.95, -6), (x1 + 0.03, 1.0, -5.45), M["oak"]))
    for s, y in enumerate((1.3, 1.72)):
        out.append(box(f"shelf{s}", (x0, y - 0.04, -6), (x1, y, -5.68), M["oak"]))
        out.append(box(f"shelfled{s}", (x0, y - 0.05, -5.72), (x1, y - 0.04, -5.68), M["led"]))
        for i in range(16):
            x = x0 + 0.2 + i * (x1 - x0 - 0.4) / 15
            jar(out, f"jar{s}_{i}", x, y, -5.84, M["weed"] if (i + s) % 3 else M["hash"])
    out.append(box("menuframe", (1.9, 2.0, -6.0), (6.3, 3.25, -5.88), M["black"], 0.01))
    out.append(box("menuface", (1.96, 2.06, -5.88), (6.24, 3.19, -5.87), M["menu"]))
    out.append(text("menutitle", "KRONKEL  MENU", (4.1, 3.06, -5.865), 0.12, M["menugreen"], 0.0))
    for i, w in enumerate(DATA["weed"]):
        y = 2.88 - i * 0.1
        out.append(text(f"mw{i}", w["name"].upper(), (2.1, y, -5.865), 0.075, M["menutext"], 0.0, align="LEFT", font_kind="bold"))
        out.append(text(f"mwp{i}", f"€{w['price']:.0f}", (3.9, y, -5.865), 0.075, M["menugreen"], 0.0, align="RIGHT", font_kind="bold"))
    for i, w in enumerate(DATA["hash"] + DATA["extras"][:2]):
        y = 2.88 - i * 0.1
        out.append(text(f"mh{i}", w["name"].upper(), (4.3, y, -5.865), 0.075, M["menutext"], 0.0, align="LEFT", font_kind="bold"))
        out.append(text(f"mhp{i}", f"€{w['price']:.0f}", (6.1, y, -5.865), 0.075, M["menugreen"], 0.0, align="RIGHT", font_kind="bold"))
    out.append(text("menufoot", "PRIJS PER GRAM  ·  MAX 5 GRAM  ·  18+", (4.1, 2.1, -5.865), 0.06, M["menutext"], 0.0,
                    font_kind="bold"))
    return out


def bar_stool(name, x, y0, z, h=0.72):
    return [lathe(name + "base", [(0, 0), (0.2, 0), (0.205, 0.01), (0.18, 0.025), (0.05, 0.05), (0, 0.05)], M["chrome"],
                  (x, y0, z), 20),
            cyl(name + "leg", (x, y0 + 0.04, z), 0.028, h - 0.06, M["chrome"], 10),
            torus(name + "ring", (x, y0 + 0.3, z), 0.16, 0.011, M["chrome"], 20, 6),
            lathe(name + "seat", [(0, h - 0.02), (0.17, h - 0.02), (0.195, h), (0.2, h + 0.03), (0.185, h + 0.06),
                                  (0.12, h + 0.075), (0, h + 0.078)], M["leather2"], (x, y0, z), 20)]


def bar():
    """Curved bar like the real one: dark front, light oak top band, machines on the back counter."""
    out = []
    A = L["bar"]["arc"]
    h = L["bar"]["height"]
    cx, cz, ri, ro = A["cx"], A["cz"], A["rIn"], A["rOut"]
    a = 32.5
    out.append(curved("barbody", cx, cz, ri + 0.05, ro - 0.08, -a, a, 0.0, 0.8, M["dark"], 32))
    out.append(curved("barband", cx, cz, ri + 0.05, ro, -a, a, 0.8, h - 0.04, M["oak"], 32))
    out.append(curved("bartop", cx, cz, ri - 0.02, ro + 0.04, -a - 0.5, a + 0.5, h - 0.04, h + 0.01, M["table"], 32))
    out.append(curved("barled", cx, cz, ro - 0.1, ro - 0.08, -a, a, 0.05, 0.07, M["led"], 32))
    out.append(cyl("cakeplate", (-2.2, h + 0.01, -3.95), 0.16, 0.02, M["white"], 18))
    out.append(cyl("cake", (-2.2, h + 0.03, -3.95), 0.13, 0.07, mat("PieCrust", "#c88b46", 0.8), 18))
    out.append(sphere("cakedome", (-2.2, h + 0.03, -3.95), 0.17, M["glass"], 16, 8, (1, 0.9, 1)))
    out.append(cyl("bartip", (-4.9, h + 0.01, -3.85), 0.06, 0.15, M["glass"], 12))
    out.append(cyl("bartipc", (-4.9, h + 0.015, -3.85), 0.05, 0.03, M["coins"], 12))
    for i, (xa, xb) in enumerate(((-6.6, -4.7), (-2.5, -1.2))):
        out.append(box(f"backctr{i}", (xa, 0, -6), (xb, 0.95, -5.4), M["dark"], 0.02))
        out.append(box(f"backctrtop{i}", (xa, 0.95, -6), (xb, 1.0, -5.38), M["steel"]))
    mx = -5.9
    out.append(boxc("shakebody", (mx, 1.25, -5.75), (0.5, 0.5, 0.3), M["steel"], 0.03))
    out.append(boxc("shakehead", (mx, 1.55, -5.65), (0.5, 0.12, 0.42), M["steel"], 0.03))
    for i in range(3):
        sx = mx - 0.15 + i * 0.15
        out.append(cyl(f"spindle{i}", (sx, 1.24, -5.5), 0.008, 0.26, M["steel"], 6))
        out.append(cyl(f"shakecup{i}", (sx, 1.0, -5.5), 0.045, 0.2, M["steel"], 12, r2=0.05))
    out.append(text("shakelabel", "MILKSHAKES", (mx, 1.4, -5.598), 0.05, M["black"], 0.0))
    out.append(boxc("coffeebody", (-1.85, 1.27, -5.75), (0.7, 0.5, 0.42), M["steel"], 0.03))
    out.append(boxc("coffeetop", (-1.85, 1.54, -5.75), (0.72, 0.06, 0.44), M["black"], 0.02))
    for i in range(2):
        out.append(cyl(f"grouphead{i}", (-2.0 + i * 0.3, 1.2, -5.52), 0.04, 0.08, M["black"], 10))
        out.append(cyl(f"cup{i}", (-2.0 + i * 0.3, 1.0, -5.52), 0.035, 0.07, M["white"], 10))
    out.append(box("fridge", (-6.95, 0, -5.3), (-6.35, 2.0, -4.75), M["black"], 0.02))
    out.append(box("fridgein", (-6.35, 0.1, -5.25), (-6.33, 1.9, -4.8), M["fridge"]))
    out.append(box("fridgeglass", (-6.33, 0.1, -5.25), (-6.31, 1.9, -4.8), M["glass"]))
    cols = ["#d9452c", "#f2c81e", "#3fa34d", "#2f6fd0", "#ff7a1a", "#e8e8e8"]
    for s in range(4):
        for k in range(4):
            out.append(cyl(f"bottle{s}{k}", (-6.42, 0.2 + s * 0.45, -5.18 + k * 0.11), 0.03, 0.22,
                           mat(f"Bottle{(s + k) % 6}", cols[(s + k) % 6], 0.3), 8))
    out.append(box("passshelf", (-4.65, 1.02, -6.4), (-2.55, 1.07, -5.7), M["steel"]))
    for i in range(3):
        x = -4.2 + i * 0.6
        out.append(boxc(f"heat{i}", (x, 1.85, -6.05), (0.32, 0.05, 0.12), M["black"]))
        out.append(boxc(f"heatg{i}", (x, 1.82, -6.05), (0.28, 0.01, 0.08), M["heat"]))
    out.append(box("chalkframe", (-6.3, 2.2, -6.0), (-5.0, 3.1, -5.95), M["wdark"]))
    out.append(box("chalk", (-6.25, 2.25, -5.95), (-5.05, 3.05, -5.94), M["board"]))
    for i, t in enumerate(["SHAKES", "TOSTI", "FRIET", "THEE"]):
        out.append(text(f"chalk{i}", t, (-5.65, 2.9 - i * 0.12, -5.935), 0.07, M["chalk"], 0.0))
    out.append(text("chalkhours", "KEUKEN 12-22", (-5.65, 2.35, -5.935), 0.055, M["chalk"], 0.0))
    for x, z in ((-6.15, -3.75), (-1.7, -3.75)):
        out += bar_stool(f"stool{x}", x, 0, z)
    return out


def kitchen():
    out = []
    K = L["kitchen"]
    x0, z0 = K["minX"], K["minZ"]
    x1 = 0.0
    out.append(box("kfloor", (x0, -0.05, z0), (x1, 0, -6.3), M["tiles"]))
    out.append(box("kback", (x0, 0, z0 - 0.3), (x1, 3.6, z0), M["tiles"]))
    out.append(box("kleft", (x0 - 0.3, 0, z0 - 0.3), (x0, 3.6, -6.3), M["tiles"]))
    out.append(box("kright", (x1, 0, z0 - 0.3), (x1 + 0.3, 3.6, -6.3), M["tiles"]))
    out.append(box("kceil", (x0 - 0.3, 3.6, z0 - 0.3), (x1 + 0.3, 3.75, -6.3), M["roof"]))
    out.append(box("stove", (x0 + 0.4, 0, z0), (x0 + 2.4, 0.9, z0 + 0.7), M["steel"], 0.01))
    for i in range(4):
        out.append(cyl(f"burner{i}", (x0 + 0.75 + i * 0.45, 0.9, z0 + 0.35), 0.11, 0.02, M["black"], 12))
    out.append(box("hood", (x0 + 0.3, 2.2, z0), (x0 + 2.5, 2.7, z0 + 0.8), M["steel"], 0.01))
    out.append(box("fryer", (x0 + 2.6, 0, z0), (x0 + 3.3, 0.95, z0 + 0.7), M["steel"], 0.01))
    out.append(box("kfridge", (-1.0, 0, z0), (-0.1, 2.0, z0 + 0.7), M["steel"], 0.02))
    out.append(box("prep", (x0 + 0.2, 0, -7.0), (x0 + 3.3, 0.92, -6.4), M["steel"], 0.01))
    out.append(cyl("pan", (x0 + 1.2, 0.92, z0 + 0.35), 0.15, 0.05, M["black"], 14))
    return out


# ----------------------------------------------------------------------------
# Tables
# ----------------------------------------------------------------------------

def pouf(out, name, x, y0, z, yaw):
    """Leather cube pouf on an oak base, soft top with a tufting button."""
    out.append(boxc(name + "base", (x, y0 + 0.13, z), (0.4, 0.26, 0.4), M["oak"], 0.02, yaw))
    out.append(boxc(name + "kick", (x, y0 + 0.02, z), (0.36, 0.04, 0.36), M["wdark"], 0.005, yaw))
    out.append(squircle(name + "top", (x, y0 + 0.345, z), (0.44, 0.19, 0.44), M["leather2"], 3.6, yaw, 16, 10))
    out.append(sphere(name + "btn", (x, y0 + 0.437, z), 0.014, M["button"], 8, 5, (1, 0.5, 1)))


def candle(out, tid, x, y, z):
    """Tea light in a ribbed glass votive."""
    out.append(lathe(f"{tid}votive", [(0, 0), (0.045, 0), (0.05, 0.02), (0.052, 0.08), (0.048, 0.085), (0.046, 0.08),
                                      (0.043, 0.006), (0, 0.006)], M["glass"], (x, y, z), 14))
    out.append(cyl(f"{tid}wax", (x, y + 0.006, z), 0.038, 0.02, M["wax"], 12))
    out.append(sphere(f"{tid}flame", (x, y + 0.045, z), 0.012, M["bulb"], 6, 4, (1, 1.8, 1)))


def chair(out, name, x, y0, z, rot):
    """Black metal bistro chair with a round seat and a curved back band."""
    m = M["black"]
    out.append(squircle(name + "seat", (x, y0 + 0.455, z), (0.42, 0.04, 0.42), m, 5, rot, 16, 6))
    for lx, lz in ((-0.17, -0.17), (0.17, -0.17), (-0.17, 0.17), (0.17, 0.17)):
        px = x + lx * math.cos(rot) + lz * math.sin(rot)
        pz = z - lx * math.sin(rot) + lz * math.cos(rot)
        fx = x + lx * 1.15 * math.cos(rot) + lz * 1.15 * math.sin(rot)
        fz = z - lx * 1.15 * math.sin(rot) + lz * 1.15 * math.cos(rot)
        out.append(tube(name + f"leg{lx}{lz}", [(px, y0 + 0.44, pz), (fx, y0, fz)], 0.014, m, 6))
    deg = math.degrees(rot)
    out.append(arc_pad(name + "back", x, z, 0.2, deg - 38, deg + 38, y0 + 0.66, y0 + 0.84, 0.03, m, 10, 8, 4, 0.03, 0.1))
    for off in (-0.13, 0.13):
        bx = x + math.sin(rot) * 0.2 + off * math.cos(rot)
        bz = z + math.cos(rot) * 0.2 - off * math.sin(rot)
        out.append(tube(name + f"post{off}", [(bx, y0 + 0.46, bz), (bx, y0 + 0.7, bz)], 0.011, m, 6))


def table_top(out, tid, x, y, z, r, ground, mat_=None):
    """Round tabletop (surface at height y) with a softened edge, on a chrome pedestal with a trumpet foot."""
    out.append(lathe(f"{tid}top", [(0, y - 0.04), (r - 0.03, y - 0.04), (r - 0.005, y - 0.03), (r, y - 0.012), (r - 0.004, y),
                                   (r - 0.015, y + 0.004), (0, y + 0.004)], mat_ or M["table"], (x, 0, z), 32))
    h = y - ground
    out.append(lathe(f"{tid}ped", [(0, 0), (0.25, 0), (0.25, 0.01), (0.22, 0.02), (0.1, 0.045), (0.045, 0.1), (0.036, 0.2),
                                   (0.036, h - 0.1), (0.05, h - 0.06), (0.11, h - 0.045), (0, h - 0.045)], M["chrome"],
                     (x, ground, z), 16))


def table_group(t):
    out = []
    x, z = t["x"], t["z"]
    kind = t["type"]
    y0 = 0.0 if t["level"] == 0 else L["terrace"]["y"]
    yaw = t["yaw"]
    tid = t["id"]
    if kind in ("pod", "small"):
        r = 0.42 if kind == "pod" else 0.34
        table_top(out, tid, x, y0 + 0.765, z, r, y0)
        candle(out, tid, x + 0.1, y0 + 0.769, z - 0.06)
        out.append(lathe(f"{tid}ash", [(0, 0), (0.05, 0), (0.052, 0.02), (0.044, 0.02), (0.04, 0.008), (0, 0.008)],
                         M["black"], (x - 0.15, y0 + 0.769, z + 0.08), 12))
    if kind == "pod":
        # high-back booth: oak plinth, three seat cushions, channel-tufted leather back, oak shell and cap rail
        out.append(curved(f"{tid}bench", x, z, 0.52, 0.98, yaw - 78, yaw + 78, y0, y0 + 0.3, M["oak"], 20))
        out.append(curved(f"{tid}kick", x, z, 0.5, 0.53, yaw - 78, yaw + 78, y0, y0 + 0.06, M["wdark"], 20))
        for k, (a0, a1) in enumerate(((yaw - 77, yaw - 26.5), (yaw - 25.5, yaw + 25.5), (yaw + 26.5, yaw + 77))):
            out.append(arc_pad(f"{tid}cush{k}", x, z, 0.76, a0, a1, y0 + 0.29, y0 + 0.47, 0.47, M["leather"], 10, 12, 3.4,
                               0.0, 0.12))
        channels(out, f"{tid}back", x, z, 1.02, yaw - 78, yaw + 78, y0 + 0.46, y0 + 1.28, 0.15, M["leather"], 11, 1.2, 0.03)
        out.append(curved(f"{tid}backshell", x, z, 1.13, 1.16, yaw - 79, yaw + 79, y0, y0 + 1.3, M["oak"], 24))
        out.append(curved(f"{tid}cap", x, z, 1.08, 1.18, yaw - 79.5, yaw + 79.5, y0 + 1.3, y0 + 1.34, M["oak"], 24))
        for k, s in enumerate(t["seats"][2:]):
            pouf(out, f"{tid}pouf{k}", s[0], y0, s[1], math.radians(s[2]))
    elif kind == "small":
        for k, s in enumerate(t["seats"]):
            pouf(out, f"{tid}pouf{k}", s[0], y0, s[1], math.radians(s[2]))
    elif kind == "lounge":
        out.append(squircle(f"{tid}ctop", (x, y0 + 0.44, z), (0.62, 0.05, 1.12), M["table"], 8))
        for dx, dz in ((-0.26, -0.5), (0.26, -0.5), (-0.26, 0.5), (0.26, 0.5)):
            out.append(lathe(f"{tid}cleg{dx}{dz}", [(0.022, 0), (0.03, 0.2), (0.026, 0.42), (0, 0.42)], M["black"],
                             (x + dx, y0, z + dz), 8))
        candle(out, tid, x, y0 + 0.465, z - 0.2)
        out.append(xbox(f"{tid}menu", (x + 0.05, y0 + 0.55, z + 0.25), (0.12, 0.18, 0.02), M["black"], 0.005, 0.3, 0.12))
        # curved cream leather sofa: dark plinth, three seat cushions, tufted back, rounded arms
        out.append(curved(f"{tid}sofa", x, z, 0.76, 1.2, yaw - 52, yaw + 52, y0, y0 + 0.26, M["wdark"], 20))
        for k, (a0, a1) in enumerate(((yaw - 50, yaw - 17.5), (yaw - 16.5, yaw + 16.5), (yaw + 17.5, yaw + 50))):
            out.append(arc_pad(f"{tid}sofac{k}", x, z, 0.98, a0, a1, y0 + 0.25, y0 + 0.44, 0.44, M["cream"], 10, 12, 3.4,
                               0.0, 0.12))
        channels(out, f"{tid}sofab", x, z, 1.2, yaw - 52, yaw + 52, y0 + 0.42, y0 + 0.86, 0.16, M["cream"], 9, 1.0, 0.025)
        out.append(curved(f"{tid}sofashell", x, z, 1.285, 1.32, yaw - 52.5, yaw + 52.5, y0 + 0.2, y0 + 0.86, M["cream"], 20))
        out.append(curved(f"{tid}sofacap", x, z, 1.24, 1.33, yaw - 52.5, yaw + 52.5, y0 + 0.86, y0 + 0.9, M["cream"], 20))
        for side in (-1, 1):
            a = yaw + side * 53.5
            out.append(arc_pad(f"{tid}arm{side}", x, z, 0.99, a - 3, a + 3, y0 + 0.24, y0 + 0.64, 0.48, M["cream"], 4, 12,
                               3.0, 0.0, 0.3))
    else:  # terrace: metal bistro set + parasol
        table_top(out, tid, x, y0 + 0.761, z, 0.46, y0, M["white"])
        candle(out, tid, x + 0.12, y0 + 0.765, z - 0.08)
        for k, s in enumerate(t["seats"]):
            chair(out, f"{tid}c{k}", s[0], y0, s[1], math.radians(s[2] + 180))
        if len(t["seats"]) == 4:
            out.append(cyl(f"{tid}pole", (x, y0 + 0.74, z), 0.022, 1.66, M["oak"], 8))
            out.append(lathe(f"{tid}parasol", [(0, y0 + 2.46), (0.06, y0 + 2.45), (0.7, y0 + 2.25), (1.28, y0 + 2.02),
                                               (1.28, y0 + 1.92), (1.25, y0 + 1.92), (1.24, y0 + 2.0), (0, y0 + 2.43)],
                             M["parasol"], (x, 0, z), 8, None))
            for k in range(8):
                a = (k + 0.5) / 8 * math.tau
                out.append(tube(f"{tid}rib{k}", [(x, y0 + 2.42, z), (x + math.cos(a) * 1.22, y0 + 2.0, z + math.sin(a) * 1.22)],
                                0.008, M["oak"], 4))
            out.append(sphere(f"{tid}finial", (x, y0 + 2.5, z), 0.04, M["oak"], 8, 6))
    return out


# ----------------------------------------------------------------------------
# Upgrades
# ----------------------------------------------------------------------------

def pool_tables():
    out = []
    cols = ["#f2c81e", "#2f5bd0", "#d9452c", "#6b3f8f", "#ff7a1a", "#2f8f4a", "#7a1f1f", "#151515", "#f4f1ea"]
    for i, p in enumerate(L["pool"]):
        x, z = p["x"], p["z"]
        out.append(boxc(f"pool{i}frame", (x, 0.71, z), (2.5, 0.16, 1.4), M["dark"], 0.03))
        out.append(boxc(f"pool{i}felt", (x, 0.795, z), (2.24, 0.02, 1.14), M["felt"]))
        out.append(boxc(f"pool{i}railN", (x, 0.81, z - 0.62), (2.4, 0.06, 0.12), M["felt"], 0.02))
        out.append(boxc(f"pool{i}railS", (x, 0.81, z + 0.62), (2.4, 0.06, 0.12), M["felt"], 0.02))
        out.append(boxc(f"pool{i}railW", (x - 1.18, 0.81, z), (0.12, 0.06, 1.2), M["felt"], 0.02))
        out.append(boxc(f"pool{i}railE", (x + 1.18, 0.81, z), (0.12, 0.06, 1.2), M["felt"], 0.02))
        for dx in (-1.13, 0, 1.13):
            for dz in (-0.6, 0.6):
                out.append(lathe(f"pool{i}pk{dx}{dz}", [(0, 0.78), (0.06, 0.78), (0.065, 0.835), (0.072, 0.84), (0.05, 0.84),
                                                       (0.045, 0.7), (0, 0.68)], M["pocket"], (x + dx, 0, z + dz), 12))
        for dx in (-1.0, 1.0):
            for dz in (-0.52, 0.52):
                out.append(lathe(f"pool{i}leg{dx}{dz}", [(0.1, 0), (0.11, 0.05), (0.075, 0.1), (0.065, 0.28), (0.09, 0.42),
                                                        (0.075, 0.54), (0.1, 0.63), (0, 0.64)], M["dark"], (x + dx, 0, z + dz),
                                 12))
        for k in range(3):
            for dz in (-0.67, 0.67):
                out.append(sphere(f"pool{i}sight{k}{dz}", (x - 0.56 + k * 0.56, 0.842, z + dz), 0.012, M["white"], 6, 4,
                                  (1, 0.3, 1)))
        for k, c in enumerate(cols):
            bx = x + 0.4 + (k % 3) * 0.06 - (k // 3) * 0.03
            bz = z - 0.06 + (k // 3) * 0.06
            if k == 8:
                bx, bz = x - 0.7, z + 0.1
            out.append(sphere(f"pool{i}ball{k}", (bx, 0.835, bz), 0.028, mat(f"Ball{k}", c, 0.15), 10, 6))
        out.append(tube(f"pool{i}cue", [(x - 0.95, 0.83, z + 0.3), (x - 0.2, 0.84, z + 0.55)], 0.01, M["oak"], 6))
    out.append(boxc("cuerack", (-6.95, 1.5, 3.55), (0.06, 1.4, 0.5), M["oak"], 0.01))
    for k in range(4):
        out.append(tube(f"rackcue{k}", [(-6.9, 0.2, 3.38 + k * 0.11), (-6.9, 1.75, 3.38 + k * 0.11)], 0.012, M["oak"], 6))
    return out


def pool_lamps():
    out = []
    for i, p in enumerate(L["pool"]):
        x, z = p["x"], p["z"]
        for dx in (-0.6, 0.6):
            out.append(tube(f"plc{i}{dx}", [(x + dx, CEIL, z), (x + dx, 1.85, z)], 0.006, M["black"], 4))
        out.append(boxc(f"plamp{i}", (x, 1.8, z), (1.6, 0.14, 0.32), M["black"], 0.03))
        out.append(boxc(f"plampg{i}", (x, 1.725, z), (1.5, 0.01, 0.26), M["downlight"]))
    return out


def lounge():
    """Reclaimed wood wall with a linear gas fireplace, gold mirror and gold flower ornament."""
    out = []
    fz = L["fireplace"]["z"]
    out.append(uv_box(box("barnwall", (-6.97, 0, fz - 1.9), (-6.9, CEIL, fz + 1.9), M["barnwood"]), 0.8))
    out.append(uv_box(box("firebox", (-6.9, 0, fz - 0.9), (-6.6, 1.6, fz + 0.9), M["barnwood"]), 0.8))
    out.append(box("fireopen", (-6.61, 0.35, fz - 0.6), (-6.59, 0.7, fz + 0.6), M["black"]))
    out.append(box("fireglow", (-6.6, 0.38, fz - 0.55), (-6.58, 0.55, fz + 0.55), M["fire"]))
    for k in range(9):
        out.append(blob(f"flame{k}", (-6.6, 0.5 + (k % 3) * 0.02, fz - 0.48 + k * 0.12), (0.015, 0.06, 0.035), M["fire"]))
    out.append(box("firesurround", (-6.62, 0.3, fz - 0.66), (-6.58, 0.34, fz + 0.66), M["chrome"]))
    out.append(box("mantel", (-6.95, 1.6, fz - 1.0), (-6.5, 1.68, fz + 1.0), M["wdark"]))
    out.append(box("mirrorframe", (-6.9, 1.85, fz - 0.55), (-6.85, 2.95, fz + 0.55), M["gold"], 0.02))
    out.append(box("mirror", (-6.85, 1.92, fz - 0.47), (-6.84, 2.88, fz + 0.47), M["chrome"]))
    fl = fz + 1.35
    for k in range(6):
        a = k / 6 * math.tau
        out.append(blob(f"goldpetal{k}", (-6.86, 2.4 + math.sin(a) * 0.16, fl + math.cos(a) * 0.16), (0.03, 0.11, 0.11),
                        M["gold"], 0, 0, 12, 8))
    out.append(sphere("goldcenter", (-6.84, 2.4, fl), 0.07, M["gold"], 12, 8))
    return out


def stage():
    """Acoustic corner for singer-songwriters (front-right, by the window)."""
    out = []
    S = L["stage"]
    h = S["height"]
    out.append(box("stagedeck", (S["minX"], 0, S["minZ"]), (S["maxX"], h, S["maxZ"] - 0.15), M["oak"], 0.02))
    mx, mz = S["musician"]
    out.append(cyl("micbase", (mx - 0.1, h, mz - 0.55), 0.12, 0.02, M["black"], 12))
    out.append(tube("micpole", [(mx - 0.1, h, mz - 0.55), (mx - 0.1, h + 1.45, mz - 0.55), (mx - 0.05, h + 1.55, mz - 0.4)],
                    0.01, M["black"]))
    out.append(sphere("mic", (mx - 0.05, h + 1.56, mz - 0.38), 0.03, M["steel"], 8, 6))
    gx, gz = 6.75, 4.55
    gw = mat("GuitarWood", "#c8792f", 0.4)
    out.append(sphere("guitarbody", (gx, h + 0.32, gz), 0.2, gw, 16, 8, (0.32, 1.25, 1.0)))
    out.append(sphere("guitarbody2", (gx, h + 0.58, gz), 0.15, gw, 16, 8, (0.32, 1.0, 1.0)))
    out.append(boxc("guitarneck", (gx, h + 0.95, gz), (0.03, 0.6, 0.05), M["wdark"]))
    out.append(boxc("amp", (6.6, h + 0.25, 5.55), (0.5, 0.5, 0.3), M["black"], 0.02, 0.4))
    out.append(cyl("stagestool", (mx, h, mz), 0.04, 0.62, M["chrome"], 8))
    out.append(cyl("stagestoolseat", (mx, h + 0.62, mz), 0.18, 0.05, M["leather2"], 14))
    out.append(cyl("stagespot", (6.3, CEIL - 0.25, 4.6), 0.08, 0.25, M["black"], 10))
    out.append(text("stageneon", "LIVE", (6.2, 2.25, 5.94), 0.28, M["neonpink"], 0.01, facing="back"))
    return out


def game_shelf():
    out = []
    S = L["gameShelf"]
    x0, x1, z0, z1 = S["minX"], S["maxX"], S["minZ"], S["maxZ"]
    out.append(box("gscase", (x0, 0, z0), (x1, 2.1, z0 + 0.04), M["wdark"]))
    out.append(box("gscase2", (x0, 0, z1 - 0.04), (x1, 2.1, z1), M["wdark"]))
    out.append(box("gsback", (x1 - 0.03, 0, z0), (x1, 2.1, z1), M["wdark"]))
    cols = ["#b8322f", "#2f5b8f", "#e9b434", "#2f7a4a", "#efe6cf", "#6b3f8f", "#d9772b", "#1e1e20"]
    for s in range(5):
        y = 0.05 + s * 0.42
        out.append(box(f"gsshelf{s}", (x0, y - 0.03, z0), (x1, y, z1), M["oak"]))
        if s == 4:
            continue
        z = z0 + 0.08
        while z < z1 - 0.2:
            w = 0.06 + rnd.random() * 0.1
            hgt = 0.25 + rnd.random() * 0.12
            ci = rnd.randrange(len(cols))
            out.append(box(f"gbox{s}_{z:.2f}", (x0 + 0.04, y, z), (x1 - 0.06, y + hgt, z + w), mat(f"Game{ci}", cols[ci], 0.6)))
            z += w + 0.01
    out.append(text("gssign", "SPELLETJES", (6.95, 2.4, 1.4), 0.15, M["gold"], 0.01, facing="left"))
    out.append(text("gssign2", "gratis te leen", (6.95, 2.22, 1.4), 0.07, M["plaster"], 0.0, facing="left"))
    return out


def banana_plant(out, name, x, z, size=1.0):
    k = size
    prof = [(0, 0)]
    for i in range(7):
        y = i * 0.075 * k
        prof.append((0.26 * k + 0.04 * k * (y / (0.45 * k)) + (0.008 * k if i % 2 else 0), y))
    prof += [(0.31 * k, 0.45 * k), (0.28 * k, 0.45 * k), (0.25 * k, 0.4 * k), (0, 0.4 * k)]
    out.append(lathe(name + "basket", prof, M["basket"], (x, 0, z), 20))
    out.append(cyl(name + "soil", (x, 0.38 * k, z), 0.27 * k, 0.02, M["wdark"], 16))
    for i in range(3):
        sx = x + (i - 1) * 0.05
        out.append(tube(f"{name}stem{i}", [(sx, 0.38 * k, z), (sx + (i - 1) * 0.04, (0.9 + i * 0.25) * k, z + 0.02 * i)],
                        0.028, M["leaf2"], 6))
    for i in range(10):
        a = i / 10 * math.tau + rnd.random() * 0.4
        h = (0.75 + rnd.random() * 0.75) * k
        out.append(leaf_blade(f"{name}leaf{i}", (x + math.sin(a) * 0.05, h, z + math.cos(a) * 0.05), a,
                              (0.55 + rnd.random() * 0.25) * k, 0.13 * k, M["banana"] if i % 2 else M["leaf"],
                              0.9 + rnd.random() * 0.4, 1.4 + rnd.random() * 0.8))


def pampas(out, name, x, z, pink=False):
    out.append(cyl(name + "bottle", (x, 0, z), 0.12, 0.45, M["glass"], 14, r2=0.06))
    out.append(cyl(name + "stump", (x, 0, z), 0.16, 0.12, M["oak"], 12))
    for i in range(5):
        a = i / 5 * math.tau
        tip = (x + math.sin(a) * 0.12, 1.6 + rnd.random() * 0.5, z + math.cos(a) * 0.12)
        out.append(tube(f"{name}stem{i}", [(x, 0.4, z), tip], 0.006, M["paper"], 4))
        out.append(blob(f"{name}plume{i}", (tip[0], tip[1] + 0.12, tip[2]), (0.05, 0.22, 0.05),
                        M["pampaspink"] if pink and i % 2 else M["pampas"], 0.15, a))


def plants():
    out = []
    banana_plant(out, "ban1", 6.45, -2.2, 1.1)
    banana_plant(out, "ban2", -0.6, 5.55, 0.9)
    pampas(out, "pamp1", -6.6, -2.7, True)
    pampas(out, "pamp2", 1.25, -2.9)
    pampas(out, "pamp3", 3.55, 5.6, True)
    for k in range(70):
        px = -0.95 + rnd.random() * 0.85
        py = 0.3 + rnd.random() * 2.8
        out.append(blob(f"wall{k}", (px, py, -5.93), (0.14, 0.1, 0.05), M["leaf"] if k % 3 else M["banana"], 0, 0, 6, 4))
    out.append(box("plantwallbg", (-1.0, 0.25, -5.98), (-0.05, 3.2, -5.95), M["leaf2"]))
    bx, bz = -6.55, -2.2
    out.append(boxc("buddhaplinth", (bx, 0.25, bz), (0.36, 0.5, 0.36), M["concrete"], 0.02))
    out.append(sphere("buddhahead", (bx, 0.78, bz), 0.2, M["buddha"], 16, 12, (0.9, 1.15, 0.95)))
    out.append(sphere("buddhabun", (bx, 1.02, bz), 0.1, M["buddha"], 12, 8))
    for k in range(10):
        a = k / 10 * math.tau
        out.append(sphere(f"buddhacurl{k}", (bx + math.sin(a) * 0.15, 0.92, bz + math.cos(a) * 0.14), 0.035, M["buddha"],
                          6, 4))
    out.append(sphere("buddhaneck", (bx, 0.55, bz), 0.12, M["buddha"], 12, 8))
    for k in range(40):
        gx = -6.4 + k * 0.25
        if 3.8 < gx < 5.6:
            continue
        out.append(blob(f"garland{k}", (gx, 2.95 - 0.12 * abs(math.sin(k * 0.8)), 5.82), (0.12, 0.08, 0.08),
                        [M["pampas"], M["leaf2"], M["pampaspink"]][k % 3], 0.3, k))
    return out


def lit_sign():
    """Upgrade: lights up the blade sign (emissive overlay) and the window."""
    out = blade_sign(True)
    out.append(text("neonopen", "OPEN", (2.0, 2.0, 5.95), 0.3, M["neonpink"], 0.01, facing="front"))
    return out


def vaporizer():
    out = []
    x, z = 6.55, -0.6
    out.append(cyl("vtable", (x, 0, z), 0.04, 0.7, M["black"], 8))
    out.append(cyl("vtabletop", (x, 0.7, z), 0.28, 0.04, M["table"], 18))
    out.append(boxc("vbase", (x, 0.82, z), (0.22, 0.16, 0.16), M["steel"], 0.02))
    out.append(cyl("vchamber", (x, 0.9, z), 0.05, 0.12, M["glass"], 10))
    out.append(sphere("vballoon", (x, 1.2, z), 0.12, mat("Balloon", "#dfe9f2", 0.2, alpha=0.5), 12, 8, (1, 1.5, 1)))
    out.append(text("vsigntext", "VAPORIZER", (6.95, 1.6, z), 0.08, M["gold"], 0.0, facing="left"))
    out.append(text("vsigntext2", "gratis", (6.95, 1.47, z), 0.07, M["plaster"], 0.0, facing="left"))
    return out


def decor():
    out = []
    for i, (x, y, z, face) in enumerate(((6.94, 2.2, -1.2, "left"), (-6.94, 2.2, -4.4, "right"))):
        out.append(boxc(f"tv{i}", (x, y, z), (0.06, 0.62, 1.05), M["black"], 0.01))
        out.append(boxc(f"tvs{i}", (x - 0.031 if face == "left" else x + 0.031, y, z), (0.004, 0.56, 0.98), M["tv"]))
    out.append(cyl("clockface", (6.96, 2.75, 1.4), 0.26, 0.04, M["white"], 32, axis="X"))
    out.append(torus("clockrim", (6.94, 2.75, 1.4), 0.26, 0.02, M["black"], 32, 8, axis="X"))
    for i in range(12):
        a = i / 12 * math.tau
        s = 0.05 if i % 3 == 0 else 0.03
        out.append(boxc(f"tick{i}", (6.93, 2.75 + math.cos(a) * 0.21, 1.4 + math.sin(a) * 0.21), (0.01, s, s), M["black"]))
    out.append(box("doormat", (4.1, 0, 4.9), (5.5, 0.015, 5.9), mat("Mat", "#2a2a2a", 0.95)))
    dz = L["stairs"]["doorGroundZ"]
    out.append(box("stairdoorg", (6.9, 0.02, dz - 0.45), (6.96, 2.15, dz + 0.45), M["wdark"], 0.01))
    out.append(box("stairdoorgk", (6.86, 1.0, dz - 0.35), (6.9, 1.05, dz - 0.25), M["chrome"]))
    out.append(text("privetext", "DAKTERRAS", (6.89, 2.35, dz), 0.1, M["gold"], 0.0, facing="left"))
    for i, x in enumerate((-5.0, -1.6, 2.0)):
        out.append(box(f"rad{i}", (x - 0.6, 0.12, 5.75), (x + 0.6, 0.48, 5.85), M["dark"], 0.01))
    return out


def clock_hands():
    hands = []
    for name, length, width in (("clock_hour", 0.13, 0.03), ("clock_minute", 0.2, 0.02)):
        o = boxc(name, (0, length / 2 - 0.025, 0), (0.008, length, width), M["black"])
        o.location = G(6.92, 2.75, 1.4)
        hands.append(o)
    return hands


# ----------------------------------------------------------------------------
# Rooftop terrace
# ----------------------------------------------------------------------------

def terrace():
    out = []
    y = L["terrace"]["y"]
    out.append(uv_box(box("deck", (-6.9, y - 0.05, -6.2), (6.9, y, 2.3), M["deck"]), 1.0))
    posts = [(-6.85 + i * (13.7 / 14), -6.15) for i in range(15)]
    for i in range(1, 9):
        posts += [(-6.85, -6.15 + i * 1.05), (6.85, -6.15 + i * 1.05)]
    for i, (px, pz) in enumerate(posts):
        out.append(cyl(f"rpost{i}", (px, y, pz), 0.03, 1.05, M["black"], 8))
    out.append(tube("rail_back", [(-6.85, y + 1.05, -6.15), (6.85, y + 1.05, -6.15)], 0.03, M["black"], 8))
    out.append(tube("rail_l", [(-6.85, y + 1.05, -6.15), (-6.85, y + 1.05, 2.25)], 0.03, M["black"], 8))
    out.append(tube("rail_r", [(6.85, y + 1.05, -6.15), (6.85, y + 1.05, 2.25)], 0.03, M["black"], 8))
    out.append(box("rglass_back", (-6.85, y + 0.08, -6.16), (6.85, y + 0.98, -6.14), M["glass"]))
    out.append(box("rglass_l", (-6.86, y + 0.08, -6.15), (-6.84, y + 0.98, 2.25), M["glass"]))
    out.append(box("rglass_r", (6.84, y + 0.08, -6.15), (6.86, y + 0.98, 2.25), M["glass"]))
    for i, z in enumerate((-5.0, -2.6, -0.2)):
        for sx in (-6.4, 6.4):
            out.append(box(f"planter{i}{sx}", (sx - 0.3, y, z - 0.7), (sx + 0.3, y + 0.55, z + 0.7), M["wdark"], 0.02))
            for k in range(5):
                out.append(blob(f"pl{i}{sx}{k}", (sx + rnd.uniform(-0.15, 0.15), y + 0.75, z - 0.5 + k * 0.25),
                                (0.22, 0.3, 0.22), M["leaf"] if k % 2 else M["leaf2"]))
    poles = [(-6.6, -5.9), (6.6, -5.9), (-6.6, 2.0), (6.6, 2.0), (0, -5.9)]
    for i, (px, pz) in enumerate(poles):
        out.append(cyl(f"slpole{i}", (px, y, pz), 0.04, 2.7, M["black"], 8))
    spans = [((-6.6, -5.9), (6.6, 2.0)), ((6.6, -5.9), (-6.6, 2.0)), ((-6.6, -5.9), (6.6, -5.9)),
             ((-6.6, 2.0), (6.6, 2.0)), ((0, -5.9), (0, 2.2))]
    for s, ((ax, az), (bx, bz)) in enumerate(spans):
        pts = []
        n = 16
        for k in range(n + 1):
            t = k / n
            pts.append((ax + (bx - ax) * t, y + 2.65 - 0.55 * 4 * t * (1 - t), az + (bz - az) * t))
        out.append(tube(f"slwire{s}", pts, 0.006, M["black"], 4))
        for k in range(1, n):
            px, py, pz = pts[k]
            out.append(sphere(f"slb{s}_{k}", (px, py - 0.06, pz), 0.035, M["bulb"], 8, 5))
    for i in range(3):
        out.append(box(f"pallet{i}", (-6.5 + i * 0.75, y, -5.8), (-5.8 + i * 0.75, y + 0.3, -5.0), M["oak"], 0.01))
        out.append(box(f"cush{i}", (-6.45 + i * 0.75, y + 0.3, -5.75), (-5.85 + i * 0.75, y + 0.45, -5.05), M["leather"],
                       0.05))
        out.append(box(f"cushb{i}", (-6.45 + i * 0.75, y + 0.45, -5.8), (-5.85 + i * 0.75, y + 0.85, -5.6), M["leather"],
                       0.05))
    sx = L["stairs"]["doorTerraceX"]
    zb = L["upper"]["minZ"]
    out.append(box("awning", (sx - 0.7, 6.1, zb - 0.9), (sx + 0.7, 6.18, zb - 0.3), M["awning"]))
    out.append(sphere("doorlamp", (sx + 0.7, 5.5, zb - 0.38), 0.1, M["globe"], 10, 6))
    out.append(text("terrsign", "DAKTERRAS", (sx - 2.3, 5.9, zb - 0.31), 0.22, M["signred"], 0.01, facing="back"))
    return out


# ----------------------------------------------------------------------------
# The alley (Vlaamsegas) and the city around it
# ----------------------------------------------------------------------------

def bike(out, name, x, z, frame_m):
    """A parked bike leaning on a wall, parallel to the alley."""
    y = 0.36
    out.append(torus(name + "w1", (x - 0.52, y, z), 0.34, 0.022, M["tyre"], 20, 6, axis="Z"))
    out.append(torus(name + "w2", (x + 0.52, y, z), 0.34, 0.022, M["tyre"], 20, 6, axis="Z"))
    P = lambda dx, yy: (x + dx, yy, z)
    out.append(tube(name + "frame", [P(-0.52, y), P(-0.1, 0.82), P(0.42, 0.9), P(0.52, y)], 0.02, frame_m))
    out.append(tube(name + "frame2", [P(-0.05, y + 0.02), P(-0.1, 0.82)], 0.02, frame_m))
    out.append(tube(name + "frame3", [P(-0.05, y + 0.02), P(0.42, 0.9)], 0.02, frame_m))
    out.append(boxc(name + "saddle", P(-0.12, 0.88), (0.22, 0.05, 0.1), M["black"], 0.01))
    hx, hy, hz = P(0.38, 1.0)
    out.append(tube(name + "bar", [(hx, hy, hz - 0.25), (hx, hy, hz + 0.25)], 0.015, M["steel"]))


def alley_building(out, name, x0, x1, height, front_z, facing, wall_mat, seed, shop=None):
    """A building along the alley. facing=+1 faces +z (our side), -1 faces -z (opposite side)."""
    r = random.Random(seed)
    zf = front_z
    if facing > 0:
        out.append(uv_box(box(name + "mass", (x0, 0, zf - 14), (x1, height, zf), wall_mat), 1.0))
    else:
        out.append(uv_box(box(name + "mass", (x0, 0, zf), (x1, height, zf + 14), wall_mat), 1.0))
    off = 0.03 * facing
    lo, hi = min(zf, zf + off), max(zf, zf + off)
    w = x1 - x0
    dx = x0 + 0.6 + r.random() * max(0.1, w - 2.2)
    out.append(box(name + "door", (dx, 0, lo), (dx + 0.95, 2.2, hi), M["wdark"]))
    if w > 3.0:
        wx0 = dx + 1.3 if dx + 1.3 + 1.6 < x1 else x0 + 0.4
        out.append(box(name + "win", (wx0, 0.7, lo), (wx0 + 1.6, 2.3, hi), M["lit"] if r.random() < 0.5 else M["glassdark"]))
    for f in range(int((height - 3.4) // 2.9)):
        yy = 3.6 + f * 2.9
        n = max(1, int(w // 2.4))
        for k in range(n):
            cx = x0 + w * (k + 0.5) / n
            out.append(box(f"{name}uwf{f}{k}", (cx - 0.56, yy - 0.06, lo), (cx + 0.56, yy + 1.66, hi), M["white"]))
            g_lo, g_hi = min(zf + off, zf + 2 * off), max(zf + off, zf + 2 * off)
            out.append(box(f"{name}uw{f}{k}", (cx - 0.5, yy, g_lo), (cx + 0.5, yy + 1.6, g_hi),
                           M["lit"] if r.random() < 0.35 else M["glassdark"]))
    out.append(box(name + "cope", (x0, height, min(zf, zf + 0.1 * facing) - (14 if facing > 0 else 0)),
                   (x1, height + 0.15, max(zf, zf + 0.1 * facing) + (0 if facing > 0 else 14)), M["coping"]))
    if r.random() < 0.6:
        out.append(cyl(name + "pipe", (x0 + 0.15, 0, zf + 0.08 * facing), 0.045, height, M["coping"], 8))
    if r.random() < 0.5 and height > 3.5:
        out.append(boxc(name + "ac", (x0 + w * 0.6, 2.9, zf + 0.17 * facing), (0.75, 0.5, 0.3), M["white"], 0.02))
    if shop:
        label, color = shop
        out.append(boxc(name + "signb", (x0 + w / 2, 2.75, zf + 0.06 * facing), (min(w - 0.4, 2.6), 0.45, 0.08), color,
                        0.01))
        out.append(text(name + "signt", label, (x0 + w / 2, 2.75, zf + 0.11 * facing), 0.24, M["signwhite"], 0.01,
                        facing="front" if facing > 0 else "back"))


def alley():
    out = []
    oz = L["alley"]["maxZ"]
    out.append(uv_box(box("alleyfloor", (-45, -0.06, 6.0), (45, 0.0, oz + 0.3), M["pavers"]), 1.4))
    out.append(box("gutter", (-45, 0.0, 7.95), (45, 0.006, 8.1), M["coping"]))
    specs = [("nL1", -13.5, -7.3, 6.6, M["brick"], ("KAPPER", M["blue"])),
             ("nL2", -21.0, -13.5, 9.5, M["ybrick"], None),
             ("nL3", -30.0, -21.0, 8.0, M["brick2"], ("TATTOO", M["black"])),
             ("nR1", 7.3, 13.0, 8.4, M["brick2"], None),
             ("nR2", 13.0, 21.0, 6.2, M["ybrick"], ("FIETSEN", M["red"])),
             ("nR3", 21.0, 30.0, 10.0, M["brick"], None)]
    for i, (n, x0, x1, h, m, shop) in enumerate(specs):
        alley_building(out, n, x0, x1, h, 6.3, 1, m, 100 + i, shop)
    # Opposite side: a low painted building with a snack bar (generic), taller brick behind
    out.append(box("oppLow", (-6.5, 0, oz), (9.5, 3.4, oz + 10), M["greenpaint"]))
    out.append(box("oppLowCope", (-6.6, 3.4, oz - 0.05), (9.6, 3.55, oz + 10), M["coping"]))
    stripes = [M["red"], M["yellowp"], M["black"]]
    for k in range(9):
        x = -6.0 + k * 1.7
        h1 = 0.5 + (k % 2) * 0.9
        for j, m in enumerate(stripes):
            out.append(boxc(f"mural{k}{j}", (x + 0.4, h1 + j * 0.28, oz - 0.01), (1.4, 0.22, 0.02), m))
    out.append(box("oppdoor1", (-3.0, 0, oz - 0.03), (-2.05, 2.2, oz), M["wdark"]))
    out.append(box("oppwin1", (0.5, 0.9, oz - 0.03), (2.4, 2.3, oz), M["lit"]))
    out.append(box("oppdoor2", (6.0, 0, oz - 0.03), (6.95, 2.2, oz), M["black"]))
    out.append(tube("snackarm", [(1.5, 3.6, oz), (1.5, 3.9, oz - 0.6)], 0.04, M["black"], 6))
    out.append(cyl("snackdisc", (1.42, 4.35, oz - 0.6), 0.45, 0.16, M["signwhite"], 28, axis="X"))
    for side, facing in ((1, "right"), (-1, "left")):
        out.append(text(f"snacktext{side}", "SNACKBAR", (1.5 + side * 0.09, 4.38, oz - 0.6), 0.13, M["signred"], 0.0,
                        facing=facing))
        out.append(text(f"snacktext2{side}", "frites · kroket", (1.5 + side * 0.09, 4.2, oz - 0.6), 0.07, M["black"], 0.0,
                        facing=facing))
    pts = [(-6.4 + k * 0.08, 3.75 + 0.12 * math.sin(k * 1.3), oz + 0.15 + 0.12 * math.cos(k * 1.3)) for k in range(200)]
    out.append(tube("barbed", pts, 0.006, M["steel"], 4))
    out.append(box("oppTall", (-6.5, 0, oz + 6), (9.5, 11.0, oz + 16), M["brick2"]))
    for k in range(5):
        out.append(box(f"oppTallw{k}", (-5.0 + k * 3.0, 6.0, oz + 5.97), (-4.0 + k * 3.0, 7.6, oz + 6),
                       M["lit"] if k % 2 else M["glassdark"]))
    for i, (x0, x1, h, m) in enumerate(((-30, -20.5, 9.0, M["brick"]), (-20.5, -6.5, 7.5, M["ybrick"]),
                                         (9.5, 18, 8.5, M["brick"]), (18, 30, 9.5, M["brick2"]))):
        alley_building(out, f"opp{i}", x0, x1, h, oz, -1, m, 200 + i)
    for i, x in enumerate((-17.0, -10.0, 10.0, 17.0)):
        wall_globe(out, f"aglb{i}", x, 3.4, 6.3)
    for i, x in enumerate((-12.0, 5.0, 14.0)):
        wall_globe(out, f"oglb{i}", x, 3.2, oz, -1)
    bikes = [(-12.0, 6.65), (-10.9, 6.65), (-8.4, 6.65), (6.6, 6.65), (8.2, 6.65), (9.3, 6.65), (11.6, 6.65),
             (-4.6, oz - 0.35), (-1.0, oz - 0.35), (3.6, oz - 0.35), (12.5, oz - 0.35)]
    mats = [M["bike1"], M["bike2"], M["bike3"]]
    for i, (bx, bz) in enumerate(bikes):
        bike(out, f"bike{i}", bx, bz, mats[i % 3])
    out.append(cyl("campole", (-8.6, 0, oz - 0.2), 0.06, 5.0, M["coping"], 8))
    out.append(sphere("cam2", (-8.4, 4.9, oz - 0.3), 0.14, M["white"], 10, 6, (1, 0.8, 1)))
    out.append(cyl("bin", (7.6, 0, 6.6), 0.25, 0.9, mat("BinGreen", "#2d4a33", 0.6), 14))
    return out


def skyline():
    out = []
    r = random.Random(7)
    for i in range(70):
        a = r.uniform(0, math.tau)
        d = r.uniform(32, 75)
        x, z = math.sin(a) * d, math.cos(a) * d
        w, dpt, h = r.uniform(5, 9), r.uniform(6, 12), r.uniform(9, 17)
        rot = r.uniform(-0.2, 0.2)
        m = [M["brick"], M["brick2"], M["ybrick"]][i % 3]
        out.append(boxc(f"city{i}", (x, h / 2, z), (w, h, dpt), m, 0, rot))
        rb = prism_roof(f"cityroof{i}", x - w / 2, x + w / 2, z - dpt / 2, z + dpt / 2, h, h + w * 0.4,
                        M["rooftile"] if i % 2 else M["slate"])
        rb.rotation_euler = (0, 0, rot)
        out.append(rb)
    cx, cz = -24.0, -42.0
    out.append(boxc("church_nave", (cx + 12, 9, cz - 4), (30, 18, 14), M["church"]))
    out.append(prism_roof("church_naveroof", cx - 3, cx + 27, cz - 11, cz + 3, 18, 26, M["churchroof"]))
    out.append(boxc("tower1", (cx, 15, cz), (9, 30, 9), M["church"]))
    out.append(boxc("tower1b", (cx, 30.5, cz), (9.6, 1, 9.6), M["stone"]))
    out.append(cyl("tower2", (cx, 31, cz), 4.0, 12, M["church"], 8, smooth=False))
    for i in range(8):
        a = i / 8 * math.tau + math.pi / 8
        out.append(boxc(f"towerwin{i}", (cx + math.sin(a) * 3.7, 37, cz + math.cos(a) * 3.7), (1.2, 4.5, 0.4),
                        M["glassdark"], 0, a))
    out.append(cyl("tower3", (cx, 43, cz), 4.3, 1.0, M["stone"], 8, smooth=False))
    out.append(sphere("tower4", (cx, 46.5, cz), 3.6, M["churchroof"], 12, 8, (1, 0.9, 1)))
    out.append(cyl("tower5", (cx, 49.5, cz), 1.2, 3.5, M["church"], 8, smooth=False))
    out.append(sphere("tower6", (cx, 54.0, cz), 1.6, M["churchroof"], 10, 8, (1, 1.2, 1)))
    out.append(cyl("tower7", (cx, 55.5, cz), 0.25, 5.5, M["churchroof"], 6, r2=0.02))
    out.append(sphere("towerball", (cx, 58.0, cz), 0.35, M["gold"], 8, 6))
    out.append(box("behind", (-7.3, 0, -18), (7.3, 3.2, -8.4), M["roof"]))
    out.append(box("behindwall", (-7.3, 0, -8.7), (7.3, 3.4, -8.4), M["brick2"]))
    for i in range(5):
        out.append(cyl(f"vent{i}", (-5 + i * 2.5, 3.2, -11 - (i % 2) * 2), 0.2, 0.6, M["steel"], 10))
    return out


# ----------------------------------------------------------------------------

def build(ao=True):
    materials()
    root = empty("Kronkel")
    groups = {
        "static": shell() + shop_counter() + bar() + kitchen() + decor() + alley(),
        "static_facade": facade(),
        "static_ceiling": ceiling(),
        "static_far": skyline(),
    }
    for t in L["tables"]:
        groups[f"table_{t['id']}"] = table_group(t)
    groups["upg_pool"] = pool_tables()
    groups["upg_pool_ceil"] = pool_lamps()
    groups["upg_lounge"] = lounge()
    groups["upg_stage"] = stage()
    groups["upg_gameShelf"] = game_shelf()
    groups["upg_plants"] = plants()
    groups["upg_neon"] = lit_sign()
    groups["upg_vaporizer"] = vaporizer()
    groups["upg_terrace"] = terrace()

    textured = ("Laminate", "Concrete", "BarnWood", "CeilingTiles", "TealBoards", "BrickCream", "Brick", "BrickDark",
                "Tiles", "Pavers", "Deck")
    nodes = []
    for gname, objs in groups.items():
        objs = [o for o in objs if o is not None]
        for o in objs:
            if o.data.materials and o.data.materials[0].name in textured and not o.get("uv_done"):
                uv_box(o, 1.0)
        parent = empty(gname, root)
        if ao and gname != "static_far":
            for o in objs:
                subdivide_long_faces(o, 0.6 if gname.startswith("static") else 0.45)
        nodes.extend(merge_by_material(objs, gname, parent))
    for h in clock_hands():
        h.parent = root
    return root, nodes, []
