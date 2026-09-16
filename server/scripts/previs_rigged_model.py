"""带骨角色的受控导入、严格映射与重定向。仅由服务器侧载的本地 GLB 调用。

本模块不联网、不解析用户 Python、不载入 blend、不自动给无骨模型绑骨。
inspect_glb 可用普通 Python；其余函数须在 Blender 后台进程中运行。
"""
import hashlib
from contextlib import contextmanager
import json
import math
from pathlib import Path
import struct

MAX_GLB_BYTES = 64 * 1024 * 1024
MAX_JSON_BYTES = 16 * 1024 * 1024
MAX_VERTICES = 250_000
# 0916 低模绑骨：原模只做检查与权重转移目标，允许更大预算（Tripo 标准档 74 万顶点）
SOURCE_MAX_VERTICES = 2_000_000
MAX_ACCESSOR_COMPONENTS = 8_000_000
MAX_IMAGE_PIXELS = 16_777_216
MAX_TOTAL_IMAGE_PIXELS = 33_554_432
SEMANTIC_BONES = (
    "pelvis", "spine", "neck", "head",
    "upper_arm-1", "forearm-1", "hand-1",
    "upper_arm1", "forearm1", "hand1",
    "upper_leg-1", "lower_leg-1", "foot-1",
    "upper_leg1", "lower_leg1", "foot1",
)
# -1/1 对应当前预演器的右/左侧；其它命名必须由用户明确映射。
ALIASES = {
    "pelvis": ("pelvis", "hips"), "spine": ("spine", "spine2", "chest"),
    "neck": ("neck",), "head": ("head",),
    "upper_arm-1": ("upper_arm-1", "rightarm"),
    "forearm-1": ("forearm-1", "rightforearm"), "hand-1": ("hand-1", "righthand"),
    "upper_arm1": ("upper_arm1", "leftarm"),
    "forearm1": ("forearm1", "leftforearm"), "hand1": ("hand1", "lefthand"),
    "upper_leg-1": ("upper_leg-1", "rightupleg"),
    "lower_leg-1": ("lower_leg-1", "rightleg"), "foot-1": ("foot-1", "rightfoot"),
    "upper_leg1": ("upper_leg1", "leftupleg"),
    "lower_leg1": ("lower_leg1", "leftleg"), "foot1": ("foot1", "leftfoot"),
}
PARENTS = {"spine": "pelvis", "neck": "spine", "head": "neck"}
for _side in ("-1", "1"):
    PARENTS.update({"upper_arm" + _side: "spine", "forearm" + _side: "upper_arm" + _side,
                    "hand" + _side: "forearm" + _side, "upper_leg" + _side: "pelvis",
                    "lower_leg" + _side: "upper_leg" + _side, "foot" + _side: "lower_leg" + _side})
EXPRESSION_LABELS = {"calm": "平静", "tense": "紧张", "surprised": "惊讶"}


def _finite(value, low, high, label):
    if isinstance(value, bool) or not isinstance(value, (float, int)) or not math.isfinite(value) or not low <= value <= high:
        raise ValueError("%s必须在%s至%s之间" % (label, low, high))
    return float(value)


def _integer(value, low, high, label):
    if type(value) is not int or not low <= value <= high:
        raise ValueError(label + "索引或整数边界无效")
    return value


def _image_dimensions(data, mime):
    """只读图片头与容器边界，不解压图片；拒绝未知格式和动画纹理。"""
    if mime == "image/png":
        if len(data) < 33 or data[:8] != b"\x89PNG\r\n\x1a\n":
            raise ValueError("内嵌PNG头无效")
        cursor, dimensions, ended, has_data = 8, None, False, False
        while cursor < len(data):
            if cursor + 12 > len(data):
                raise ValueError("内嵌PNG分块截断")
            length = struct.unpack_from(">I", data, cursor)[0]
            kind = data[cursor + 4:cursor + 8]
            if cursor + 12 + length > len(data) or kind in (b"acTL", b"fcTL", b"fdAT"):
                raise ValueError("内嵌PNG分块无效或为动画")
            import zlib
            if zlib.crc32(data[cursor + 4:cursor + 8 + length]) != struct.unpack_from(">I", data, cursor + 8 + length)[0]:
                raise ValueError("内嵌PNG校验和无效")
            if kind == b"IHDR":
                if cursor != 8 or dimensions is not None or length != 13:
                    raise ValueError("内嵌PNG尺寸头无效")
                dimensions = struct.unpack_from(">II", data, cursor + 8)
            elif dimensions is None:
                raise ValueError("内嵌PNG缺少尺寸头")
            if kind == b"IDAT" and length:
                has_data = True
            cursor += 12 + length
            if kind == b"IEND":
                if length or cursor != len(data):
                    raise ValueError("内嵌PNG结尾无效")
                ended = True
                break
        if not ended or not has_data:
            raise ValueError("内嵌PNG不完整")
        return dimensions
    if mime == "image/jpeg":
        if len(data) < 4 or data[:2] != b"\xff\xd8" or data[-2:] != b"\xff\xd9":
            raise ValueError("内嵌JPEG头尾无效")
        cursor, dimensions, scanning, scan_has_data, component_count = 2, None, False, False, 0
        while cursor < len(data) - 2:
            if scanning:
                # 熵编码里的FF00为转义字节，RST为重启标记；其它标记仍须完整检查。
                next_marker = data.find(b"\xff", cursor)
                if next_marker < 0 or next_marker + 1 >= len(data):
                    raise ValueError("内嵌JPEG扫描截断")
                scan_has_data = scan_has_data or next_marker > cursor
                cursor = next_marker
            if data[cursor] != 255:
                raise ValueError("内嵌JPEG标记无效")
            while cursor < len(data) and data[cursor] == 255:
                cursor += 1
            if cursor >= len(data):
                raise ValueError("内嵌JPEG截断")
            marker = data[cursor]
            cursor += 1
            if scanning and (marker == 0 or 0xD0 <= marker <= 0xD7):
                if marker == 0:
                    scan_has_data = True
                continue
            if scanning and not scan_has_data:
                raise ValueError("内嵌JPEG扫描数据为空")
            if marker == 0xD9:
                if cursor != len(data):
                    raise ValueError("内嵌JPEG结尾重复")
                break
            if cursor + 2 > len(data):
                raise ValueError("内嵌JPEG截断")
            length = struct.unpack_from(">H", data, cursor)[0]
            if length < 2 or cursor + length > len(data):
                raise ValueError("内嵌JPEG分块截断")
            if marker in (0xC0, 0xC2):
                if dimensions is not None or length < 8 or data[cursor + 2] != 8:
                    raise ValueError("内嵌JPEG尺寸头无效")
                height, width = struct.unpack_from(">HH", data, cursor + 3)
                component_count = data[cursor + 7]
                if component_count not in (1, 3, 4) or length != 8 + 3 * component_count:
                    raise ValueError("内嵌JPEG颜色分量头无效")
                dimensions = (width, height)
            elif 0xC0 <= marker <= 0xCF and marker not in (0xC4,):
                raise ValueError("内嵌JPEG编码不支持")
            if marker == 0xDA:
                if dimensions is None:
                    raise ValueError("内嵌JPEG缺少尺寸头")
                if length < 8 or not 1 <= data[cursor + 2] <= component_count or length != 6 + 2 * data[cursor + 2]:
                    raise ValueError("内嵌JPEG扫描头无效")
                scanning, scan_has_data = True, False
            cursor += length
        if not scanning or not scan_has_data or dimensions is None:
            raise ValueError("内嵌JPEG缺少扫描数据")
        return dimensions
    raise ValueError("内嵌图片仅支持PNG/JPEG，压缩扩展格式关闭")


