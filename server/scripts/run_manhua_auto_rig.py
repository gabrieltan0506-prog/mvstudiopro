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


PROXY_MAX_VERTICES = 45_000
MID_MAX_VERTICES = 240_000
RIG_MAX_VERTICES = 50_000


def _decimate_to(obj, target):
    """用 Blender 减面把网格压到 ≤target 顶点（最多三轮），权重（若有）随之插值保留。"""
    import bpy
    for _ in range(3):
        count = len(obj.data.vertices)
        if count <= target:
            break
        ratio = max(.005, min(1.0, target * .9 / count))
        modifier = obj.modifiers.new("低模减面", "DECIMATE")
        modifier.ratio = ratio
        modifier.use_collapse_triangulate = True
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.modifier_apply(modifier=modifier.name)
    obj.data.update()
    return len(obj.data.vertices)


def _keep_largest_island(obj):
    """低模代理只保留最大的连通块（眼球/饰件等小岛不参与骨架求解；权重转移按最近面覆盖它们）。"""
    import bmesh
    bm = bmesh.new()
    try:
        bm.from_mesh(obj.data)
        weld_identical_vertices(bm)
        remaining = set(bm.verts)
        islands = []
        while remaining:
            seed = remaining.pop()
            stack, island = [seed], {seed}
            while stack:
                for edge in stack.pop().link_edges:
                    for vertex in edge.verts:
                        if vertex in remaining:
                            remaining.remove(vertex)
                            island.add(vertex)
                            stack.append(vertex)
            islands.append(island)
        islands.sort(key=len, reverse=True)
        dropped = sum(len(i) for i in islands[1:])
        if dropped:
            bmesh.ops.delete(bm, geom=[v for i in islands[1:] for v in i], context="VERTS")
        bm.to_mesh(obj.data)
        return len(islands), dropped
    finally:
        bm.free()


def _is_manifold_connected(obj):
    import bmesh
    bm = bmesh.new()
    try:
        bm.from_mesh(obj.data)
        weld_identical_vertices(bm)
        if not bm.verts or any(not edge.is_manifold for edge in bm.edges):
            return False
        remaining = set(bm.verts)
        stack = [remaining.pop()]
        while stack:
            for edge in stack.pop().link_edges:
                for vertex in edge.verts:
                    if vertex in remaining:
                        remaining.remove(vertex)
                        stack.append(vertex)
        return not remaining
    finally:
        bm.free()


def _strip_materials(obj):
    """求解副本不带任何材质：清槽位、面材质索引归零；原模的材质/贴图/UV 完全不碰。"""
    obj.data.materials.clear()
    for polygon in obj.data.polygons:
        polygon.material_index = 0


def _make_solve_copy(original, target_max):
    """
    从原模派生**独立**求解副本：复制 mesh 数据 → 清材质 → 若超上限/非流形/不连通则体素重网格+减面，
    直到 ≤target_max 顶点且封闭流形单连通。inspect 与 bind 用同一派生规则，摘要稳定。
    """
    import bpy
    proxy = original.copy()
    proxy.data = original.data.copy()
    proxy.name = "绑骨求解副本"
    bpy.context.scene.collection.objects.link(proxy)
    _strip_materials(proxy)
    info = {"decimated": False, "remeshed": False}
    if len(proxy.data.vertices) <= target_max and _is_manifold_connected(proxy):
        return proxy, info
    low, high = bounds_of(proxy)
    height = max(1e-3, high[2] - low[2])
    bpy.ops.object.select_all(action="DESELECT")
    proxy.select_set(True)
    bpy.context.view_layer.objects.active = proxy
    for voxel in (height / 200, height / 150, height / 110):
        proxy.data.remesh_voxel_size = voxel
        proxy.data.remesh_voxel_adaptivity = 0
        bpy.ops.object.voxel_remesh()
        info["remeshed"] = True
        info["voxelSize"] = round(voxel, 4)
        if len(proxy.data.vertices) > target_max:
            _decimate_to(proxy, target_max)
            info["decimated"] = True
        islands, dropped = _keep_largest_island(proxy)
        info["proxyIslands"], info["proxyDroppedVertices"] = islands, dropped
        proxy.data.update()
        if 100 <= len(proxy.data.vertices) <= target_max and _is_manifold_connected(proxy):
            return proxy, info
    raise ValueError("求解副本无法收敛为 100 至 %d 顶点的封闭流形单连通网格" % target_max)


