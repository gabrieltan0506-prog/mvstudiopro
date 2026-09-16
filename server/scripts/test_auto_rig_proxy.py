"""0916 低模绑骨验证：自造 >5 万顶点的 T 型人体（原模），验证代理减面 → 绑骨 → 权重转回原模 → 中模/全模导出。
不使用真实用户资产。用法：blender -b --factory-startup --python test_auto_rig_proxy.py -- <输出目录>"""
import hashlib
import importlib.util
import json
from pathlib import Path
import sys
import bpy
from mathutils import Vector

here = Path(__file__).parent
spec = importlib.util.spec_from_file_location("run_manhua_auto_rig", here / "run_manhua_auto_rig.py")
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)
out = Path(sys.argv[sys.argv.index("--") + 1])
out.mkdir(parents=True, exist_ok=True)

# 1) 造一个 T 型人体并加密到 >5 万顶点，导出为「原模」GLB
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
source.data.remesh_voxel_size = .007
bpy.ops.object.voxel_remesh()
dense = len(source.data.vertices)
assert dense > 50_000, "测试原模必须超过 5 万顶点，当前 %d" % dense
# 给原模一层 UV + 一个带贴图的材质：让「剥材质求解副本 / 全模重导入核材质贴图」这条路真的被走到
while source.data.uv_layers:
    source.data.uv_layers.remove(source.data.uv_layers[0])
uv = source.data.uv_layers.new(name="UVMap")
for loop in source.data.loops:
    co = source.data.vertices[loop.vertex_index].co
    uv.data[loop.index].uv = ((co.y + 1) / 2, co.z / 2)
