"""第六步独立蒙皮内核：确认关节→热权重→严格重导入，第四/第五步接口不变。

本模块不联网。支持范围仍为单人A/T、封闭连通、100至50000顶点无骨网格；
产生待人工检查的新候选，不把权重/运动数值检查当作美术质量验收。
"""
import hashlib
import importlib.util
import json
import math
import os
import tempfile
from datetime import datetime, timezone
from pathlib import Path


def _contract():
    spec = importlib.util.spec_from_file_location("previs_rigged_model", Path(__file__).with_name("previs_rigged_model.py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def mesh_digest(obj):
    """只读记录源对象几何；失败与成功都必须保留此指纹。"""
    data = {"vertices": [list(v.co) for v in obj.data.vertices],
            "faces": [list(p.vertices) for p in obj.data.polygons],
            "matrix": [list(row) for row in obj.matrix_world]}
    return hashlib.sha256(json.dumps(data, sort_keys=True).encode()).hexdigest()


def _rna_values(value):
    """读取可序列化属性，包括法线、采样方式与颜色空间；不读运行时指针。"""
    result = {}
    for prop in value.bl_rna.properties:
        if prop.identifier in {"rna_type", "users", "tag", "is_updated", "is_updated_data", "is_updated_transform", "session_uid", "is_evaluated"} or prop.type not in {"BOOLEAN", "INT", "FLOAT", "STRING", "ENUM"}:
            continue
        current = getattr(value, prop.identifier)
        if getattr(prop, "is_array", False):
            current = list(current)
        elif isinstance(current, set):
            current = sorted(current)
        result[prop.identifier] = current
    return result


def _corner_normals(mesh):
    """
    角法线：4.1+ 用 mesh.corner_normals（始终已算好）；3.4/3.6 只有 loop.normal，
    而它在调用 calc_normals_split() 之前是**未初始化的缓存**——同一份网格在两个进程里可能读出不同值。
    检查与绑定是两次独立 Blender 进程，摘要一旦把这种值算进去，绑定必被判「模型或检查设置已经变化」。
    所以旧版必须先显式算一次再读。
    """
    if hasattr(mesh, "corner_normals"):
        return [list(item.vector) for item in mesh.corner_normals]
    if hasattr(mesh, "calc_normals_split"):
        mesh.calc_normals_split()
    return [list(loop.normal) for loop in mesh.loops]


def source_digest(obj):
    """绑定确认到完整的可消费外观与几何，防止改模型后复用旧关节点。"""
    import struct
    value = {"geometry": mesh_digest(obj),
             "edges": [list(edge.vertices) for edge in obj.data.edges],
             "polygonSettings": [_rna_values(p) for p in obj.data.polygons],
             "normals": _corner_normals(obj.data),
             "attributes": [{"name": attr.name, "domain": attr.domain, "type": attr.data_type,
                             "data": [_rna_values(item) for item in attr.data]} for attr in obj.data.attributes],
             "uv": {layer.name: [list(loop.uv) for loop in layer.data] for layer in obj.data.uv_layers},
             "polygonMaterials": [p.material_index for p in obj.data.polygons],
             "materials": []}
    for slot in obj.material_slots:
        material = slot.material
        if material is None:
            value["materials"].append(None)
            continue
        row = {"name": material.name, "color": list(material.diffuse_color),
               "settings": _rna_values(material), "nodes": [], "links": []}
        if material.use_nodes and material.node_tree:
            for node in material.node_tree.nodes:
                if node.bl_idname not in {"ShaderNodeOutputMaterial", "ShaderNodeBsdfPrincipled", "ShaderNodeTexImage",
                                          "ShaderNodeTexCoord", "ShaderNodeMapping", "ShaderNodeNormalMap",
                                          "ShaderNodeRGB", "ShaderNodeValue", "NodeReroute"}:
                    raise ValueError("当前候选流程暂不支持该材质节点：" + node.bl_idname)
                if getattr(node, "node_tree", None):
                    raise ValueError("当前候选流程暂不支持嵌套材质节点组")
                item = {"name": node.name, "type": node.bl_idname, "settings": _rna_values(node), "inputs": []}
                for key in ("texture_mapping", "color_mapping", "image_user"):
                    if getattr(node, key, None):
                        setting = getattr(node, key)
                        item[key] = _rna_values(setting)
                        if getattr(setting, "color_ramp", None):
                            item[key]["colorRamp"] = {"settings": _rna_values(setting.color_ramp),
                                                      "elements": [_rna_values(e) for e in setting.color_ramp.elements]}
                for socket in node.inputs:
                    if not hasattr(socket, "default_value"):
                        continue
                    current = socket.default_value
                    if isinstance(current, (bool, int, float, str)):
                        value_out = current
                    else:
                        try:
                            value_out = list(current)
                        except TypeError:
                            value_out = str(current)
                    item["inputs"].append([socket.name, value_out])
                image = getattr(node, "image", None)
                if image:
                    # 使用加载后的实际像素；路径相同不代表图片字节没有变。
                    digest = hashlib.sha256()
                    for pixel in image.pixels:
                        digest.update(struct.pack("<f", pixel))
                    item["image"] = {"name": image.name, "size": list(image.size), "pixelsSha256": digest.hexdigest(), "settings": _rna_values(image), "colorSpace": _rna_values(image.colorspace_settings)}
                row["nodes"].append(item)
            row["links"] = sorted((link.from_node.name, link.from_socket.identifier,
                                   link.to_node.name, link.to_socket.identifier)
                                  for link in material.node_tree.links)
        value["materials"].append(row)
    return hashlib.sha256(json.dumps(value, sort_keys=True, allow_nan=False).encode()).hexdigest()


def _write_json(file, value):
    with Path(file).open("x", encoding="utf8") as handle:
        json.dump(value, handle, ensure_ascii=False, indent=2, allow_nan=False)
        handle.flush()
        os.fsync(handle.fileno())


def rig_confirmed_mesh(source, landmarks, confirmation, output_path, *, checkpoint=lambda phase: None, compact_proxy=False):
    """工作进程入口；确认绑定源摘要，输出仅为待审候选，绝不覆盖已有文件。"""
    import bpy
    import bmesh
    from mathutils import Matrix, Vector
    contract = _contract()
    path = Path(output_path)
    if not isinstance(confirmation, dict) or set(confirmation) != {
            "singleHuman", "pose", "landmarksManuallyConfirmed", "sourceDigest"}:
        raise ValueError("请先确认单人A/T姿态和当前模型的关节点")
    if confirmation.get("singleHuman") is not True or confirmation.get("landmarksManuallyConfirmed") is not True or confirmation.get("pose") not in ("A", "T"):
        raise ValueError("只接受已人工确认关节的单人 A/T 网格")
    if source.type != "MESH" or source.mode != "OBJECT":
        raise ValueError("请使用物体模式下的独立无骨网格")
    original_digest = source_digest(source)
    if confirmation["sourceDigest"] != original_digest:
        raise ValueError("模型已变化，请重新校正并确认关节")
    if path.suffix.lower() != ".glb" or path.exists():
        raise ValueError("必须指定不存在的新 GLB 路径，禁止覆盖原资产")
    if source.parent or source.modifiers or source.vertex_groups or source.data.shape_keys:
        raise ValueError("源必须为无骨无权重无修改器的独立网格")
    if not 100 <= len(source.data.vertices) <= 50_000:
        raise ValueError("离线原型仅支持 100 至 50000 顶点")
    if not isinstance(landmarks, dict) or set(landmarks) != set(contract.SEMANTIC_BONES):
        raise ValueError("必须人工提供全部 16 根语义骨的起终点")
    bounds = [(min(v.co[i] for v in source.data.vertices) - .05,
               max(v.co[i] for v in source.data.vertices) + .05) for i in range(3)]
    points = {}
    for name, pair in landmarks.items():
        if not isinstance(pair, (list, tuple)) or len(pair) != 2:
            raise ValueError("关节点格式无效")
        for xyz in pair:
            if len(xyz) != 3 or any(type(v) not in (int, float) or not math.isfinite(v) or abs(v) > 10 for v in xyz):
                raise ValueError("关节点必须为有限的局部米制坐标")
        head, tail = map(Vector, pair)
        if any(not bounds[i][0] <= point[i] <= bounds[i][1] for point in (head, tail) for i in range(3)):
            raise ValueError("人工关节点超出源网格包围盒")
        if not .02 <= (tail - head).length <= 1:
            raise ValueError("人工骨长不在原型支持范围")
        points[name] = (head, tail)
    for side in (-1, 1):
        suffix = str(side)
        upper, forearm, hand = (points[key + suffix] for key in ("upper_arm", "forearm", "hand"))
        if any((a[1] - b[0]).length > .005 for a, b in ((upper, forearm), (forearm, hand))):
            raise ValueError("人工手臂关节必须连续")
        arm = hand[1] - upper[0]
        if arm.y * side < .25 or abs(arm.x) > .15 or arm.z > .05 or arm.z < -.7:
            raise ValueError("人工关节点不符合 +X 朝向的 A/T 展臂范围")
        if confirmation["pose"] == "T" and abs(arm.z) > .08:
            raise ValueError("T 型手臂必须接近水平")
        for key in ("upper_leg", "lower_leg"):
            head, tail = points[key + suffix]
            if tail.z >= head.z:
                raise ValueError("腿部关节点必须符合直立姿态")
    bm = bmesh.new()
    try:
        bm.from_mesh(source.data)
        if any(not e.is_manifold for e in bm.edges):
            raise ValueError("原型只接受封闭流形网格")
        remaining = set(bm.verts)
        pending = [remaining.pop()]
        while pending:
            for e in pending.pop().link_edges:
                for v in e.verts:
                    if v in remaining:
                        remaining.remove(v)
                        pending.append(v)
        if remaining:
            raise ValueError("原型只接受单个连通人体网格")
    finally:
        bm.free()
    for side in (-1, 1):
        suffix = str(side)
        for first, second in (("upper_leg", "lower_leg"), ("lower_leg", "foot")):
            if (points[first + suffix][1] - points[second + suffix][0]).length > .005:
                raise ValueError("人工腿部关节必须连续")
    for first, second in (("pelvis", "spine"), ("spine", "neck"), ("neck", "head")):
        if (points[first][1] - points[second][0]).length > .005:
            raise ValueError("人工躯干关节必须连续")
        if points[first][1].z <= points[first][0].z:
            raise ValueError("躯干关节点必须符合直立姿态")
    # 在独立目录产出、验证后排他链接到目标；检查存在与真正发布之间不能覆盖他人文件。
    path.parent.mkdir(parents=True, exist_ok=True)
    audit_dir = Path(tempfile.mkdtemp(prefix="semi-rig-", dir=path.parent))
    candidate = audit_dir / "candidate.glb"
    started = {"sourceDigest": original_digest, "landmarks": landmarks, "confirmation": confirmation,
               "outputRequested": str(path), "startedAt": datetime.now(timezone.utc).isoformat()}
    _write_json(audit_dir / "request.json", started)
    before = {kind: set(getattr(bpy.data, kind)) for kind in ("objects", "meshes", "armatures", "materials", "images")}
    selected = list(bpy.context.selected_objects)
    active = bpy.context.view_layer.objects.active
    published = False
    phase = "复制原模型"
    def advance(value):
        nonlocal phase
        phase = value
        checkpoint(value)

    try:
        mesh = source.copy()
        mesh.data = source.data.copy()
        mesh.name = "待检查_带骨模型"
        bpy.context.scene.collection.objects.link(mesh)
        rig_data = bpy.data.armatures.new("人工校正骨架")
        rig = bpy.data.objects.new(rig_data.name, rig_data)
        bpy.context.scene.collection.objects.link(rig)
        rig.matrix_world = source.matrix_world.copy()
        advance("源模型复制完成")
        bpy.ops.object.select_all(action="DESELECT")
        rig.select_set(True)
        bpy.context.view_layer.objects.active = rig
        bpy.ops.object.mode_set(mode="EDIT")
        for name, (head, tail) in points.items():
            bone = rig_data.edit_bones.new(name)
            bone.head, bone.tail = head, tail
        for child, parent in contract.PARENTS.items():
            bone = rig_data.edit_bones[child]
            bone.parent = rig_data.edit_bones[parent]
            bone.use_connect = (bone.head - bone.parent.tail).length < .00001
        bpy.ops.object.mode_set(mode="OBJECT")
        mesh.select_set(True)
        # 唯一求解器：失败即停，不用距离或固定权重伪装热权重成功。
        bpy.ops.object.parent_set(type="ARMATURE_AUTO")
        advance("热权重完成")
        totals, influenced = [], {name: 0 for name in contract.SEMANTIC_BONES}
        for vertex in mesh.data.vertices:
            weights = []
            for assignment in vertex.groups:
                name = mesh.vertex_groups[assignment.group].name
                if name in influenced:
                    weight = assignment.weight
                    if not math.isfinite(weight) or not 0 <= weight <= 1:
                        raise ValueError("热权重产生无效权重")
                    weights.append(weight)
                    if weight > .01:
                        influenced[name] += 1
            total = sum(weights)
            if total <= .000001:
                raise ValueError("热权重存在未覆盖顶点，禁止导出")
            totals.append(total)
        if any(value == 0 for value in influenced.values()):
            raise ValueError("热权重存在没有有效顶点的语义骨，禁止导出")
        def evaluated(obj):
            bpy.context.view_layer.update()
            result = obj.evaluated_get(bpy.context.evaluated_depsgraph_get())
            geometry = result.to_mesh()
            try:
                return [v.co.copy() for v in geometry.vertices]
            finally:
                result.to_mesh_clear()

        bend_names = ("forearm-1", "forearm1", "lower_leg-1", "lower_leg1")
        before_truncation = {}
        for name in bend_names:
            bone = rig.pose.bones[name]
            bone.rotation_mode = "XYZ"
            bone.rotation_euler.x = .55
            before_truncation[name] = evaluated(mesh)
            bone.matrix_basis = Matrix.Identity(4)
        # 与 GLB 最多四影响的导出契约一致；显式前置裁剪，弯曲验证使用最终权重。
        influenced = {name: 0 for name in contract.SEMANTIC_BONES}
        truncated_vertices = 0
        discarded_weights = []
        original_weights = []
        kept_totals = []
        for vertex in mesh.data.vertices:
            assignments = sorted([(a.group, a.weight) for a in vertex.groups], key=lambda row: row[1], reverse=True)
            original_weights.append([[mesh.vertex_groups[index].name, weight] for index, weight in assignments])
            kept = assignments[:4]
            truncated_vertices += len(assignments) > 4
            total = sum(weight for _, weight in kept)
            kept_totals.append(total)
            discarded_weights.append(sum(weight for _, weight in assignments[4:]))
            for index, _ in assignments[4:]:
                mesh.vertex_groups[index].remove([vertex.index])
            for index, weight in kept:
                mesh.vertex_groups[index].add([vertex.index], weight / total, "REPLACE")
                if weight / total > .01:
                    influenced[mesh.vertex_groups[index].name] += 1
        if any(value == 0 for value in influenced.values()):
            raise ValueError("四影响导出契约导致骨骼无有效权重，禁止导出")
        _write_json(audit_dir / "weight-discard.json", {"perVertexOriginalWeights": original_weights,
                    "perVertexOriginalTotal": totals, "perVertexKeptTotal": kept_totals,
                    "perVertexDiscardedWeight": discarded_weights})
        truncation_errors = {}
        rest = evaluated(mesh)
        bends = {}
        for name in bend_names:
            bone = rig.pose.bones[name]
            bone.rotation_mode = "XYZ"
            bone.rotation_euler.x = .55
            moved = evaluated(mesh)
            errors = [(a - b).length for a, b in zip(before_truncation[name], moved)]
            if len(moved) != len(before_truncation[name]) or any(not math.isfinite(v) for v in errors):
                raise ValueError("裁剪前后几何对照无效")
            truncation_errors[name] = {"perVertexDeltaMeters": errors, "maxDeltaMeters": max(errors),
                                        "rmsDeltaMeters": math.sqrt(sum(v * v for v in errors) / len(errors))}
            distances = [(a - b).length for a, b in zip(rest, moved)]
            if any(not math.isfinite(v) for v in distances) or max(distances) < .01:
                raise ValueError("真实网格弯曲测试失败：" + name)
            bends[name] = max(distances)
            bone.matrix_basis = Matrix.Identity(4)
        _write_json(audit_dir / "weight-deformation-comparison.json", truncation_errors)
        bpy.context.view_layer.update()
        bpy.ops.object.select_all(action="DESELECT")
        rig.select_set(True)
        mesh.select_set(True)
        path.parent.mkdir(parents=True, exist_ok=True)
        # 仅生产代理剥离求解副本的UV/法线，避免3.4导出按属性拆点；原模不变。
        if compact_proxy:
            while mesh.data.uv_layers:
                mesh.data.uv_layers.remove(mesh.data.uv_layers[0])
        bpy.ops.export_scene.gltf(filepath=str(candidate), export_format="GLB", use_selection=True,
                                  export_animations=False, export_skins=True, export_normals=not compact_proxy)
        advance("候选导出完成")
        inspection = contract.inspect_glb(candidate)
        imported = contract.import_rigged_model(candidate, "候选重导入", forward_axis="+X",
                                               expected_sha256=inspection["sha256"])
        reimport_bends = {}
        imported_mesh = imported["meshes"][0]
        imported_rest = evaluated(imported_mesh)
        for name in bends:
            bone = imported["rig"].pose.bones[name]
            bone.rotation_mode = "XYZ"
            bone.rotation_euler.x = .55
            distances = [(a - b).length for a, b in zip(imported_rest, evaluated(imported_mesh))]
            if any(not math.isfinite(v) for v in distances) or max(distances) < .01:
                raise ValueError("导出后弯曲测试失败：" + name)
            reimport_bends[name] = max(distances)
            bone.matrix_basis = Matrix.Identity(4)
        bpy.context.view_layer.update()
        advance("候选重导入完成")
        if source_digest(source) != original_digest:
            raise ValueError("源对象指纹发生变化")
        receipt = {"status": "candidate_validated", "testOnly": bool(source.get("TEST_ONLY")),
                "productionReady": False, "qualityAccepted": False,
                "solver": "Blender ARMATURE_AUTO", "sourceMeshSha256": mesh_digest(source), "sourceDigest": original_digest,
                "output": str(path), "outputSha256": inspection["sha256"],
                "vertices": len(mesh.data.vertices), "influencedVertices": influenced,
                "maxWeightInfluences": 4, "explicitlyTruncatedVertices": truncated_vertices,
                "maxDiscardedWeight": max(discarded_weights, default=0),
                "truncationBendMaxDeltaMeters": {name: row["maxDeltaMeters"] for name, row in truncation_errors.items()}, "auditDirectory": str(audit_dir),
                "bendMaxDeltaMeters": bends, "stage4Reimport": imported["report"],
                "reimportBendMaxDeltaMeters": reimport_bends,
                "limitations": ["人工关节点，不自动识别人形", "仅封闭连通 A/T 网格和基础 PBR/图片材质节点", "须检查变形与外观，不含眼骨和表情控制器", "数值通过不代表美术质量通过"]}
        # 成功回执先持久保留，排他发布成功后才返回；失败候选/回执始终可审计。
        _write_json(audit_dir / "candidate-report.json", receipt)
        os.link(candidate, path)
        published = True
        _write_json(audit_dir / "published.json", {"output": str(path), "sha256": inspection["sha256"]})
        return receipt
    except Exception as error:
        _write_json(audit_dir / "failure.json", {"status": "failed", "phase": phase,
                    "errorType": type(error).__name__, "message": str(error),
                    "sourceDigest": original_digest, "sourceUnchanged": source_digest(source) == original_digest,
                    "qualityAccepted": False, "outputPublished": published, "targetExists": path.exists(),
                    "candidateRetained": candidate.exists()})
        raise
    finally:
        if bpy.context.object and bpy.context.object.mode != "OBJECT":
            bpy.ops.object.mode_set(mode="OBJECT")
        for obj in set(bpy.data.objects) - before["objects"]:
            bpy.data.objects.remove(obj, do_unlink=True)
        for kind in ("meshes", "armatures", "materials", "images"):
            for item in set(getattr(bpy.data, kind)) - before[kind]:
                if item.users == 0:
                    getattr(bpy.data, kind).remove(item)
        bpy.ops.object.select_all(action="DESELECT")
        for obj in selected:
            if obj.name in bpy.context.view_layer.objects:
                obj.select_set(True)
        if active and active.name in bpy.context.view_layer.objects:
            bpy.context.view_layer.objects.active = active


def auto_rig_test_mesh(source, landmarks, confirmation, output_path):
    """保留历史测试入口，仅测试夹具可走；真实入口不伪造TEST_ONLY标记。"""
    if not isinstance(confirmation, dict) or confirmation != {
            "testOnly": True, "singleHuman": True, "pose": confirmation.get("pose"),
            "landmarksManuallyConfirmed": True} or confirmation.get("pose") not in ("A", "T") or not source.get("TEST_ONLY"):
        raise ValueError("只允许人工确认关节的 TEST_ONLY 单人 A/T 网格")
    return rig_confirmed_mesh(source, landmarks, {
        "singleHuman": True, "pose": confirmation["pose"], "landmarksManuallyConfirmed": True,
        "sourceDigest": source_digest(source)}, output_path)
