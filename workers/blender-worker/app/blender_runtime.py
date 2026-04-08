"""
Deterministic Blender scene builder.

Builds a bpy scene from scene_graph JSON. All transforms and keyframes are
applied exactly as specified — no randomness, no physics.

Designed to run inside `blender --background --python`.
"""
import logging
import math

logger = logging.getLogger(__name__)

try:
    import bpy
    from mathutils import Vector, Euler
    HAS_BPY = True
except ImportError:
    HAS_BPY = False
    logger.warning("bpy not available — Blender runtime will be stubbed")


def _reset_scene() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)


def _create_camera(cam_data: dict) -> None:
    cam = bpy.data.cameras.new(name=cam_data.get("id", "Camera"))
    cam_obj = bpy.data.objects.new(name=cam_data.get("id", "Camera"), object_data=cam)
    bpy.context.collection.objects.link(cam_obj)
    bpy.context.scene.camera = cam_obj

    path = cam_data.get("path", [])
    if path:
        cam_obj.location = tuple(path[0].get("pos", [0, 0, 10]))

    # Track-to origin
    target = bpy.data.objects.new("CamTarget", None)
    target.location = (0.0, 0.0, 0.0)
    bpy.context.collection.objects.link(target)
    track = cam_obj.constraints.new(type="TRACK_TO")
    track.target = target
    track.track_axis = "TRACK_NEGATIVE_Z"
    track.up_axis = "UP_Y"

    for kf in path:
        frame = kf.get("frame", 0) + 1  # Blender is 1-indexed
        pos = kf.get("pos", [0, 0, 10])
        cam_obj.location = tuple(pos)
        cam_obj.keyframe_insert(data_path="location", frame=frame)

    if cam_obj.animation_data and cam_obj.animation_data.action:
        for fcurve in cam_obj.animation_data.action.fcurves:
            for kp in fcurve.keyframe_points:
                kp.interpolation = "LINEAR"


def _create_light(light_data: dict) -> None:
    light_type = light_data.get("type", "area").upper()
    if light_type not in {"POINT", "SUN", "SPOT", "AREA"}:
        light_type = "AREA"

    ld = bpy.data.lights.new(name=light_data.get("id", "Light"), type=light_type)
    ld.energy = light_data.get("energy", 1000)
    color = light_data.get("color", [1, 1, 1])
    ld.color = tuple(color[:3])

    if light_type == "AREA":
        ld.size = light_data.get("size", 5.0)

    obj = bpy.data.objects.new(name=light_data.get("id", "Light"), object_data=ld)
    bpy.context.collection.objects.link(obj)
    pos = light_data.get("position", [4.0, 1.0, 6.0])
    obj.location = tuple(pos)


PRIMITIVE_MAP = {
    "cube": bpy.ops.mesh.primitive_cube_add if HAS_BPY else None,
    "sphere": bpy.ops.mesh.primitive_uv_sphere_add if HAS_BPY else None,
    "cylinder": bpy.ops.mesh.primitive_cylinder_add if HAS_BPY else None,
    "cone": bpy.ops.mesh.primitive_cone_add if HAS_BPY else None,
    "plane": bpy.ops.mesh.primitive_plane_add if HAS_BPY else None,
} if HAS_BPY else {}


def _create_object(obj_data: dict) -> None:
    asset = obj_data.get("asset", "cube").lower()
    add_fn = PRIMITIVE_MAP.get(asset, PRIMITIVE_MAP.get("cube"))
    if add_fn is None:
        logger.warning("Unknown asset %s, using cube", asset)
        add_fn = bpy.ops.mesh.primitive_cube_add

    transform = obj_data.get("transform", {})
    loc = transform.get("location", [0, 0, 0])
    rot = transform.get("rotation", [0, 0, 0])
    scl = transform.get("scale", [1, 1, 1])

    add_fn(size=2, location=tuple(loc), scale=tuple(scl))
    obj = bpy.context.active_object
    obj.name = obj_data.get("id", "Object")
    obj.rotation_euler = tuple(rot)

    # Material
    mat = bpy.data.materials.new(name=f"{obj.name}_Mat")
    mat.use_nodes = True
    obj.data.materials.append(mat)

    # Animation keyframes
    for kf in obj_data.get("animation", []):
        frame = kf.get("frame", 0) + 1
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


def build_scene(scene_graph: dict, engine: str = "CYCLES", samples: int = 64, use_gpu: bool = False) -> None:
    if not HAS_BPY:
        raise RuntimeError("bpy not available — must run inside Blender")

    _reset_scene()

    # Cameras
    for cam in scene_graph.get("cameras", []):
        _create_camera(cam)

    # If no camera in graph, create default
    if not scene_graph.get("cameras"):
        _create_camera({"id": "DefaultCamera", "path": [{"frame": 0, "pos": [7, -7, 5]}]})

    # Lights
    for light in scene_graph.get("lights", []):
        _create_light(light)

    if not scene_graph.get("lights"):
        _create_light({"id": "DefaultLight", "type": "area", "energy": 1000})

    # Objects
    for obj in scene_graph.get("objects", []):
        _create_object(obj)

    if not scene_graph.get("objects"):
        _create_object({"id": "DefaultCube", "asset": "cube", "transform": {}})

    # Render settings
    scene = bpy.context.scene
    scene.render.engine = engine
    if use_gpu:
        scene.cycles.device = "GPU"
    else:
        scene.cycles.device = "CPU"
    scene.cycles.samples = samples
    scene.cycles.seed = hash(str(scene_graph.get("scene_id", ""))) & 0x7FFFFFFF
    scene.cycles.use_denoising = False

    fps = scene_graph.get("fps", 24)
    duration = scene_graph.get("duration_frames", 240)
    scene.render.fps = fps
    scene.frame_start = 1
    scene.frame_end = duration

    scene.render.resolution_x = 512
    scene.render.resolution_y = 512
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"


def render_frame(frame_index: int, output_path: str) -> None:
    if not HAS_BPY:
        raise RuntimeError("bpy not available")
    scene = bpy.context.scene
    scene.frame_set(frame_index + 1)  # Blender 1-indexed
    scene.render.filepath = output_path
    bpy.ops.render.render(write_still=True)