def _validate_resources(doc, binary, *, unrigged=False, max_vertices=None):
    """所有元数据、解码规模和实际索引/蒙皮值须先通过，之后才允许调用Blender。"""
    limit_vertices = max_vertices or MAX_VERTICES
    limit_components = MAX_ACCESSOR_COMPONENTS * limit_vertices // MAX_VERTICES
    arrays = {name: doc.get(name, []) for name in ("buffers", "bufferViews", "accessors", "nodes", "meshes", "skins", "images", "textures", "materials", "samplers", "scenes", "animations")}
    for name, rows in arrays.items():
        if not isinstance(rows, list) or len(rows) > 4096 or any(not isinstance(row, dict) for row in rows):
            raise ValueError("GLB数组结构无效：" + name)
    # 不把声明可选当作安全：包括未在extensionsUsed声明的嵌套扩展，一律关闭。
    pending = [(doc, 0)]
    while pending:
        item, depth = pending.pop()
        if depth > 48:
            raise ValueError("GLB元数据嵌套过深")
        if isinstance(item, dict):
            if item.get("extensions") or item.get("extensionsUsed") or item.get("extensionsRequired"):
                raise ValueError("角色GLB扩展当前全部关闭，禁止压缩或未知扩展")
            pending.extend((value, depth + 1) for value in item.values())
        elif isinstance(item, list):
            pending.extend((value, depth + 1) for value in item)
        elif isinstance(item, float) and not math.isfinite(item):
            raise ValueError("GLB含非有限数字")
    if arrays["animations"]:
        raise ValueError("当前带骨导入只接受无内嵌动画的静态蒙皮资产")
    buffers, views, accessors = (arrays[name] for name in ("buffers", "bufferViews", "accessors"))
    for row in buffers + arrays["images"]:
        if "uri" in row:
            raise ValueError("角色GLB必须内嵌所有资源，不能引用外链或本机文件")
    if len(buffers) != 1 or not binary:
        raise ValueError("GLB必须含单个非空内嵌二进制缓冲")
    declared = _integer(buffers[0].get("byteLength"), 1, len(binary), "buffer长度")
    if len(binary) - declared > 3:
        raise ValueError("GLB二进制长度与声明不符")
    for view in views:
        if type(view.get("buffer")) is not int or view["buffer"] != 0:
            raise ValueError("bufferView引用无效buffer")
        offset = _integer(view.get("byteOffset", 0), 0, declared, "bufferView偏移")
        length = _integer(view.get("byteLength"), 1, declared, "bufferView长度")
        if offset + length > declared:
            raise ValueError("bufferView越过二进制边界")
        if "byteStride" in view:
            stride = _integer(view["byteStride"], 4, 252, "bufferView步长")
            if stride % 4:
                raise ValueError("bufferView步长未对齐")
        if "target" in view and view["target"] not in (34962, 34963):
            raise ValueError("bufferView target无效")
    types = {5120: ("b", 1), 5121: ("B", 1), 5122: ("h", 2), 5123: ("H", 2), 5125: ("I", 4), 5126: ("f", 4)}
    widths = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}
    layouts, budget = [], 0
    def layout(view_index, offset, count, width, component, sparse=False):
        view = views[_integer(view_index, 0, len(views) - 1, "bufferView")]
        code, size = types[component]
        step = view.get("byteStride", width * size)
        offset = _integer(offset, 0, view["byteLength"], "accessor偏移")
        if offset % size or (view.get("byteOffset", 0) + offset) % size or step < width * size or step % size:
            raise ValueError("accessor步长或对齐无效")
        if sparse and "byteStride" in view:
            raise ValueError("sparse缓冲不允许步长")
        if offset + (count - 1) * step + width * size > view["byteLength"]:
            raise ValueError("accessor越过bufferView边界")
        return (view.get("byteOffset", 0) + offset, step, "<" + code * width)
    def values(where, count):
        start, step, fmt = where
        for i in range(count):
            yield struct.unpack_from(fmt, binary, start + i * step)
    for accessor in accessors:
        component, kind = accessor.get("componentType"), accessor.get("type")
        if type(component) is not int or component not in types or kind not in widths or (kind == "MAT4" and component != 5126):
            raise ValueError("accessor分量类型不支持")
        count = _integer(accessor.get("count"), 1, limit_vertices * 6, "accessor数量")
        width = widths[kind]
        budget += count * width
        if budget > limit_components:
            raise ValueError("accessor展开总分量超过预算")
        if type(accessor.get("normalized", False)) is not bool or (accessor.get("normalized") and component not in (5120, 5121, 5122, 5123)):
            raise ValueError("accessor归一化类型无效")
        dense = layout(accessor["bufferView"], accessor.get("byteOffset", 0), count, width, component) if "bufferView" in accessor else None
        if dense is None and accessor.get("byteOffset", 0) != 0:
            raise ValueError("无基础缓冲的accessor偏移必须为零")
        sparse_values = {}
        if "sparse" in accessor:
            sparse = accessor["sparse"]
            if not isinstance(sparse, dict) or not isinstance(sparse.get("indices"), dict) or not isinstance(sparse.get("values"), dict):
                raise ValueError("sparse结构无效")
            n = _integer(sparse.get("count"), 1, count, "sparse数量")
            indices, data = sparse["indices"], sparse["values"]
            ct = indices.get("componentType")
            if type(ct) is not int or ct not in (5121, 5123, 5125):
                raise ValueError("sparse索引类型无效")
            il = layout(indices.get("bufferView"), indices.get("byteOffset", 0), n, 1, ct, True)
            vl = layout(data.get("bufferView"), data.get("byteOffset", 0), n, width, component, True)
            previous = -1
            for (index,), value in zip(values(il, n), values(vl, n)):
                if not previous < index < count:
                    raise ValueError("sparse索引越界或未严格递增")
                sparse_values[index], previous = value, index
        if dense is None and not sparse_values:
            raise ValueError("accessor没有真实数据")
        for value in list(accessor.get("min", [])) + list(accessor.get("max", [])):
            if type(value) not in (int, float) or not math.isfinite(value):
                raise ValueError("accessor极值无效")
        if any(len(accessor[key]) != width for key in ("min", "max") if key in accessor):
            raise ValueError("accessor极值维度无效")
        if component == 5126:
            for row in (values(dense, count) if dense else ()):
                if any(not math.isfinite(v) or abs(v) > 1e6 for v in row):
                    raise ValueError("accessor含非有限或超界浮点值")
            if any(not math.isfinite(v) or abs(v) > 1e6 for row in sparse_values.values() for v in row):
                raise ValueError("sparse含非有限或超界浮点值")
        layouts.append((dense, sparse_values))
    def rows(index, kind=None, components=None, count=None):
        index = _integer(index, 0, len(accessors) - 1, "accessor")
        accessor = accessors[index]
        if (kind and accessor["type"] not in kind) or (components and accessor["componentType"] not in components) or (count is not None and accessor["count"] != count):
            raise ValueError("accessor语义类型或数量不一致")
        dense, sparse = layouts[index]
        base = values(dense, accessor["count"]) if dense else ((0,) * widths[accessor["type"]] for _ in range(accessor["count"]))
        return (sparse.get(i, value) for i, value in enumerate(base))
    skins, nodes, meshes = arrays["skins"], arrays["nodes"], arrays["meshes"]
    if unrigged and skins:
        raise ValueError("绑骨准备只接受无骨模型，请直接使用已有带骨模型")
    if not unrigged and (len(skins) != 1 or not skins[0].get("joints")):
        raise ValueError("必须提供单套已蒙皮骨架；无骨模型不能直接重定向")
    joints = [] if unrigged else skins[0]["joints"]
    if not isinstance(joints, list) or not (0 if unrigged else 1) <= len(joints) <= 256 or any(type(i) is not int or not 0 <= i < len(nodes) for i in joints) or len(set(joints)) != len(joints):
        raise ValueError("角色关节索引无效")
    if skins and "inverseBindMatrices" in skins[0]:
        for matrix in rows(skins[0]["inverseBindMatrices"], {"MAT4"}, {5126}, len(joints)):
            if any(abs(matrix[i]) > 1e-6 for i in (3, 7, 11)) or abs(matrix[15] - 1) > 1e-6:
                raise ValueError("inverseBindMatrices必须为仿射矩阵")
    if skins and "skeleton" in skins[0]:
        _integer(skins[0]["skeleton"], 0, len(nodes) - 1, "骨架根节点")
    mesh_counts, mesh_components, mesh_indices, morph_names = [], [], [], []
    for mesh in meshes:
        primitives = mesh.get("primitives")
        if not isinstance(primitives, list) or not 1 <= len(primitives) <= 128:
            raise ValueError("角色网格分片数无效")
        vertex_count, target_count, decoded_count, index_count = 0, None, 0, 0
        for primitive in primitives:
            if not isinstance(primitive, dict) or primitive.get("mode", 4) != 4:
                raise ValueError("仅支持三角形网格")
            attrs = primitive.get("attributes", {})
            required = {"POSITION"} if unrigged else {"POSITION", "JOINTS_0", "WEIGHTS_0"}
            if not isinstance(attrs, dict) or not required.issubset(attrs):
                raise ValueError("每个角色网格必须包含真实顶点与蒙皮权重")
            if unrigged and (set(attrs) & {"JOINTS_0", "WEIGHTS_0"} or primitive.get("targets")):
                raise ValueError("绑骨准备不接受已有权重或形变")
            pi = _integer(attrs["POSITION"], 0, len(accessors) - 1, "POSITION accessor")
            count = accessors[pi]["count"]
            vertex_count += count
            for name, index in attrs.items():
                spec = {"POSITION": ({"VEC3"}, {5126}), "NORMAL": ({"VEC3"}, {5126}), "TANGENT": ({"VEC4"}, {5126}),
                        "JOINTS_0": ({"VEC4"}, {5121, 5123}), "WEIGHTS_0": ({"VEC4"}, {5126, 5121, 5123}),
                        "TEXCOORD_0": ({"VEC2"}, {5126, 5121, 5123}), "TEXCOORD_1": ({"VEC2"}, {5126, 5121, 5123}), "COLOR_0": ({"VEC3", "VEC4"}, {5126, 5121, 5123})}.get(name)
                if spec is None:
                    raise ValueError("未支持的顶点属性：" + name)
                rows(index, *spec, count)
                decoded_count += count * widths[accessors[index]["type"]]
                normalized = accessors[index].get("normalized", False)
                if name == "JOINTS_0" and normalized or name != "JOINTS_0" and accessors[index]["componentType"] != 5126 and not normalized:
                    raise ValueError("顶点属性归一化契约无效")
            for joint_row, weight_row in (zip(rows(attrs["JOINTS_0"]), rows(attrs["WEIGHTS_0"])) if not unrigged else ()):
                divisor = {5121: 255, 5123: 65535, 5126: 1}[accessors[attrs["WEIGHTS_0"]]["componentType"]]
                weights = [v / divisor for v in weight_row]
                if any(not 0 <= j < len(joints) for j in joint_row):
                    raise ValueError("JOINTS实际索引越界")
                if any(not 0 <= w <= 1 for w in weights) or not .98 <= sum(weights) <= 1.02:
                    raise ValueError("WEIGHTS实际蒙皮权重为空或无效")
            if "indices" in primitive:
                index = _integer(primitive["indices"], 0, len(accessors) - 1, "indices accessor")
                if accessors[index]["count"] % 3 or accessors[index].get("normalized", False):
                    raise ValueError("三角形indices数量或归一化无效")
                if any(i >= count for (i,) in rows(index, {"SCALAR"}, {5121, 5123, 5125})):
                    raise ValueError("三角形实际indices越界")
                index_count += accessors[index]["count"]
                decoded_count += accessors[index]["count"]
            elif count % 3:
                raise ValueError("无索引三角形顶点数无效")
            else:
                index_count += count
            targets = primitive.get("targets", [])
            if not isinstance(targets, list) or len(targets) > 64 or target_count is not None and target_count != len(targets):
                raise ValueError("morph数量无效或分片不一致")
            target_count = len(targets)
            for target in targets:
                if not isinstance(target, dict) or not target or set(target) - {"POSITION", "NORMAL", "TANGENT"}:
                    raise ValueError("morph属性无效")
                for index in target.values():
                    rows(index, {"VEC3"}, {5126}, count)
                    decoded_count += count * 3
            if decoded_count > limit_components or index_count > limit_vertices * 6:
                raise ValueError("网格实例展开分量或indices超过预算")
            if "material" in primitive:
                _integer(primitive["material"], 0, len(arrays["materials"]) - 1, "material")
        names = mesh.get("extras", {}).get("targetNames", [])
        if names and (len(names) != target_count or any(not isinstance(n, str) or not n for n in names) or len(set(names)) != len(names)):
            raise ValueError("morph名称无效")
        morph_names.extend(names)
        if "weights" in mesh and (not isinstance(mesh["weights"], list) or len(mesh["weights"]) != target_count or any(type(v) not in (int, float) or not math.isfinite(v) or abs(v) > 1 for v in mesh["weights"])):
            raise ValueError("morph默认权重数量无效")
        mesh_counts.append(vertex_count)
        mesh_components.append(decoded_count)
        mesh_indices.append(index_count)
    if not meshes or len(meshes) > 64 or not nodes or len(nodes) > 2048:
        raise ValueError("角色节点或网格数量超限")
    parents, total, reachable = {}, 0, set()
    instance_components, instance_indices, used_meshes = 0, 0, set()
    for index, node in enumerate(nodes):
        if "name" in node and (not isinstance(node["name"], str) or len(node["name"]) > 256):
            raise ValueError("节点名称无效")
        if "matrix" in node and set(node) & {"translation", "rotation", "scale"}:
            raise ValueError("节点matrix不能与TRS并用")
        for field, width in (("matrix", 16), ("translation", 3), ("rotation", 4), ("scale", 3)):
            if field in node and (not isinstance(node[field], list) or len(node[field]) != width or any(type(v) not in (int, float) or not math.isfinite(v) or abs(v) > 1e6 for v in node[field])):
                raise ValueError("节点变换无效")
        if "rotation" in node and abs(sum(v * v for v in node["rotation"]) - 1) > .001:
            raise ValueError("节点四元数必须为单位旋转，不能为零")
        if "matrix" in node and (any(abs(node["matrix"][i]) > 1e-6 for i in (3, 7, 11)) or abs(node["matrix"][15] - 1) > 1e-6):
            raise ValueError("节点matrix必须为仿射矩阵")
        children = node.get("children", [])
        if not isinstance(children, list):
            raise ValueError("节点children无效")
        for child in children:
            _integer(child, 0, len(nodes) - 1, "子节点")
            if child in parents:
                raise ValueError("节点多父级或重复引用")
            parents[child] = index
        if "mesh" in node:
            mi = _integer(node["mesh"], 0, len(meshes) - 1, "mesh")
            if (unrigged and "skin" in node) or (not unrigged and (type(node.get("skin")) is not int or node["skin"] != 0)):
                raise ValueError("实例网格缺少真实skin")
            total += mesh_counts[mi]
            instance_components += mesh_components[mi]
            instance_indices += mesh_indices[mi]
            used_meshes.add(mi)
            if "weights" in node:
                expected = len(meshes[mi]["primitives"][0].get("targets", []))
                if not isinstance(node["weights"], list) or len(node["weights"]) != expected or any(type(v) not in (int, float) or not math.isfinite(v) or abs(v) > 1 for v in node["weights"]):
                    raise ValueError("节点morph权重无效")
        elif "skin" in node:
            raise ValueError("skin节点缺少网格")
    for start in range(len(nodes)):
        chain, cursor = set(), start
        while cursor in parents:
            if cursor in chain or len(chain) > 128:
                raise ValueError("节点存在环或层级超过128")
            chain.add(cursor)
            cursor = parents[cursor]
    def ancestors(index):
        chain = [index]
        while index in parents:
            index = parents[index]
            chain.append(index)
        return chain
    common = set(ancestors(joints[0])) if joints else set()
    for joint in joints[1:]:
        common.intersection_update(ancestors(joint))
    if joints and not common:
        raise ValueError("skin所有joints必须有共同根节点")
    if skins and "skeleton" in skins[0] and skins[0]["skeleton"] not in common:
        raise ValueError("skin.skeleton必须是全部joints的共同祖先")
    # 不能只验局部TRS：合法的逐层scale也能在父链中相乘溢出。
    world_matrices = {}
    def local_matrix(node):
        if "matrix" in node:
            return [[node["matrix"][c * 4 + r] for c in range(4)] for r in range(4)]
        x, y, z, w = node.get("rotation", (0, 0, 0, 1))
        scale = node.get("scale", (1, 1, 1))
        translation = node.get("translation", (0, 0, 0))
        rotation = [[1 - 2 * (y*y + z*z), 2 * (x*y - z*w), 2 * (x*z + y*w)],
                    [2 * (x*y + z*w), 1 - 2 * (x*x + z*z), 2 * (y*z - x*w)],
                    [2 * (x*z - y*w), 2 * (y*z + x*w), 1 - 2 * (x*x + y*y)]]
        return [[rotation[r][c] * scale[c] for c in range(3)] + [translation[r]] for r in range(3)] + [[0, 0, 0, 1]]
    for index in range(len(nodes)):
        for current in reversed(ancestors(index)):
            if current in world_matrices:
                continue
            matrix = local_matrix(nodes[current])
            if current in parents:
                parent = world_matrices[parents[current]]
                matrix = [[sum(parent[r][k] * matrix[k][c] for k in range(4)) for c in range(4)] for r in range(4)]
            if any(not math.isfinite(value) or abs(value) > 1e6 for row in matrix for value in row):
                raise ValueError("节点合成世界变换超过有限数值预算")
            world_matrices[current] = matrix
    if not 0 < total <= limit_vertices:
        raise ValueError("实例总顶点超过预算或为空（实例总顶点 %d，预算 %d，网格数 %d）" % (total, limit_vertices, len(meshes)))
    if instance_components > limit_components or instance_indices > limit_vertices * 6:
        raise ValueError("实例展开分量或indices超过预算")
    if len(used_meshes) != len(meshes):
        raise ValueError("存在未实例化网格")
    joint_names = [nodes[index].get("name", "") for index in joints]
    if any(not name for name in joint_names) or len(set(joint_names)) != len(joint_names):
        raise ValueError("骨骼名称缺失或重复")
    scenes = arrays["scenes"]
    if len(scenes) != 1:
        raise ValueError("角色只支持单场景")
    _integer(doc.get("scene", 0), 0, 0, "scene")
    roots = scenes[0].get("nodes", [])
    if not isinstance(roots, list) or not roots:
        raise ValueError("场景根节点为空")
    for root in roots:
        _integer(root, 0, len(nodes) - 1, "scene根节点")
        if root in parents or root in reachable:
            raise ValueError("场景根节点重复或已有父级")
        stack = [root]
        while stack:
            current = stack.pop()
            reachable.add(current)
            stack.extend(nodes[current].get("children", []))
    if len(reachable) != len(nodes):
        raise ValueError("存在场景外孤立节点")
    pixels = 0
    for image in arrays["images"]:
        vi = _integer(image.get("bufferView"), 0, len(views) - 1, "image bufferView")
        view = views[vi]
        if "byteStride" in view:
            raise ValueError("图片bufferView不能有步长")
        begin = view.get("byteOffset", 0)
        width, height = _image_dimensions(binary[begin:begin + view["byteLength"]], image.get("mimeType"))
        if not 0 < width <= 4096 or not 0 < height <= 4096 or width * height > MAX_IMAGE_PIXELS:
            raise ValueError("内嵌图片像素超过4096边长或单图预算")
        pixels += width * height
        if pixels > MAX_TOTAL_IMAGE_PIXELS:
            raise ValueError("内嵌图片总像素超过预算")
    for texture in arrays["textures"]:
        _integer(texture.get("source"), 0, len(arrays["images"]) - 1, "texture source")
        if "sampler" in texture:
            _integer(texture["sampler"], 0, len(arrays["samplers"]) - 1, "texture sampler")
    for material in arrays["materials"]:
        entries = [material.get(name) for name in ("normalTexture", "occlusionTexture", "emissiveTexture")]
        pbr = material.get("pbrMetallicRoughness", {})
        if not isinstance(pbr, dict):
            raise ValueError("材质PBR结构无效")
        entries.extend(pbr.get(name) for name in ("baseColorTexture", "metallicRoughnessTexture"))
        for entry in entries:
            if entry is not None:
                if not isinstance(entry, dict):
                    raise ValueError("材质纹理结构无效")
                _integer(entry.get("index"), 0, len(arrays["textures"]) - 1, "材质texture")
                _integer(entry.get("texCoord", 0), 0, 1, "材质texCoord")
    return {"vertices": total, "meshVertices": sum(mesh_counts), "accessorComponents": budget,
            "instanceComponents": instance_components, "instanceIndices": instance_indices,
            "imagePixels": pixels, "morphNames": sorted(set(morph_names))}