def load_source(file, expected_sha, settings):
    """
    0916 低模绑骨：原模（可多网格、可超 5 万顶点、任意材质）保留画质，字节与材质/UV/贴图不动；
    自动绑骨一律在**无材质的独立求解副本**上做（≤4.5 万顶点、封闭流形单连通；超限才减面），
    之后把权重转回原模。返回 (solve_copy, metadata, merged, original, proxy_info)。
    """
    import bpy
    from mathutils import Matrix, Vector
    metadata = contract.inspect_glb(file, expected_sha, unrigged=True, max_vertices=contract.SOURCE_MAX_VERTICES)
    if metadata["vertices"] < 100:
        raise ValueError("当前只支持至少 100 顶点的人体")
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    contract._import_gltf_asset(bpy, file)
    objects = list(bpy.context.scene.objects)
    meshes = [obj for obj in objects if obj.type == "MESH"]
    if not meshes or any(obj.type not in ("MESH", "EMPTY") for obj in objects):
        raise ValueError("当前只支持无骨人物网格，不能混入其他物体")
    for obj in meshes:
        if obj.modifiers or obj.vertex_groups or obj.data.shape_keys:
            raise ValueError("当前只支持无骨、无权重、无形变的人物模型")
    joined_parts = len(meshes)
    if len(meshes) > 1:
        # 多网格原模：合成一个物体（材质槽各自保留），权重转移与导出都按单物体走
        bpy.ops.object.select_all(action="DESELECT")
        for obj in meshes:
            obj.select_set(True)
        bpy.context.view_layer.objects.active = meshes[0]
        bpy.ops.object.join()
        meshes = [bpy.context.object]
    original = meshes[0]
    original.name = "原模_权重转移目标"
    world = original.matrix_world.copy()
    original.parent = None
    original.matrix_world = Matrix.Identity(4)
    original.data.transform(world)
    # 所有变换只在进程内的导入副本执行；云端原GLB按SHA保持不变。
    angle = {"+X": 0, "-X": math.pi, "+Y": -math.pi / 2, "-Y": math.pi / 2}[settings["forwardAxis"]]
    original.data.transform(Matrix.Rotation(angle, 4, "Z"))
    low, high = bounds_of(original)
    height = high[2] - low[2]
    if not math.isfinite(height) or height < .0001:
        raise ValueError("模型高度无效，请检查是否为直立人物")
    scale = settings["targetHeight"] / height
    center = Vector(((low[0] + high[0]) / 2, (low[1] + high[1]) / 2, low[2]))
    for vertex in original.data.vertices:
        vertex.co = (vertex.co - center) * scale
    original.data.update()
    original_vertices = len(original.data.vertices)
    proxy, derive = _make_solve_copy(original, PROXY_MAX_VERTICES)
    bpy.context.view_layer.update()
    info = {"enabled": True, "originalVertices": original_vertices, "proxyVertices": len(proxy.data.vertices),
            "decimateRatio": round(len(proxy.data.vertices) / max(1, original_vertices), 4),
            "joinedParts": joined_parts, "originalMaterials": len(original.data.materials),
            "originalUvLayers": len(original.data.uv_layers), **derive}
    return proxy, metadata, 0, original, info


