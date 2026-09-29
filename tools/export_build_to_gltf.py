import math
import os

import bpy


ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUTPUT_DIR = os.path.join(ROOT, "exports", "beatscore-build")
LOGO_PATH = os.path.join(ROOT, "assets", "images", "beatscore.png")


def rgba(rgb, alpha=1.0):
    return (*rgb, alpha)


def material(name, color, emission=None, strength=0.0, metallic=0.0, roughness=0.45):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = color
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = color
    metallic_input = bsdf.inputs.get("Metallic IOR Level") or bsdf.inputs.get("Metallic")
    if metallic_input:
        metallic_input.default_value = metallic
    bsdf.inputs["Roughness"].default_value = roughness
    if emission:
        bsdf.inputs["Emission Color"].default_value = rgba(emission)
        bsdf.inputs["Emission Strength"].default_value = strength
    if color[3] < 1:
        bsdf.inputs["Alpha"].default_value = color[3]
        mat.surface_render_method = "DITHERED"
    return mat


def logo_material():
    mat = bpy.data.materials.new("Beat Score Logo")
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    bsdf = nodes.get("Principled BSDF")
    image = nodes.new("ShaderNodeTexImage")
    image.image = bpy.data.images.load(LOGO_PATH)
    links.new(image.outputs["Color"], bsdf.inputs["Base Color"])
    links.new(image.outputs["Alpha"], bsdf.inputs["Alpha"])
    bsdf.inputs["Roughness"].default_value = 0.35
    mat.surface_render_method = "DITHERED"
    return mat


def collection(name):
    result = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(result)
    return result


def move_to_collection(obj, target):
    for source in list(obj.users_collection):
        source.objects.unlink(obj)
    target.objects.link(obj)


def position(x, y, z):
    # Decentraland is Y-up. Blender is Z-up; center the 32 m venue at the origin.
    return (x - 16.0, 16.0 - z, y)


def add_box(name, x, y, z, sx, sy, sz, mat, group, bevel=0.0):
    bpy.ops.mesh.primitive_cube_add(location=position(x, y, z))
    obj = bpy.context.object
    obj.name = name
    obj.scale = (sx / 2, sz / 2, sy / 2)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if mat:
        obj.data.materials.append(mat)
    if bevel > 0:
        modifier = obj.modifiers.new("Edge Softening", "BEVEL")
        modifier.width = bevel
        modifier.segments = 2
    move_to_collection(obj, group)
    return obj


def add_sphere(name, x, y, z, sx, sy, sz, mat, group, segments=24, rings=12):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments, ring_count=rings, location=position(x, y, z))
    obj = bpy.context.object
    obj.name = name
    obj.scale = (sx, sz, sy)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if mat:
        obj.data.materials.append(mat)
    move_to_collection(obj, group)
    return obj


def add_logo(name, x, y, z, width, height, mat, group):
    bpy.ops.mesh.primitive_plane_add(size=1, location=position(x, y, z), rotation=(math.radians(90), 0, 0))
    obj = bpy.context.object
    obj.name = name
    obj.scale = (width, height, 1)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(mat)
    move_to_collection(obj, group)
    return obj


def add_text(name, value, x, y, z, size, mat, group, rotation_y=0):
    bpy.ops.object.text_add(location=position(x, y, z), rotation=(math.radians(90), 0, math.radians(rotation_y)))
    obj = bpy.context.object
    obj.name = name
    obj.data.body = value
    obj.data.align_x = "CENTER"
    obj.data.align_y = "CENTER"
    obj.data.size = size
    obj.data.extrude = 0.01
    obj.data.bevel_depth = 0.005
    obj.data.materials.append(mat)
    move_to_collection(obj, group)
    return obj


