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
        print("[auto-rig] decimate %s: %d -> %d (target %d, ratio %.4f, faces %d)" % (obj.name, count, len(obj.data.vertices), target, ratio, len(obj.data.polygons)))
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
    import bmesh
    proxy = original.copy()
    proxy.data = original.data.copy()
    proxy.name = "绑骨求解副本"
    bpy.context.scene.collection.objects.link(proxy)
    _strip_materials(proxy)
    # GLB 的 UV/法线接缝会拆开同一位置的顶点；副本上先把数值重合点焊回去并**写回网格**，
    # 否则 ≤上限的小模型会带着拆开的接缝进 rig_confirmed_mesh 的流形检查而被拒（原模不动）。
    bm = bmesh.new()
    try:
        bm.from_mesh(proxy.data)
        count = len(bm.verts)
        weld_identical_vertices(bm)
        merged = count - len(bm.verts)
        bm.to_mesh(proxy.data)
    finally:
        bm.free()
    proxy.data.update()
    info = {"decimated": False, "remeshed": False, "weldedVertices": merged}
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
    return proxy, metadata, derive["weldedVertices"], original, info


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


def realign_reimported_rig(rig, rigged_mesh, pre_bounds):
    """
    import_rigged_model 会把重导入的代理重新归一（骨盆点移到 xy=0、按包围盒高缩放）。
    用户确认的骨盆点不在包围盒中心、或代理丢了小岛时，骨架就会相对原模平移/缩放，
    权重按最近面转移会串到邻近肢体。这里用导出前代理的包围盒把骨架+代理精确映射回原模坐标系。
    """
    import bpy
    from mathutils import Matrix, Vector
    post_low, post_high = bounds_of(rigged_mesh)
    pre_low, pre_high = (Vector(v) for v in pre_bounds)
    post_low, post_high = Vector(post_low), Vector(post_high)
    post_height = post_high.z - post_low.z
    if post_height < 1e-6:
        raise ValueError("代理重导入后高度为空")
    scale = (pre_high.z - pre_low.z) / post_height
    offset = pre_low - post_low * scale
    correction = Matrix.Translation(offset) @ Matrix.Scale(scale, 4)
    if rigged_mesh.parent is not rig:
        raise ValueError("代理重导入后未挂在骨架下")
    rig.matrix_world = correction @ rig.matrix_world
    bpy.context.view_layer.update()
    bpy.ops.object.select_all(action="DESELECT")
    rig.select_set(True)
    rigged_mesh.select_set(True)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    bpy.context.view_layer.update()
    low, high = bounds_of(rigged_mesh)
    residual = max(abs(a - b) for pair in ((low, pre_low), (high, pre_high)) for a, b in zip(pair[0], pair[1]))
    if not math.isfinite(residual) or residual > 1e-3:
        raise ValueError("代理重导入后无法对齐回原模坐标系")
    return {"scale": round(scale, 6), "offsetMeters": [round(v, 5) for v in offset], "residualMeters": round(residual, 6)}


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


def _glb_mesh_summary(path):
    """只读 GLB 的 JSON 块：每个网格节点的名字与 POSITION 顶点数（不进 Blender，用于导出后即刻取证）。"""
    import struct
    data = Path(path).read_bytes()
    if len(data) < 20 or data[:4] != b"glTF":
        return []
    json_len = struct.unpack_from("<I", data, 12)[0]
    doc = json.loads(data[20:20 + json_len].decode("utf-8"))
    accessors, meshes = doc.get("accessors", []), doc.get("meshes", [])
    rows = []
    for node in doc.get("nodes", []):
        if "mesh" not in node:
            continue
        mesh = meshes[node["mesh"]]
        count = sum(accessors[p["attributes"]["POSITION"]]["count"] for p in mesh.get("primitives", []) if "POSITION" in p.get("attributes", {}))
        rows.append((node.get("name") or mesh.get("name") or "?", count))
    return rows


