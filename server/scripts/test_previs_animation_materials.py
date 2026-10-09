"""真实 Blender 内存数据回归：不渲染、不导出媒体、不读用户素材。"""
import json
from pathlib import Path
import sys
import bpy

sys.path.insert(0, str(Path(__file__).resolve().parent))
from previs_animation_materials import SOURCE_MATERIAL_KEY, SOURCE_UV_KEY, restore_animation_materials
from previs_workbench_appearance import prepare_workbench_appearance

checks = []


def check(condition, label):
    if not condition:
        raise AssertionError(label)
    checks.append(label)


def rejects(fn, text):
    try:
        fn()
    except ValueError as error:
        check(text in str(error), text)
    else:
        raise AssertionError("应拒绝：" + text)


rig = bpy.data.objects.new("TEST_ONLY_rig", bpy.data.armatures.new("TEST_ONLY_rig"))
mesh = bpy.data.meshes.new("TEST_ONLY_mesh")
mesh.from_pydata([(0, 0, 0), (1, 0, 0), (0, 1, 0)], [], [(0, 1, 2)])
obj = bpy.data.objects.new("TEST_ONLY_actor", mesh)
modifier = obj.modifiers.new("TEST_ONLY_skin", "ARMATURE")
modifier.object = rig
uv0 = mesh.uv_layers.new(name="UV0")
uv1 = mesh.uv_layers.new(name="UV1")
mesh.uv_layers.active_index = 1
uv1.active_render = True
source = bpy.data.materials.new("TEST_ONLY_original_PBR")
source.use_nodes = True
shader = source.node_tree.nodes.get("Principled BSDF")
shader.inputs["Base Color"].default_value = (.2, .4, .6, 1)
shader.inputs["Roughness"].default_value = .23
shader.inputs["Metallic"].default_value = .72
mesh.materials.append(source)
original_nodes = [(node.name, node.type) for node in source.node_tree.nodes]
model = {"rig": rig, "meshes": [obj]}
prepare_workbench_appearance(model)
preview = mesh.materials[0]
check(preview != source and preview[SOURCE_MATERIAL_KEY] == source,
      "预演副本持有真实原材质ID，原PBR仍可达")
check(source.users > 0, "原材质有持久用户引用，不会作为孤立数据丢失")
mesh.uv_layers.active_index = 0
uv0.active_render = True

# 后一对象证据损坏时，前一对象也不能先被改写。
other_mesh = mesh.copy()
other = bpy.data.objects.new("TEST_ONLY_invalid", other_mesh)
valid_state = other_mesh[SOURCE_UV_KEY]
other_mesh[SOURCE_UV_KEY] = '{"names":[],"active":0,"render":[]}'
rejects(lambda: restore_animation_materials([obj, other]), "原UV状态无效")
check(mesh.materials[0] == preview and mesh.uv_layers.active_index == 0,
      "全体预检失败时不部分恢复前面的网格")
other_mesh[SOURCE_UV_KEY] = valid_state
del other_mesh[SOURCE_UV_KEY]
rejects(lambda: restore_animation_materials([other]), "原UV状态缺失")
other_mesh[SOURCE_UV_KEY] = valid_state
preview[SOURCE_MATERIAL_KEY] = preview
rejects(lambda: restore_animation_materials([obj]), "原材质引用无效")
preview[SOURCE_MATERIAL_KEY] = source

shared = bpy.data.objects.new("TEST_ONLY_shared", mesh)
check(restore_animation_materials([obj, shared]) == 1, "共享网格仅恢复一次")
check(mesh.materials[0] == source, "动画消费者恢复同一个原材质")
check(mesh.uv_layers.active_index == 1 and uv1.active_render, "恢复原UV活动及渲染通道")
check(SOURCE_UV_KEY not in mesh, "恢复后清除一次性UV记录")
check(original_nodes == [(node.name, node.type) for node in source.node_tree.nodes]
      and abs(shader.inputs["Roughness"].default_value - .23) < 1e-6
      and abs(shader.inputs["Metallic"].default_value - .72) < 1e-6,
      "原PBR节点及粗糙度金属度未被预演副本覆盖")
check(restore_animation_materials([obj]) == 0, "重复恢复和普通原材质不发生变化")
empty = bpy.data.objects.new("TEST_ONLY_empty", bpy.data.meshes.new("TEST_ONLY_empty"))
check(restore_animation_materials([rig, empty]) == 0, "非网格和无材质旧白模不变")
print(json.dumps({"status": "PASS", "mediaGenerated": False, "checks": checks}, ensure_ascii=False))
