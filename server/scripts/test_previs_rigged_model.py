"""离线真 Blender 验证；自造几何体只用于测试，绝非已验收人物资产。

运行：blender -b --factory-startup --python-exit-code 1 --python 此脚本 -- 输出目录
不渲染视频、不联网；保留 GLB、blend 与 JSON 证据供复核。
"""
import importlib.util
import json
import math
import struct
from pathlib import Path
import sys
from types import SimpleNamespace
import bpy
from mathutils import Matrix, Vector

spec = importlib.util.spec_from_file_location("previs_rigged_model", Path(__file__).with_name("previs_rigged_model.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
out = Path(sys.argv[sys.argv.index("--") + 1])
out.mkdir(parents=True, exist_ok=True)
checks = []


def check(condition, label):
    if not condition:
        raise AssertionError(label)
    checks.append(label)


def rejects(fn, message):
    try:
        fn()
    except ValueError as error:
        check(message in str(error), "明确拒绝：" + message)
    else:
        raise AssertionError("没有拒绝：" + message)


def check_numpy_compat_scope():
    import numpy
    original_bool = numpy.__dict__.get("bool")
    # 仅测试用视图模拟NumPy1.24缺少旧别名，实际empty/dtype仍来自当前真实NumPy。
    missing_bool = SimpleNamespace(bool_=numpy.bool_, empty=numpy.empty)
    legacy_mesh = SimpleNamespace(np=missing_bool)
    with module._legacy_numpy_bool_scope(missing_bool, legacy_mesh):
        check(legacy_mesh.np.empty(4, dtype=legacy_mesh.np.bool).dtype == numpy.dtype(numpy.bool_), "旧glTF bool兼容仍创建真实布尔数组")
        check("bool" not in missing_bool.__dict__, "兼容不修改NumPy模块命名空间")
    check(legacy_mesh.np is missing_bool, "成功导入后恢复旧插件np引用")
    try:
        with module._legacy_numpy_bool_scope(missing_bool, legacy_mesh):
            raise RuntimeError("仅测试的导入失败")
    except RuntimeError:
        pass
    check(legacy_mesh.np is missing_bool, "异常导入后也恢复旧插件np引用")
    existing = SimpleNamespace(bool=numpy.bool_, bool_=numpy.bool_)
    modern_mesh = SimpleNamespace(np=existing)
    with module._legacy_numpy_bool_scope(existing, modern_mesh):
        check(modern_mesh.np is existing, "已有bool类型的NumPy不加代理")
    check(numpy.__dict__.get("bool") is original_bool, "真实全局NumPy别名完全未改变")


check_numpy_compat_scope()


def check_import_engine_failure():
    # 使用真实场景与引擎属性；只替换导入动作，模拟插件已改引擎后中途失败。
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH"
    expected_error = RuntimeError("仅测试的glTF中途失败")
    def failed_import(**kwargs):
        scene.render.engine = "CYCLES"
        raise expected_error
    test_bpy = SimpleNamespace(context=bpy.context, app=bpy.app,
                              ops=SimpleNamespace(import_scene=SimpleNamespace(gltf=failed_import)))
    try:
        module._import_gltf_asset(test_bpy, "TEST_ONLY-failed-import.glb")
    except RuntimeError as error:
        check(error is expected_error, "导入异常原样向上传播")
    else:
        raise AssertionError("导入异常被吞掉")
    check(scene.render.engine == "BLENDER_WORKBENCH", "导入中途失败也恢复原WORKBENCH引擎")


check_import_engine_failure()


def rest_points():
    p = {"pelvis": ((0, 0, .85), (0, 0, .95)), "spine": ((0, 0, .95), (0, 0, 1.35)),
         "neck": ((0, 0, 1.35), (0, 0, 1.5)), "head": ((0, 0, 1.5), (0, 0, 1.75))}
    for side in (-1, 1):
        s = str(side)
        p.update({"upper_arm" + s: ((0, side * .2, 1.35), (0, side * .5, 1.35)),
                  "forearm" + s: ((0, side * .5, 1.35), (0, side * .8, 1.35)),
                  "hand" + s: ((0, side * .8, 1.35), (0, side * .9, 1.35)),
                  "upper_leg" + s: ((0, side * .14, .85), (0, side * .14, .46)),
                  "lower_leg" + s: ((0, side * .14, .46), (0, side * .14, .08)),
                  "foot" + s: ((0, side * .14, .08), (.18, side * .14, .08))})
    return p


def create_rig(name, with_eyes=True, parented=True):
    points = rest_points()
    if with_eyes:
        points.update({"Eye.L": ((.055, .065, 1.64), (.135, .065, 1.64)),
                       "Eye.R": ((.055, -.065, 1.64), (.135, -.065, 1.64))})
    data = bpy.data.armatures.new(name)
    rig = bpy.data.objects.new(name, data)
    bpy.context.scene.collection.objects.link(rig)
    bpy.ops.object.select_all(action="DESELECT")
    rig.select_set(True)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode="EDIT")
    for name, (head, tail) in points.items():
        b = data.edit_bones.new(name)
        b.head, b.tail = head, tail
    if parented:
        for child, parent in module.PARENTS.items():
            data.edit_bones[child].parent = data.edit_bones[parent]
        if with_eyes:
            data.edit_bones["Eye.L"].parent = data.edit_bones["head"]
            data.edit_bones["Eye.R"].parent = data.edit_bones["head"]
    bpy.ops.object.mode_set(mode="OBJECT")
    return rig, points


def create_test_mesh(rig, points):
    vertices, faces, groups = [], [], {}
    for name, (head, tail) in points.items():
        center = (Vector(head) + Vector(tail)) / 2
        # 测试方块刻意不对称，旋转眼骨时必须能观察到实际网格变化。
        begin = len(vertices)
        for x, y, z in ((-.04, -.025, -.03), (.07, -.025, -.03), (.07, .025, -.03), (-.04, .025, -.03),
                        (-.04, -.025, .03), (.07, -.025, .03), (.07, .025, .03), (-.04, .025, .03)):
            vertices.append(tuple(center + Vector((x, y, z))))
        groups[name] = list(range(begin, begin + 8))
        faces.extend(tuple(begin + v for v in face) for face in ((0, 1, 2, 3), (4, 7, 6, 5), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)))
    data = bpy.data.meshes.new("仅测试用途几何体")
    data.from_pydata(vertices, [], faces)
    obj = bpy.data.objects.new("仅测试用途角色", data)
    bpy.context.scene.collection.objects.link(obj)
    for name, indexes in groups.items():
        obj.vertex_groups.new(name=name).add(indexes, 1.0, "REPLACE")
    mod = obj.modifiers.new("真实蒙皮", "ARMATURE")
    mod.object = rig
    obj.parent = rig
    obj.shape_key_add(name="Basis")
    for name, vector in (("Relax", (.03, 0, 0)), ("Tense", (0, .035, 0)), ("Surprise", (0, 0, .04))):
        key = obj.shape_key_add(name=name)
        for index in groups["head"]:
            key.data[index].co += Vector(vector)
    return obj


