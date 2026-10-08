"""动画导出恢复原材质；预演副本只供 WORKBENCH 使用，不修改源资产。"""
import json

SOURCE_MATERIAL_KEY = "previs_export_source_material"
SOURCE_UV_KEY = "previs_export_source_uv"


def restore_animation_materials(objects):
    """先校验所有槽和 UV，再在导出进程恢复；普通白模没有标记时保持原样。"""
    import bpy
    plans, seen = [], set()
    for obj in objects:
        if obj.type != "MESH" or obj.data in seen:
            continue
        mesh = obj.data
        seen.add(mesh)
        materials = list(mesh.materials)
        restored, tagged = [], False
        for material in materials:
            if material is None or SOURCE_MATERIAL_KEY not in material:
                restored.append(material)
                continue
            tagged = True
            source = material[SOURCE_MATERIAL_KEY]
            if (not isinstance(source, bpy.types.Material) or source == material
                    or SOURCE_MATERIAL_KEY in source):
                raise ValueError("动画原材质引用无效，禁止导出去材质预演副本")
            restored.append(source)
        state = mesh.get(SOURCE_UV_KEY)
        if tagged and state is None:
            raise ValueError("动画原UV状态缺失，禁止以预演UV替代")
        if state is None:
            continue
        try:
            uv = json.loads(state)
            names = [layer.name for layer in mesh.uv_layers]
            if (not isinstance(uv, dict) or set(uv) != {"names", "active", "render"}
                    or uv["names"] != names or type(uv["active"]) is not int
                    or not isinstance(uv["render"], list)
                    or len(uv["render"]) != len(names)
                    or any(type(flag) is not bool for flag in uv["render"])
                    or (names and not 0 <= uv["active"] < len(names))):
                raise ValueError("UV状态与当前网格不一致")
        except (ValueError, TypeError) as error:
            raise ValueError("动画原UV状态无效，禁止带错误贴图导出") from error
        plans.append((mesh, restored, uv))
    for mesh, materials, uv in plans:
        for index, material in enumerate(materials):
            mesh.materials[index] = material
        if mesh.uv_layers:
            mesh.uv_layers.active_index = uv["active"]
            for layer, active_render in zip(mesh.uv_layers, uv["render"]):
                layer.active_render = active_render
        del mesh[SOURCE_UV_KEY]
    return len(plans)
