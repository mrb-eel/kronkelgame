"""Small props the game spawns: drinks, food, products, board games, tray, ID card.

Each prop is one top-level node named prop_<id>, origin at the bottom centre. Materials named
ShakeFill / GameBox are recoloured per instance in the game.
"""
import math
import random

import bmesh
import bpy
from mathutils import Matrix, Vector

from lib import box, boxc, cyl, join, mat, render_preview, sphere, text, torus, tube, _finish, G

rnd = random.Random(42)


def wedge(name, center, r, h, angle, material):
    """Pie/sandwich wedge: triangular prism, apex at center, opening toward +z."""
    bm = bmesh.new()
    a0, a1 = -angle / 2, angle / 2
    pts = [(0, 0), (math.sin(a0) * r, math.cos(a0) * r), (math.sin(a1) * r, math.cos(a1) * r)]
    lo = [bm.verts.new(G(center[0] + x, center[1], center[2] + z)) for x, z in pts]
    hi = [bm.verts.new(G(center[0] + x, center[1] + h, center[2] + z)) for x, z in pts]
    bm.faces.new(lo)
    bm.faces.new(list(reversed(hi)))
    for i in range(3):
        j = (i + 1) % 3
        bm.faces.new((lo[i], lo[j], hi[j], hi[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bmesh.ops.bevel(bm, geom=list(bm.edges), offset=0.004, segments=1, affect="EDGES")
    return _finish(bm, name, material, 40)


def plate(parts, name, r=0.12):
    parts.append(cyl(name + "plate", (0, 0, 0), r, 0.012, M["white"], 24, r2=r * 0.85))
    parts.append(cyl(name + "rim", (0, 0.012, 0), r * 0.85, 0.006, M["white"], 24))


M = {}


def materials():
    M["white"] = mat("Porcelain", "#f6f3ec", 0.3)
    M["glass"] = mat("Glass", "#d6eef5", 0.05, alpha=0.3)
    M["shake"] = mat("ShakeFill", "#f2a0b4", 0.6)
    M["cream"] = mat("WhippedCream", "#fffaf0", 0.8)
    M["straw"] = mat("Straw", "#2f8f4a", 0.5)
    M["cherry"] = mat("Cherry", "#c4161c", 0.25)
    M["tea"] = mat("Tea", "#c9a03a", 0.2, alpha=0.75)
    M["mint"] = mat("Mint", "#3f9a3a", 0.6)
    M["coffee"] = mat("Coffee", "#6b4024", 0.4)
    M["foam"] = mat("Foam", "#e9d6b8", 0.8)
    M["cola"] = mat("Cola", "#3a1a10", 0.15)
    M["ice"] = mat("Ice", "#e8f6ff", 0.05, alpha=0.6)
    M["lemon"] = mat("Lemon", "#f2d53c", 0.5)
    M["crust"] = mat("PieCrust", "#c88b46", 0.8)
    M["apple"] = mat("AppleFill", "#e0b45a", 0.6)
    M["toast"] = mat("Toast", "#d8a35a", 0.85)
    M["cheese"] = mat("Cheese", "#f2c94c", 0.6)
    M["ketchup"] = mat("Ketchup", "#b3241c", 0.3)
    M["fries"] = mat("Fries", "#f0c75e", 0.7)
    M["paper"] = mat("Paper", "#efe6cf", 0.9)
    M["paperred"] = mat("PaperRed", "#c0392b", 0.8)
    M["mayo"] = mat("Mayo", "#fbf3d5", 0.4)
    M["bun"] = mat("Bun", "#c98a3e", 0.6)
    M["patty"] = mat("Patty", "#5a3220", 0.8)
    M["lettuce"] = mat("Lettuce", "#6fb84a", 0.7)
    M["tomato"] = mat("Tomato", "#d9452c", 0.5)
    M["game"] = mat("GameBox", "#2f5b8f", 0.6)
    M["label"] = mat("Label", "#f4f1ea", 0.7)
    M["bag"] = mat("Baggie", "#eaf4ee", 0.2, alpha=0.45)
    M["weed"] = mat("Bud", "#6f9a3b", 0.95)
    M["sticker"] = mat("Sticker", "#1d4a2f", 0.6)
    M["roll"] = mat("RollPaper", "#f3efe4", 0.85)
    M["filter"] = mat("Filter", "#d9c49a", 0.85)
    M["foil"] = mat("Foil", "#c8ccd2", 0.25, 0.8)
    M["cake"] = mat("CakeBrown", "#6b4a2b", 0.8)
    M["black"] = mat("BlackMetal", "#1e1e20", 0.45, 0.6)
    M["lighter"] = mat("LighterBody", "#d9452c", 0.4)
    M["steel"] = mat("Steel", "#c3c7cc", 0.3, 0.9)
    M["card"] = mat("IdCard", "#dce8f2", 0.4)
    M["cardblue"] = mat("IdBlue", "#2b4c8c", 0.5)
    M["note"] = mat("Banknote", "#9cc9a3", 0.8)
    M["crumbs"] = mat("Crumbs", "#b58a4a", 0.9)
    M["gold"] = mat("Coins", "#d9b24a", 0.3, 0.9)


def build_prop(name, parts, x):
    o = join([p for p in parts if p is not None], f"prop_{name}")
    o.location = (x, 0, 0)
    return o


def shake():
    p = []
    p.append(cyl("sg", (0, 0, 0), 0.042, 0.17, M["glass"], 18, r2=0.055))
    p.append(cyl("sf", (0, 0.004, 0), 0.039, 0.15, M["shake"], 16, r2=0.051))
    p.append(sphere("sc", (0, 0.165, 0), 0.05, M["cream"], 14, 8, (1, 0.8, 1)))
    p.append(sphere("sc2", (0, 0.2, 0), 0.03, M["cream"], 12, 6, (1, 0.9, 1)))
    p.append(sphere("ch", (0.01, 0.235, 0.0), 0.015, M["cherry"], 10, 6))
    p.append(tube("st", [(-0.015, 0.08, 0.0), (-0.03, 0.27, 0.02)], 0.006, M["straw"], 8))
    return p


def tea():
    p = [cyl("sau", (0, 0, 0), 0.07, 0.008, M["white"], 20)]
    p.append(cyl("tg", (0, 0.008, 0), 0.032, 0.11, M["glass"], 16, r2=0.038))
    p.append(cyl("tt", (0, 0.012, 0), 0.03, 0.09, M["tea"], 14, r2=0.035))
    for i in range(5):
        a = i / 5 * math.tau
        p.append(sphere(f"m{i}", (math.sin(a) * 0.012, 0.06 + i * 0.012, math.cos(a) * 0.012), 0.02, M["mint"], 8, 5,
                        (1, 0.3, 0.6)))
    return p


def coffee():
    p = [cyl("sau", (0, 0, 0), 0.07, 0.008, M["white"], 20)]
    p.append(cyl("cup", (0, 0.008, 0), 0.036, 0.07, M["white"], 18, r2=0.045))
    p.append(cyl("cof", (0, 0.07, 0), 0.042, 0.006, M["foam"], 18))
    p.append(torus("handle", (0.05, 0.045, 0), 0.016, 0.005, M["white"], 12, 6, axis="Z"))
    return p


def cola():
    p = [cyl("cg", (0, 0, 0), 0.036, 0.14, M["glass"], 16, r2=0.04)]
    p.append(cyl("cl", (0, 0.004, 0), 0.033, 0.12, M["cola"], 14, r2=0.037))
    for i in range(3):
        p.append(boxc(f"ice{i}", (0.01 * (i - 1), 0.12 + i * 0.006, 0.006 * i), (0.022, 0.022, 0.022), M["ice"], 0.004,
                      i * 0.5))
    p.append(cyl("lem", (0.03, 0.12, 0), 0.025, 0.006, M["lemon"], 14, axis="X"))
    p.append(tube("st", [(0.0, 0.05, 0.0), (0.012, 0.2, -0.012)], 0.005, M["paperred"], 6))
    return p


def pie():
    p = []
    plate(p, "pp", 0.1)
    p.append(wedge("crust", (0, 0.018, -0.05), 0.11, 0.05, math.radians(50), M["crust"]))
    p.append(wedge("fill", (0, 0.068, -0.045), 0.1, 0.006, math.radians(46), M["apple"]))
    p.append(sphere("cr", (0.0, 0.08, 0.03), 0.025, M["cream"], 10, 6, (1, 0.7, 1)))
    return p


def tosti():
    p = []
    plate(p, "tp", 0.12)
    for i, (dx, ry) in enumerate(((-0.03, 0.4), (0.035, -0.5))):
        wg = wedge(f"t{i}", (dx, 0.018, -0.04), 0.1, 0.025, math.radians(80), M["toast"])
        p.append(wg)
        p.append(wedge(f"ch{i}", (dx, 0.025, -0.037), 0.095, 0.01, math.radians(76), M["cheese"]))
    p.append(cyl("kc", (0.07, 0.018, 0.05), 0.022, 0.02, M["white"], 12))
    p.append(cyl("k", (0.07, 0.02, 0.05), 0.019, 0.016, M["ketchup"], 12))
    return p


def fries():
    p = [boxc("tray", (0, 0.03, 0), (0.12, 0.06, 0.09), M["paperred"], 0.005)]
    for i in range(26):
        x = rnd.uniform(-0.045, 0.045)
        z = rnd.uniform(-0.03, 0.03)
        p.append(boxc(f"f{i}", (x, 0.06 + rnd.uniform(0, 0.03), z), (0.011, 0.06 + rnd.uniform(0, 0.04), 0.011),
                      M["fries"], 0, rnd.uniform(0, 3)))
    p.append(sphere("mayo", (0.035, 0.1, 0.0), 0.022, M["mayo"], 10, 6, (1, 0.7, 1)))
    return p


def burger():
    p = []
    plate(p, "bp", 0.13)
    p.append(cyl("bb", (0, 0.018, 0), 0.065, 0.025, M["bun"], 20))
    p.append(cyl("pat", (0, 0.043, 0), 0.068, 0.022, M["patty"], 20))
    p.append(boxc("chs", (0, 0.066, 0), (0.12, 0.005, 0.12), M["cheese"], 0, 0.4))
    p.append(cyl("let", (0, 0.068, 0), 0.072, 0.008, M["lettuce"], 14))
    p.append(cyl("tom", (0, 0.076, 0), 0.06, 0.008, M["tomato"], 16))
    p.append(sphere("bt", (0, 0.084, 0), 0.068, M["bun"], 20, 10, (1, 0.6, 1)))
    p.append(tube("pick", [(0, 0.08, 0), (0, 0.19, 0)], 0.003, M["filter"], 5))
    p.append(boxc("flag", (0.025, 0.175, 0), (0.05, 0.03, 0.002), M["sticker"]))
    for i in range(10):
        a = i / 10 * math.tau
        p.append(boxc(f"fry{i}", (math.sin(a) * 0.035 + 0.075, 0.025, math.cos(a) * 0.02 - 0.06), (0.06, 0.011, 0.011),
                      M["fries"], 0, a))
    return p


def gamebox():
    p = [boxc("gb", (0, 0.035, 0), (0.3, 0.07, 0.22), M["game"], 0.006)]
    p.append(boxc("lab", (0, 0.0705, 0), (0.2, 0.002, 0.08), M["label"]))
    p.append(text("gtxt", "SPEL", (0, 0.072, 0), 0.04, M["game"], 0.0, facing="up"))
    return p


def baggie():
    p = [boxc("bag", (0, 0.012, 0), (0.08, 0.024, 0.11), M["bag"], 0.008)]
    for i in range(4):
        p.append(sphere(f"bud{i}", (rnd.uniform(-0.02, 0.02), 0.012, rnd.uniform(-0.03, 0.03)), 0.014, M["weed"], 8, 5,
                        (1, 0.8, 1.3)))
    p.append(boxc("zip", (0, 0.012, -0.05), (0.08, 0.026, 0.006), M["sticker"]))
    p.append(boxc("st", (0.0, 0.0245, 0.02), (0.04, 0.001, 0.03), M["label"]))
    return p


def preroll():
    p = [cyl("pr", (0, 0.0045, -0.04), 0.0045, 0.09, M["roll"], 10, r2=0.007, axis="Z")]
    p.append(cyl("fl", (0, 0.0045, -0.05), 0.0045, 0.018, M["filter"], 10, axis="Z"))
    p.append(sphere("tw", (0, 0.007, 0.052), 0.007, M["roll"], 8, 5, (1, 1, 1.6)))
    # They're tiny: show three in a little tube for readability
    p.append(cyl("tube", (0.03, 0.009, -0.06), 0.009, 0.12, mat("TubeGreen", "#2f8f4a", 0.4), 12, axis="Z"))
    return p


def spacecake():
    p = [boxc("ck", (0, 0.02, 0), (0.08, 0.04, 0.08), M["cake"], 0.006)]
    p.append(boxc("wrap", (0, 0.02, 0), (0.085, 0.042, 0.085), M["bag"], 0.006))
    p.append(boxc("lab", (0, 0.0415, 0), (0.05, 0.001, 0.03), M["sticker"]))
    return p


def papers():
    p = [boxc("pk", (0, 0.004, 0), (0.07, 0.008, 0.035), M["sticker"], 0.002)]
    p.append(boxc("pl", (0, 0.0085, 0), (0.06, 0.001, 0.02), M["label"]))
    return p


def lighter():
    p = [boxc("lb", (0, 0.03, 0), (0.025, 0.06, 0.012), M["lighter"], 0.004)]
    p.append(boxc("lt", (0, 0.068, 0), (0.022, 0.016, 0.011), M["steel"], 0.002))
    return p


def idcard():
    p = [boxc("card", (0, 0.001, 0), (0.0856, 0.002, 0.054), M["card"], 0.002)]
    p.append(boxc("band", (0, 0.0021, -0.02), (0.0856, 0.0004, 0.012), M["cardblue"]))
    p.append(boxc("photo", (-0.026, 0.0022, 0.008), (0.022, 0.0004, 0.028), M["crust"]))
    return p


def banknote():
    return [boxc("note", (0, 0.0005, 0), (0.13, 0.001, 0.067), M["note"])]


def tray():
    return [cyl("tr", (0, 0, 0), 0.2, 0.012, M["black"], 28), torus("trr", (0, 0.014, 0), 0.195, 0.008, M["black"], 28, 6)]


def bill():
    p = []
    plate(p, "bl", 0.08)
    p.append(boxc("rc", (0, 0.02, 0), (0.06, 0.002, 0.1), M["paper"], 0, 0.3))
    for i in range(2):
        p.append(cyl(f"coin{i}", (0.03 + i * 0.006, 0.02 + i * 0.003, -0.03), 0.012, 0.003, M["gold"], 12))
    return p


def dirty():
    p = []
    plate(p, "dp", 0.11)
    for i in range(10):
        p.append(sphere(f"cr{i}", (rnd.uniform(-0.06, 0.06), 0.02, rnd.uniform(-0.06, 0.06)), 0.006, M["crumbs"], 6, 4))
    p.append(cyl("eg", (0.12, 0, 0.05), 0.036, 0.14, M["glass"], 14, r2=0.04))
    p.append(cyl("res", (0.12, 0.003, 0.05), 0.033, 0.02, M["shake"], 12))
    p.append(boxc("nap", (-0.05, 0.02, 0.03), (0.06, 0.01, 0.05), M["paper"], 0.004, 0.6))
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