def positions(obj):
    graph = bpy.context.evaluated_depsgraph_get()
    evaluated = obj.evaluated_get(graph)
    mesh = evaluated.to_mesh()
    result = [evaluated.matrix_world @ v.co for v in mesh.vertices]
    evaluated.to_mesh_clear()
    return result


bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)
fixture_rig, points = create_rig("仅测试用途带骨模型")
fixture_mesh = create_test_mesh(fixture_rig, points)
bpy.ops.object.select_all(action="DESELECT")
fixture_rig.select_set(True)
fixture_mesh.select_set(True)
path = out / "TEST_ONLY-rigged-with-morph.glb"
if "--fixture" in sys.argv:
    path = Path(sys.argv[sys.argv.index("--fixture") + 1])
    if not path.is_file() or not path.name.startswith("TEST_ONLY-"):
        raise ValueError("外部夹具必须为已存在且明确TEST_ONLY的GLB；只读不覆盖")
else:
    bpy.ops.export_scene.gltf(filepath=str(path), export_format="GLB", use_selection=True, export_animations=False)
meta = module.inspect_glb(path)
check(len(meta["jointNames"]) == 18, "真实GLB含18骨")
check(set(meta["morphNames"]) == {"Relax", "Tense", "Surprise"}, "真实GLB含三组命名形变")
rejects(lambda: module.inspect_glb(path, "0" * 64), "SHA不一致")
# 仅修改测试夹具的JSON，确认导入器执行前阻断无骨与外链资源。
raw = path.read_bytes()
json_length = struct.unpack_from("<I", raw, 12)[0]
fixture_doc = json.loads(raw[20:20 + json_length])


def primitive(doc):
    """按实际蒙皮网格寻找属性，不能假定不同导出器的accessor序号。"""
    node = next(node for node in doc["nodes"] if "mesh" in node and "skin" in node)
    return doc["meshes"][node["mesh"]]["primitives"][0]


def accessor(doc, semantic):
    item = primitive(doc)
    index = item["indices"] if semantic == "indices" else item["targets"][0]["POSITION"] if semantic == "morph" else item["attributes"][semantic]
    return doc["accessors"][index]


def view_for(doc, semantic):
    return doc["bufferViews"][accessor(doc, semantic)["bufferView"]]


def node_id(doc, name):
    return next(i for i, node in enumerate(doc["nodes"]) if node.get("name") == name)


def mesh_node_id(doc):
    return next(i for i, node in enumerate(doc["nodes"]) if "mesh" in node and "skin" in node)


def parent_id(doc, child):
    return next(i for i, node in enumerate(doc["nodes"]) if child in node.get("children", []))


def append_view(doc, binary, data):
    binary.extend(b"\0" * ((-len(binary)) % 4))
    index = len(doc["bufferViews"])
    doc["bufferViews"].append({"buffer": 0, "byteOffset": len(binary), "byteLength": len(data)})
    binary.extend(data)
    doc["buffers"][0]["byteLength"] = len(binary)
    return index


