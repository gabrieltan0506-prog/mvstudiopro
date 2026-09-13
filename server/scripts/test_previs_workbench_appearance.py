"""离线真实GLB/WORKBENCH基础色验收，不联网、不调用模型；输出仅TEST_ONLY。"""
import hashlib
import importlib.util
import json
import math
from pathlib import Path
import sys
import bpy
from mathutils import Vector


def load(name):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(name + ".py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


appearance = load("previs_workbench_appearance")
rigged = load("previs_rigged_model")
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


def image(name, color):
    img = bpy.data.images.new("TEST_ONLY_" + name, width=8, height=8, alpha=True)
    img.pixels = list(color) * 64
    img.pack()
    return img


def material(name, kind):
    mat = bpy.data.materials.new("TEST_ONLY_" + name)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    shader = nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = (.1, .6, .2, 1)
    shader.inputs["Metallic"].default_value = 0
    if kind in ("base-normal", "base", "alpha"):
        tex = nodes.new("ShaderNodeTexImage")
        tex.image = image(name + "_color", (.8, .05, .02, .5 if kind == "alpha" else 1))
        mat.node_tree.links.new(tex.outputs["Color"], shader.inputs["Base Color"])
        if kind == "alpha":
            mat.node_tree.links.new(tex.outputs["Alpha"], shader.inputs["Alpha"])
            if hasattr(mat, "surface_render_method"):
                mat.surface_render_method = "BLENDED"
            else:
                mat.blend_method = "BLEND"
    if kind in ("base-normal", "normal", "roughness", "emission"):
        tex = nodes.new("ShaderNodeTexImage")
        tex.image = image(name + "_data", (.5, .5, 1, 1))
        if kind == "emission":
            socket = shader.inputs.get("Emission Color") or shader.inputs.get("Emission")
            mat.node_tree.links.new(tex.outputs["Color"], socket)
        elif kind == "roughness":
            tex.image.colorspace_settings.is_data = True
            mat.node_tree.links.new(tex.outputs["Color"], shader.inputs["Roughness"])
        else:
            tex.image.colorspace_settings.is_data = True
            normal = nodes.new("ShaderNodeNormalMap")
            mat.node_tree.links.new(tex.outputs["Color"], normal.inputs["Color"])
            mat.node_tree.links.new(normal.outputs["Normal"], shader.inputs["Normal"])
        nodes.active = tex  # 刻意把错误候选设成active，基础色选择不能依赖此状态。
    return mat


bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)
data = bpy.data.armatures.new("TEST_ONLY_16骨")
rig = bpy.data.objects.new("TEST_ONLY_16骨", data)
bpy.context.collection.objects.link(rig)
bpy.context.view_layer.objects.active = rig
rig.select_set(True)
bpy.ops.object.mode_set(mode="EDIT")
for index, name in enumerate(rigged.SEMANTIC_BONES):
    bone = data.edit_bones.new(name)
    bone.head, bone.tail = (0, .05, .1 + index * .01), (0, .05, .2 + index * .01)
for child, parent in rigged.PARENTS.items():
    data.edit_bones[child].parent = data.edit_bones[parent]
bpy.ops.object.mode_set(mode="OBJECT")
kinds = ["base-normal", "normal", "roughness", "emission", "constant", "alpha"]
vertices, faces = [], []
for i in range(len(kinds)):
    x, z = i % 3, i // 3
    offset = len(vertices)
    vertices.extend([(x, 0, z), (x + .8, 0, z), (x + .8, 0, z + .8), (x, 0, z + .8)])
    faces.append(tuple(offset + j for j in range(4)))
mesh_data = bpy.data.meshes.new("TEST_ONLY_色块")
mesh_data.from_pydata(vertices, [], faces)
obj = bpy.data.objects.new("TEST_ONLY_色块", mesh_data)
bpy.context.collection.objects.link(obj)
obj.parent = rig
obj.vertex_groups.new(name="pelvis").add(list(range(len(vertices))), 1, "REPLACE")
modifier = obj.modifiers.new("TEST_ONLY_蒙皮", "ARMATURE")
modifier.object = rig
uv = mesh_data.uv_layers.new(name="UVMap")
for face in mesh_data.polygons:
    face.material_index = face.index
    for loop_index, point in zip(face.loop_indices, [(0, 0), (1, 0), (1, 1), (0, 1)]):
        uv.data[loop_index].uv = point
