"""已验证带骨网格的基础色预演材质；不联网、不改引擎、不修改原材质或报告schema。"""
import math


def _fail(message):
    raise ValueError("基础色预演不支持：" + message)


def _rgba(value):
    values = tuple(float(x) for x in value)
    if len(values) != 4 or any(not math.isfinite(x) or x < 0 or x > 1 for x in values):
        _fail("基础色或透明度必须是0到1的有限数")
    return values


def _one_link(socket):
    if not socket.is_linked or len(socket.links) != 1:
        _fail("基础色节点连接不唯一")
    link = socket.links[0]
    if not link.is_valid or link.from_node.mute:
        _fail("基础色节点连接无效或已静音")
    return link


def _material_plan(material):
    if material is None:
        _fail("目标网格含空材质槽")
    if not material.use_nodes or material.node_tree is None:
        _fail("目标材质不是可追溯的glTF节点材质")
    if material.animation_data or material.node_tree.animation_data:
        _fail("动画材质")
    outputs = [node for node in material.node_tree.nodes
               if node.type == "OUTPUT_MATERIAL" and node.is_active_output]
    if len(outputs) != 1:
        _fail("材质输出不唯一")
    surface = _one_link(outputs[0].inputs["Surface"])
    shader = surface.from_node
    if shader.type != "BSDF_PRINCIPLED" or surface.from_socket.name != "BSDF":
        _fail("不是直接Principled材质输出")
    alpha = shader.inputs["Alpha"]
    base = shader.inputs["Base Color"]
    if not base.is_linked:
        if alpha.is_linked:
            _fail("纯色材质含独立透明度节点")
        color = _rgba((*base.default_value[:3], alpha.default_value))
        return {"source": material, "kind": "constant", "color": color, "image": None,
                "uv": None, "alphaApproximate": color[3] < 1}
    link = _one_link(base)
    texture = link.from_node
    # 不追任意乘色、顶点色或节点组；不以节点名、标签、active猜测颜色语义。
    if texture.type != "TEX_IMAGE" or link.from_socket.name != "Color":
        _fail("基础色含乘数、顶点色或复杂节点链")
    image = texture.image
    if image is None or image.source not in ("FILE", "GENERATED") or not image.packed_file:
        _fail("基础色图片必须是已内嵌的单张静态图")
    # glTF导入后图片可能延迟解码；先确认内嵌再触发读取，不访问外部图片路径。
    if len(image.pixels) == 0 or not image.has_data or min(image.size) <= 0:
        _fail("基础色图片为空或未解码")
    if image.colorspace_settings.is_data or image.colorspace_settings.name != "sRGB":
        _fail("基础色图片不是sRGB颜色图")
    if texture.projection != "FLAT" or texture.extension not in ("REPEAT", "EXTEND"):
        _fail("图片投影或采样环绕方式不能由WORKBENCH准确表示")
    if texture.interpolation not in ("Linear", "Closest"):
        _fail("图片滤波方式不能由WORKBENCH准确表示")
    if alpha.is_linked:
        alpha_link = _one_link(alpha)
        if alpha_link.from_node != texture or alpha_link.from_socket.name != "Alpha":
            _fail("透明度含乘数、裁切或其他图片")
    elif abs(float(alpha.default_value) - 1) > 1e-6:
        _fail("纹理透明度乘数不是1")
    uv = None
    vector = texture.inputs["Vector"]
    if vector.is_linked:
        uv_link = _one_link(vector)
        if uv_link.from_node.type != "UVMAP" or uv_link.from_socket.name != "UV":
            _fail("基础色使用变换或复杂UV链")
        uv = uv_link.from_node.uv_map
        if not uv or uv_link.from_node.from_instancer:
            _fail("UV名称为空或来自实例")
    return {"source": material, "kind": "texture", "color": (1, 1, 1, 1),
            "image": image, "uv": uv, "texture": texture, "alphaApproximate": True}