def prepare_sparse(doc, binary):
    """从真实形变值建立等价、先验通过的dense+sparse布局，不要求导出器默认稀疏。"""
    item = accessor(doc, "morph")
    assert item["componentType"] == 5126 and item["type"] == "VEC3" and item["count"] >= 2
    values = [(0., 0., 0.) for _ in range(item["count"])]
    if "bufferView" in item:
        view = doc["bufferViews"][item["bufferView"]]
        start = view.get("byteOffset", 0) + item.get("byteOffset", 0)
        values = [struct.unpack_from("<3f", binary, start + i * view.get("byteStride", 12)) for i in range(item["count"])]
    if "sparse" in item:
        sparse = item["sparse"]
        index_view = doc["bufferViews"][sparse["indices"]["bufferView"]]
        data_view = doc["bufferViews"][sparse["values"]["bufferView"]]
        code = {5121: "B", 5123: "H", 5125: "I"}[sparse["indices"]["componentType"]]
        for i in range(sparse["count"]):
            index = struct.unpack_from("<" + code, binary, index_view.get("byteOffset", 0) + sparse["indices"].get("byteOffset", 0) + i * struct.calcsize(code))[0]
            values[index] = struct.unpack_from("<3f", binary, data_view.get("byteOffset", 0) + sparse["values"].get("byteOffset", 0) + i * 12)
    item["bufferView"] = append_view(doc, binary, b"".join(struct.pack("<3f", *row) for row in values))
    item["byteOffset"] = 0
    item["sparse"] = {"count": 2,
                      "indices": {"bufferView": append_view(doc, binary, struct.pack("<2H", 0, 1)), "componentType": 5123},
                      "values": {"bufferView": append_view(doc, binary, struct.pack("<6f", *(values[0] + values[1])))}}
    module._validate_resources(doc, bytes(binary))
    check(True, "稀疏负例先验证等价合法基线")
    return item["sparse"]


def malformed_glb(label, mutate, expected, mutate_binary=None):
    doc = json.loads(json.dumps(fixture_doc))
    mutate(doc)
    binary = bytearray(raw[28 + json_length:])
    if mutate_binary:
        mutate_binary(doc, binary)
    encoded = json.dumps(doc).encode("utf8")
    encoded += b" " * ((-len(encoded)) % 4)
    binary += b"\0" * ((-len(binary)) % 4)
    body = struct.pack("<II", len(encoded), 0x4E4F534A) + encoded + struct.pack("<II", len(binary), 0x004E4942) + binary
    bad_path = out / ("TEST_ONLY-rejected-" + label + ".glb")
    bad_path.write_bytes(struct.pack("<4sII", b"glTF", 2, 12 + len(body)) + body)
    rejects(lambda: module.inspect_glb(bad_path), expected)
    calls = []
    def forbidden_import(**kwargs):
        calls.append(kwargs)
        raise AssertionError("畸形GLB不应调用Blender导入器")
    original_bpy = module._bpy
    module._bpy = lambda: SimpleNamespace(data=bpy.data, ops=SimpleNamespace(import_scene=SimpleNamespace(gltf=forbidden_import)))
    try:
        rejects(lambda: module.import_rigged_model(bad_path, "must-not-import"), expected)
        check(not calls, "导入器调用前拒绝：" + label)
    finally:
        module._bpy = original_bpy
malformed_glb("external-uri", lambda doc: doc["buffers"][0].update(uri="file:///not-allowed.bin"), "不能引用外链")
malformed_glb("no-skin", lambda doc: doc.update(skins=[]), "无骨模型不能直接重定向")
malformed_glb("indices-billion", lambda d: accessor(d, "indices").update(count=1_000_000_000), "accessor数量")
malformed_glb("weights-missing-accessor", lambda d: primitive(d)["attributes"].update(WEIGHTS_0=len(d["accessors"])), "accessor")
malformed_glb("bad-buffer-ref", lambda d: view_for(d, "POSITION").update(buffer=len(d["buffers"])), "buffer")
malformed_glb("view-overflow", lambda d: view_for(d, "POSITION").update(byteLength=d["buffers"][0]["byteLength"] + 1), "bufferView长度")
malformed_glb("view-end-overflow", lambda d: view_for(d, "POSITION").update(byteOffset=d["buffers"][0]["byteLength"]), "二进制边界")
malformed_glb("accessor-offset", lambda d: accessor(d, "POSITION").update(byteOffset=view_for(d, "POSITION")["byteLength"]), "accessor越过")
malformed_glb("accessor-unaligned", lambda d: accessor(d, "POSITION").update(byteOffset=1), "对齐")
malformed_glb("stride-short", lambda d: view_for(d, "POSITION").update(byteStride=4), "步长")
malformed_glb("weights-count", lambda d: accessor(d, "WEIGHTS_0").update(count=accessor(d, "POSITION")["count"] - 1), "数量不一致")
malformed_glb("joints-type", lambda d: accessor(d, "JOINTS_0").update(type="SCALAR"), "语义类型")
malformed_glb("joints-normalized", lambda d: accessor(d, "JOINTS_0").update(normalized=True), "归一化契约")
def shorter_morph(doc, binary):
    # 同时收紧真实sparse索引，避免另一个越界掩盖“形变数量不一致”这个目标断言。
    prepare_sparse(doc, binary)
    accessor(doc, "morph")["count"] = accessor(doc, "POSITION")["count"] - 1