def _export_rigged(objects, rig, path, **export_extra):
    """
    只导出指定网格 + 骨架。不靠「隐藏」（glTF 导出器各版本对 hide_set/use_visible 的处理不一致，线上 Debian Blender 3.4 没有 use_visible），
    而是把其它网格物体从所有集合暂时解链——不在场景里的物体任何版本都导不出来；导完再链回。
    导出后即读 GLB 取证：网格节点名与顶点数写到 stdout，多出/缺少网格直接报错，不等到重导入合同才发现。
    """
    import bpy
    keep = set(objects) | {rig}
    unlinked = []
    for obj in list(bpy.context.scene.objects):
        if obj.type == "MESH" and obj not in keep:
            for coll in list(obj.users_collection):
                coll.objects.unlink(obj)
                unlinked.append((obj, coll))
    try:
        bpy.context.view_layer.update()
        bpy.ops.object.select_all(action="DESELECT")
        rig.select_set(True)
        for obj in objects:
            obj.hide_set(False)
            obj.select_set(True)
        bpy.context.view_layer.objects.active = rig
        bpy.ops.export_scene.gltf(filepath=str(path), export_format="GLB", use_selection=True, export_animations=False, export_skins=True, **export_extra)
    finally:
        for obj, coll in unlinked:
            coll.objects.link(obj)
        bpy.context.view_layer.update()
    summary = _glb_mesh_summary(path)
    print("[auto-rig] export %s meshes=%s bytes=%d" % (Path(path).name, summary, Path(path).stat().st_size))
    expected = sorted(obj.name for obj in objects)
    got = sorted(name for name, _ in summary)
    if got != expected:
        raise ValueError("导出网格与目标不一致：期望 %s，实际 %s" % (expected, got))
    return hashlib.sha256(Path(path).read_bytes()).hexdigest(), sum(count for _, count in summary)


def orientation_check(obj):
    """
    廉价朝向自检（不改任何阈值、不阻断）：归一后人物应面朝 +X。
    - 选错 90°（如 Tripo 实际 +X 却选 -Y）：手臂落到 X 轴，contract 的展臂检查会明确报错；
    - 选错 180°（选 -X）：所有合同检查都能过，但左右骨互换、脚骨朝后——**静默错骨**。
    用「脚部质心是否在躯干质心前方（脚尖朝 +X）」与「深度是否小于宽度（展臂在 Y 轴）」给出疑似警告。
    """
    low, high = bounds_of(obj)
    height = max(1e-6, high[2] - low[2])
    feet, torso = [], []
    for vertex in obj.data.vertices:
        z = (vertex.co.z - low[2]) / height
        if z < .08:
            feet.append(vertex.co.x)
        elif .4 <= z <= .6:
            torso.append(vertex.co.x)
    feet_forward = (sum(feet) / len(feet) - sum(torso) / len(torso)) if feet and torso else 0.0
    depth, width = high[0] - low[0], high[1] - low[1]
    return orientation_verdict(feet_forward, depth, width, height)


ORIENTATION_NOISE_RATIO = 0.02


