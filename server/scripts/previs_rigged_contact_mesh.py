"""实际求值蒙皮的脚底测量；只作几何门禁，不代表衣物或常速质量验收。"""
import math


def measure_contact_mesh(model, frames):
    import bpy
    scene = bpy.context.scene
    if not frames or frames != sorted(set(frames)) or any(type(f) is not int or f < 1 or f > 720 for f in frames):
        raise ValueError('接触网格帧窗无效')
    meshes = model['meshes']
    feet = [model['boneMap'][name] for name in ('foot-1', 'foot1')]
    indices = []
    counts = [0, 0]
    for mesh in meshes:
        selected = []
        for side, name in enumerate(feet):
            group = mesh.vertex_groups.get(name)
            ids = {v.index for v in mesh.data.vertices if group is not None and
                   sum(g.weight for g in v.groups if g.group == group.index) >= .5}
            selected.append(ids)
            counts[side] += len(ids)
        indices.append(selected)
    if min(counts) < 3:
        raise ValueError('接触缺少双脚可测量蒙皮权重')
    original = scene.frame_current
    samples = []
    try:
        for frame in frames:
            scene.frame_set(frame)
            bpy.context.view_layer.update()
            graph = bpy.context.evaluated_depsgraph_get()
            floor, soles = math.inf, [math.inf, math.inf]
            for mesh, selected in zip(meshes, indices):
                evaluated = mesh.evaluated_get(graph)
                data = evaluated.to_mesh()
                try:
                    if data is None or len(data.vertices) != len(mesh.data.vertices):
                        raise ValueError('接触网格拓扑与蒙皮权重不一致')
                    for vertex in data.vertices:
                        point = evaluated.matrix_world @ vertex.co
                        if not all(math.isfinite(value) for value in point):
                            raise ValueError('接触网格包含非有限坐标')
                        floor = min(floor, point.z)
                        for side in (0, 1):
                            if vertex.index in selected[side]:
                                soles[side] = min(soles[side], point.z)
                finally:
                    evaluated.to_mesh_clear()
            if not math.isfinite(floor) or any(not math.isfinite(z) for z in soles):
                raise ValueError('接触实际网格为空')
            if floor < -.005 or any(z < -.005 or z > .03 for z in soles):
                raise ValueError('接触实际网格穿地或双脚失去地面支撑')
            samples.append({'frame': frame, 'minimumHeight': floor, 'soleHeights': soles})
    finally:
        scene.frame_set(original)
        bpy.context.view_layer.update()
    return {'footVertices': counts, 'samples': samples, 'meshMeasured': True}