malformed_glb("morph-count", lambda d: None, "数量不一致", shorter_morph)
malformed_glb("sparse-overcount", lambda d: None, "sparse数量", lambda d, b: prepare_sparse(d, b).update(count=accessor(d, "morph")["count"] + 1))
malformed_glb("sparse-index-view", lambda d: None, "bufferView", lambda d, b: prepare_sparse(d, b)["indices"].update(bufferView=len(d["bufferViews"])))
def sparse_offset(doc, binary):
    sparse = prepare_sparse(doc, binary)
    sparse["values"]["byteOffset"] = doc["bufferViews"][sparse["values"]["bufferView"]]["byteLength"]
malformed_glb("sparse-value-offset", lambda d: None, "accessor越过", sparse_offset)
malformed_glb("optional-draco", lambda d: d.update(extensionsUsed=["KHR_draco_mesh_compression"]), "扩展当前全部关闭")
malformed_glb("hidden-meshopt", lambda d: view_for(d, "POSITION").update(extensions={"EXT_meshopt_compression": {}}), "扩展当前全部关闭")
malformed_glb("unknown-extension", lambda d: d.update(extensionsRequired=["TEST_unknown"]), "扩展当前全部关闭")
malformed_glb("animation", lambda d: d.update(animations=[{}]), "无内嵌动画")
malformed_glb("node-cycle", lambda d: d["nodes"][node_id(d, "Eye.L")].update(children=[d["scenes"][0]["nodes"][0]]), "存在环")
malformed_glb("node-repeat", lambda d: d["nodes"][parent_id(d, mesh_node_id(d))]["children"].append(mesh_node_id(d)), "多父级")
malformed_glb("node-no-skin", lambda d: d["nodes"][mesh_node_id(d)].pop("skin"), "缺少真实skin")
malformed_glb("node-skin-ref", lambda d: d["nodes"][mesh_node_id(d)].update(skin=len(d["skins"])), "缺少真实skin")
malformed_glb("node-transform", lambda d: d["nodes"][mesh_node_id(d)].update(scale=[1, 1, float("inf")]), "非有限数字")
malformed_glb("node-detached", lambda d: d["nodes"][parent_id(d, mesh_node_id(d))]["children"].remove(mesh_node_id(d)), "孤立节点")
malformed_glb("bone-name-duplicate", lambda d: d["nodes"][node_id(d, "Eye.L")].update(name="Eye.R"), "名称缺失或重复")
malformed_glb("skeleton-not-ancestor", lambda d: d["skins"][0].update(skeleton=mesh_node_id(d)), "共同祖先")
def disconnected_joints(doc):
    eye = node_id(doc, "Eye.L")
    doc["nodes"][parent_id(doc, eye)]["children"].remove(eye)
    doc["scenes"][0]["nodes"].append(eye)