def inspect_glb(path, expected_sha256=None, *, unrigged=False, max_vertices=None):
    """读取 GLB 元数据；在导入器触碰它前禁止外链和不受支持的压缩/脚本扩展。"""
    source = Path(path)
    size = source.stat().st_size
    if size < 20 or size > MAX_GLB_BYTES:
        raise ValueError("角色GLB大小无效或超过64MB")
    with source.open("rb") as handle:
        raw = handle.read(MAX_GLB_BYTES + 1)
    if len(raw) != size or len(raw) > MAX_GLB_BYTES:
        raise ValueError("角色GLB读取长度变化或超过64MB")
    if struct.unpack_from("<4sII", raw) != (b"glTF", 2, size):
        raise ValueError("角色文件必须为完整GLB2")
    digest = hashlib.sha256(raw).hexdigest()
    if expected_sha256 is not None and digest != expected_sha256:
        raise ValueError("角色GLB与已授权版本SHA不一致")
    offset, doc, seen_bin, binary = 12, None, False, None
    while offset < size:
        if offset + 8 > size:
            raise ValueError("GLB分块头截断")
        length, kind = struct.unpack_from("<II", raw, offset)
        offset += 8
        if length % 4 or offset + length > size:
            raise ValueError("GLB分块长度无效")
        chunk = raw[offset:offset + length]
        if kind == 0x4E4F534A:
            if doc is not None or offset != 20 or length > MAX_JSON_BYTES:
                raise ValueError("GLB JSON分块重复、过大或不在首位")
            def unique_object(pairs):
                result = {}
                for key, value in pairs:
                    if key in result:
                        raise ValueError("GLB含重复JSON字段")
                    result[key] = value
                return result
            try:
                doc = json.loads(chunk.decode("utf8"), object_pairs_hook=unique_object,
                                 parse_constant=lambda _: (_ for _ in ()).throw(ValueError("GLB含非有限数字")))
            except (RecursionError, UnicodeDecodeError) as error:
                raise ValueError("GLB JSON编码或嵌套深度无效") from error
        elif kind == 0x004E4942:
            if doc is None or seen_bin:
                raise ValueError("GLB二进制块顺序或数量无效")
            seen_bin = True
            binary = chunk
        else:
            raise ValueError("角色GLB含不支持的分块")
        offset += length
    if not isinstance(doc, dict) or not isinstance(doc.get("asset"), dict) or doc["asset"].get("version") != "2.0":
        raise ValueError("角色GLB元数据无效")
    try:
        resources = _validate_resources(doc, binary, unrigged=unrigged, max_vertices=max_vertices)
    except (TypeError, KeyError, AttributeError, OverflowError, RecursionError) as error:
        raise ValueError("GLB资源元数据结构无效") from error
    return {"sha256": digest, "bytes": size, **resources, "meshes": len(doc["meshes"]),
            "jointNames": [] if unrigged else [doc["nodes"][i].get("name", "") for i in doc["skins"][0]["joints"]]}


