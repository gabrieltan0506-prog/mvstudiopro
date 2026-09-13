"""固定马体的四尾黑翼显形；不读取外部脚本，不实现任意模型变身。"""
import math
import bpy
from mathutils import Matrix, Vector

PRESET = 'four_tail_black_wings'


def _smooth(value):
    value = max(0., min(1., value))
    return value * value * (3. - 2. * value)


def _config(actor, duration):
    config = actor.get('creature')
    if config is None:
        return None
    if actor.get('shape') != 'horse' or not isinstance(config, dict):
        raise ValueError('四尾黑翼显形只支持马体')
    if set(config) != {'preset', 'transformStartSec', 'transformEndSec'} or config['preset'] != PRESET:
        raise ValueError('未知的指定形态配置')
    start, end = config['transformStartSec'], config['transformEndSec']
    if any(isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) for v in (start, end)):
        raise ValueError('显形起止秒必须是有限数值')
    if start < 0 or end - start < .5 or end > duration:
        raise ValueError('显形终态必须不晚于最后实际视频帧，且至少半秒')
    return config


def _segments(body, seconds, progress):
    """局部空间的四条三节尾链与左右三节翼链，尾部摇动保持相互错开。"""
    rear, front = (Vector(p) for p in body)
    growth = max(.001, progress)
    result = {}
    for tail in range(4):
        spread = (tail - 1.5) * .40
        point = rear + Vector((-.02, (tail - 1.5) * .075, .02))
        for segment in range(3):
            wave = math.sin(seconds * 2. + tail * .9 - segment * .65) * .10
            delta = Vector((-.40, spread * .42 + wave, .13 + .035 * segment)) * growth
            end = point + delta
            result[f'tail_{tail}_{segment}'] = (point, end)
            point = end
    for side in (-1, 1):
        point = front + Vector((-.30, side * .18, .13))
        for segment in range(3):
            # 由贴身折叠过渡到侧上方展翼；终态保持轻微有界呼吸式摆动。
            opening = progress * (1. + .025 * math.sin(seconds * 1.6))
            delta = Vector((-.14 + .08 * segment,
                            side * (.12 + .47 * opening),
                            .18 + .20 * opening - .11 * segment)) * growth
            end = point + delta
            result[f'wing_{side}_{segment}'] = (point, end)
            point = end
    return result


def _matrix(a, b, radial_scale=1.):
    direction = b - a
    return Matrix.Translation(a) @ direction.to_track_quat('Y', 'Z').to_matrix().to_4x4() @ Matrix.Diagonal((radial_scale, 1., radial_scale, 1.))


def _material(name, rgb):
    material = bpy.data.materials.new(name)
    material.diffuse_color = (*rgb, 1.)
    return material


def _mesh(scene, rig, name, vertices, faces, material, bone):
    data = bpy.data.meshes.new(name)
    data.from_pydata(vertices, [], faces)
    data.update()
    obj = bpy.data.objects.new(name, data)
    scene.collection.objects.link(obj)
    obj.parent = rig
    obj.data.materials.append(material)
    group = obj.vertex_groups.new(name=bone)
    group.add(list(range(len(vertices))), 1., 'REPLACE')
    modifier = obj.modifiers.new('尾翼骨骼绑定', 'ARMATURE')
    modifier.object = rig
    return obj


