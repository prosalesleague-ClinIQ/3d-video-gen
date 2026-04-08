import math

import bpy
from mathutils import Vector

from shared.schemas import SceneGraph, ObjectParams


def _add_object(obj_params: ObjectParams) -> bpy.types.Object:
    primitives = {
        "CUBE": bpy.ops.mesh.primitive_cube_add,
        "SPHERE": bpy.ops.mesh.primitive_uv_sphere_add,
        "CYLINDER": bpy.ops.mesh.primitive_cylinder_add,
        "CONE": bpy.ops.mesh.primitive_cone_add,
        "PLANE": bpy.ops.mesh.primitive_plane_add,
    }
    add_fn = primitives.get(obj_params.obj_type, bpy.ops.mesh.primitive_cube_add)
    add_fn(size=2, location=tuple(obj_params.position), scale=tuple(obj_params.scale))
    obj = bpy.context.active_object
    obj.name = obj_params.name

    mat = bpy.data.materials.new(name=f"{obj_params.name}_Mat")
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = tuple(obj_params.color)
    obj.data.materials.append(mat)

    for kf in obj_params.keyframes:
        obj.rotation_euler = tuple(kf.value)
        obj.keyframe_insert(data_path="rotation_euler", frame=kf.frame)

    if obj.animation_data and obj.animation_data.action:
        for fcurve in obj.animation_data.action.fcurves:
            for kp in fcurve.keyframe_points:
                kp.interpolation = "LINEAR"

    return obj


def _add_camera(graph: SceneGraph) -> bpy.types.Object:
    cam_data = bpy.data.cameras.new(name="MainCamera")
    cam_data.lens = graph.camera.lens
    cam_obj = bpy.data.objects.new(name="MainCamera", object_data=cam_data)
    bpy.context.collection.objects.link(cam_obj)
    cam_obj.location = tuple(graph.camera.position)
    cam_obj.rotation_euler = tuple(graph.camera.rotation)
    bpy.context.scene.camera = cam_obj

    # Animated camera path (orbit around origin)
    if graph.camera.keyframes:
        # Track-to constraint so camera always looks at origin
        track = cam_obj.constraints.new(type="TRACK_TO")
        target = bpy.data.objects.new("CamTarget", None)
        target.location = (0.0, 0.0, 0.0)
        bpy.context.collection.objects.link(target)
        track.target = target
        track.track_axis = "TRACK_NEGATIVE_Z"
        track.up_axis = "UP_Y"

        for kf in graph.camera.keyframes:
            cam_obj.location = tuple(kf.value)
            cam_obj.keyframe_insert(data_path="location", frame=kf.frame)

        if cam_obj.animation_data and cam_obj.animation_data.action:
            for fcurve in cam_obj.animation_data.action.fcurves:
                for kp in fcurve.keyframe_points:
                    kp.interpolation = "LINEAR"

    return cam_obj


def _add_area_light(graph: SceneGraph) -> bpy.types.Object:
    light_data = bpy.data.lights.new(name="MainLight", type=graph.light.light_type)
    light_data.energy = graph.light.energy
    if graph.light.light_type == "AREA":
        light_data.size = graph.light.size
    light_obj = bpy.data.objects.new(name="MainLight", object_data=light_data)
    bpy.context.collection.objects.link(light_obj)
    light_obj.location = tuple(graph.light.position)
    return light_obj


def build_bpy_scene(graph: SceneGraph) -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)

    for obj_params in graph.objects:
        _add_object(obj_params)

    _add_camera(graph)
    _add_area_light(graph)

    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "GPU"
    scene.cycles.samples = graph.samples
    scene.cycles.seed = graph.seed
    scene.cycles.use_denoising = False  # deterministic
    scene.render.resolution_x = graph.resolution_x
    scene.render.resolution_y = graph.resolution_y
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.frame_start = 1
    scene.frame_end = graph.frame_count