def resolve_bone_map(names, explicit=None):
    """只匹配精确规范名或 Mixamo 别名；歧义、缺失、重复目标一律拒绝。"""
    explicit = explicit or {}
    if not isinstance(explicit, dict) or set(explicit) - set(SEMANTIC_BONES):
        raise ValueError("骨骼映射含未知语义")
    names = list(names)
    if len(set(names)) != len(names):
        raise ValueError("角色存在重复骨骼名")
    result = {}
    for semantic in SEMANTIC_BONES:
        if semantic in explicit:
            candidates = [explicit[semantic]] if explicit[semantic] in names else []
        elif semantic in names:
            candidates = [semantic]
        else:
            candidates = [name for name in names if name.lower().removeprefix("mixamorig:") in ALIASES[semantic]]
        if len(candidates) != 1:
            raise ValueError("请明确映射骨骼%s：匹配到%d个候选" % (semantic, len(candidates)))
        result[semantic] = candidates[0]
    if len(set(result.values())) != len(SEMANTIC_BONES):
        raise ValueError("不同语义不能指向同一根骨骼")
    return result


def _bpy():
    import bpy
    return bpy


@contextmanager
def _legacy_numpy_bool_scope(numpy_module, mesh_module):
    """仅替换旧glTF网格模块的np引用；不修改全局NumPy或系统插件文件。"""
    if "bool" in numpy_module.__dict__:
        yield
        return
    if mesh_module.np is not numpy_module:
        raise ValueError("旧glTF网格模块NumPy引用异常，停止导入")
    class LegacyNumpyView:
        def __getattr__(self, name):
            return numpy_module.bool_ if name == "bool" else getattr(numpy_module, name)
    original = mesh_module.np
    mesh_module.np = LegacyNumpyView()
    try:
        yield
    finally:
        mesh_module.np = original


