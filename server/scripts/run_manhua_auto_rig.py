"""受控GLB文件入口：检查与校正分两次执行；不联网、不读取生产凭证。"""
import hashlib
import importlib.util
import json
import math
from pathlib import Path
import sys


def module(name):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(name + ".py"))
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


core = module("previs_auto_rig")
contract = module("previs_rigged_model")
BONES = {"pelvis": ("pelvis", "waist"), "spine": ("waist", "chest"),
         "neck": ("chest", "neck"), "head": ("neck", "headTop")}
for side, suffix in (("L", "1"), ("R", "-1")):
    for bone, start, end in (("upper_arm", "shoulder", "elbow"), ("forearm", "elbow", "wrist"),
                             ("hand", "wrist", "handTip"), ("upper_leg", "hip", "knee"),
                             ("lower_leg", "knee", "ankle"), ("foot", "ankle", "toe")):
        BONES[bone + suffix] = (start + side, end + side)


def write_json(path, value):
    core._write_json(path, value)


def bounds_of(mesh):
    return [[min(v.co[i] for v in mesh.data.vertices) for i in range(3)],
            [max(v.co[i] for v in mesh.data.vertices) for i in range(3)]]


def weld_identical_vertices(bm):
    """只合并完全相同坐标，避免旧Blender距离搜索漏掉重合接缝；逐角UV保持。"""
    import bmesh
    first = {}
    targets = {}
    for vertex in bm.verts:
        coordinate = tuple(vertex.co)
        if coordinate in first:
            targets[vertex] = first[coordinate]
        else:
            first[coordinate] = vertex
    if targets:
        bmesh.ops.weld_verts(bm, targetmap=targets)


def load_source(file, expected_sha, settings):
    import bpy
    import bmesh
    from mathutils import Matrix, Vector
    metadata = contract.inspect_glb(file, expected_sha, unrigged=True)
    if metadata["meshes"] != 1 or not 100 <= metadata["vertices"] <= 50_000:
        raise ValueError("当前只支持单网格、100至50000顶点的人体")
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    contract._import_gltf_asset(bpy, file)
    objects = list(bpy.context.scene.objects)
    meshes = [obj for obj in objects if obj.type == "MESH"]
    if len(meshes) != 1 or any(obj.type not in ("MESH", "EMPTY") for obj in objects):
        raise ValueError("当前只支持一个无骨人物网格，不能混入其他物体")
    source = meshes[0]
    if source.modifiers or source.vertex_groups or source.data.shape_keys:
        raise ValueError("当前只支持无骨、无权重、无形变的人物模型")
    world = source.matrix_world.copy()
    source.parent = None
    source.matrix_world = Matrix.Identity(4)
    source.data.transform(world)
    # 所有变换只在进程内的导入副本执行；云端原GLB按SHA保持不变。
    angle = {"+X": 0, "-X": math.pi, "+Y": -math.pi / 2, "-Y": math.pi / 2}[settings["forwardAxis"]]
    source.data.transform(Matrix.Rotation(angle, 4, "Z"))
    low, high = bounds_of(source)
    height = high[2] - low[2]
    if not math.isfinite(height) or height < .0001:
        raise ValueError("模型高度无效，请检查是否为直立人物")
    scale = settings["targetHeight"] / height
    center = Vector(((low[0] + high[0]) / 2, (low[1] + high[1]) / 2, low[2]))
    for vertex in source.data.vertices:
        vertex.co = (vertex.co - center) * scale
    # GLB的UV/法线接缝可能拆开同一位置的顶点；只焊接数值重合点，保留逐角UV。
    bm = bmesh.new()
    try:
        bm.from_mesh(source.data)
        count = len(bm.verts)
        weld_identical_vertices(bm)
        merged = count - len(bm.verts)
        if any(not edge.is_manifold for edge in bm.edges):
            raise ValueError("人物网格有开口或非流形边，当前无法可靠绑骨")
        remaining = set(bm.verts)
        if not remaining:
            raise ValueError("人物网格为空")
        stack = [remaining.pop()]
        while stack:
            for edge in stack.pop().link_edges:
                for vertex in edge.verts:
                    if vertex in remaining:
                        remaining.remove(vertex)
                        stack.append(vertex)
        if remaining:
            raise ValueError("人物含多个不相连网格，当前只支持连通人体；未修改原模型")
        bm.to_mesh(source.data)
    finally:
        bm.free()
    source.data.update()
    if not 100 <= len(source.data.vertices) <= 50_000:
        raise ValueError("焊接后的网格不在当前顶点范围")
    bpy.context.view_layer.update()
    return source, metadata, merged


def suggestions(bounds, pose):
    """比例建议不是人体识别，必须由用户对照前/侧视图逐点确认。"""
    low, high = bounds
    h, width = high[2], (high[1] - low[1]) / 2
    result = {"pelvis": [0, 0, h * .46], "waist": [0, 0, h * .52],
              "chest": [0, 0, h * .75], "neck": [0, 0, h * .84], "headTop": [0, 0, h * .97]}
    for side, sign in (("L", 1), ("R", -1)):
        for name, fraction, z in (("shoulder", .20, .75), ("elbow", .55, .75 if pose == "T" else .64),
                                  ("wrist", .86, .75 if pose == "T" else .54), ("handTip", .98, .75 if pose == "T" else .48)):
            result[name + side] = [0, sign * width * fraction, h * z]
        for name, z in (("hip", .46), ("knee", .25), ("ankle", .055)):
            result[name + side] = [0, sign * h * .07, h * z]
        result["toe" + side] = [min(high[0] * .95, h * .1), sign * h * .07, h * .055]
    return {key: [max(low[i], min(high[i], coordinate)) for i, coordinate in enumerate(point)] for key, point in result.items()}


