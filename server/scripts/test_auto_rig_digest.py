"""
0916 跨进程摘要稳定性：把 source_digest 算一次并写盘。

为什么单独一个脚本、还要跑两遍：
线上「检查」与「绑定」是**两次独立的 Blender 进程**，绑定会拿检查存下的 sourceDigest 与自己重算的值比对，
不一致就报「模型或检查设置已经变化」。而 test_auto_rig_proxy.py 的两个阶段跑在同一个进程里，
进程内缓存一致，跨进程不稳的值它一次也抓不到——2026-09-16 线上首跑真的因此被拒。
所以这条测试必须由外部跑两遍再比对输出，见 Dockerfile 与 .github/workflows/pr-blender-smoke.yml。

用法：blender -b --factory-startup --python test_auto_rig_digest.py -- <输出目录>
"""
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

# 自造一具 >5 万顶点的 T 形人体，导出成「原模」GLB（不使用任何用户资产）
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
# 带 UV：让摘要里的 uv/normals 分支真的被走到（3.4 无 corner_normals，走 loop.normal 回退）
while source.data.uv_layers:
    source.data.uv_layers.remove(source.data.uv_layers[0])
uv = source.data.uv_layers.new(name="UVMap")
for loop in source.data.loops:
    co = source.data.vertices[loop.vertex_index].co
    uv.data[loop.index].uv = ((co.y + 1) / 2, co.z / 2)
glb = out / "TEST_ONLY-dense-body.glb"
bpy.ops.object.select_all(action="DESELECT")
source.select_set(True)
bpy.context.view_layer.objects.active = source
bpy.ops.export_scene.gltf(filepath=str(glb), export_format="GLB", use_selection=True, export_animations=False)

sha = hashlib.sha256(glb.read_bytes()).hexdigest()
proxy, metadata, merged, original, info = runner.load_source(str(glb), sha, {"pose": "A", "forwardAxis": "+X", "targetHeight": 1.7})
# 0917：检查↔绑定的契约摘要改为 request_digest（源 SHA + 设置 + 代理参数版本）；几何摘要只作对照记录
digest = runner.request_digest(sha, {"pose": "A", "forwardAxis": "+X", "targetHeight": 1.7})
geometry_digest = runner.core.source_digest(proxy)
mesh = proxy.data
record = {
    "digest": digest,
    "geometryDigest": geometry_digest,
    "sourceSha256": sha,
    "proxyVertices": len(mesh.vertices),
    "proxyPolygons": len(mesh.polygons),
    "voxelSize": info.get("voxelSize"),
    "weldedVertices": info.get("weldedVertices"),
    # 走的是哪条法线分支：4.1+ 有 corner_normals；3.4/3.6 走 loop.normal，必须先 calc_normals_split
    "hasCornerNormals": hasattr(mesh, "corner_normals"),
    "blender": bpy.app.version_string,
}
(out / "digest.json").write_text(json.dumps(record, ensure_ascii=False, sort_keys=True, indent=2))
print("DIGEST_OK " + json.dumps(record, ensure_ascii=False, sort_keys=True))