def _import_gltf_asset(bpy, local_path):
    """隔离glTF插件副作用：保持调用者引擎，并兼容3.4旧NumPy别名。"""
    scene = bpy.context.scene
    render_engine = scene.render.engine
    try:
        if tuple(bpy.app.version[:2]) == (3, 4):
            import numpy
            from io_scene_gltf2.blender.imp import gltf2_blender_mesh
            # 仅包围真实导入，成功/异常均恢复；不改变着色模式绕过法线读取。
            with _legacy_numpy_bool_scope(numpy, gltf2_blender_mesh):
                return bpy.ops.import_scene.gltf(filepath=str(local_path), import_pack_images=True)
        return bpy.ops.import_scene.gltf(filepath=str(local_path), import_pack_images=True)
    finally:
        # 旧插件会强制切到EEVEE；任何版本都恢复原场景，不依赖导入后的活动上下文。
        scene.render.engine = render_engine


def _validate_hierarchy(rig, mapping):
    for child, parent in PARENTS.items():
        bone = rig.data.bones[mapping[child]].parent
        while bone and bone.name != mapping[parent]:
            bone = bone.parent
        if bone is None:
            raise ValueError("骨架层级不匹配：%s必须位于%s之下" % (child, parent))
    for name in mapping.values():
        if rig.data.bones[name].length < 0.00001:
            raise ValueError("角色含零长度骨骼")