malformed_glb("joints-no-common-root", disconnected_joints, "共同根节点")
malformed_glb("zero-quaternion", lambda d: d["nodes"][node_id(d, "Eye.L")].update(rotation=[0, 0, 0, 0]), "单位旋转")
malformed_glb("composed-world-overflow", lambda d: (d["nodes"][node_id(d, "head")].update(scale=[1e6] * 3), d["nodes"][node_id(d, "Eye.L")].update(scale=[1e6] * 3)), "合成世界变换")
def many_instances(doc):
    count = accessor(doc, "POSITION")["count"]
    source_node = doc["nodes"][mesh_node_id(doc)]
    for i in range(module.MAX_VERTICES // count + 1):
        index = len(doc["nodes"])
        doc["nodes"].append({"mesh": source_node["mesh"], "skin": source_node["skin"]})
        doc["scenes"][0]["nodes"].append(index)
malformed_glb("instance-vertices", many_instances, "实例总顶点")
def repeated_morphs(doc):
    item = primitive(doc)
    item["targets"] = [item["targets"][0]] * 64
    source_node = doc["nodes"][mesh_node_id(doc)]
    doc["meshes"][source_node["mesh"]].pop("extras", None)
    doc["meshes"][source_node["mesh"]].pop("weights", None)
    widths = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}
    used = list(item["attributes"].values()) + [index for target in item["targets"] for index in target.values()] + [item["indices"]]
    per_instance = sum(doc["accessors"][index]["count"] * widths[doc["accessors"][index]["type"]] for index in used)
    for i in range(module.MAX_ACCESSOR_COMPONENTS // per_instance + 1):
        index = len(doc["nodes"])
        doc["nodes"].append({"mesh": source_node["mesh"], "skin": source_node["skin"]})
        doc["scenes"][0]["nodes"].append(index)
malformed_glb("instance-morph-budget", repeated_morphs, "实例展开分量")
def poke_accessor(semantic, value):
    def mutate(doc, binary):
        item = accessor(doc, semantic)
        start = doc["bufferViews"][item["bufferView"]].get("byteOffset", 0) + item.get("byteOffset", 0)
        fmt = "<" + {5121: "B", 5123: "H", 5125: "I", 5126: "f"}[item["componentType"]]
        struct.pack_into(fmt, binary, start, value(doc) if callable(value) else value)
    return mutate
malformed_glb("actual-joint-oob", lambda d: None, "JOINTS实际索引", poke_accessor("JOINTS_0", lambda d: len(d["skins"][0]["joints"])))
malformed_glb("actual-index-oob", lambda d: None, "实际indices越界", poke_accessor("indices", lambda d: accessor(d, "POSITION")["count"]))
malformed_glb("actual-weight-negative", lambda d: None, "实际蒙皮权重", poke_accessor("WEIGHTS_0", -.5))
malformed_glb("actual-weight-nan", lambda d: None, "非有限", poke_accessor("WEIGHTS_0", float("nan")))
malformed_glb("actual-position-nan", lambda d: None, "非有限", poke_accessor("POSITION", float("nan")))
def non_affine_bind(doc, binary):
    item = doc["accessors"][doc["skins"][0]["inverseBindMatrices"]]
    start = doc["bufferViews"][item["bufferView"]].get("byteOffset", 0) + item.get("byteOffset", 0)
    struct.pack_into("<f", binary, start + 12, .5)
malformed_glb("inverse-bind-not-affine", lambda d: None, "仿射矩阵", non_affine_bind)
def zero_weights(doc, binary):
    view = view_for(doc, "WEIGHTS_0")
    item = accessor(doc, "WEIGHTS_0")
    size = {5121: 1, 5123: 2, 5126: 4}[item["componentType"]] * 4
    start = view.get("byteOffset", 0) + item.get("byteOffset", 0)
    for i in range(item["count"]):
        offset = start + i * view.get("byteStride", size)
        binary[offset:offset + size] = bytes(size)
malformed_glb("actual-weights-empty", lambda d: None, "实际蒙皮权重", zero_weights)
def sparse_duplicate(doc, binary):
    sparse = prepare_sparse(doc, binary)
    index = sparse["indices"]["bufferView"]
    start = doc["bufferViews"][index]["byteOffset"]
    struct.pack_into("<2H", binary, start, 0, 0)
malformed_glb("actual-sparse-duplicate", lambda d: None, "未严格递增", sparse_duplicate)
def attach_png(width, height):
    def mutate(doc, binary):
        import zlib
        def chunk(kind, payload):
            return struct.pack(">I", len(payload)) + kind + payload + struct.pack(">I", zlib.crc32(kind + payload))
        payload = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(b"\0\xff\0\0\xff")) + chunk(b"IEND", b"")
        start = len(binary)
        binary.extend(payload)
        doc["buffers"][0]["byteLength"] = len(binary)
        index = len(doc["bufferViews"])
        doc["bufferViews"].append({"buffer": 0, "byteOffset": start, "byteLength": len(payload)})
        doc["images"] = [{"mimeType": "image/png", "bufferView": index}]
    return mutate
malformed_glb("image-bomb", lambda d: None, "图片像素", attach_png(100_000, 100_000))
malformed_glb("image-total", lambda d: None, "总像素", lambda d, b: (attach_png(4096, 4096)(d, b), d["images"].extend([dict(d["images"][0]), dict(d["images"][0])])))
malformed_glb("image-external", lambda d: d.update(images=[{"uri": "https://not-allowed.example/a.png"}]), "不能引用外链")
malformed_glb("image-view-missing", lambda d: d.update(images=[{"mimeType": "image/png", "bufferView": len(d["bufferViews"])}]), "image bufferView")
def jpeg_bomb(doc, binary):
    payload = b"\xff\xd8\xff\xc0" + struct.pack(">HBHHB", 11, 8, 65535, 65535, 1) + b"\1\x11\0" + b"\xff\xda\0\x08\x01\x01\0\0\x3f\0\x01\xff\xd9"
    start = len(binary)
    binary.extend(payload)
    doc["buffers"][0]["byteLength"] = len(binary)
    index = len(doc["bufferViews"])
    doc["bufferViews"].append({"buffer": 0, "byteOffset": start, "byteLength": len(payload)})
    doc["images"] = [{"mimeType": "image/jpeg", "bufferView": index}]
malformed_glb("jpeg-bomb", lambda d: None, "图片像素", jpeg_bomb)
def empty_jpeg_scan(doc, binary):
    jpeg_bomb(doc, binary)
    view = doc["bufferViews"][-1]
    start = view["byteOffset"]
    struct.pack_into(">HH", binary, start + 7, 1, 1)
    binary[start + 15:] = b"\xff\xda\x00\x02\xff\xd9"
    view["byteLength"] = len(binary) - start
    doc["buffers"][0]["byteLength"] = len(binary)
