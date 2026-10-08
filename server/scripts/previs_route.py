"""可选分段平面运动轨；短弧转向，报告只读实际烘焙根矩阵。"""
import math
import bpy
from mathutils import Vector


def route_pose(actor, t):
    route = actor.get('motionRoute')
    if not route:
        return None
    if t <= route[0]['timeSec']:
        node = route[0]
        return Vector((*node['position'], 0)), node['facingDeg']
    for a, b in zip(route, route[1:]):
        if t <= b['timeSec']:
            u = max(0., min(1., (t-a['timeSec'])/(b['timeSec']-a['timeSec'])))
            u = u*u*(3-2*u)
            delta = (b['facingDeg']-a['facingDeg']+180)%360-180
            if abs(delta+180) < 1e-8:
                delta = 180.
            return (Vector((*a['position'], 0)).lerp(Vector((*b['position'], 0)), u),
                    a['facingDeg']+delta*u)
    node = route[-1]
    return Vector((*node['position'], 0)), node['facingDeg']


def measure_routes(spec, rigs, scene):
    rows = []
    original = scene.frame_current
    try:
        for actor, rig, *_ in rigs:
            if not actor.get('motionRoute'):
                continue
            samples = []
            for frame in range(1, scene.frame_end+1):
                scene.frame_set(frame)
                bpy.context.view_layer.update()
                matrix = rig.matrix_world
                facing = math.degrees(math.atan2(matrix[1][0], matrix[0][0]))
                samples.append({'frame': frame, 'root': list(matrix.translation), 'facingDeg': facing})
            rows.append({'actorId': actor['id'], 'samples': samples})
    finally:
        scene.frame_set(original)
        bpy.context.view_layer.update()
    return rows