def import_rigged_model(local_path, actor_id, bone_map=None, forward_axis="-Y", target_height=1.7,
                        expected_sha256=None):
    """导入已授权GLB并规范为+X朝向/Z朝上，严格保留实际蒙皮，不创建假骨。"""
    from mathutils import Matrix, Vector
    bpy = _bpy()
    inspection = inspect_glb(local_path, expected_sha256)
    if forward_axis not in ("+X", "-X", "+Y", "-Y"):
        raise ValueError("角色前向必须为+X/-X/+Y/-Y")
    target_height = _finite(target_height, 0.5, 3.0, "角色高度")
    before = set(bpy.data.objects)
    try:
        _import_gltf_asset(bpy, local_path)
        # glTF导入器会创建骨骼显示辅助体；只排除真正被custom_shape引用的对象，不按名字猜。
        objects = [o for o in bpy.context.scene.objects if o not in before]
        rigs = [o for o in objects if o.type == "ARMATURE"]
        helpers = {b.custom_shape for r in rigs for b in r.pose.bones if b.custom_shape}
        objects = [o for o in objects if o not in helpers]
        meshes = [o for o in objects if o.type == "MESH"]
        if len(rigs) != 1 or not meshes:
            raise ValueError("导入结果必须为单套骨架及非空蒙皮网格")
        rig = rigs[0]
        mapping = resolve_bone_map(rig.data.bones.keys(), bone_map)
        _validate_hierarchy(rig, mapping)
        if sum(len(o.data.vertices) for o in meshes) > MAX_VERTICES:
            raise ValueError("导入后顶点数超过250000")
        for obj in objects:
            if obj.type not in ("MESH", "ARMATURE", "EMPTY"):
                raise ValueError("角色文件不得携带相机、灯光或其它场景对象")
            obj.animation_data_clear()
            if obj.type == "MESH" and obj.data.shape_keys:
                obj.data.shape_keys.animation_data_clear()
                for key in list(obj.data.shape_keys.key_blocks)[1:]:
                    key.value = 0
        for obj in meshes:
            if not any(m.type == "ARMATURE" and m.object == rig for m in obj.modifiers):
                raise ValueError("角色含未连接主骨架的网格")
            deform = {g.index for g in obj.vertex_groups if g.name in rig.data.bones and rig.data.bones[g.name].use_deform}
            if any(not any(g.group in deform and math.isfinite(g.weight) and g.weight > 0 for g in v.groups) for v in obj.data.vertices):
                raise ValueError("角色含没有实际蒙皮权重的顶点")
        # 去父级后保存世界变换；统一变换同时应用网格和骨架，避免双重缩放。
        worlds = {o: o.matrix_world.copy() for o in objects}
        for obj in objects:
            obj.parent = None
            obj.matrix_world = worlds[obj]
        rotate = Matrix.Rotation({"+X": 0, "-X": math.pi, "+Y": -math.pi / 2, "-Y": math.pi / 2}[forward_axis], 4, "Z")
        bounds = [rotate @ obj.matrix_world @ Vector(corner) for obj in meshes for corner in obj.bound_box]
        minimum, maximum = min(v.z for v in bounds), max(v.z for v in bounds)
        if maximum - minimum < 0.00001:
            raise ValueError("角色高度为空")
        scale = target_height / (maximum - minimum)
        pelvis = rotate @ rig.matrix_world @ rig.data.bones[mapping["pelvis"]].head_local
        correction = Matrix.Translation((-pelvis.x * scale, -pelvis.y * scale, -minimum * scale)) @ Matrix.Scale(scale, 4) @ rotate
        for obj in objects:
            obj.matrix_world = correction @ worlds[obj]
        bpy.ops.object.select_all(action="DESELECT")
        for obj in [rig] + meshes:
            obj.select_set(True)
        bpy.context.view_layer.objects.active = rig
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
        # 网格父级用于随actor路径整体移动；世界坐标在绑定时保持原值。
        for obj in meshes:
            world = obj.matrix_world.copy()
            obj.parent = rig
            obj.matrix_world = world
        rig.name = str(actor_id) + "_角色骨架"
        bpy.context.view_layer.update()
        return {"rig": rig, "meshes": meshes, "objects": objects, "boneMap": mapping,
                "inspection": inspection, "restMatrices": {b.name: b.matrix_local.copy() for b in rig.data.bones},
                "report": {**inspection, "mappedBones": len(mapping), "boneMap": dict(mapping), "forwardAxis": forward_axis,
                           "targetHeight": target_height, "weightedVertices": sum(len(o.data.vertices) for o in meshes)}}
    except Exception:
        for obj in list(bpy.data.objects):
            if obj not in before:
                bpy.data.objects.remove(obj, do_unlink=True)
        raise