image = bpy.data.images.new("测试贴图", 64, 64)
image.pixels = [v for _ in range(64 * 64) for v in (.8, .3, .2, 1)]
image.pack()
material = bpy.data.materials.new("测试材质")
material.use_nodes = True
tex = material.node_tree.nodes.new("ShaderNodeTexImage")
tex.image = image
bsdf = next(n for n in material.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
material.node_tree.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
source.data.materials.append(material)
# 原模朝向 +X 已是绑骨坐标；导出时 glTF 会转 Y-up，脚本按 forwardAxis 转回
glb = out / "dense-original.glb"
bpy.ops.export_scene.gltf(filepath=str(glb), export_format="GLB", use_selection=True, export_animations=False)
sha = hashlib.sha256(glb.read_bytes()).hexdigest()

# 2) inspect：应走代理路径
settings = {"pose": "T", "forwardAxis": "+X", "targetHeight": 1.75}
(out / "inspect").mkdir(exist_ok=True); (out / "bind").mkdir(exist_ok=True)
req1 = out / "req1.json"
req1.write_text(json.dumps({"request": {"requestId": "00000000-0000-4000-8000-0000000000a1", "assetRef": "test", "sourceJobId": "m3d_test", "settings": settings, "stage": "inspect"}, "sourceSha256": sha}))
r1 = runner.run(str(req1), str(glb), str(out / "inspect"))
# glTF 导出会按法线/UV 接缝拆点，导入后顶点数 ≥ 导出前；只断言超过 5 万且走了代理
assert r1["weightTransfer"]["enabled"] and r1["weightTransfer"]["originalVertices"] >= 50_000, r1["weightTransfer"]
assert r1["weightTransfer"]["originalMaterials"] == 1 and r1["weightTransfer"]["originalUvLayers"] == 1, r1["weightTransfer"]
assert 100 <= r1["vertices"] <= runner.RIG_MAX_VERTICES, r1["vertices"]
assert (out / "inspect" / "preview-0.png").stat().st_size > 200
oc = r1["orientationCheck"]
assert not oc["suspect"] and oc["feetForwardMeters"] > 0 and oc["depthMeters"] < oc["widthMeters"], oc
# 朝向自检：同一模型把 forwardAxis 选反 180°（-X），合同检查全部能过，但必须给出「疑似朝向不符」警告
(out / "inspect-wrong").mkdir(exist_ok=True)
req_wrong = out / "req-wrong.json"
req_wrong.write_text(json.dumps({"request": {"requestId": "00000000-0000-4000-8000-0000000000a3", "assetRef": "test", "sourceJobId": "m3d_test", "settings": {**settings, "forwardAxis": "-X"}, "stage": "inspect"}, "sourceSha256": sha}))
r_wrong = runner.run(str(req_wrong), str(glb), str(out / "inspect-wrong"))
assert r_wrong["orientationCheck"]["suspect"] and r_wrong["orientationCheck"]["feetForwardMeters"] < 0, r_wrong["orientationCheck"]
assert any("疑似前向轴" in line for line in r_wrong["limitations"]), r_wrong["limitations"]

# 3) bind：关节点用测试网格的真值（与 test_previs_auto_rig 同一套），单位已按 targetHeight 归一
# 躯干点故意前移 4cm（真实模型骨盆很少正好在包围盒中心）：重导入会把骨盆归到 xy=0，脚本必须对齐回原模坐标
TORSO_X = .04
truth = {"pelvis": (TORSO_X, 0, .85), "waist": (TORSO_X, 0, .95), "chest": (TORSO_X, 0, 1.35), "neck": (TORSO_X, 0, 1.35), "headTop": (TORSO_X, 0, 1.75)}
# 语义点（与 BONES 表对应）：neck 骨 chest→neck，head 骨 neck→headTop；此处 neck 点取 1.5
truth["neck"] = (TORSO_X, 0, 1.5)
for side, sign in (("L", 1), ("R", -1)):
    truth.update({"shoulder" + side: (0, sign * .16, 1.35), "elbow" + side: (0, sign * .46, 1.35), "wrist" + side: (0, sign * .73, 1.35), "handTip" + side: (0, sign * .85, 1.35),
                  "hip" + side: (0, sign * .12, .85), "knee" + side: (0, sign * .12, .46), "ankle" + side: (0, sign * .12, .08), "toe" + side: (.18, sign * .12, .08)})
low, high = r1["bounds"]
joints = {k: [max(low[i], min(high[i], v[i])) for i in range(3)] for k, v in truth.items()}
req2 = out / "req2.json"
req2.write_text(json.dumps({"request": {"requestId": "00000000-0000-4000-8000-0000000000a2", "assetRef": "test", "sourceJobId": "m3d_test", "settings": settings, "stage": "bind", "inspectionRequestId": "00000000-0000-4000-8000-0000000000a1", "sourceDigest": r1["sourceDigest"], "joints": joints, "singleHuman": True, "landmarksManuallyConfirmed": True}, "sourceSha256": sha}))
r2 = runner.run(str(req2), str(glb), str(out / "bind"))
wt = r2["weightTransfer"]
assert wt["enabled"] and wt["fullVertices"] == r1["weightTransfer"]["originalVertices"] and wt["midVertices"] <= runner.MID_MAX_VERTICES, wt
# 回执顶点 = 导出 GLB 实际顶点；中模去 UV/法线后应与网格顶点一致且 ≤ 预算（导出器版本无关）
assert r2["vertices"] == wt["midExportedVertices"] <= runner.MID_MAX_VERTICES, (r2["vertices"], wt)
assert wt["midExportedVertices"] == wt["midVertices"], ("中模导出拆点", wt["midExportedVertices"], wt["midVertices"])
assert all(v >= .01 for v in wt["originalBendMaxDeltaMeters"].values()), wt["originalBendMaxDeltaMeters"]
mid = (out / "bind" / "model.glb").read_bytes(); full = (out / "bind" / "model-full.glb").read_bytes()
assert hashlib.sha256(mid).hexdigest() == r2["outputSha256"], "中模 sha 与回执不一致"
assert hashlib.sha256(full).hexdigest() == wt["fullSha256"], "全模 sha 与回执不一致"
assert len(full) > len(mid), "全模应比中模大"
# 全模重导入核对：材质/UV/贴图都在；中模无材质
fc = wt["fullCheck"]
assert fc["materials"] == 1 and fc["uvLayers"] == 1 and fc["images"] >= 1 and fc["armatureModifier"], fc
# 骨架对齐：重导入把骨盆归到 xy=0，脚本必须映射回原模坐标，骨盆骨头端要落回用户确认的关节点
realign = wt["proxyRealign"]
assert realign["residualMeters"] < 1e-3 and abs(realign["offsetMeters"][0] - TORSO_X) < .01, realign
rig = bpy.data.objects["代理重导入_角色骨架"]  # 中模重导入的骨架会被再次归一，不是这里要核的
pelvis_head = rig.matrix_world @ rig.data.bones["pelvis"].head_local
assert (pelvis_head - Vector(joints["pelvis"])).length < 2e-3, (list(pelvis_head), joints["pelvis"])
for i in range(5):
    assert (out / "bind" / ("preview-%d.png" % i)).stat().st_size > 200
print("TEST_OK", json.dumps({"dense": dense, "proxy": wt["proxyVertices"], "mid": wt["midVertices"], "filled": wt["filledVertices"], "bends": {k: round(v, 3) for k, v in wt["originalBendMaxDeltaMeters"].items()}, "midBytes": len(mid), "fullBytes": len(full)}))