malformed_glb("jpeg-empty-scan", lambda d: None, "扫描头无效", empty_jpeg_scan)
malformed_glb("unsupported-image", lambda d: None, "仅支持PNG/JPEG", lambda d, b: (attach_png(1, 1)(d, b), d["images"][0].update(mimeType="image/ktx2")))
small_doc, small_binary = json.loads(json.dumps(fixture_doc)), bytearray(raw[28 + json_length:])
attach_png(1, 1)(small_doc, small_binary)
small_view = small_doc["bufferViews"][-1]
small_png = bytes(small_binary[small_view["byteOffset"]:])
check(module._image_dimensions(small_png, "image/png") == (1, 1), "真实1像素PNG容器尺寸通过")
check(module._validate_resources(small_doc, bytes(small_binary))["imagePixels"] == 1, "内嵌1像素PNG进入资源回执")
malformed_glb("png-corrupt-crc", lambda d: None, "校验和", lambda d, b: (attach_png(1, 1)(d, b), b.__setitem__(-1, b[-1] ^ 1)))
malformed_glb("texture-ref", lambda d: d.update(textures=[{"source": len(d.get("images", []))}]), "texture source")
malformed_glb("material-ref", lambda d: primitive(d).update(material=len(d.get("materials", []))), "material")
check(module.MAX_GLB_BYTES == 64 * 1024 * 1024, "脚本GLB字节上限与服务端64MB一致")
rejects(lambda: module.resolve_bone_map(["head"]), "请明确映射")
bad = {name: "head" for name in module.SEMANTIC_BONES}
rejects(lambda: module.resolve_bone_map(meta["jointNames"], bad), "同一根骨骼")
check(len(module.resolve_bone_map(meta["jointNames"])) == 16, "规范16骨严格映射")
fixture_mesh_data = fixture_mesh.data
bpy.data.objects.remove(fixture_mesh, do_unlink=True)
bpy.data.objects.remove(fixture_rig, do_unlink=True)
import numpy
if tuple(bpy.app.version[:2]) == (3, 4):
    import io_scene_gltf2.blender.imp.gltf2_blender_mesh as actual_gltf_mesh
else:
    import io_scene_gltf2.blender.imp.mesh as actual_gltf_mesh
original_gltf_numpy = actual_gltf_mesh.np
original_numpy_bool = numpy.__dict__.get("bool")
bpy.context.scene.render.engine = "BLENDER_WORKBENCH"
model = module.import_rigged_model(path, "test-actor", forward_axis="+X", target_height=1.7, expected_sha256=meta["sha256"])
check(bpy.context.scene.render.engine == "BLENDER_WORKBENCH", "真实GLB经生产入口导入后保留WORKBENCH引擎")
check(actual_gltf_mesh.np is original_gltf_numpy, "真实生产导入后glTF插件NumPy引用已恢复")
check(numpy.__dict__.get("bool") is original_numpy_bool, "真实生产导入未改动全局NumPy别名")
check(model["report"]["weightedVertices"] > 0, "导入后每顶点有实际蒙皮")
check(model["report"]["boneMap"] == model["boneMap"] and len(model["report"]["boneMap"]) == 16, "报告包含完整真实16骨映射")
source, _ = create_rig("测试源预演16骨", with_eyes=False, parented=False)
scene = bpy.context.scene
scene.frame_start, scene.frame_end = 1, 48
for frame in range(1, 49):
    scene.frame_set(frame)
    source.location = ((frame - 1) / 48, 0, 0)
    source.keyframe_insert("location", frame=frame)
    source.rotation_euler.z = .4 * (frame - 1) / 47
    source.keyframe_insert("rotation_euler", frame=frame)
    for bone in source.pose.bones:
        bone.rotation_mode = "QUATERNION"
        rest = bone.bone.matrix_local
        turn = math.radians(40) * (frame - 1) / 47 if bone.name == "upper_arm-1" else 0
        bone.matrix = Matrix.Translation(rest.translation) @ Matrix.Rotation(turn, 4, "X") @ rest.to_quaternion().to_matrix().to_4x4()
        for prop in ("location", "rotation_quaternion", "scale"):
            bone.keyframe_insert(prop, frame=frame)
module.retarget_from_source(source, model, 1, 48)
rig = model["rig"]
scene.frame_set(1)
before = positions(model["meshes"][0])
q1 = rig.pose.bones[model["boneMap"]["upper_arm-1"]].matrix.to_quaternion().copy()
scene.frame_set(48)
after = positions(model["meshes"][0])
q2 = rig.pose.bones[model["boneMap"]["upper_arm-1"]].matrix.to_quaternion().copy()
check(q1.rotation_difference(q2).angle > .6, "真实目标上臂旋转超过0.6弧度")
check(max((a - b).length for a, b in zip(before, after)) > .8, "真实目标蒙皮顶点随路径移动")
check(abs(rig.location.x - source.location.x) < 1e-6, "目标角色路径来自源rig")
for frame in (1, 8, 24, 48):
    scene.frame_set(frame)
    check(rig.matrix_world.to_quaternion().rotation_difference(source.matrix_world.to_quaternion()).angle < .00001,
          "角色世界转向烘焙正确：" + str(frame))