def orientation_verdict(feet_forward, depth, width, height):
    """
    纯判定，便于不开 Blender 单测。0916 阿菁 A-pose 真跑：feetForwardMeters = -0.0104（1 厘米）就被判「背对 +X」，
    而正面预览明明是正脸——脚与躯干质心几乎同一垂直线时，正负号只是噪声。
    噪声线按身高 2%（1.7 m → 3.4 cm）：|Δ| 在噪声线内不判朝向，只留一句提示让用户看正面预览。
    """
    noise = ORIENTATION_NOISE_RATIO * max(1e-6, height)
    reasons, notes = [], []
    if feet_forward < -noise:
        reasons.append("脚部质心在躯干后方，人物可能背对 +X（前向轴选反 180°）")
    elif abs(feet_forward) <= noise:
        notes.append("脚部与躯干质心几乎同一垂直线（%.1f 厘米，噪声线 %.1f 厘米内），无法从脚判朝向，请以正面预览为准" % (feet_forward * 100, noise * 100))
    if depth >= width:
        reasons.append("深度不小于宽度，展臂可能落在 X 轴（前向轴选错 90°）")
    return {"suspect": bool(reasons), "feetForwardMeters": round(feet_forward, 4), "noiseFloorMeters": round(noise, 4),
            "depthMeters": round(depth, 4), "widthMeters": round(width, 4), "reasons": reasons, "notes": notes}


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
        result["orientationCheck"] = orientation_check(source)
        if result["orientationCheck"]["suspect"]:
            result["limitations"].append("疑似前向轴不符：" + "；".join(result["orientationCheck"]["reasons"]) + "。请核对正面预览，必要时改 forwardAxis 重新检查")
        # 噪声线内不判朝向，但要把「为什么没判」说给用户听，避免以为自检没跑
        result["limitations"].extend(result["orientationCheck"].get("notes", []))
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
    # 重导入会按骨盆点/包围盒重新归一；先把骨架精确映射回导出前代理（=原模）坐标系再转权重
    realign = realign_reimported_rig(rig, rigged_proxy, bounds_of(source))
    transfer = transfer_weights_to_original(original, rigged_proxy, rig)
    # 代理只为求解与转权重；转完即删，避免随骨架被一起导出
    bpy.data.objects.remove(rigged_proxy, do_unlink=True)
    for child in list(rig.children):
        bpy.data.objects.remove(child, do_unlink=True)
    bends = _bend_max_delta(original, rig, ("forearm-1", "forearm1", "lower_leg-1", "lower_leg1"))
    # 全模（原模 + 骨架）：三视角参考与画质；中模（≤24 万顶点）：白模渲染预算
    full_sha, full_exported = _export_rigged([original], rig, out / "model-full.glb")
    full_check = verify_full_export(out / "model-full.glb", original, proxy_info)
    mid = original.copy()
    mid.data = original.data.copy()
    mid.name = "白模中模"
    bpy.context.scene.collection.objects.link(mid)
    # 白模只要几何与权重，不带材质、不带 UV、不写法线；画质在 model-full.glb。
    # 合同按 glTF 顶点数（拆点后）算预算：CI 实测同一 10 万顶点网格，Blender 3.4 导出器拆出 29.5 万、5.2 拆出 11.3 万。
    # 去掉 UV、不写法线后当前夹具实测导出顶点与网格顶点一致；但不当作定律，最终一律以导出 GLB 的实际计数为准：
    # 导出后按实际数核一次，超了继续减面重导，不放宽上限。
    mid.data.materials.clear()
    while mid.data.uv_layers:
        mid.data.uv_layers.remove(mid.data.uv_layers[0])
    print("[auto-rig] mid initial vertices=%d faces=%d loose=%d" % (len(mid.data.vertices), len(mid.data.polygons), len(mid.data.vertices) - len({i for poly in mid.data.polygons for i in poly.vertices})))
    mid_vertices = _decimate_to(mid, MID_MAX_VERTICES)
    mid_sha, mid_exported = _export_rigged([mid], rig, out / "model.glb", export_normals=False)
    for _ in range(3):
        if mid_exported <= MID_MAX_VERTICES:
            break
        # 按「导出/网格」比例反推目标；目标不小于当前顶点时（导出计数异常）改按九折减，避免减面空转三轮后才报错
        current = len(mid.data.vertices)
        mid_vertices = _decimate_to(mid, min(int(MID_MAX_VERTICES * current / mid_exported), int(current * .9)))
        mid_sha, mid_exported = _export_rigged([mid], rig, out / "model.glb", export_normals=False)
    if mid_exported > MID_MAX_VERTICES:
        raise ValueError("中模导出顶点 %d 仍超过预算 %d（网格顶点 %d）" % (mid_exported, MID_MAX_VERTICES, mid_vertices))
    check = contract.import_rigged_model(out / "model.glb", "中模重导入", forward_axis="+X", target_height=settings["targetHeight"], expected_sha256=mid_sha)
    # 最终中模（再次减面 + 去 UV/法线）重导入后也要过弯曲测试与预览：证明减面没损坏权重、缺省法线没有明显渲染异常
    mid_check = check["meshes"][0]
    mid_bends = _bend_max_delta(mid_check, check["rig"], ("forearm-1", "forearm1", "lower_leg-1", "lower_leg1"))
    for hidden in [original, mid] + [m for m in check["meshes"] if m is not mid_check]:
        hidden.hide_render = True
    preview([mid_check], out / "preview-mid-0.png")
    mid_bone = check["rig"].pose.bones["forearm-1"]
    mid_bone.rotation_mode = "XYZ"
    mid_bone.rotation_euler.x = .55
    bpy.context.view_layer.update()
    preview([mid_check], out / "preview-mid-1.png")
    mid_bone.matrix_basis = Matrix.Identity(4)
    bpy.context.view_layer.update()
    original.hide_render = False
    receipt["outputSha256"] = mid_sha
    # 回执顶点数 = 导出 GLB 的实际顶点数（服务端与合同都按它判 ≤25 万）
    receipt["vertices"] = mid_exported
    receipt["stage4Reimport"] = check["report"]
    receipt["weightTransfer"] = {**proxy_info, "proxySha256": proxy_sha, "fullSha256": full_sha, "fullVertices": len(original.data.vertices),
                                 "midVertices": mid_vertices, "midExportedVertices": mid_exported, "fullExportedVertices": full_exported, "midReimportBendMaxDeltaMeters": mid_bends, "filledVertices": transfer["filledVertices"], "originalBendMaxDeltaMeters": bends, "fullCheck": full_check,
                                 "proxyRealign": realign}
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