def retarget_from_source(source_rig, model, frame_start, frame_end):
    """逐帧烘焙旋转到真实骨架，保目标骨长和层级；不是逐点复制拉断关节。

    源/目标都已规范到+X前向。不同身材只保证旋转/路径跟随，不承诺足底接触或双人接触位置。
    调用者必须把此边界显示在验收回执，不得用源白模接触误差冒充角色网格误差。
    """
    from mathutils import Matrix
    bpy = _bpy()
    if type(frame_start) is not int or type(frame_end) is not int or not 1 <= frame_start <= frame_end <= 720:
        raise ValueError("角色重定向帧范围须为1至720")
    if any(name not in source_rig.pose.bones for name in SEMANTIC_BONES):
        raise ValueError("源预演骨架缺少16骨语义")
    rig, mapping = model["rig"], model["boneMap"]
    inverse_map = {target: semantic for semantic, target in mapping.items()}
    ordered = sorted(rig.pose.bones, key=lambda bone: len(bone.parent_recursive))
    source_rest = {name: source_rig.data.bones[name].matrix_local.copy() for name in SEMANTIC_BONES}
    target_rest = model["restMatrices"]
    source_pelvis = source_rest["pelvis"].translation
    target_pelvis = target_rest[mapping["pelvis"]].translation
    source_height = max(b.tail_local.z for b in source_rig.data.bones) - min(b.head_local.z for b in source_rig.data.bones)
    target_height = max(b.tail_local.z for b in rig.data.bones) - min(b.head_local.z for b in rig.data.bones)
    ratio = target_height / max(source_height, .00001)
    for frame in range(frame_start, frame_end + 1):
        bpy.context.scene.frame_set(frame)
        rig.rotation_mode = "QUATERNION"
        rig.matrix_world = source_rig.matrix_world.copy()
        for prop in ("location", "rotation_quaternion", "scale"):
            rig.keyframe_insert(prop, frame=frame)
        solved = {}
        for bone in ordered:
            rest = target_rest[bone.name]
            base = solved[bone.parent.name] @ target_rest[bone.parent.name].inverted() @ rest if bone.parent else rest.copy()
            semantic = inverse_map.get(bone.name)
            if semantic:
                source = source_rig.pose.bones[semantic].matrix.copy()
                rotation = source.to_quaternion() @ source_rest[semantic].to_quaternion().inverted() @ rest.to_quaternion()
                location = base.translation.copy()
                if semantic == "pelvis":
                    location = target_pelvis + (source.translation - source_pelvis) * ratio
                base = Matrix.Translation(location) @ rotation.to_matrix().to_4x4()
            bone.rotation_mode = "QUATERNION"
            # 显式用本帧已求出的父骨矩阵反解basis，不能依赖Blender上一帧的懒更新父姿态。
            parent_args = {"parent_matrix": solved[bone.parent.name], "parent_matrix_local": target_rest[bone.parent.name]} if bone.parent else {}
            bone.matrix_basis = bone.bone.convert_local_to_pose(base, rest, invert=True, **parent_args)
            solved[bone.name] = base
            for prop in ("location", "rotation_quaternion", "scale"):
                bone.keyframe_insert(prop, frame=frame)
        bpy.context.view_layer.update()
    model["report"].update({"retargetFrames": frame_end - frame_start + 1,
                            "retargetMode": "rest-corrected-rotation-preserve-target-lengths",
                            "contactValidated": False})
    return model["report"]


def validate_performance_controller(model, controller):
    """控制器必须有真实眼骨、头颈以及三组非零形变；不存在时绝不制造替身。"""
    if not isinstance(controller, dict) or set(controller) != {"eyeBones", "expressions"}:
        raise ValueError("表演控制器须明确提供eyeBones及三种expressions")
    eyes, expressions = controller["eyeBones"], controller["expressions"]
    if not isinstance(eyes, dict) or set(eyes) != {"left", "right"} or len(set(eyes.values())) != 2:
        raise ValueError("表演控制器须提供不同的左右眼骨")
    rig = model["rig"]
    for name in eyes.values():
        if name not in rig.pose.bones or name in model["boneMap"].values():
            raise ValueError("眼骨不存在或错误占用身体骨骼")
        if model["boneMap"]["head"] not in [b.name for b in rig.data.bones[name].parent_recursive]:
            raise ValueError("眼骨必须属于头部层级")
        if not any(name in obj.vertex_groups and any(
                g.group == obj.vertex_groups[name].index and g.weight > .01
                for vertex in obj.data.vertices for g in vertex.groups) for obj in model["meshes"]):
            raise ValueError("眼骨没有实际蒙皮顶点，不能作为视线控制器")
    if not isinstance(expressions, dict) or set(expressions) != set(EXPRESSION_LABELS):
        raise ValueError("必须映射平静、紧张、惊讶三种表情")
    shape_keys = {}
    facial_bones = {b.name for b in rig.data.bones if b.name == model["boneMap"]["head"] or
                    model["boneMap"]["head"] in [p.name for p in b.parent_recursive]}
    for obj in model["meshes"]:
        if not obj.data.shape_keys:
            continue
        for key in list(obj.data.shape_keys.key_blocks)[1:]:
            if key.name in shape_keys:
                raise ValueError("表情形变名跨网格重复，请先合并或重命名")
            changed = [i for i, (a, b) in enumerate(zip(key.data, key.relative_key.data)) if (a.co - b.co).length > .000001]
            facial_groups = {g.index for g in obj.vertex_groups if g.name in facial_bones}
            if changed and all(any(g.group in facial_groups and g.weight > .01 for g in obj.data.vertices[i].groups) for i in changed):
                shape_keys[key.name] = key
    fingerprints = []
    for name in EXPRESSION_LABELS:
        values = expressions[name]
        if not isinstance(values, dict) or not values or len(values) > 16:
            raise ValueError("每种表情必须映射1至16个实际形变")
        fingerprint = []
        for key, value in values.items():
            _finite(value, 0, 1, "表情权重")
            if key not in shape_keys:
                raise ValueError("表情形变%s不存在、无实际变化或影响非头部顶点" % key)
            fingerprint.append((key, value))
        if not any(value > 0 for value in values.values()):
            raise ValueError("表情映射不能全部为零")
        fingerprints.append(tuple(sorted(fingerprint)))
    if len(set(fingerprints)) != 3:
        raise ValueError("三种表情不能使用完全相同的控制值")
    return {"eyes": eyes, "expressions": expressions, "shapeKeys": shape_keys}


