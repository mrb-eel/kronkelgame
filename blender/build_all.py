"""Build every 3D asset for the game.

Usage (either works):
    python blender/build_all.py [--no-ao] [--previews] [--only shop,people,props]
    blender -b -P blender/build_all.py -- [--no-ao] [--previews] [--only ...]

Writes:
    blender/out/{shop,people,props}.glb      raw exports
    assets/models/{shop,people,props}.glb   meshopt-compressed copies loaded by the game (via npm run compress)
    blender/out/*.blend                      editable Blender source files
    docs/screenshots/blender_*.png           Cycles preview renders (with --previews)
"""
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402

import lib  # noqa: E402

ROOT = lib.ROOT
MODELS = os.path.join(ROOT, "blender", "out")  # raw exports; tools/compress-models.mjs writes assets/models
OUT = os.path.join(ROOT, "blender", "out")
SHOTS = os.path.join(ROOT, "docs", "screenshots")


def args():
    a = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
    only = None
    if "--only" in a:
        only = set(a[a.index("--only") + 1].split(","))
    return {"ao": "--no-ao" not in a, "previews": "--previews" in a, "only": only,
            "samples": int(a[a.index("--samples") + 1]) if "--samples" in a else 64}


def interior_lights():
    """Moody Kronkel lighting: pink drum lamps, orange wall washers, purple ceiling wash, spots."""
    L = lib.load_json("layout.json")
    lights = []
    for t in L["tables"]:
        if t["type"] == "pod":
            lights.append(((t["x"], 2.05, t["z"]), "#ff4f7a", 55, 0.3))
    for z in (-5.0, -3.4, 3.6, 5.2):
        lights.append(((-6.75, 0.4, z), "#ff9a3a", 45, 0.2))
    for x in (-6.2, 0.4, 1.0):
        lights.append(((x, 0.4, -5.75), "#ff9a3a", 45, 0.2))
    for x, z in ((-4, -2), (3, -1), (-3, 3), (3, 3.5)):
        lights.append(((x, 3.1, z), "#a040ff", 70, 1.5))
    for x in (-5.4, -1.8, 1.8, 5.4):
        for z in (-4.8, -1.8, 1.0, 4.6):
            lights.append(((x, 3.2, z), "#fff1d8", 14, 0.1))
    lights.append(((4.1, 2.4, -5.0), "#e8ffe0", 40, 0.5))
    lights.append(((-3.9, 2.2, -3.9), "#ffc27a", 60, 0.4))
    lights.append(((-6.4, 0.6, 0.3), "#ff7a1a", 40, 0.4))
    lights.append(((-5.3, 1.6, 3.5), "#fff4e0", 60, 0.6))
    lights.append(((-3.6, 2.6, -7.2), "#fff1d6", 80, 0.5))
    return lights


def alley_lights():
    lights = []
    for x in (-17.0, -10.0, -4.8, 0.6, 6.5, 10.0, 17.0):
        lights.append(((x, 3.5, 6.75), "#ffd9a0", 60, 0.2))
    for x in (-12.0, 5.0, 14.0):
        lights.append(((x, 3.2, 9.3), "#ffd9a0", 60, 0.2))
    lights.append(((3.0, 6.0, 8.0), "#ff4040", 120, 0.6))
    return lights


def build_shop(o):
    import shop
    lib.reset()
    t = time.time()
    root, nodes, hands = shop.build(ao=o["ao"])
    print(f"[shop] geometry built in {time.time() - t:.1f}s, {len(nodes)} meshes")
    if o["ao"]:
        t = time.time()
        bake = [n for n in nodes if not n.name.startswith("static_far")]
        lib.set_vertex_ao(bake, samples=32, distance=1.0)
        print(f"[shop] AO baked in {time.time() - t:.1f}s")
    os.makedirs(OUT, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, "kronkel_shop.blend"), compress=True)
    lib.export_glb(os.path.join(MODELS, "shop.glb"))
    print(f"[shop] exported {os.path.getsize(os.path.join(MODELS, 'shop.glb')) / 1e6:.1f} MB")
    if o["previews"]:
        s = o["samples"]
        night = dict(sun=False, world="#141a30", world_strength=0.5)
        lib.render_preview(os.path.join(SHOTS, "blender_alley.png"), (12.5, 1.7, 8.6), (2.0, 4.2, 7.0), 20,
                           samples=s, lights=interior_lights() + alley_lights(), **night)
        lib.render_preview(os.path.join(SHOTS, "blender_shop_interior.png"), (5.9, 2.5, 5.4), (-2.0, 0.9, -2.0), 17,
                           samples=s, lights=interior_lights(), sun=False, world="#141a30", world_strength=0.15)
        lib.render_preview(os.path.join(SHOTS, "blender_shop_booths.png"), (2.6, 1.5, 4.2), (-2.6, 0.9, -1.0), 20,
                           samples=s, lights=interior_lights(), sun=False, world="#141a30", world_strength=0.15)
        lib.render_preview(os.path.join(SHOTS, "blender_shop_counter.png"), (3.8, 1.65, -4.9), (3.6, 1.1, 1.5), 18,
                           samples=s, lights=interior_lights(), sun=False, world="#141a30", world_strength=0.15)
        lib.render_preview(os.path.join(SHOTS, "blender_shop_lounge.png"), (-2.6, 1.6, 2.6), (-6.6, 1.0, -0.6), 20,
                           samples=s, lights=interior_lights(), sun=False, world="#141a30", world_strength=0.15)
        lib.render_preview(os.path.join(SHOTS, "blender_terrace.png"), (5.8, 5.6, 2.0), (-3.0, 3.8, -5.0), 18,
                           samples=s, sun=True, world="#9cc3e6", world_strength=1.0)


def build_people(o):
    import people
    lib.reset()
    objs = people.build()
    os.makedirs(OUT, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, "kronkel_people.blend"), compress=True)
    lib.export_glb(os.path.join(MODELS, "people.glb"), animations=True)
    print(f"[people] exported {os.path.getsize(os.path.join(MODELS, 'people.glb')) / 1e6:.2f} MB")
    if o["previews"]:
        people.preview_lineup(os.path.join(SHOTS, "blender_people.png"), o["samples"])


def build_props(o):
    import props
    lib.reset()
    props.build()
    os.makedirs(OUT, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, "kronkel_props.blend"), compress=True)
    lib.export_glb(os.path.join(MODELS, "props.glb"))
    print(f"[props] exported {os.path.getsize(os.path.join(MODELS, 'props.glb')) / 1e6:.2f} MB")
    if o["previews"]:
        props.preview(os.path.join(SHOTS, "blender_props.png"), o["samples"])


if __name__ == "__main__":
    o = args()
    os.makedirs(MODELS, exist_ok=True)
    os.makedirs(SHOTS, exist_ok=True)
    for name, fn in (("shop", build_shop), ("people", build_people), ("props", build_props)):
        if o["only"] is None or name in o["only"]:
            fn(o)
    # Compress for the web if node + gltf-transform are available
    import shutil
    import subprocess
    if shutil.which("node"):
        subprocess.run(["node", os.path.join(ROOT, "tools", "compress-models.mjs")], check=False)