def preview(meshes, destination, view="front"):
    import bpy
    from mathutils import Vector
    scene = bpy.context.scene
    engines = {item.identifier for item in scene.render.bl_rna.properties["engine"].enum_items}
    engine = next((name for name in ("BLENDER_EEVEE", "BLENDER_EEVEE_NEXT") if name in engines), None)
    if engine is None:
        raise ValueError("当前运行环境缺少已支持的预览引擎")
    scene.render.engine = engine
    scene.render.resolution_x = 640
    scene.render.resolution_y = 640
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False
    scene.world.color = (.25, .25, .25)
    for obj in scene.objects:
        obj.hide_render = obj.type == "MESH" and obj not in meshes
    bounds = [obj.matrix_world @ Vector(corner) for obj in meshes for corner in obj.bound_box]
    center = Vector(tuple((min(v[i] for v in bounds) + max(v[i] for v in bounds)) / 2 for i in range(3)))
    height = max(v.z for v in bounds) - min(v.z for v in bounds)
    width = max(v.y for v in bounds) - min(v.y for v in bounds)
    camera_data = bpy.data.cameras.new("检查相机")
    camera = bpy.data.objects.new("检查相机", camera_data)
    scene.collection.objects.link(camera)
    camera.location = center + Vector((4, 0, 0) if view == "front" else (0, -4, 0))
    camera.rotation_euler = (center - camera.location).to_track_quat("-Z", "Y").to_euler()
    camera_data.type = "ORTHO"
    camera_data.ortho_scale = max(height, width) * 1.2
    scene.camera = camera
    lights = []
    for position, energy in (((3, -3, 4), 600), ((-2, 2, 3), 350)):
        data = bpy.data.lights.new("检查灯", "AREA")
        data.energy = energy
        data.size = 4
        light = bpy.data.objects.new(data.name, data)
        scene.collection.objects.link(light)
        light.location = position
        light.rotation_euler = (center - light.location).to_track_quat("-Z", "Y").to_euler()
        lights.append(light)
    scene.render.filepath = str(destination)
    bpy.ops.render.render(write_still=True)
    for obj in [camera, *lights]:
        bpy.data.objects.remove(obj, do_unlink=True)


def run(request_file, source_file, output_dir):
    import bpy
    from mathutils import Matrix
    out = Path(output_dir)
    out.mkdir(parents=True, exist_ok=True)
    data = json.loads(Path(request_file).read_text())
    request, sha = data["request"], data["sourceSha256"]
    settings = request["settings"]
    source, metadata, merged = load_source(source_file, sha, settings)
    digest = core.source_digest(source)
    if request["stage"] == "inspect":
        result = {"version": 1, "stage": "inspect", "sourceDigest": digest,
                  "sourceSha256": sha, "vertices": len(source.data.vertices),
                  "bounds": bounds_of(source), "settings": settings,
                  "limitations": ["初始点是比例建议，必须对照模型人工校正", "仅封闭连通A/T人体，不含眼骨和表情", "本次合并%d个数值重合接缝点，原云模型保持不变" % merged]}
        result["joints"] = suggestions(result["bounds"], settings["pose"])
        write_json(out / "report.json", result)
        bpy.ops.object.select_all(action="DESELECT")
        source.select_set(True)
        bpy.context.view_layer.objects.active = source
        bpy.ops.export_scene.gltf(filepath=str(out / "model.glb"), export_format="GLB", use_selection=True, export_animations=False)
        contract.inspect_glb(out / "model.glb", unrigged=True)
        preview([source], out / "preview-0.png")
        preview([source], out / "preview-1.png", "side")
        return result
    if request["sourceDigest"] != digest:
        raise ValueError("模型或检查设置已经变化，请重新检查和确认关节点")
    points = {name: [request["joints"][key] for key in pair] for name, pair in BONES.items()}
    receipt = core.rig_confirmed_mesh(source, points, {
        "sourceDigest": digest, "pose": settings["pose"], "singleHuman": request["singleHuman"],
        "landmarksManuallyConfirmed": request["landmarksManuallyConfirmed"]}, out / "model.glb")
    write_json(out / "report.json", receipt)
    model = contract.import_rigged_model(out / "model.glb", "可视变形检查", forward_axis="+X", target_height=settings["targetHeight"], expected_sha256=receipt["outputSha256"])
    preview(model["meshes"], out / "preview-0.png")
    for index, name in enumerate(("forearm-1", "forearm1", "lower_leg-1", "lower_leg1"), 1):
        bone = model["rig"].pose.bones[name]
        bone.rotation_mode = "XYZ"
        bone.rotation_euler.x = .55
        bpy.context.view_layer.update()
        preview(model["meshes"], out / ("preview-%d.png" % index))
        bone.matrix_basis = Matrix.Identity(4)
    return receipt


if __name__ == "__main__":
    args = sys.argv[sys.argv.index("--") + 1:]
    if len(args) != 3:
        raise ValueError("必须提供固定请求文件、本人GLB文件与独立输出目录")
    try:
        run(*args)
    except Exception as error:
        output = Path(args[2])
        output.mkdir(parents=True, exist_ok=True)
        write_json(output / "failure.json", {"status": "failed", "message": str(error), "type": type(error).__name__, "qualityAccepted": False})
        raise