def apply_performance(model, controller, cues, frame_start, frame_end, fps=24):
    """在已经重定向的基础帧上叠加有界头颈、眼神、呼吸和真实形变表演。"""
    from mathutils import Matrix, Vector
    bpy = _bpy()
    control = validate_performance_controller(model, controller)
    if type(frame_start) is not int or type(frame_end) is not int or not 1 <= frame_start <= frame_end <= 720 or fps != 24:
        raise ValueError("表演帧范围须为1至720、帧率固定24")
    if not isinstance(cues, list) or not cues or len(cues) > 24:
        raise ValueError("表演轨必须包含1至24段")
    previous_end = -1
    for cue in cues:
        if not isinstance(cue, dict) or set(cue) - {"startSec", "endSec", "gazeTarget", "headYawDeg", "headPitchDeg", "breathAmplitude", "breathHz", "expression", "intensity"}:
            raise ValueError("表演轨含未知字段")
        start = _finite(cue.get("startSec"), 0, frame_end / fps, "表演起点")
        end = _finite(cue.get("endSec"), 0, frame_end / fps, "表演终点")
        if end <= start or start < previous_end:
            raise ValueError("表演轨必须按时间排列且不重叠")
        previous_end = end
        target = cue.get("gazeTarget")
        if not isinstance(target, (list, tuple)) or len(target) != 3:
            raise ValueError("视线必须有三维目标点")
        for value in target:
            _finite(value, -30, 30, "视线目标")
        _finite(cue.get("headYawDeg", 0), -35, 35, "转头角")
        _finite(cue.get("headPitchDeg", 0), -20, 20, "俯仰角")
        _finite(cue.get("breathAmplitude", .01), 0, .03, "呼吸幅度")
        _finite(cue.get("breathHz", .25), .1, .6, "呼吸频率")
        _finite(cue.get("intensity", 1), 0, 1, "表情强度")
        if cue.get("expression") not in EXPRESSION_LABELS:
            raise ValueError("未知表情语义")
    rig = model["rig"]
    # 先捕获全部基线再写关键帧，避免前一帧叠加污染后一帧。
    bases = {}
    for frame in range(frame_start, frame_end + 1):
        bpy.context.scene.frame_set(frame)
        bases[frame] = {b.name: b.matrix.copy() for b in rig.pose.bones}
    ordered = sorted(rig.pose.bones, key=lambda bone: len(bone.parent_recursive))
    for frame in range(frame_start, frame_end + 1):
        bpy.context.scene.frame_set(frame)
        time = (frame - 1) / fps
        cue = next((c for c in cues if c["startSec"] <= time < c["endSec"]), None)
        for key in control["shapeKeys"].values():
            key.value = 0
        envelope, yaw, pitch, amount = 0., 0., 0., 0.
        if cue:
            u = (time - cue["startSec"]) / (cue["endSec"] - cue["startSec"])
            envelope = min(1., u / .15, (1 - u) / .15)
            # 在规范后的骨架坐标系施加旋转，不假定每根骨骼的局部轴相同。
            yaw, pitch = math.radians(cue.get("headYawDeg", 0)) * envelope, math.radians(cue.get("headPitchDeg", 0)) * envelope
            amount = cue.get("breathAmplitude", .01) * math.sin(2 * math.pi * cue.get("breathHz", .25) * time) * envelope
            for name, value in control["expressions"][cue["expression"]].items():
                control["shapeKeys"][name].value = value * cue.get("intensity", 1) * envelope
        solved = {}
        for bone in ordered:
            base = bases[frame][bone.name].copy()
            if bone.parent:
                base = solved[bone.parent.name] @ bases[frame][bone.parent.name].inverted() @ base
            portion = .35 if bone.name == model["boneMap"]["neck"] else .65 if bone.name == model["boneMap"]["head"] else 0
            if portion:
                rotation = Matrix.Rotation(yaw * portion, 4, "Z") @ Matrix.Rotation(pitch * portion, 4, "Y")
                base = Matrix.Translation(base.translation) @ rotation @ base.to_quaternion().to_matrix().to_4x4() @ Matrix.Diagonal((*base.to_scale(), 1))
            if bone.name == model["boneMap"]["spine"]:
                base = base @ Matrix.Diagonal((1 + amount, 1, 1 + amount, 1))
            if cue and bone.name in control["eyes"].values():
                target = rig.matrix_world.inverted() @ Vector(cue["gazeTarget"])
                direction = target - base.translation
                if direction.length < .00001:
                    raise ValueError("视线目标不能与眼睛位置重合")
                eyaw = max(-.45, min(.45, math.atan2(direction.y, direction.x))) * envelope
                epitch = max(-.3, min(.3, -math.atan2(direction.z, math.hypot(direction.x, direction.y)))) * envelope
                base = Matrix.Translation(base.translation) @ Matrix.Rotation(eyaw, 4, "Z") @ Matrix.Rotation(epitch, 4, "Y") @ bases[frame][bone.name].to_quaternion().to_matrix().to_4x4()
            parent_args = {"parent_matrix": solved[bone.parent.name], "parent_matrix_local": model["restMatrices"][bone.parent.name]} if bone.parent else {}
            bone.rotation_mode = "QUATERNION"
            bone.matrix_basis = bone.bone.convert_local_to_pose(base, model["restMatrices"][bone.name], invert=True, **parent_args)
            solved[bone.name] = base
            for prop in ("location", "rotation_quaternion", "scale"):
                bone.keyframe_insert(prop, frame=frame)
        for key in control["shapeKeys"].values():
            key.keyframe_insert("value", frame=frame)
    model["report"]["performance"] = {"frames": frame_end - frame_start + 1, "eyeBones": list(control["eyes"].values()),
                                      "expressions": list(EXPRESSION_LABELS), "cueCount": len(cues),
                                      "qualityAccepted": False}
    return model["report"]
