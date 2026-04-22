"""
Standalone Blender script. Run as:

  blender --background --python blender_entrypoint.py -- <scene.json> <out_dir>

Reads a scene graph JSON, builds the scene, renders all frames to <out_dir>/frame_NNNN.png.
"""
import json
import math
import os
import sys


def _argv_after_dash() -> list[str]:
    if "--" in sys.argv:
        return sys.argv[sys.argv.index("--") + 1:]
    return []


def _reset(bpy) -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)


def _add_primitive(bpy, asset: str, location, scale):
    funcs = {
        "cube": bpy.ops.mesh.primitive_cube_add,
        "sphere": bpy.ops.mesh.primitive_uv_sphere_add,
        "cylinder": bpy.ops.mesh.primitive_cylinder_add,
        "cone": bpy.ops.mesh.primitive_cone_add,
        "plane": bpy.ops.mesh.primitive_plane_add,
        "torus": bpy.ops.mesh.primitive_torus_add,
        "monkey": bpy.ops.mesh.primitive_monkey_add,
    }
    fn = funcs.get(asset, funcs["cube"])
    if asset == "torus":
        fn(location=tuple(location), major_radius=1.2, minor_radius=0.4)
    elif asset == "monkey":
        fn(location=tuple(location))
    else:
        fn(size=2, location=tuple(location))

    obj = bpy.context.active_object
    obj.scale = tuple(scale)
    return obj