joint_gaps = {}
for side in ("-1", "1"):
    for parent, child in (("upper_arm", "forearm"), ("forearm", "hand"), ("upper_leg", "lower_leg"), ("lower_leg", "foot")):
        gap = (rig.pose.bones[parent + side].tail - rig.pose.bones[child + side].head).length
        joint_gaps[parent + side] = gap
        check(gap < .00001, "接头连续：" + parent + side)
for name in module.SEMANTIC_BONES:
    bone = rig.pose.bones[model["boneMap"][name]]
    check(abs(bone.length - bone.bone.length) < .00001, "保留目标骨长：" + name)
controller = {"eyeBones": {"left": "Eye.L", "right": "Eye.R"}, "expressions": {
    "calm": {"Relax": 1}, "tense": {"Tense": 1}, "surprised": {"Surprise": 1}}}
rejects(lambda: module.validate_performance_controller(model, {**controller, "eyeBones": {"left": "missing", "right": "Eye.R"}}), "眼骨不存在")
rejects(lambda: module.validate_performance_controller(model, {**controller, "expressions": {"calm": {"Relax": 0}, "tense": {"Tense": 1}, "surprised": {"Surprise": 1}}}), "全部为零")
module.validate_performance_controller(model, controller)
mesh = model["meshes"][0]
eye_group = mesh.vertex_groups["Eye.L"]
eye_weights = [(v.index, g.weight) for v in mesh.data.vertices for g in v.groups if g.group == eye_group.index]
eye_group.remove([index for index, _ in eye_weights])
rejects(lambda: module.validate_performance_controller(model, controller), "眼骨没有实际蒙皮顶点")
for index, weight in eye_weights:
    eye_group.add([index], weight, "REPLACE")
relax = mesh.data.shape_keys.key_blocks["Relax"]
relax_saved = [p.co.copy() for p in relax.data]
for p, basis in zip(relax.data, relax.relative_key.data):
    p.co = basis.co
rejects(lambda: module.validate_performance_controller(model, controller), "无实际变化")
for p, saved in zip(relax.data, relax_saved):
    p.co = saved
body_index = next(v.index for v in mesh.data.vertices if any(g.group == mesh.vertex_groups["pelvis"].index for g in v.groups))
relax.data[body_index].co.x += .1
rejects(lambda: module.validate_performance_controller(model, controller), "影响非头部顶点")
relax.data[body_index].co = relax_saved[body_index]
cues = [{"startSec": i * 2 / 3, "endSec": (i + 1) * 2 / 3, "gazeTarget": [3, 1, 1.8],
         "headYawDeg": 25, "headPitchDeg": 10, "breathAmplitude": .025, "breathHz": .5,
         "expression": expression, "intensity": .8} for i, expression in enumerate(module.EXPRESSION_LABELS)]
rejects(lambda: module.apply_performance(model, controller, [cues[0], cues[0]], 1, 48), "不重叠")
rejects(lambda: module.apply_performance(model, controller, [{**cues[0], "gazeTarget": [float("nan"), 0, 1]}], 1, 48), "视线目标必须")
base = {}
for frame in (8, 24, 40):
    scene.frame_set(frame)
    base[frame] = {"head": rig.pose.bones["head"].matrix.copy(), "eye": rig.pose.bones["Eye.L"].matrix.copy(),
                   "spine": rig.pose.bones["spine"].scale.copy(), "vertices": positions(model["meshes"][0])}
module.apply_performance(model, controller, cues, 1, 48)
samples = []
for frame, shape in ((8, "Relax"), (24, "Tense"), (40, "Surprise")):
    scene.frame_set(frame)
    bpy.context.view_layer.update()
    shape_value = model["meshes"][0].data.shape_keys.key_blocks[shape].value
    head_delta = base[frame]["head"].to_quaternion().rotation_difference(rig.pose.bones["head"].matrix.to_quaternion()).angle
    eye_delta = base[frame]["eye"].to_quaternion().rotation_difference(rig.pose.bones["Eye.L"].matrix.to_quaternion()).angle
    vertex_delta = max((a - b).length for a, b in zip(base[frame]["vertices"], positions(model["meshes"][0])))
    check(shape_value > .5, "真实表情关键帧非零：" + shape)
    check(head_delta > .1, "真实头骨旋转：" + shape)
    check(eye_delta > .05, "真实眼骨旋转：" + shape)
    check(vertex_delta > .01, "真实表演网格形变：" + shape)
    check((rig.pose.bones["neck"].tail - rig.pose.bones["head"].head).length < .00001, "表演头颈接头连续：" + shape)
    samples.append({"frame": frame, "shape": shape, "shapeValue": shape_value, "headDeltaRad": head_delta,
                    "eyeDeltaRad": eye_delta, "maxVertexDelta": vertex_delta})
