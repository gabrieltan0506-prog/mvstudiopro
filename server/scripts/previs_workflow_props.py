"""可保存的建筑折叠与爆椅聚字；仅消费任务规格，不读取本地制作脚本。"""
import math
import random


def build_workflow_prop(prop, scene, material):
    import bpy
    from mathutils import Vector
    from previs_scene_effects import _installed_font
    config = prop['proxy']
    width, depth, height = config['size']
    objects = []

    def box(label, size, offset, group):
        bpy.ops.mesh.primitive_cube_add(size=1)
        obj = bpy.context.object
        obj.name = prop['id'] + '_' + label
        for v in obj.data.vertices:
            v.co = Vector((v.co.x*size[0], v.co.y*size[1], v.co.z*size[2]))
        obj.data.materials.append(material)
        if objects:
            obj.parent = objects[0]
        obj.location = offset
        obj['previs_animation_object'] = True
        obj['previs_proxy_shape'] = 'box'
        obj['workflow_group'] = group
        objects.append(obj)
        return obj

    # 独立根控制全部局部网格；尺寸仅1毫米，不作为可见椅面或墙体。
    box('root', (.001, .001, .001), (0, 0, 0), 'root')
    if prop['kind'] == 'folding_wall':
        # 竖轴在墙体左边缘；旋转来自原keyframes，不通过移动摄影机伪造。
        box('wall', (width, depth, height), (width/2, 0, height/2), 'wall')
        for x in (.2*width, .8*width):
            box('window_side', (.06, depth+.04, height*.65), (x, 0, height*.55), 'wall')
        for z in (.225*height, .875*height):
            box('window_rail', (width*.66, depth+.04, .06), (width*.5, 0, z), 'wall')
        return objects
    box('seat', (width, depth, height*.12), (0, 0, height*.48), 'chair')
    box('back', (width, depth*.16, height*.5), (0, depth*.42, height*.75), 'chair')
    for x in (-width*.38, width*.38):
        for y in (-depth*.36, depth*.36):
            box('leg', (width*.1, depth*.1, height*.45), (x, y, height*.225), 'chair')
    if prop['kind'] != 'chair_burst_text':
        return objects
    burst = config['burst']
    font, _ = _installed_font(burst['text'])
    curve = bpy.data.curves.new(prop['id']+'_text', 'FONT')
    curve.body = burst['text']; curve.font = font; curve.size = .5
    curve.align_x = 'LEFT'; curve.extrude = .02; curve.resolution_u = 2
    text = bpy.data.objects.new(prop['id']+'_text', curve)
    scene.collection.objects.link(text)
    text.parent = objects[0]; text.location = burst['textPosition']
    text.rotation_euler = (math.pi/2, 0, 0); text.data.materials.append(material)
    bpy.context.view_layer.update()
    factor = burst['textWidth']/max(text.dimensions.x, .00001)
    text.scale = (factor,)*3
    bpy.ops.object.select_all(action='DESELECT')
    text.select_set(True); bpy.context.view_layer.objects.active = text
    bpy.ops.object.convert(target='MESH')
    text['previs_animation_object'] = True; text['workflow_group'] = 'text'
    objects.append(text); bpy.context.view_layer.update()
    targets = [text.matrix_local @ v.co for v in text.data.vertices]
    if not targets:
        raise ValueError('聚字缺少真实中文网格')
    rng = random.Random(19)
    for i in range(48):
        origin = Vector((rng.uniform(-width*.45, width*.45), rng.uniform(-depth*.4, depth*.4), rng.uniform(height*.15, height)))
        destination = origin + Vector((rng.uniform(-.65, .6), rng.uniform(-.4, .25), rng.uniform(.25, .95)))
        obj = box('fragment_%02d'%i, (.07, .045, .09), origin, 'fragment')
        obj['workflow_origin'] = list(origin)
        obj['workflow_burst'] = list(destination)
        obj['workflow_target'] = list(targets[i*len(targets)//48])
        obj['workflow_index'] = i
    return objects


def animate_workflow_prop(prop, objects, t, frame, visible):
    from mathutils import Vector
    b = prop['proxy']['burst']
    def progress(start, end):
        u = min(1., max(0., (t-start)/(end-start)))
        return u*u*(3-2*u)
    for obj in objects:
        group = obj.get('workflow_group')
        shown = visible and (group == 'root' or (group == 'chair' and t < b['startSec']) or
                            (group == 'fragment' and b['startSec'] <= t < b['gatherEndSec']) or
                            (group == 'text' and t >= b['gatherEndSec']))
        obj.hide_render = not shown; obj.hide_viewport = not shown
        if group == 'fragment':
            origin, burst, target = (Vector(obj[key]) for key in ('workflow_origin','workflow_burst','workflow_target'))
            if t <= b['burstEndSec']:
                obj.location = origin.lerp(burst, progress(b['startSec'], b['burstEndSec']))
            else:
                obj.location = burst.lerp(target, progress(b['gatherStartSec'], b['gatherEndSec']))
            spin = progress(b['startSec'], b['burstEndSec'])*(1-progress(b['gatherStartSec'], b['gatherEndSec']))
            i = obj['workflow_index']; obj.rotation_euler = (i*.23*spin, i*.17*spin, i*.3*spin)
            for key in ('location', 'rotation_euler'):
                obj.keyframe_insert(key, frame=frame)
        for key in ('hide_render', 'hide_viewport'):
            obj.keyframe_insert(key, frame=frame)


def measure_workflow_state(objects):
    from mathutils import Vector
    fragments = [o for o in objects if o.get('workflow_group') == 'fragment']
    return {'fragmentCount': len(fragments),
            'fragmentsVisible': sum(not o.hide_render for o in fragments),
            'chairPartsVisible': sum(not o.hide_render for o in objects if o.get('workflow_group') == 'chair'),
            'textVisible': any(not o.hide_render for o in objects if o.get('workflow_group') == 'text'),
            'targetMaxError': max((o.location-Vector(o['workflow_target'])).length for o in fragments)}