for kind in kinds:
    mesh_data.materials.append(material(kind, kind))
bpy.ops.object.select_all(action="DESELECT")
rig.select_set(True)
obj.select_set(True)
source = out / "TEST_ONLY-appearance.glb"
bpy.ops.export_scene.gltf(filepath=str(source), export_format="GLB", use_selection=True, export_animations=False)
source_sha = hashlib.sha256(source.read_bytes()).hexdigest()
bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)
model = rigged.import_rigged_model(source, "TEST_ONLY_IMPORTED", forward_axis="+X", target_height=1.8,
                                  expected_sha256=source_sha)
target = model["meshes"][0]
original_report = json.dumps(model["report"], sort_keys=True)
original_mats = list(target.data.materials)
check(len(original_mats) == len(kinds), "实际GLB重新导入保留六材质槽")


def snapshot():
    return [(m.name, m.use_nodes, len(m.node_tree.nodes), tuple(m.diffuse_color)) for m in original_mats]


before = snapshot()
# 使用真实共享网格和材质对象验证边界；只在TEST_ONLY场景创建/移除副本。
shared = target.copy()
shared.name = "TEST_ONLY_共享网格"
bpy.context.collection.objects.link(shared)
rejects(lambda: appearance.prepare_workbench_appearance(model), "范围外对象共享数据")
check(list(target.data.materials) == original_mats, "范围外共享网格在修改槽前拒绝")
shared_model = dict(model, meshes=[target, shared])
material_count_before = len(bpy.data.materials)
shared_report = appearance.prepare_workbench_appearance(shared_model)
shared_copies = list(target.data.materials)
check(len(bpy.data.materials) - material_count_before == len(original_mats), "范围内共享网格只创建一次材质副本")
check(list(shared.data.materials) == shared_copies and shared_report["materialCount"] == 6,
      "共享网格的两个消费者读取同一批预演材质")
for index, mat in enumerate(original_mats):
    target.data.materials[index] = mat
for mat in shared_copies:
    check(mat.users == 0, "TEST_ONLY共享网格副本恢复后无使用者")
    bpy.data.materials.remove(mat)
bpy.data.objects.remove(shared, do_unlink=True)
outside = target.copy()
outside.data = target.data.copy()
outside.name = "TEST_ONLY_共享原材质范围外对象"
bpy.context.collection.objects.link(outside)
# 在真实生产函数已替换第一组槽后注入一次异常，不改变生产代码或伪造容器。
fault_state = {"injected": False, "observedReplaced": False}
def rollback_fault(frame, event, arg):
    if (not fault_state["injected"] and event == "line" and
            frame.f_code.co_name == "prepare_workbench_appearance" and
            frame.f_code.co_filename == appearance.__file__ and
            frame.f_locals.get("previous") and list(target.data.materials) != original_mats):
        fault_state["observedReplaced"] = True
        fault_state["injected"] = True
        raise RuntimeError("TEST_ONLY_材质槽替换后受控异常")
    return rollback_fault
rollback_material_count = len(bpy.data.materials)
rollback_uv = (target.data.uv_layers.active_index, [layer.active_render for layer in target.data.uv_layers])
old_trace = sys.gettrace()
try:
    sys.settrace(rollback_fault)
    try:
        appearance.prepare_workbench_appearance(model)
    except RuntimeError as error:
        check(str(error) == "TEST_ONLY_材质槽替换后受控异常", "原受控异常保持身份继续上抛")
    else:
        raise AssertionError("替换槽后异常未注入")
finally:
    sys.settrace(old_trace)
check(fault_state["observedReplaced"], "异常确实发生在真实材质槽已开始替换之后")
check(list(target.data.materials) == original_mats, "异常后目标材质槽完整回滚")
check(rollback_uv == (target.data.uv_layers.active_index, [layer.active_render for layer in target.data.uv_layers]),
      "异常后原UV活动状态恢复")
check(len(bpy.data.materials) == rollback_material_count, "异常后新建预演材质均清理无泄漏")
check(list(outside.data.materials) == original_mats and snapshot() == before,
      "共享原材质的范围外对象在异常时不受污染")