scene.frame_set(8)
check(abs(rig.pose.bones["spine"].scale.x - base[8]["spine"].x) > .005, "真实呼吸控制改变胸部径向比例")
check(module.hashlib.sha256(path.read_bytes()).hexdigest() == meta["sha256"], "测试结束原GLB字节未覆盖")
check(scene.render.engine == "BLENDER_WORKBENCH", "重定向与表演结束仍保留WORKBENCH引擎")
saved_target = {"rig": rig.name, "meshes": [obj.name for obj in model["meshes"]],
                "shapeKeyNames": [obj.data.shape_keys.name for obj in model["meshes"]]}
shape_key_ownership = [{"key": key.name, "users": key.users,
                       "owner": key.user.name if key.user else None,
                       "ownerUsers": key.user.users if key.user else None,
                       "testFixture": key == fixture_mesh_data.shape_keys} for key in bpy.data.shape_keys]
print("SHAPE_KEY_OWNERSHIP_BEFORE_SAVE=" + json.dumps(shape_key_ownership, ensure_ascii=False))
check(fixture_mesh_data.users == 0 and all(obj.data != fixture_mesh_data for obj in model["meshes"]), "仅清理已知自造且零用户的源夹具网格")
fixture_key_name = fixture_mesh_data.shape_keys.name
check(fixture_mesh_data.shape_keys.user == fixture_mesh_data, "孤儿Key归属源夹具而非导入目标")
# 仅删除本测试创建且对象已移除的原始网格；不执行全局孤儿清理，不碰导入目标。
bpy.data.meshes.remove(fixture_mesh_data)
check(bpy.data.shape_keys.get(fixture_key_name) is None, "移除零用户源夹具后其孤儿Key同步释放")
bpy.ops.wm.save_as_mainfile(filepath=str(out / "TEST_ONLY-rigged-performance.blend"))
model_report = model["report"]
bpy.ops.wm.open_mainfile(filepath=str(out / "TEST_ONLY-rigged-performance.blend"))
check(bpy.context.scene.render.engine == "BLENDER_WORKBENCH", "保存并重新打开真实blend仍为WORKBENCH引擎")
restored_rig = bpy.data.objects.get(saved_target["rig"])
check(restored_rig is not None and restored_rig.type == "ARMATURE", "重开后实际目标骨架存在")
restored_meshes = [bpy.data.objects.get(name) for name in saved_target["meshes"]]
check(all(obj is not None and obj.type == "MESH" and len(obj.data.vertices) > 0 for obj in restored_meshes), "重开后全部实际目标网格非空")
check([obj.data.shape_keys.name for obj in restored_meshes] == saved_target["shapeKeyNames"], "重开后目标形态键数据块身份未丢失")
for eye in ("Eye.L", "Eye.R"):
    check(restored_rig.pose.bones.get(eye) is not None, "重开后真实眼骨存在：" + eye)
restored_samples = []
for frame, shape in ((8, "Relax"), (24, "Tense"), (40, "Surprise")):
    bpy.context.scene.frame_set(frame)
    bpy.context.view_layer.update()
    obj = restored_meshes[0]
    key = obj.data.shape_keys.key_blocks.get(shape)
    check(key is not None and len(key.data) == len(obj.data.vertices), "重开后目标表情数据非空：" + shape)
    check(max((a.co - b.co).length for a, b in zip(key.data, obj.data.shape_keys.key_blocks["Basis"].data)) > .001, "重开后目标表情形变量非零：" + shape)
    check(key.value > .5, "重开后目标表情对应帧仍非零：" + shape)
    actual_positions = positions(obj)
    vertex_delta = max((a - b).length for a, b in zip(base[frame]["vertices"], actual_positions))
    check(vertex_delta > .01 and all(math.isfinite(v) for point in actual_positions for v in point), "重开后真实表演网格仍形变且有限：" + shape)
    eye_delta = base[frame]["eye"].to_quaternion().rotation_difference(restored_rig.pose.bones["Eye.L"].matrix.to_quaternion()).angle
    check(eye_delta > .05, "重开后真实眼骨动作保留：" + shape)
    restored_samples.append({"frame": frame, "shape": shape, "value": key.value,
                             "maxVertexDelta": vertex_delta, "eyeDeltaRad": eye_delta})
report = {"testOnly": True, "blender": bpy.app.version_string, "checksPassed": len(checks), "checks": checks,
          "fixture": {"path": str(path), "generator": fixture_doc["asset"].get("generator"), "sourceSha256": meta["sha256"],
                      "originalSparseAccessors": sum("sparse" in item for item in fixture_doc["accessors"])},
          "model": model_report, "performanceSamples": samples,
          "savedRenderEngine": bpy.context.scene.render.engine,
          "shapeKeyOwnershipBeforeSave": shape_key_ownership, "restoredPerformanceSamples": restored_samples,
          "jointGaps": joint_gaps,
          "limits": ["自造测试模型，不等于用户角色验收", "未渲染视频", "未做双人接触/足底质量验收", "无生产UI/API/扣费调用"]}
(out / "rigged-model-test-receipt.json").write_text(json.dumps(report, ensure_ascii=False, indent=2))
print("RIGGED_MODEL_TEST_RESULT=" + json.dumps(report, ensure_ascii=False))
