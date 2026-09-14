"""独立出水几何预演；不模拟流体。报告来自烘焙后的实际网格和骨架。"""
import math
import bpy
from mathutils import Vector
from bpy_extras.object_utils import world_to_camera_view


def smooth(u):
    u = max(0., min(1., u))
    return u*u*(3-2*u)


def root_z(event, t, head_height):
    cross = event['crossSec']
    if t <= cross:
        return -head_height-.6*(1-smooth(t/cross))
    return -head_height+(event['height']+head_height)*smooth((t-cross)/event['riseSec'])


def _geometry():
    # 冲击冠三圈水片，外圈永远不超过单位半径；额外八颗封闭水滴。
    vertices, faces = [], []
    n = 32
    for ring in range(3):
        for i in range(n):
            a = 2*math.pi*i/n
            radius = (.28, .68, 1.)[ring]
            z = (.02, .45+.35*(.5+.5*math.cos(8*a)), .04)[ring]
            vertices.append((radius*math.cos(a), radius*math.sin(a), z))
    for ring in range(2):
        for i in range(n):
            j = (i+1)%n
            faces.append((ring*n+i, ring*n+j, (ring+1)*n+j, (ring+1)*n+i))
    for i in range(8):
        a = 2*math.pi*i/8
        center = Vector((.82*math.cos(a), .82*math.sin(a), .94))
        offset = len(vertices)
        vertices.extend([tuple(center+Vector(v)) for v in ((.035,0,0),(-.035,0,0),(0,.035,0),(0,-.035,0),(0,0,.06),(0,0,-.06))])
        faces.extend([tuple(offset+k for k in f) for f in ((0,2,4),(2,1,4),(1,3,4),(3,0,4),(2,0,5),(1,2,5),(3,1,5),(0,3,5))])
    return vertices, faces


def build_water(spec, rigs, scene):
    config = spec.get('waterEmergence')
    if not config:
        return None
    by_id = {a['id']: r for a, r, *_ in rigs}
    handles = {'mode': config['mode'], 'events': []}
    material = bpy.data.materials.new('出水预演水片')
    material.diffuse_color = (.14, .55, .72, 1)
    vertices, faces = _geometry()
    for event in config['events']:
        rig = by_id[event['actorId']]
        scene.frame_set(1)
        bpy.context.view_layer.update()
        head_height = float(rig.pose.bones['head'].tail.z)
        mesh = bpy.data.meshes.new(event['actorId']+'_独立冲击浪网格')
        mesh.from_pydata(vertices, [], faces)
        mesh.update()
        obj = bpy.data.objects.new(event['actorId']+'_独立冲击浪', mesh)
        scene.collection.objects.link(obj)
        obj.data.materials.append(material)
        obj.location = (rig.matrix_world.translation.x, rig.matrix_world.translation.y, 0)
        for frame in range(1, scene.frame_end+1):
            t = (frame-1)/24
            u = (frame-1-round(event['crossSec']*24))/round(event['waveDurationSec']*24)
            active = 0 <= u < 1
            # 冲击从小冠向外扩散，先抬升再回落；固定网格，无跨角色共享缓存。
            radial = event['waveRadius']*(.20+.80*smooth(u)) if active else 0.
            vertical = event['waveHeight']*(.08+.92*math.sin(math.pi*u)**.65)*(1-smooth(max(0.,(u-.75)/.25))) if active else 0.
            obj.scale = (radial, radial, vertical)
            obj.hide_render = not active
            obj.hide_viewport = not active
            for prop in ('scale', 'hide_render', 'hide_viewport'):
                obj.keyframe_insert(prop, frame=frame)
        handles['events'].append({'event': event, 'rig': rig, 'object': obj, 'headHeight': head_height})
    return handles


def _bounds(points, dimensions):
    return {'min': [min(p[k] for p in points) for k in range(dimensions)],
            'max': [max(p[k] for p in points) for k in range(dimensions)]}


def _overlap(a, b):
    # 包围矩形是保守拒收：不把网格间空隙当作可靠的不遮挡证明。
    return all(min(a['max'][k], b['max'][k])-max(a['min'][k], b['min'][k]) > 1e-6 for k in range(2))


def measure_water(handles, rigs, scene):
    if not handles:
        return None
    original = scene.frame_current
    rows = [{'actorId': h['event']['actorId'], 'crossFrame': None, 'headHeight': h['headHeight'], 'samples': []} for h in handles['events']]
    overlaps, offscreen = [], []
    try:
        for frame in range(1, scene.frame_end+1):
            scene.frame_set(frame)
            bpy.context.view_layer.update()
            depsgraph = bpy.context.evaluated_depsgraph_get()
            current = []
            for h, row in zip(handles['events'], rows):
                rig, obj = h['rig'], h['object']
                head = rig.matrix_world @ rig.pose.bones['head'].tail
                root = rig.matrix_world.translation.copy()
                if row['crossFrame'] is None and head.z >= -1e-5:
                    row['crossFrame'] = frame
                active = not obj.hide_render and min(obj.scale) > 0
                world, screen = None, None
                if active:
                    evaluated = obj.evaluated_get(depsgraph)
                    mesh = evaluated.to_mesh()
                    try:
                        points = [evaluated.matrix_world @ v.co for v in mesh.vertices]
                        if not points:
                            raise ValueError('独立冲击浪网格为空')
                        projected = [world_to_camera_view(scene, scene.camera, p) for p in points]
                        world, screen = _bounds(points, 3), _bounds(projected, 2)
                        if any(p.z <= 0 or not .02 <= p.x <= .98 or not .02 <= p.y <= .98 for p in projected):
                            offscreen.append(frame)
                    finally:
                        evaluated.to_mesh_clear()
                sample = {'frame': frame, 'root': list(root), 'head': list(head), 'active': active, 'worldBounds': world, 'screenBounds': screen}
                row['samples'].append(sample)
                if active:
                    current.append((row['actorId'], sample))
            for i, (aid, a) in enumerate(current):
                for bid, b in current[i+1:]:
                    for kind, key in (('world', 'worldBounds'), ('screen', 'screenBounds')):
                        if _overlap(a[key], b[key]):
                            overlaps.append({'frame': frame, 'actorIds': [aid, bid], 'kind': kind})
    finally:
        scene.frame_set(original)
        bpy.context.view_layer.update()
    return {'mode': handles['mode'], 'preset': 'geometric_splash_v1', 'events': rows,
            'overlaps': overlaps, 'offscreenFrames': sorted(set(offscreen)),
            'boundaryZh': '受控几何水花预演，非流体终片；逐帧网格包围范围保守检查，不证明帧间连续碰撞或流体物理。'}