def verify_full_export(path, original, expected):
    """重新导入带骨原模 GLB，核材质槽/UV 层/贴图/顶点数与原模一致（几何与材质都要在）。"""
    import bpy
    before = set(bpy.data.objects)
    contract._import_gltf_asset(bpy, path)
    imported = [obj for obj in bpy.data.objects if obj not in before]
    # 骨架自带的小标记体（<100 顶点）不算人物网格
    meshes = [obj for obj in imported if obj.type == "MESH" and len(obj.data.vertices) >= 100]
    rigs = [obj for obj in imported if obj.type == "ARMATURE"]
    try:
        if len(rigs) != 1 or len(meshes) != 1:
            raise ValueError("带骨原模重导入应恰有一套骨架与一个网格，实际骨架%d/网格%d/对象%s" % (len(rigs), len(meshes), [(o.type, o.name, len(o.data.vertices) if o.type == "MESH" else 0, o.parent.name if o.parent else None) for o in imported]))
        mesh = meshes[0]
        materials = [m for m in mesh.data.materials if m is not None]
        images = {node.image.name for m in materials if m.use_nodes for node in m.node_tree.nodes if node.type == "TEX_IMAGE" and node.image is not None}
        weighted = sum(1 for v in mesh.data.vertices if any(g.weight > 0 for g in v.groups))
        report = {"vertices": len(mesh.data.vertices), "materials": len(materials), "uvLayers": len(mesh.data.uv_layers),
                  "images": len(images), "weightedVertices": weighted, "armatureModifier": any(m.type == "ARMATURE" for m in mesh.modifiers)}
        if report["materials"] != expected["originalMaterials"] or report["uvLayers"] != expected["originalUvLayers"]:
            raise ValueError("带骨原模材质槽或 UV 层与原模不一致")
        if expected["originalMaterials"] and report["images"] == 0:
            raise ValueError("带骨原模贴图丢失")
        if report["weightedVertices"] != report["vertices"]:
            raise ValueError("带骨原模含无权重顶点")
        return report
    finally:
        for obj in imported:
            bpy.data.objects.remove(obj, do_unlink=True)


def transfer_weights_to_original(original, rigged_mesh, rig):
    """把代理上的权重按最近面插值转到原模，缺权重顶点按最近骨补 1.0；挂骨架修改器。"""
    import bpy
    from mathutils import Vector
    bpy.ops.object.select_all(action="DESELECT")
    original.select_set(True)
    bpy.context.view_layer.objects.active = original
    # 与代理同一坐标系：代理重导入后按身高归一，原模也在同一归一坐标；这里再按 z 范围对齐一次防漂移
    o_low, o_high = bounds_of(original)
    r_low, r_high = bounds_of(rigged_mesh)
    oz, rz = o_high[2] - o_low[2], r_high[2] - r_low[2]
    if rz > 1e-6 and abs(oz / rz - 1) > .02:
        raise ValueError("代理与原模身高不一致，权重转移中止")
    modifier = original.modifiers.new("权重转移", "DATA_TRANSFER")
    modifier.object = rigged_mesh
    modifier.use_vert_data = True
    modifier.data_types_verts = {"VGROUP_WEIGHTS"}
    modifier.vert_mapping = "POLYINTERP_NEAREST"
    modifier.layers_vgroup_select_src = "ALL"
    modifier.layers_vgroup_select_dst = "NAME"
    bpy.ops.object.datalayout_transfer(modifier=modifier.name)
    bpy.ops.object.modifier_apply(modifier=modifier.name)
    deform = {group.name for group in original.vertex_groups if group.name in contract.SEMANTIC_BONES}
    if len(deform) != len(contract.SEMANTIC_BONES):
        raise ValueError("权重转移后缺少语义骨顶点组")
    # 缺权重的顶点（孤立小岛、被减面吃掉的细节）：按最近骨段补 1.0
    bone_segments = []
    for bone in rig.pose.bones:
        if bone.name in deform:
            bone_segments.append((bone.name, rig.matrix_world @ bone.head, rig.matrix_world @ bone.tail))
    def nearest_bone(point):
        best, best_d = None, None
        for name, head, tail in bone_segments:
            seg = tail - head
            t = 0 if seg.length_squared < 1e-12 else max(0, min(1, (point - head).dot(seg) / seg.length_squared))
            d = (point - (head + seg * t)).length
            if best_d is None or d < best_d:
                best, best_d = name, d
        return best
    filled = 0
    groups = {group.name: group for group in original.vertex_groups}
    for vertex in original.data.vertices:
        total = sum(g.weight for g in vertex.groups if original.vertex_groups[g.group].name in deform and math.isfinite(g.weight) and g.weight > 0)
        if total <= 1e-6:
            groups[nearest_bone(original.matrix_world @ vertex.co)].add([vertex.index], 1.0, "REPLACE")
            filled += 1
    bpy.ops.object.vertex_group_normalize_all(lock_active=False)
    # 只挂骨架修改器、不设父子：glTF 按选择导出时不会把骨架的其它子物体（代理/中模）一起带出
    armature = original.modifiers.new("骨架", "ARMATURE")
    armature.object = rig
    bpy.context.view_layer.update()
    return {"filledVertices": filled, "deformGroups": len(deform)}