def prepare_workbench_appearance(model):
    """返回独立边界报告；调用者决定启用TEXTURE，不写model.report或场景渲染设置。

    仅支持直接sRGB基础色贴图或纯色；复杂乘数、顶点色、UV变换与同网格多UV明确失败。
    透明度仅用于预演近似；不承诺完整PBR、BLEND排序或MASK阈值等价。
    """
    import bpy
    meshes = list(model.get("meshes", []))
    rig = model.get("rig")
    if not meshes or rig is None or rig.type != "ARMATURE":
        _fail("必须传入真实带骨导入结果")
    plans, object_plans, planned_mesh_data = {}, [], set()
    default_slots = 0
    targets = set(meshes)
    for obj in meshes:
        if obj.type != "MESH" or not obj.data.vertices:
            _fail("目标网格为空")
        if not any(mod.type == "ARMATURE" and mod.object == rig for mod in obj.modifiers):
            _fail("目标网格未绑定指定骨架")
        if any(other.type == "MESH" and other.data == obj.data and other not in targets
               for other in bpy.data.objects):
            _fail("目标网格与范围外对象共享数据")
        if any(slot.link != "DATA" for slot in obj.material_slots):
            _fail("目标材质槽不是网格级材质")
        if not obj.material_slots:
            default_slots += 1
        chosen_uv = set()
        for slot in obj.material_slots:
            material = slot.material
            if material is None:
                default_slots += 1
                continue  # 合法缺省材质沿用WORKBENCH灰白默认，不制造新节点材质。
            if material not in plans:
                plans[material] = _material_plan(material)
            plan = plans[material]
            if plan["kind"] == "texture":
                if not obj.data.uv_layers:
                    _fail("贴图网格缺少UV")
                uv = plan["uv"] or obj.data.uv_layers[0].name
                if obj.data.uv_layers.get(uv) is None:
                    _fail("贴图指定UV在目标网格不存在")
                chosen_uv.add(uv)
        if len(chosen_uv) > 1:
            _fail("同一网格的材质使用不同UV，WORKBENCH只有一个活动UV")
        if obj.data not in planned_mesh_data:
            object_plans.append((obj, next(iter(chosen_uv), None)))
            planned_mesh_data.add(obj.data)

    # 全部预检完成才开始修改；独立副本不影响旧白模/地面或原始材质。
    copies, previous = {}, []
    try:
        for material, plan in plans.items():
            preview = material.copy()
            copies[material] = preview
            preview.name = "PREVIS_BASE_COLOR_" + material.name
            preview.diffuse_color = plan["color"]
            preview.metallic, preview.roughness = 0, .5
            preview.use_nodes = plan["kind"] == "texture"
            if preview.node_tree:
                preview.node_tree.nodes.clear()
            if plan["kind"] == "texture":
                texture = preview.node_tree.nodes.new("ShaderNodeTexImage")
                texture.image = plan["image"]
                texture.interpolation = plan["texture"].interpolation
                texture.extension = plan["texture"].extension
                preview.node_tree.nodes.active = texture
        for obj, uv in object_plans:
            previous.append((obj, list(obj.data.materials), obj.data.uv_layers.active_index,
                             [layer.active_render for layer in obj.data.uv_layers]))
            for index, material in enumerate(list(obj.data.materials)):
                if material is not None:
                    obj.data.materials[index] = copies[material]
            if uv is not None:
                obj.data.uv_layers.active_index = obj.data.uv_layers.find(uv)
                obj.data.uv_layers[uv].active_render = True
        return {"mode": "workbench-base-color-preview", "colorType": "TEXTURE",
                "materialCount": len(plans), "textureMaterialCount": sum(p["kind"] == "texture" for p in plans.values()),
                "defaultMaterialSlots": default_slots,
                "materials": [{"source": material.name, "preview": copies[material].name,
                               "kind": plan["kind"], "image": plan["image"].name if plan["image"] else None,
                               "uv": plan["uv"] or "UV0", "alphaApproximate": plan["alphaApproximate"]}
                              for material, plan in plans.items()],
                "boundaryZh": "仅基础色预演，非完整PBR；透明度/遮挡排序近似，不作为最终材质质量验收。",
                "qualityAccepted": False}
    except Exception:
        for obj, materials, active_index, render_flags in reversed(previous):
            for index, material in enumerate(materials):
                obj.data.materials[index] = material
            if obj.data.uv_layers:
                obj.data.uv_layers.active_index = active_index
                for layer, active_render in zip(obj.data.uv_layers, render_flags):
                    layer.active_render = active_render
        for preview in copies.values():
            if preview.users == 0:
                bpy.data.materials.remove(preview)
        raise