def build_creature(actor, owner_rig, scene, points_at_frame):
    """主体骨骼烘焙后调用；回调返回各帧主体局部骨端点。无配置时严格惰性。"""
    fps = scene.render.fps / scene.render.fps_base
    config = _config(actor, (scene.frame_end - 1) / fps)
    if config is None:
        return None
    if owner_rig.type != 'ARMATURE' or 'body' not in owner_rig.data.bones:
        raise ValueError('指定形态需要真实马体骨架')
    rest = _segments(points_at_frame(1)['body'], 0., 1.)
    data = bpy.data.armatures.new(actor['id'] + '_creature')
    rig = bpy.data.objects.new(actor['id'] + '_creature', data)
    scene.collection.objects.link(rig)
    rig.parent = owner_rig
    rig['ownerId'] = actor['id']
    rig['creaturePreset'] = PRESET
    bpy.ops.object.select_all(action='DESELECT')
    rig.select_set(True)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode='EDIT')
    for name, (a, b) in rest.items():
        bone = data.edit_bones.new(name)
        bone.head, bone.tail = a, b
        stem, index = name.rsplit('_', 1)
        if int(index):
            bone.parent = data.edit_bones[f'{stem}_{int(index)-1}']
            bone.use_connect = True
    bpy.ops.object.mode_set(mode='OBJECT')
    black = _material(actor['id'] + '_黑羽', (.035, .04, .06))
    tail_colors = [(.34, .42, .55), (.44, .36, .52), (.32, .47, .43), (.51, .43, .31)]
    tails = [_material(actor['id'] + '_尾色' + str(i), color) for i, color in enumerate(tail_colors)]
    meshes = []
    for name, (a, b) in rest.items():
        direction = (b-a).normalized()
        cross = direction.cross(Vector((0, 0, 1))).normalized()
        up = direction.cross(cross).normalized()
        radius = .055 if name.startswith('tail') else .045
        vertices = [tuple(point + cross*x*radius + up*z*radius) for point in (a,b) for x,z in ((-1,-1),(1,-1),(1,1),(-1,1))]
        faces = [(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)]
        material = tails[int(name.split('_')[1])] if name.startswith('tail') else black
        meshes.append(_mesh(scene, rig, actor['id']+'_'+name, vertices, faces, material, name))
        if name.startswith('wing'):
            # 每节三片有厚度的独立羽片，绑定当前节，不用图片伪造翼面。
            for feather in range(3):
                root = a.lerp(b, .20 + feather*.28)
                tip = root + Vector((-.42-.07*feather, 0, -.12))
                width = direction * .09
                thick = Vector((0,0,.012))
                ring = [root-width, root+width, tip+width*.25, tip-width*.25]
                verts = [tuple(v+offset) for offset in (-thick,thick) for v in ring]
                meshes.append(_mesh(scene, rig, actor['id']+'_'+name+'_feather'+str(feather), verts, faces, black, name))
    original_frame = scene.frame_current
    frames = []
    for frame in range(scene.frame_start, scene.frame_end+1):
        t = (frame-1)/fps
        progress = _smooth((t-config['transformStartSec'])/(config['transformEndSec']-config['transformStartSec']))
        segments = _segments(points_at_frame(frame)['body'], t, progress)
        targets = {}
        for name, (a,b) in segments.items():
            pb = rig.pose.bones[name]
            target = _matrix(a,b,max(.001,progress)) @ Matrix.Diagonal((1., (b-a).length/pb.bone.length, 1., 1.))
            targets[name] = target
            # 由期望绝对局部姿态逆算basis；不依赖上一帧depsgraph求值顺序。
            basis = pb.bone.matrix_local.inverted() @ target
            if pb.parent:
                basis = pb.bone.matrix_local.inverted() @ pb.parent.bone.matrix_local @ targets[pb.parent.name].inverted() @ target
            pb.matrix_basis = basis
            pb.rotation_mode = 'QUATERNION'
            for prop in ('location','rotation_quaternion','scale'):
                pb.keyframe_insert(prop,frame=frame)
        visible = progress > 0.
        for obj in meshes:
            obj.hide_render = not visible
            obj.hide_viewport = not visible
            obj.keyframe_insert('hide_render',frame=frame)
            obj.keyframe_insert('hide_viewport',frame=frame)
        frames.append({'frame':frame,'timeSec':t,'progress':progress,'visibleFraction':1. if visible else 0.})
    scene.frame_set(original_frame)
    bpy.context.view_layer.update()
    return {'rig':rig,'meshes':meshes,'ownerId':actor['id'],'config':dict(config),'frames':frames}


def world_vertices(handle, depsgraph=None):
    """当前帧可见附件真实变形网格顶点；相机构图与验收共用，无静默截断。"""
    if handle is None:
        return
    depsgraph = depsgraph or bpy.context.evaluated_depsgraph_get()
    for obj in handle['meshes']:
        if obj.hide_render:
            continue
        evaluated = obj.evaluated_get(depsgraph)
        mesh = evaluated.to_mesh()
        try:
            for vertex in mesh.vertices:
                yield evaluated.matrix_world @ vertex.co
        finally:
            evaluated.to_mesh_clear()


def summarize(handle):
    if handle is None:
        return None
    bones = handle['rig'].data.bones
    return {'ownerId':handle['ownerId'],'preset':PRESET,'tailCount':4,'wingCount':2,
            'tailBones':sum(b.name.startswith('tail_') for b in bones),
            'wingBones':sum(b.name.startswith('wing_') for b in bones),
            'meshObjects':len(handle['meshes']), 'transform':handle['config'],
            'stages':handle['frames'],
            'boundaryZh':'同一马体四尾黑翼显形与展开；不含任意体型变化、碰撞与最终模型跟随验收'}
