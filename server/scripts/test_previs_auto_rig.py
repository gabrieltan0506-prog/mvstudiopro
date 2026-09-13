"""离线受限绑骨验证，自造 T 型人体测试网格，不使用或修改真实用户资产。"""
import importlib.util
import json
from pathlib import Path
import sys
import bpy
import bmesh
from mathutils import Vector

spec = importlib.util.spec_from_file_location("previs_auto_rig", Path(__file__).with_name("previs_auto_rig.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
out = Path(sys.argv[sys.argv.index("--") + 1])
out.mkdir(parents=True, exist_ok=True)
bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)
points = {"pelvis": ((0, 0, .85), (0, 0, .95)), "spine": ((0, 0, .95), (0, 0, 1.35)),
          "neck": ((0, 0, 1.35), (0, 0, 1.5)), "head": ((0, 0, 1.5), (0, 0, 1.75))}
for side in (-1, 1):
    s = str(side)
    points.update({"upper_arm" + s: ((0, side * .16, 1.35), (0, side * .46, 1.35)),
                   "forearm" + s: ((0, side * .46, 1.35), (0, side * .73, 1.35)),
                   "hand" + s: ((0, side * .73, 1.35), (0, side * .85, 1.35)),
                   "upper_leg" + s: ((0, side * .12, .85), (0, side * .12, .46)),
                   "lower_leg" + s: ((0, side * .12, .46), (0, side * .12, .08)),
                   "foot" + s: ((0, side * .12, .08), (.18, side * .12, .08))})
pieces = []
for name, (start, end) in points.items():
    head, tail = Vector(start), Vector(end)
    radius = .19 if name in ("pelvis", "spine") else .115 if name == "head" else .085 if "leg" in name else .065
    direction = tail - head
    bpy.ops.mesh.primitive_cylinder_add(vertices=16, radius=radius, depth=direction.length + radius, location=(head + tail) / 2)
    obj = bpy.context.object
    obj.rotation_mode = "QUATERNION"
    obj.rotation_quaternion = direction.to_track_quat("Z", "Y")
    pieces.append(obj)
bpy.ops.object.select_all(action="DESELECT")
for obj in pieces:
    obj.select_set(True)
bpy.context.view_layer.objects.active = pieces[0]
bpy.ops.object.join()
source = bpy.context.object
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
source.name = "TEST_ONLY_无骨T型人体"
source.data.remesh_voxel_size = .025
bpy.ops.object.voxel_remesh()
source["TEST_ONLY"] = True
confirmation = {"testOnly": True, "singleHuman": True, "pose": "T", "landmarksManuallyConfirmed": True}
checks = []
original = module.mesh_digest(source)


def rejects(fn, text):
    try:
        fn()
    except ValueError as error:
        assert text in str(error), str(error)
        assert module.mesh_digest(source) == original
        checks.append("拒绝且源不变：" + text)
    else:
        raise AssertionError("未拒绝：" + text)


rejects(lambda: module.auto_rig_test_mesh(source, points, {**confirmation, "singleHuman": False}, out / "bad-multi.glb"), "单人")
rejects(lambda: module.auto_rig_test_mesh(source, points, {**confirmation, "pose": "sitting"}, out / "bad-pose.glb"), "A/T")
rejects(lambda: module.auto_rig_test_mesh(source, points, {**confirmation, "landmarksManuallyConfirmed": False}, out / "bad-confirm.glb"), "人工确认")
rejects(lambda: module.auto_rig_test_mesh(source, {k: v for k, v in points.items() if k != "head"}, confirmation, out / "bad-missing.glb"), "16")
rejects(lambda: module.auto_rig_test_mesh(source, {**points, "head": ((0, 0, float("nan")), (0, 0, 1.8))}, confirmation, out / "bad-nan.glb"), "有限")
source["TEST_ONLY"] = False
rejects(lambda: module.auto_rig_test_mesh(source, points, confirmation, out / "bad-production.glb"), "TEST_ONLY")
source["TEST_ONLY"] = True
rejects(lambda: module.auto_rig_test_mesh(source, {**points, "head": ((5, 0, 1.5), (5, 0, 1.75))}, confirmation, out / "bad-outside.glb"), "包围盒")
rejects(lambda: module.auto_rig_test_mesh(source, {**points, "forearm1": ((0, .5, 1.35), (0, .73, 1.35))}, confirmation, out / "bad-chain.glb"), "连续")
open_mesh = source.copy()
open_mesh.data = source.data.copy()
bpy.context.scene.collection.objects.link(open_mesh)
bm = bmesh.new()
bm.from_mesh(open_mesh.data)
bm.faces.ensure_lookup_table()
bmesh.ops.delete(bm, geom=[bm.faces[0]], context="FACES")
bm.to_mesh(open_mesh.data)
bm.free()
rejects(lambda: module.auto_rig_test_mesh(open_mesh, points, confirmation, out / "bad-open.glb"), "流形")
bpy.data.objects.remove(open_mesh, do_unlink=True)
disconnected = source.copy()
disconnected.data = source.data.copy()
bpy.context.scene.collection.objects.link(disconnected)
bm = bmesh.new()
bm.from_mesh(disconnected.data)
bmesh.ops.create_cube(bm, size=.01)
bm.to_mesh(disconnected.data)
bm.free()
rejects(lambda: module.auto_rig_test_mesh(disconnected, points, confirmation, out / "bad-disconnected.glb"), "连通")
bpy.data.objects.remove(disconnected, do_unlink=True)
target = out / "TEST_ONLY_人工关节热权重.glb"
receipt = module.auto_rig_test_mesh(source, points, confirmation, target)
assert module.mesh_digest(source) == original
assert not source.parent and not source.vertex_groups and not source.modifiers
checks.extend(["源网格未改写且仍无骨无权重", "16 根语义骨均有真实权重", "全部顶点有限非零权重", "四肢真实蒙皮弯曲", "新 GLB 经阶段四严格重导入", "导出后四肢仍有真实蒙皮弯曲"])
rejects(lambda: module.auto_rig_test_mesh(source, points, confirmation, target), "禁止覆盖")
# 回滚验证保留全部原有对象、数据块、选择与活动对象；不用全局孤儿清理。
def context_snapshot():
    return {"data": {kind: set(getattr(bpy.data, kind)) for kind in ("objects", "meshes", "armatures", "materials", "images")},
            "selected": set(bpy.context.selected_objects), "active": bpy.context.view_layer.objects.active,
            "digest": module.source_digest(source)}


def confirmed():
    return {"singleHuman": True, "pose": "T", "landmarksManuallyConfirmed": True,
            "sourceDigest": module.source_digest(source)}


rejects(lambda: module.rig_confirmed_mesh(source, {**points, "lower_leg1": ((0, .15, .46), (0, .12, .08))}, confirmed(), out / "bad-leg.glb"), "腿部关节必须连续")
rejects(lambda: module.rig_confirmed_mesh(source, {**points, "neck": ((0, 0, 1.38), (0, 0, 1.5))}, confirmed(), out / "bad-torso.glb"), "躯干关节必须连续")
# 从真实可变 UV、材质参数和纹理像素验证旧确认失效。
uv = source.data.uv_layers.new(name="测试UV")
material = bpy.data.materials.new("测试源材质")
material.use_nodes = True
source.data.materials.append(material)
texture = bpy.data.images.new("测试纹理", 2, 2)
node = material.node_tree.nodes.new("ShaderNodeTexImage")
node.image = texture
material.node_tree.links.new(node.outputs["Color"], material.node_tree.nodes.get("Principled BSDF").inputs["Base Color"])
for label, mutate in (
    ("uv", lambda: setattr(uv.data[0], "uv", (.3, .7))),
    ("material", lambda: setattr(material, "diffuse_color", (.2, .4, .6, 1))),
    ("texture", lambda: texture.pixels.__setitem__(0, .55)),
    ("sampler", lambda: setattr(node, "interpolation", "Closest")),
):
    stale = confirmed()
    mutate()
    rejects(lambda: module.rig_confirmed_mesh(source, points, stale, out / ("stale-" + label + ".glb")), "模型已变化")

for index, failure_phase in enumerate(("源模型复制完成", "热权重完成", "候选导出完成", "候选重导入完成")):
    before_context = context_snapshot()
    before_audits = set(out.glob("semi-rig-*"))
    def inject(phase):
        if phase == failure_phase:
            raise RuntimeError("注入失败：" + phase)
    try:
        module.rig_confirmed_mesh(source, points, confirmed(), out / ("failure-" + str(index) + ".glb"), checkpoint=inject)
    except RuntimeError as error:
        assert str(error) == "注入失败：" + failure_phase
    else:
        raise AssertionError("未触发注入失败")
    assert before_context == context_snapshot(), failure_phase
    audit = (set(out.glob("semi-rig-*")) - before_audits).pop()
    failure = json.loads((audit / "failure.json").read_text())
    assert failure["phase"] == failure_phase and failure["sourceUnchanged"] and not failure["outputPublished"]
    assert failure["candidateRetained"] == (index >= 2)
    checks.append("失败回执和上下文恢复：" + failure_phase)

# 非 TEST_ONLY 入口只验证命名/标记约束；素材仍是自造夹具，不冒充真实用户模型。
del source["TEST_ONLY"]
source.name = "自造夹具_普通入口验证"
before_context = context_snapshot()
normal = module.rig_confirmed_mesh(source, points, confirmed(), out / "普通入口候选.glb")
assert "TEST_ONLY" not in source and not normal["testOnly"]
assert before_context == context_snapshot()
assert not normal["productionReady"] and not normal["qualityAccepted"]
weights = json.loads((Path(normal["auditDirectory"]) / "weight-discard.json").read_text())
comparison = json.loads((Path(normal["auditDirectory"]) / "weight-deformation-comparison.json").read_text())
assert len(weights["perVertexOriginalWeights"]) == len(source.data.vertices)
assert len(weights["perVertexDiscardedWeight"]) == len(source.data.vertices)
assert all(len(row["perVertexDeltaMeters"]) == len(source.data.vertices) for row in comparison.values())
checks.extend(["普通入口不写TEST_ONLY且恢复上下文", "全量裁剪原权重与同姿态逐顶点误差持久保存"])

race_target = out / "并发目标.glb"
before_context = context_snapshot()
before_audits = set(out.glob("semi-rig-*"))
def inject_race(phase):
    if phase == "候选重导入完成":
        with race_target.open("xb") as handle:
            handle.write(b"other-owned-output")
try:
    module.rig_confirmed_mesh(source, points, confirmed(), race_target, checkpoint=inject_race)
except FileExistsError:
    pass
else:
    raise AssertionError("并发发布应拒绝")
assert race_target.read_bytes() == b"other-owned-output"
assert before_context == context_snapshot()
race_audit = (set(out.glob("semi-rig-*")) - before_audits).pop()
race_failure = json.loads((race_audit / "failure.json").read_text())
assert not race_failure["outputPublished"] and race_failure["targetExists"] and race_failure["candidateRetained"]
checks.append("排他发布拒绝竞争且保留他人目标和本次审计")
receipt["checks"] = checks
receipt["blenderVersion"] = bpy.app.version_string
(out / "receipt.json").write_text(json.dumps(receipt, ensure_ascii=False, indent=2))
bpy.ops.wm.save_as_mainfile(filepath=str(out / "TEST_ONLY_人工关节热权重.blend"))
print(json.dumps({"passed": len(checks), "receipt": receipt}, ensure_ascii=False))