# 负例在真实导入节点上变异并恢复，不用假输入绕过基础色消费者。
base_mat = next(m for m in original_mats if "base-normal" in m.name)
shader = next(n for n in base_mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
base_socket = shader.inputs["Base Color"]
base_link = base_socket.links[0]
base_node = base_link.from_node
base_mat.node_tree.links.remove(base_link)
multiply = base_mat.node_tree.nodes.new("ShaderNodeMixRGB")
multiply.blend_type = "MULTIPLY"
multiply.inputs[0].default_value = 1
multiply.inputs[2].default_value = (.5, .5, .5, 1)
base_mat.node_tree.links.new(base_node.outputs["Color"], multiply.inputs[1])
base_mat.node_tree.links.new(multiply.outputs["Color"], base_socket)
rejects(lambda: appearance.prepare_workbench_appearance(model), "乘数、顶点色")
check(list(target.data.materials) == original_mats, "不支持乘数在接槽前失败")
base_mat.node_tree.nodes.remove(multiply)
base_mat.node_tree.links.new(base_node.outputs["Color"], base_socket)
vcolor = base_mat.node_tree.nodes.new("ShaderNodeVertexColor")
base_mat.node_tree.links.new(vcolor.outputs["Color"], base_socket)
rejects(lambda: appearance.prepare_workbench_appearance(model), "乘数、顶点色")
base_mat.node_tree.nodes.remove(vcolor)
base_mat.node_tree.links.new(base_node.outputs["Color"], base_socket)
mapping = base_mat.node_tree.nodes.new("ShaderNodeMapping")
base_mat.node_tree.links.new(mapping.outputs["Vector"], base_node.inputs["Vector"])
rejects(lambda: appearance.prepare_workbench_appearance(model), "复杂UV")
base_mat.node_tree.nodes.remove(mapping)
uvmap = base_mat.node_tree.nodes.new("ShaderNodeUVMap")
uvmap.uv_map = "missing"
base_mat.node_tree.links.new(uvmap.outputs["UV"], base_node.inputs["Vector"])
rejects(lambda: appearance.prepare_workbench_appearance(model), "UV在目标网格不存在")
second_uv = target.data.uv_layers.new(name="UV_SECOND")
uvmap.uv_map = second_uv.name
rejects(lambda: appearance.prepare_workbench_appearance(model), "不同UV")
base_mat.node_tree.nodes.remove(uvmap)
# 两个真实基础色材质共同指定UV1时应成功；完成后恢复原槽继续验证默认UV0。
explicit_uv_nodes = []
for mat in original_mats:
    pbr = next(node for node in mat.node_tree.nodes if node.type == "BSDF_PRINCIPLED")
    if pbr.inputs["Base Color"].is_linked:
        tex = pbr.inputs["Base Color"].links[0].from_node
        uv_node = mat.node_tree.nodes.new("ShaderNodeUVMap")
        uv_node.uv_map = second_uv.name
        mat.node_tree.links.new(uv_node.outputs["UV"], tex.inputs["Vector"])
        explicit_uv_nodes.append((mat, uv_node))
explicit_report = appearance.prepare_workbench_appearance(model)
check(target.data.uv_layers.active_index == 1 and second_uv.active_render,
      "合法显式UV1实际成为WORKBENCH活动及渲染UV")
check(all(item["uv"] == second_uv.name for item in explicit_report["materials"] if item["kind"] == "texture"),
      "显式UV1来源写入独立外观报告")
explicit_copies = list(target.data.materials)
for index, mat in enumerate(original_mats):
    target.data.materials[index] = mat
for mat, uv_node in explicit_uv_nodes:
    mat.node_tree.nodes.remove(uv_node)
for mat in explicit_copies:
    check(mat.users == 0, "TEST_ONLY显式UV副本恢复后无使用者")
    bpy.data.materials.remove(mat)
target.data.uv_layers.active_index = 1

# 范围外旧白模使用无节点纯色材质，在同场TEXTURE下应保持原色。
bpy.ops.mesh.primitive_plane_add(size=.6, location=(3.5, 0, .4), rotation=(math.pi / 2, 0, 0))
legacy = bpy.context.object
legacy.name = "TEST_ONLY_旧白模"
legacy_mat = bpy.data.materials.new("TEST_ONLY_旧白模材质")
legacy_mat.use_nodes = False
legacy_mat.diffuse_color = (.1, .25, .7, 1)
legacy.data.materials.append(legacy_mat)
legacy_state = (legacy_mat.use_nodes, tuple(legacy_mat.diffuse_color),
                tuple(node.type for node in legacy_mat.node_tree.nodes) if legacy_mat.node_tree else ())
report = appearance.prepare_workbench_appearance(model)
check(report["textureMaterialCount"] == 2, "只有基础色和透明基础色两槽启用贴图")
check(report["qualityAccepted"] is False and "透明度" in report["boundaryZh"], "透明度近似和非质量验收边界显式保留")
check(json.dumps(model["report"], sort_keys=True) == original_report, "不改严格model.report")
check(snapshot() == before, "原材质及其节点数量未被预演覆盖")
check(list(outside.data.materials) == original_mats, "成功转换亦不污染范围外共享原材质对象")
outside.hide_render = True
check(legacy.data.materials[0] == legacy_mat and legacy_state ==
      (legacy_mat.use_nodes, tuple(legacy_mat.diffuse_color), tuple(node.type for node in legacy_mat.node_tree.nodes) if legacy_mat.node_tree else ()), "范围外旧白模材质不变")
check(target.data.uv_layers.active_index == 0 and target.data.uv_layers[0].active_render, "基础色使用真实UV0而非旧active UV1")
for source_mat, preview in zip(original_mats, target.data.materials):
    expected = "base-normal" in source_mat.name or "alpha" in source_mat.name
    check(preview != source_mat, "目标槽使用独立材质副本：" + source_mat.name)
    if expected:
        active = preview.node_tree.nodes.active
        check(active is not None and active.type == "TEX_IMAGE" and "_color" in active.image.name,
              "明确选择基础色而非法线图：" + source_mat.name)
        check(len(preview.node_tree.nodes) == 1 and active.image.packed_file is not None, "副本只有已内嵌基础色图片")
    else:
        check(all(n.type != "TEX_IMAGE" for n in preview.node_tree.nodes),
              "非基础色图片不能回选：" + source_mat.name)
        check(max(abs(a - b) for a, b in zip(preview.diffuse_color, (.1, .6, .2, 1))) < 1e-5,
              "纯色factor精确保留：" + source_mat.name)

scene = bpy.context.scene
scene.render.engine = "BLENDER_WORKBENCH"
scene.display.shading.light = "FLAT"
scene.display.shading.color_type = "TEXTURE"
scene.display.shading.show_shadows = False
scene.display.shading.show_cavity = False
scene.render.resolution_x, scene.render.resolution_y, scene.render.resolution_percentage = 480, 320, 100
scene.render.image_settings.file_format = "PNG"
scene.view_settings.view_transform = "Standard"
scene.view_settings.look = "Medium High Contrast" if bpy.app.version[:2] == (3, 4) else "None"
camera_data = bpy.data.cameras.new("TEST_ONLY_CAMERA")
camera = bpy.data.objects.new("TEST_ONLY_CAMERA", camera_data)
bpy.context.collection.objects.link(camera)
camera.location = (1.7, -10, 1)
camera.rotation_euler = (Vector((1.7, 0, 1)) - camera.location).to_track_quat("-Z", "Y").to_euler()
camera_data.type, camera_data.ortho_scale = "ORTHO", 4.8
scene.camera = camera
target_name, legacy_name = target.name, legacy.name
bpy.ops.wm.save_as_mainfile(filepath=str(out / "TEST_ONLY-appearance.blend"))
bpy.ops.wm.open_mainfile(filepath=str(out / "TEST_ONLY-appearance.blend"))
scene = bpy.context.scene
target = bpy.data.objects[target_name]
legacy = bpy.data.objects[legacy_name]
for mat in target.data.materials:
    if mat.node_tree and mat.node_tree.nodes.active and mat.node_tree.nodes.active.type == "TEX_IMAGE":
        active = mat.node_tree.nodes.active
        check(active.image.packed_file is not None and len(active.image.pixels) > 0 and active.image.has_data and "_color" in active.image.name,
              "重开后基础色图片内嵌且可解码")
check(scene.render.engine == "BLENDER_WORKBENCH", "保存重开不改变WORKBENCH")
scene.render.filepath = str(out / "TEST_ONLY-texture.png")
bpy.ops.render.render(write_still=True)
texture_pixels = list(bpy.data.images.load(str(out / "TEST_ONLY-texture.png"), check_existing=False).pixels)
# 各材质区域按真实网格面中心投影核色，不能只检查选中的图片节点。
from bpy_extras.object_utils import world_to_camera_view
pixel_checks = []
for index, mat in enumerate(target.data.materials):
    faces = [face for face in target.data.polygons if face.material_index == index]
    center = target.matrix_world @ (sum((face.center for face in faces), Vector()) / len(faces))
    point = world_to_camera_view(scene, scene.camera, center)
    px, py = int(point.x * 480), int(point.y * 320)
    color = texture_pixels[(py * 480 + px) * 4:(py * 480 + px) * 4 + 3]
    is_base = "base-normal" in mat.name or "alpha" in mat.name
    check((color[0] > color[1] + .15) if is_base else (color[1] > color[2] + .15),
          "真实像素使用基础色或factor，非数据图：" + mat.name)
    pixel_checks.append({"material": mat.name, "pixel": [px, py], "rgb": color})
scene.display.shading.color_type = "MATERIAL"
scene.render.filepath = str(out / "TEST_ONLY-material.png")
bpy.ops.render.render(write_still=True)
material_pixels = list(bpy.data.images.load(str(out / "TEST_ONLY-material.png"), check_existing=False).pixels)
check(len(texture_pixels) == 480 * 320 * 4 and len(material_pixels) == len(texture_pixels), "真实两张非空渲染")
# 旧白模所在像素从世界位置投影，比较同一对象在两模式下像素相同。
point = world_to_camera_view(scene, scene.camera, legacy.matrix_world.translation)
x, y = int(point.x * 480), int(point.y * 320)
offset = (y * 480 + x) * 4
check(max(abs(a - b) for a, b in zip(texture_pixels[offset:offset + 4], material_pixels[offset:offset + 4])) < 1e-6,
      "同场旧白模TEXTURE与MATERIAL像素一致")
check(texture_pixels[offset + 2] > texture_pixels[offset] + .1, "比较像素来自真实蓝色旧白模")
check(any(abs(a - b) > .1 for a, b in zip(texture_pixels, material_pixels)), "基础色图片确实改变最终渲染而非空接线")
check(hashlib.sha256(source.read_bytes()).hexdigest() == source_sha, "源GLB字节未修改")
# UV选择必须影响真实采样；新导入同一TEST_ONLY源，双色非均匀图片左右两半对应UV0/UV1。
uv_model = rigged.import_rigged_model(source, "TEST_ONLY_UV_PIXELS", forward_axis="+X", target_height=1.8,
                                     expected_sha256=source_sha)
uv_target = uv_model["meshes"][0]
for candidate in bpy.data.objects:
    if candidate.type == "MESH":
        candidate.hide_render = candidate != uv_target
uv_first = uv_target.data.uv_layers[0]
uv_second = uv_target.data.uv_layers.new(name="TEST_ONLY_UV1双色")
for loop in uv_first.data:
    loop.uv = (.25, .5)
for loop in uv_second.data:
    loop.uv = (.75, .5)
two_color = image("非均匀双色", (1, 0, 0, 1))
two_color.pixels = [value for row in range(8) for col in range(8)
                    for value in ((1, 0, 0, 1) if col < 4 else (0, 0, 1, 1))]
two_color.pack()
for mat in uv_target.data.materials:
    pbr = next(node for node in mat.node_tree.nodes if node.type == "BSDF_PRINCIPLED")
    if pbr.inputs["Base Color"].is_linked:
        tex = pbr.inputs["Base Color"].links[0].from_node
        tex.image = two_color
        uv_node = mat.node_tree.nodes.new("ShaderNodeUVMap")
        uv_node.uv_map = uv_second.name
        mat.node_tree.links.new(uv_node.outputs["UV"], tex.inputs["Vector"])
appearance.prepare_workbench_appearance(uv_model)
scene.display.shading.color_type = "TEXTURE"
uv_pixels = {}
sample = next(item["pixel"] for item in pixel_checks if "base-normal" in item["material"])
for label, layer in [("UV1", uv_second), ("UV0", uv_first)]:
    if label == "UV1":
        check(uv_target.data.uv_layers.active.name == layer.name and layer.active_render,
              "UV1渲染直接使用生产转换选定状态，测试不重新指定UV")
    else:
        uv_target.data.uv_layers.active_index = uv_target.data.uv_layers.find(layer.name)
        layer.active_render = True
        uv_target.data.update()
    scene.render.filepath = str(out / ("TEST_ONLY-" + label + "-two-color.png"))
    bpy.ops.render.render(write_still=True)
    actual = list(bpy.data.images.load(scene.render.filepath, check_existing=False).pixels)
    start = (sample[1] * 480 + sample[0]) * 4
    uv_pixels[label] = actual[start:start + 3]
check(uv_pixels["UV1"][2] > .8 and uv_pixels["UV1"][0] < .1, "真实UV1采样非均匀双色图右半蓝色")
check(uv_pixels["UV0"][0] > .8 and uv_pixels["UV0"][2] < .1, "同一材质切UV0实际采样左半红色")
check(hashlib.sha256(source.read_bytes()).hexdigest() == source_sha, "UV像素测试不改变源GLB文件")
legacy_fixture_result = {"tested": False}
if "--legacy-fixture" in sys.argv:
    old_source = Path(sys.argv[sys.argv.index("--legacy-fixture") + 1])
    if not old_source.is_file() or not old_source.name.startswith("TEST_ONLY-"):
        raise ValueError("既有夹具必须明确TEST_ONLY且已存在")
    old_sha = hashlib.sha256(old_source.read_bytes()).hexdigest()
    old_model = rigged.import_rigged_model(old_source, "TEST_ONLY_NO_MATERIAL", forward_axis="+X",
                                          target_height=1.7, expected_sha256=old_sha)
    check(all(not obj.material_slots for obj in old_model["meshes"]), "真实既有带骨GLB确实无材质槽")
    old_report = appearance.prepare_workbench_appearance(old_model)
    check(old_report["materialCount"] == 0 and old_report["textureMaterialCount"] == 0,
          "既有合法无材质角色不被拒绝也不造假材质")
    check(all(not obj.material_slots for obj in old_model["meshes"]), "既有无槽角色保留原默认灰白路径")
    old_model["meshes"][0].data.materials.append(None)
    empty_report = appearance.prepare_workbench_appearance(old_model)
    check(old_model["meshes"][0].data.materials[0] is None and empty_report["defaultMaterialSlots"] > 0,
          "合法空槽保持缺省材质而非当非法节点")
    check(hashlib.sha256(old_source.read_bytes()).hexdigest() == old_sha, "既有夹具GLB原字节未改")
    legacy_fixture_result = {"tested": True, "path": str(old_source), "sha256": old_sha, "report": old_report}
public_result = {"tested": False}
if "--public-core" in sys.argv:
    public_source = Path(sys.argv[sys.argv.index("--public-core") + 1])
    public_sha = hashlib.sha256(public_source.read_bytes()).hexdigest()
    mapping = {"pelvis": "J_Bip_C_Hips", "spine": "J_Bip_C_Spine", "neck": "J_Bip_C_Neck", "head": "J_Bip_C_Head"}
    for side, letter in [("-1", "R"), ("1", "L")]:
        for semantic, actual in [("upper_arm", "UpperArm"), ("forearm", "LowerArm"), ("hand", "Hand"),
                                 ("upper_leg", "UpperLeg"), ("lower_leg", "LowerLeg"), ("foot", "Foot")]:
            mapping[semantic + side] = "J_Bip_" + letter + "_" + actual
    public_model = rigged.import_rigged_model(public_source, "TEST_ONLY_PUBLIC", mapping, "-Y", 1.7, public_sha)
    public_report_before = json.dumps(public_model["report"], sort_keys=True)
    public_report = appearance.prepare_workbench_appearance(public_model)
    check(public_report["textureMaterialCount"] == 13, "公开core的13个BLEND基础色材质真实消费")
    check(json.dumps(public_model["report"], sort_keys=True) == public_report_before, "公开core严格模型报告不被外观函数修改")
    check(hashlib.sha256(public_source.read_bytes()).hexdigest() == public_sha, "公开core源文件SHA不变")
    public_result = {"tested": True, "path": str(public_source), "sha256": public_sha, "report": public_report}
result = {"testOnly": True, "blender": bpy.app.version_string, "checksPassed": len(checks), "checks": checks,
          "appearance": report, "sourceSha256": source_sha, "legacyPixel": [x, y],
          "materialPixels": pixel_checks, "uvPixels": uv_pixels, "legacyFixture": legacy_fixture_result, "publicCore": public_result,
          "limits": ["独立受控夹具非用户角色", "透明度近似，非完整PBR", "未调用付费模型，不验证正式用户入口"]}
(out / "appearance-receipt.json").write_text(json.dumps(result, ensure_ascii=False, indent=2))
print("APPEARANCE_TEST_RESULT=" + json.dumps(result, ensure_ascii=False))