def _bend_max_delta(obj, rig, names):
    """对原模做弯曲测试：四肢各转 .55 rad，记录最大位移；<1cm 视为权重没转上。"""
    import bpy
    from mathutils import Matrix
    def evaluated():
        depsgraph = bpy.context.evaluated_depsgraph_get()
        mesh = obj.evaluated_get(depsgraph).data
        return [obj.matrix_world @ v.co for v in mesh.vertices]
    rest = evaluated()
    result = {}
    for name in names:
        bone = rig.pose.bones[name]
        bone.rotation_mode = "XYZ"
        bone.rotation_euler.x = .55
        bpy.context.view_layer.update()
        distances = [(a - b).length for a, b in zip(rest, evaluated())]
        if any(not math.isfinite(v) for v in distances) or max(distances) < .01:
            raise ValueError("原模权重转移后弯曲测试失败：" + name)
        result[name] = max(distances)
        bone.matrix_basis = Matrix.Identity(4)
    bpy.context.view_layer.update()
    return result


def _export_rigged(objects, rig, path):
    """只导出指定网格 + 骨架：其它网格临时隐藏（glTF 导出会把骨架相关网格一并带出，选择过滤不够）。"""
    import bpy
    keep = set(objects) | {rig}
    hidden = []
    for obj in bpy.context.scene.objects:
        if obj not in keep and not obj.hide_get():
            obj.hide_set(True)
            hidden.append(obj)
    try:
        bpy.ops.object.select_all(action="DESELECT")
        rig.select_set(True)
        for obj in objects:
            obj.hide_set(False)
            obj.select_set(True)
        bpy.context.view_layer.objects.active = rig
        bpy.ops.export_scene.gltf(filepath=str(path), export_format="GLB", use_selection=True, use_visible=True, export_animations=False, export_skins=True)
    finally:
        for obj in hidden:
            obj.hide_set(False)
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


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
    source, metadata, merged, original, proxy_info = load_source(source_file, sha, settings)
    digest = core.source_digest(source)
    preview_meshes = [original]
    if request["stage"] == "inspect":
        result = {"version": 1, "stage": "inspect", "sourceDigest": digest,
                  "sourceSha256": sha, "vertices": len(source.data.vertices),
                  "bounds": bounds_of(source), "settings": settings,
                  "limitations": ["初始点是比例建议，必须对照模型人工校正", "仅封闭连通A/T人体，不含眼骨和表情", "本次合并%d个数值重合接缝点，原云模型保持不变" % merged]}
        result["limitations"].append("骨架在无材质的独立求解副本上求解（%d→%d 顶点），权重转回原模；原模字节、材质、UV、贴图不动" % (proxy_info["originalVertices"], proxy_info["proxyVertices"]))
        result["weightTransfer"] = proxy_info
        result["joints"] = suggestions(result["bounds"], settings["pose"])
        write_json(out / "report.json", result)
        bpy.ops.object.select_all(action="DESELECT")
        source.select_set(True)
        bpy.context.view_layer.objects.active = source
        bpy.ops.export_scene.gltf(filepath=str(out / "model.glb"), export_format="GLB", use_selection=True, export_animations=False)
        contract.inspect_glb(out / "model.glb", unrigged=True)
        preview(preview_meshes, out / "preview-0.png")
        preview(preview_meshes, out / "preview-1.png", "side")
        return result
    if request["sourceDigest"] != digest:
        raise ValueError("模型或检查设置已经变化，请重新检查和确认关节点")
    points = {name: [request["joints"][key] for key in pair] for name, pair in BONES.items()}
    # 低模绑骨 → 权重转移 → 原模渲染
    receipt = core.rig_confirmed_mesh(source, points, {
        "sourceDigest": digest, "pose": settings["pose"], "singleHuman": request["singleHuman"],
        "landmarksManuallyConfirmed": request["landmarksManuallyConfirmed"]}, out / "model-proxy.glb")
    proxy_sha = receipt["outputSha256"]
    imported = contract.import_rigged_model(out / "model-proxy.glb", "代理重导入", forward_axis="+X", target_height=settings["targetHeight"], expected_sha256=proxy_sha)
    rig, rigged_proxy = imported["rig"], imported["meshes"][0]
    transfer = transfer_weights_to_original(original, rigged_proxy, rig)
    # 代理只为求解与转权重；转完即删，避免随骨架被一起导出
    bpy.data.objects.remove(rigged_proxy, do_unlink=True)
    for child in list(rig.children):
        bpy.data.objects.remove(child, do_unlink=True)
    bends = _bend_max_delta(original, rig, ("forearm-1", "forearm1", "lower_leg-1", "lower_leg1"))
    # 全模（原模 + 骨架）：三视角参考与画质；中模（≤24 万顶点）：白模渲染预算
    full_sha = _export_rigged([original], rig, out / "model-full.glb")
    full_check = verify_full_export(out / "model-full.glb", original, proxy_info)
    mid = original.copy()
    mid.data = original.data.copy()
    mid.name = "白模中模"
    bpy.context.scene.collection.objects.link(mid)
    # 白模只要几何与权重，不带材质；画质在 model-full.glb
    mid.data.materials.clear()
    mid_vertices = _decimate_to(mid, MID_MAX_VERTICES)
    mid_sha = _export_rigged([mid], rig, out / "model.glb")
    check = contract.import_rigged_model(out / "model.glb", "中模重导入", forward_axis="+X", target_height=settings["targetHeight"], expected_sha256=mid_sha)
    receipt["outputSha256"] = mid_sha
    receipt["vertices"] = mid_vertices
    receipt["stage4Reimport"] = check["report"]
    receipt["weightTransfer"] = {**proxy_info, "proxySha256": proxy_sha, "fullSha256": full_sha, "fullVertices": len(original.data.vertices),
                                 "midVertices": mid_vertices, "filledVertices": transfer["filledVertices"], "originalBendMaxDeltaMeters": bends, "fullCheck": full_check}
    receipt["limitations"].append("骨架在低模代理上求解，权重按最近面转回原模；请检查肩肘/手指/衣摆穿插")
    write_json(out / "report.json", receipt)
    for obj in check["meshes"] + [mid]:
        obj.hide_render = True
    preview([original], out / "preview-0.png")
    for index, name in enumerate(("forearm-1", "forearm1", "lower_leg-1", "lower_leg1"), 1):
        bone = rig.pose.bones[name]
        bone.rotation_mode = "XYZ"
        bone.rotation_euler.x = .55
        bpy.context.view_layer.update()
        preview([original], out / ("preview-%d.png" % index))
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
