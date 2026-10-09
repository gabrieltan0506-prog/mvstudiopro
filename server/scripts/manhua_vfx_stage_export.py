"""将已验净空的同场人物与碎片逐帧烘焙，供同相机3DGS渲染器消费。"""
import json
import math
from pathlib import Path


def bake_world_animation(scene, handle, event, prop, spec, update):
    import bpy
    from manhua_vfx_bullet3d import _render_members
    objects = set(handle['actors']) | set(handle['prop']['objects'])
    rigs = set(handle['rigs'])
    # 刚性手持物仍按真实骨架父链保留，排除隐藏的源白模替身。
    for obj in scene.objects:
        parent = obj.parent
        while parent:
            if parent in rigs and obj.type == 'MESH' and not obj.hide_render:
                objects.add(obj)
            parent = parent.parent
    if not objects or len(objects) > 2048:raise ValueError('场景动画网格数量无效')
    for obj in objects:
        if any(mod.show_render and mod.type != 'ARMATURE' for mod in obj.modifiers):
            raise ValueError('正式场景动画须先烘焙非骨骼网格修改器，不能静默导出不同几何')
    selected = sorted(objects | rigs, key=lambda obj: obj.name)
    count = math.ceil(spec['durationSec'] * spec['fps'])
    if sum(len(obj.data.vertices) for obj in objects) * count > 12_000_000:
        raise ValueError('正式场景动画超出1200万顶点帧预算')
    timeline, states, proofs = [], [], []
    for index in range(count):
        proof = update(scene, handle, event, prop, spec, index / spec['fps'])
        graph = bpy.context.evaluated_depsgraph_get()
        visible = _render_members(bpy.context.view_layer)
        camera = scene.camera.evaluated_get(graph)
        projection = camera.calc_matrix_camera(graph, x=spec['width'], y=spec['height'],
            scale_x=scene.render.pixel_aspect_x, scale_y=scene.render.pixel_aspect_y)
        position, quaternion, _ = camera.matrix_world.decompose()
        rows = {}
        for obj in selected:
            evaluated = obj.evaluated_get(graph)
            row = {'matrix': evaluated.matrix_world.copy()}
            if obj.type == 'ARMATURE':row['bones'] = {bone.name: bone.matrix.copy() for bone in evaluated.pose.bones}
            if obj.type == 'MESH' and obj.data.shape_keys:
                row['shapes'] = {key.name: key.value for key in evaluated.data.shape_keys.key_blocks}
            rows[obj.name] = row
        states.append(rows)
        opacities = {}
        for obj in handle['prop']['objects']:
            shader = next(node for node in obj.active_material.node_tree.nodes if node.type == 'BSDF_PRINCIPLED')
            opacities[obj.name] = shader.inputs['Alpha'].default_value
        timeline.append({'frame': index + 1, 'timeSec': index / spec['fps'], 'active': proof['active'],
            'camera': {'position': list(position), 'quaternionXYZW': [quaternion.x, quaternion.y, quaternion.z, quaternion.w],
                'vfovRad': 2 * math.atan(1 / projection[1][1]), 'clipStart': camera.data.clip_start, 'clipEnd': camera.data.clip_end},
            'visibleObjectIds': sorted(obj.name for obj in objects if obj.name in visible) if proof['active'] else [],
            'fragmentOpacity': opacities})
        proofs.append({'frame': index + 1, 'timeSec': index / spec['fps'], 'effects': [proof]})
        if index % 24 == 0:print('MANHUA_VFX_PROGRESS export_sample=%d' % (index + 1), flush=True)
    # 先完整采样，再移除原时间轴；不能边读源帧边改写源动画。
    scene.frame_start, scene.frame_end, scene.render.fps = 1, count, math.ceil(spec['fps'])
    scene.render.fps_base = math.ceil(spec['fps']) / spec['fps']
    for obj in scene.objects:obj.select_set(False)
    for obj in selected:
        obj.animation_data_clear()
        obj.parent = None
        for constraint in list(obj.constraints):obj.constraints.remove(constraint)
        obj.rotation_mode = 'QUATERNION'
        obj.hide_set(False);obj.hide_viewport = False;obj.select_set(True)
        if obj.type == 'MESH':
            obj['previsObjectId'] = obj.name
            obj['vfxFragment'] = obj in handle['prop']['objects']
            if obj.data.shape_keys:obj.data.shape_keys.animation_data_clear()
        elif obj.type == 'ARMATURE':
            for bone in obj.pose.bones:
                for constraint in list(bone.constraints):bone.constraints.remove(constraint)
                bone.rotation_mode = 'QUATERNION'
    for index, rows in enumerate(states, 1):
        scene.frame_set(index)
        for obj in selected:
            obj.matrix_world = rows[obj.name]['matrix']
            for key in ('location', 'rotation_quaternion', 'scale'):obj.keyframe_insert(key, frame=index)
        bpy.context.view_layer.update()
        for obj in selected:
            if obj.type == 'ARMATURE':
                # Blender骨架顺序是父先子后；赋值与依赖更新均在同帧完成。
                for bone in sorted(obj.pose.bones, key=lambda bone: len(bone.parent_recursive)):
                    bone.matrix = rows[obj.name]['bones'][bone.name]
                    bpy.context.view_layer.update()
                    for key in ('location', 'rotation_quaternion', 'scale'):bone.keyframe_insert(key, frame=index)
            if obj.type == 'MESH' and obj.data.shape_keys:
                for key in obj.data.shape_keys.key_blocks:
                    key.value = rows[obj.name]['shapes'][key.name]
                    key.keyframe_insert('value', frame=index)
    for index, rows in enumerate(states, 1):
        scene.frame_set(index);bpy.context.view_layer.update()
        for obj in selected:
            evaluated = obj.evaluated_get(bpy.context.evaluated_depsgraph_get())
            if any(abs(evaluated.matrix_world[i][j] - rows[obj.name]['matrix'][i][j]) > .0001 for i in range(4) for j in range(4)):
                raise ValueError('第%d帧%s世界变换在烘焙后变化' % (index, obj.name))
            if obj.type == 'ARMATURE' and any(abs(bone.matrix[i][j] - rows[obj.name]['bones'][bone.name][i][j]) > .0001
                    for bone in evaluated.pose.bones for i in range(4) for j in range(4)):
                raise ValueError('第%d帧%s骨骼姿态在烘焙后变化' % (index, obj.name))
    raw = {'version': 1, 'fps': spec['fps'], 'width': spec['width'], 'height': spec['height'], 'frames': timeline,
        'objectIds': sorted(obj.name for obj in objects), 'fragmentIds': sorted(obj.name for obj in handle['prop']['objects']),
        'coordinateSystem': 'stage-z-up-meters', 'complete': True}
    return objects, rigs, raw, proofs


def export_world_animation(scene, handle, event, prop, spec, output, update):
    import bpy
    objects, rigs, raw, proofs = bake_world_animation(scene, handle, event, prop, spec, update)
    bpy.context.view_layer.objects.active = next(iter(rigs))
    scene.frame_set(1)
    options = dict(filepath=str(Path(output) / 'world-animation.glb'), export_format='GLB', use_selection=True,
        export_animations=True, export_force_sampling=True, export_frame_range=True, export_frame_step=1,
        export_skins=True, export_extras=True, export_cameras=False)
    props = bpy.ops.export_scene.gltf.get_rna_type().properties
    if 'export_animation_mode' not in props or 'SCENE' not in [item.identifier for item in props['export_animation_mode'].enum_items]:
        raise ValueError('当前Blender不支持完整场景动画导出，保留原输入')
    options['export_animation_mode'] = 'SCENE'
    bpy.ops.export_scene.gltf(**options)
    (Path(output) / 'world-animation.frames.json').write_text(json.dumps(raw, ensure_ascii=False))
    return proofs