def _make_material(bpy, name: str, color, metallic: float, roughness: float):
    mat = bpy.data.materials.new(name=name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        bsdf.inputs["Base Color"].default_value = tuple(color)
        if "Metallic" in bsdf.inputs:
            bsdf.inputs["Metallic"].default_value = float(metallic)
        if "Roughness" in bsdf.inputs:
            bsdf.inputs["Roughness"].default_value = float(roughness)
    return mat


def _apply_keyframes(obj, keyframes, default_frame_offset: int = 0):
    """keyframes: list of {frame, rotation?, location?, scale?}"""
    for kf in keyframes:
        frame = kf.get("frame", 1) + default_frame_offset
        if "location" in kf:
            obj.location = tuple(kf["location"])
            obj.keyframe_insert(data_path="location", frame=frame)
        if "rotation" in kf:
            obj.rotation_euler = tuple(kf["rotation"])
            obj.keyframe_insert(data_path="rotation_euler", frame=frame)
        if "scale" in kf:
            obj.scale = tuple(kf["scale"])
            obj.keyframe_insert(data_path="scale", frame=frame)

    if obj.animation_data and obj.animation_data.action:
        for fcurve in obj.animation_data.action.fcurves:
            for kp in fcurve.keyframe_points:
                kp.interpolation = "LINEAR"


def _add_camera(bpy, graph):
    cam_data = graph.get("camera", {})
    cam = bpy.data.cameras.new(name="MainCam")
    cam.lens = float(cam_data.get("lens", 50))
    cam_obj = bpy.data.objects.new("MainCam", cam)
    bpy.context.collection.objects.link(cam_obj)
    bpy.context.scene.camera = cam_obj

    # Track-to origin so camera always points at (0,0,0)
    target = bpy.data.objects.new("CamTarget", None)
    target.location = (0, 0, 0)
    bpy.context.collection.objects.link(target)
    tc = cam_obj.constraints.new(type="TRACK_TO")
    tc.target = target
    tc.track_axis = "TRACK_NEGATIVE_Z"
    tc.up_axis = "UP_Y"

    kfs = cam_data.get("keyframes", [])
    if not kfs:
        kfs = [{"frame": 1, "location": [7, -7, 5]}]

    for kf in kfs:
        frame = kf.get("frame", 1)
        cam_obj.location = tuple(kf.get("location", [7, -7, 5]))
        cam_obj.keyframe_insert(data_path="location", frame=frame)

    if cam_obj.animation_data and cam_obj.animation_data.action:
        for fcurve in cam_obj.animation_data.action.fcurves:
            for kp in fcurve.keyframe_points:
                kp.interpolation = "LINEAR"


def _add_light(bpy, graph):
    ld = graph.get("light", {})
    ltype = ld.get("type", "AREA").upper()
    if ltype not in {"POINT", "SUN", "SPOT", "AREA"}:
        ltype = "AREA"

    light = bpy.data.lights.new(name="KeyLight", type=ltype)
    light.energy = float(ld.get("energy", 1000))
    color = ld.get("color", [1.0, 1.0, 1.0])
    if hasattr(light, "color"):
        light.color = tuple(color[:3])
    if ltype == "AREA" and hasattr(light, "size"):
        light.size = float(ld.get("size", 5.0))

    lo = bpy.data.objects.new("KeyLight", light)
    bpy.context.collection.objects.link(lo)
    lo.location = tuple(ld.get("location", [4, -2, 6]))


def _add_objects(bpy, graph):
    for i, od in enumerate(graph.get("objects", [])):
        asset = od.get("asset", "cube").lower()
        location = od.get("location", [0, 0, 0])
        scale = od.get("scale", [1, 1, 1])
        obj = _add_primitive(bpy, asset, location, scale)
        obj.name = od.get("name", f"Obj{i}")

        mat = _make_material(
            bpy,
            f"{obj.name}_Mat",
            od.get("color", [0.8, 0.3, 0.3, 1.0]),
            od.get("metallic", 0.1),
            od.get("roughness", 0.5),
        )
        obj.data.materials.append(mat)

        _apply_keyframes(obj, od.get("keyframes", []))


def _set_world(bpy, graph):
    if bpy.context.scene.world is None:
        bpy.context.scene.world = bpy.data.worlds.new("World")
    world = bpy.context.scene.world
    world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    if bg is not None:
        color = graph.get("world", {}).get("background", [0.05, 0.05, 0.08])
        bg.inputs["Color"].default_value = (*color[:3], 1.0)


def _add_ground(bpy):
    """Flat reflective ground plane for nicer shadows."""
    bpy.ops.mesh.primitive_plane_add(size=30, location=(0, 0, -1.01))
    plane = bpy.context.active_object
    mat = bpy.data.materials.new(name="Ground_Mat")
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        bsdf.inputs["Base Color"].default_value = (0.1, 0.1, 0.12, 1.0)
        bsdf.inputs["Roughness"].default_value = 0.4
    plane.data.materials.append(mat)


def build_and_render(scene_json_path: str, out_dir: str) -> int:
    import bpy  # Blender-bundled

    with open(scene_json_path) as f:
        graph = json.load(f)

    _reset(bpy)
    _add_camera(bpy, graph)
    _add_light(bpy, graph)
    _add_ground(bpy)
    _add_objects(bpy, graph)
    _set_world(bpy, graph)

    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = int(graph.get("samples", 16))
    scene.cycles.seed = int(graph.get("seed", 0)) & 0x7FFFFFFF
    scene.cycles.use_denoising = False
    scene.cycles.use_adaptive_sampling = True
    scene.cycles.adaptive_threshold = 0.05

    res = graph.get("resolution", [512, 512])
    scene.render.resolution_x = int(res[0])
    scene.render.resolution_y = int(res[1])
    scene.render.resolution_percentage = 100

    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGB"
    scene.render.fps = int(graph.get("fps", 24))
    frame_count = int(graph.get("frame_count", 48))
    scene.frame_start = 1
    scene.frame_end = frame_count

    os.makedirs(out_dir, exist_ok=True)

    for fi in range(1, frame_count + 1):
        scene.frame_set(fi)
        scene.render.filepath = os.path.join(out_dir, f"frame_{fi:04d}.png")
        bpy.ops.render.render(write_still=True)
        print(f"RENDERED frame {fi}/{frame_count}", flush=True)

    return frame_count


def main() -> int:
    args = _argv_after_dash()
    if len(args) < 2:
        print("ERROR: expected <scene.json> <out_dir> after --", file=sys.stderr)
        return 2

    scene_path, out_dir = args[0], args[1]
    try:
        n = build_and_render(scene_path, out_dir)
        print(f"DONE {n} frames in {out_dir}", flush=True)
        return 0
    except Exception as exc:
        import traceback
        traceback.print_exc()
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