def main():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for item in list(bpy.data.collections):
        if item != bpy.context.scene.collection:
            bpy.data.collections.remove(item)

    floor_group = collection("01 Dance Floor")
    architecture = collection("02 Architecture")
    boards = collection("03 Leaderboards")
    lighting = collection("04 Lighting")
    speakers = collection("05 Speakers")
    props = collection("06 Props")
    bleachers = collection("07 Bleachers")

    tile_mats = [
        material("Floor Indigo", rgba((0.06, 0.04, 0.18)), (0.024, 0.016, 0.072), 0.3, 0.85, 0.15),
        material("Floor Violet", rgba((0.08, 0.03, 0.22)), (0.032, 0.012, 0.088), 0.3, 0.85, 0.15),
        material("Floor Blue", rgba((0.04, 0.06, 0.20)), (0.016, 0.024, 0.08), 0.3, 0.85, 0.15),
    ]
    stage_mat = material("Stage", rgba((0.04, 0.03, 0.10)), (0.06, 0.03, 0.15), 0.4, 0.9, 0.1)
    wall_mat = material("Backdrop", rgba((0.02, 0.01, 0.08)), (0.06, 0.03, 0.20), 0.5, 0.95, 0.05)
    board_mat = material("Leaderboard Panel", rgba((0.015, 0.012, 0.045)), (0.06, 0.02, 0.16), 0.9, 0.2, 0.35)
    row_mat = material("Leaderboard Row", rgba((0.035, 0.035, 0.09)), (0.08, 0.10, 0.20), 0.45, 0.35, 0.45)
    rank_mat = material("Rank Badge", rgba((0.34, 0.12, 0.58)), (0.90, 0.28, 1.0), 0.62, 0.18, 0.2)
    dark_metal = material("Truss Metal", rgba((0.2, 0.2, 0.2)), (0.1, 0.1, 0.1), 0.2, 0.8, 0.3)
    speaker_mat = material("Speaker Cabinet", rgba((0.05, 0.05, 0.05)), (0.02, 0.02, 0.02), 0.1, 0.3, 0.8)
    woofer_mat = material("Speaker Woofer", rgba((0.12, 0.12, 0.12)), (0.06, 0.06, 0.06), 0.1, 0.6, 0.6)
    orange_mat = material("Speaker Tweeter", rgba((1.0, 0.6, 0.1)), (1.0, 0.6, 0.1), 2.0, 0.8, 0.2)
    disco_mat = material("Disco Ball", rgba((0.92, 0.92, 0.96)), (0.5, 0.5, 0.55), 0.7, 1.0, 0.0)
    bleacher_mat = material("Bleachers", rgba((0.08, 0.06, 0.16)), (0.04, 0.03, 0.10), 0.2, 0.6, 0.5)
    cyan_text = material("Cyan Text", rgba((0.4, 1.0, 0.85)), (0.4, 1.0, 0.85), 1.0, 0.0, 0.4)
    logo_mat = logo_material()

    for row in range(16):
        for col in range(16):
            add_box(f"Floor Tile {row:02d}-{col:02d}", 8.5 + col, 0.01, 8.5 + row, 0.97, 0.04, 0.97, tile_mats[(row + col) % 3], floor_group, 0.015)
    add_box("Raised Stage", 16, -0.15, 16, 18, 0.3, 18, stage_mat, floor_group, 0.06)

    add_box("Front Backdrop", 16, 5, 1.5, 30, 10, 0.25, wall_mat, architecture)
    add_box("Rear Records Wall", 16, 5, 30.5, 30, 10, 0.25, wall_mat, architecture)

    neon_specs = [
        ("Backdrop Left Neon", 1.8, 5, 1.6, 0.18, 10, 0.18, (0.3, 0.5, 1.0)),
        ("Backdrop Right Neon", 30.2, 5, 1.6, 0.18, 10, 0.18, (1.0, 0.3, 0.6)),
        ("Backdrop Top Neon", 16, 10.1, 1.6, 30, 0.18, 0.18, (0.8, 0.2, 1.0)),
        ("Backdrop Bottom Neon", 16, 0.25, 1.6, 30, 0.12, 0.12, (0.2, 0.8, 1.0)),
    ]
    for name, x, y, z, sx, sy, sz, color in neon_specs:
        add_box(name, x, y, z, sx, sy, sz, material(name, rgba(color), color, 3.0, 0.0, 1.0), lighting, 0.025)

    for side, z, logo_y, logo_z, logo_width, logo_height, face_rotation in [
        ("Current Dance", 30.18, 8.72, 29.68, 5.8, 3.17, 0),
        ("Global Records", 2.35, 8.42, 2.92, 5.8, 3.17, 180),
    ]:
        add_box(f"{side} Board", 16, 5.28, z, 10.75, 5.18, 0.16, board_mat, boards, 0.05)
        for index in range(5):
            row_y = 6.38 - index * 0.72
            add_box(f"{side} Row {index + 1}", 16, row_y, z - (0.10 if z > 16 else -0.12), 10.15, 0.62, 0.08, row_mat, boards, 0.025)
            add_box(f"{side} Rank Badge {index + 1}", 15.45, row_y, z - (0.18 if z > 16 else -0.03), 1.36, 0.42, 0.06, rank_mat, boards, 0.03)
        if side == "Current Dance":
            add_logo("Rear Beat Score Logo", 16, logo_y, logo_z, logo_width, logo_height, logo_mat, boards)
            add_text("Current Dance Heading", "CURRENT DANCE", 16, 7.5, 29.66, 0.52, cyan_text, boards)
        else:
            add_text("Global Records Heading", "GLOBAL RECORDS", 16, 8.42, 2.98, 0.52, cyan_text, boards, 180)

    spot_colors = [(1.0, 0.3, 0.6), (0.3, 0.6, 1.0), (0.5, 1.0, 0.3), (1.0, 0.8, 0.2)]
    for tx in (10, 22):
        add_box(f"Truss Beam X{tx}", tx, 9.6, 16, 0.22, 0.22, 20, dark_metal, lighting)
        for index, spot_z in enumerate((10, 14, 18, 22)):
            add_box(f"Light Housing X{tx} Z{spot_z}", tx, 9.3, spot_z, 0.4, 0.4, 0.4, speaker_mat, lighting, 0.03)
            color = spot_colors[index]
            lens_mat = material(f"Lens {tx}-{spot_z}", rgba(color), color, 3.5, 0.0, 1.0)
            add_box(f"Light Lens X{tx} Z{spot_z}", tx, 9.0, spot_z, 0.3, 0.12, 0.3, lens_mat, lighting, 0.02)
    for tz in (10, 22):
        add_box(f"Cross Truss Z{tz}", 16, 9.6, tz, 20, 0.22, 0.22, dark_metal, lighting)

    for index, (x, z) in enumerate(((4.5, 5.5), (27.5, 5.5), (4.5, 26.5), (27.5, 26.5)), 1):
        face = -1 if z > 16 else 1
        add_box(f"Speaker {index} Cabinet", x, 2, z, 1.6, 4, 1.4, speaker_mat, speakers, 0.08)
        add_sphere(f"Speaker {index} Woofer", x, 2, z + face * 0.72, 0.575, 0.09, 0.575, woofer_mat, speakers)
        add_sphere(f"Speaker {index} Tweeter", x, 3.5, z + face * 0.73, 0.14, 0.05, 0.14, orange_mat, speakers)

    add_sphere("Disco Ball", 16, 8.5, 16, 1.65, 1.65, 1.65, disco_mat, props, 32, 16)
    add_box("Disco Ball Rod", 16, 9.825, 16, 0.07, 1, 0.07, dark_metal, props)

    pillar_positions = ((7, 7), (25, 7), (7, 16), (25, 16), (7, 25), (25, 25))
    pillar_colors = ((1, 0.2, 0.5), (0.2, 0.5, 1), (0.5, 1, 0.2), (1, 0.8, 0.1), (0.8, 0.2, 1), (0.2, 1, 0.8))
    for index, ((x, z), color) in enumerate(zip(pillar_positions, pillar_colors), 1):
        shaft_mat = material(f"Pillar {index}", rgba(tuple(c * 0.12 for c in color)), color, 1.8, 0.2, 0.8)
        cap_mat = material(f"Pillar {index} Cap", rgba(color), color, 4.0, 0.0, 1.0)
        add_box(f"Pillar {index} Shaft", x, 5, z, 0.28, 10, 0.28, shaft_mat, lighting, 0.025)
        add_box(f"Pillar {index} Cap", x, 10.1, z, 0.5, 0.5, 0.5, cap_mat, lighting, 0.04)

    sections = (
        (5, 0.4, 16, 1.8, 0.8, 16), (4, 1.1, 16, 1.6, 0.8, 16), (3, 1.9, 16, 1.6, 0.8, 16),
        (27, 0.4, 16, 1.8, 0.8, 16), (28, 1.1, 16, 1.6, 0.8, 16), (29, 1.9, 16, 1.6, 0.8, 16),
        (16, 0.4, 26.5, 20, 0.8, 2), (16, 1.1, 28, 20, 0.8, 2), (16, 1.9, 29.5, 20, 0.8, 2),
    )
    for index, values in enumerate(sections, 1):
        add_box(f"Bleacher Step {index:02d}", *values, bleacher_mat, bleachers, 0.04)

    bpy.context.scene.unit_settings.system = "METRIC"
    bpy.context.scene.unit_settings.length_unit = "METERS"
    bpy.context.scene["source"] = "Beat Score Decentraland runtime build"
    bpy.context.scene["coordinate_conversion"] = "DCL (Y-up) converted to Blender (Z-up), centered on venue"

    os.makedirs(OUTPUT_DIR, exist_ok=True)
    gltf_path = os.path.join(OUTPUT_DIR, "BeatScore_Build.gltf")
    glb_path = os.path.join(OUTPUT_DIR, "BeatScore_Build.glb")
    bpy.ops.export_scene.gltf(filepath=gltf_path, export_format="GLTF_SEPARATE", export_apply=True)
    bpy.ops.export_scene.gltf(filepath=glb_path, export_format="GLB", export_apply=True)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUTPUT_DIR, "BeatScore_Build.blend"))
    print(f"Exported {gltf_path}")
    print(f"Exported {glb_path}")


if __name__ == "__main__":
    main()
