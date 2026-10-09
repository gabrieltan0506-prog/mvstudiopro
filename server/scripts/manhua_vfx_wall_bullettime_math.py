"""幕墙几何；纯数据算法不生成媒体。"""
import hashlib
import math
import random

WALL_DEFAULTS = {'columns': 6, 'rows': 5, 'impactSec': .25,
                 'contact': {'x': .5, 'y': .5}, 'spread': 1.2, 'gravity': 2., 'depth': 2.}


def finite(value, lo, hi, label):
    if isinstance(value, bool) or not isinstance(value, (float, int)) or not math.isfinite(value) or not lo <= value <= hi:
        raise ValueError('Invalid ' + label)


def validate_wall(value, duration):
    if not isinstance(value, dict) or set(value) != set(WALL_DEFAULTS):
        raise ValueError('Invalid wall fields')
    for field, lo, hi in [('columns', 2, 10), ('rows', 2, 10), ('impactSec', 0, duration), ('spread', 0, 3), ('gravity', 0, 6), ('depth', .2, 4)]:
        finite(value[field], lo, hi, 'wall ' + field)
    for field in ('columns', 'rows'):
        if not isinstance(value[field], int):
            raise ValueError('Wall grid must use integers')
    if value['impactSec'] >= duration:
        raise ValueError('Wall impact must occur inside effect window')
    contact = value['contact']
    if not isinstance(contact, dict) or set(contact) != {'x', 'y'}:
        raise ValueError('Invalid wall contact')
    for axis in ('x', 'y'):
        finite(contact[axis], 0, 1, 'wall contact ' + axis)
    return value




def wall_fragments(event, seed):
    """网格共享角点，三角棱柱覆盖宽1.6高1的墙；最多200块。"""
    p = validate_wall(event.get('wall', WALL_DEFAULTS), event['durationSec'])
    rng = random.Random(seed ^ int(hashlib.sha256(event['id'].encode()).hexdigest()[:8], 16))
    cols, rows = p['columns'], p['rows']
    points = {}
    for row in range(rows + 1):
        for col in range(cols + 1):
            jx = rng.uniform(-.23, .23) if 0 < col < cols else 0
            jy = rng.uniform(-.23, .23) if 0 < row < rows else 0
            points[col, row] = ((col + jx) / cols * 1.6 - .8, (row + jy) / rows - .5)
    result = []
    cx, cy = (p['contact']['x'] - .5) * 1.6, .5 - p['contact']['y']
    for row in range(rows):
        for col in range(cols):
            a, b, c, d = [points[key] for key in ((col,row),(col+1,row),(col+1,row+1),(col,row+1))]
            triangles = ((a,b,c),(a,c,d)) if rng.random() < .5 else ((a,b,d),(b,c,d))
            for tri in triangles:
                center = tuple(sum(v[k] for v in tri) / 3 for k in range(2))
                dx, dy = center[0] - cx, center[1] - cy
                radius = math.hypot(dx, dy)
                norm = max(radius, .03)
                speed = p['spread'] * (.35 + .65 * math.exp(-radius * 2))
                result.append({'triangle': tri, 'center': center,
                               'velocity': (dx/norm*speed, dy/norm*speed, speed * rng.uniform(.25,.8)),
                               'spin': tuple(rng.uniform(-3,3) for _ in range(3)),
                               'delay': radius * .07, 'shade': rng.uniform(.65,1.)})
    return result


def rotate(v, angles):
    x,y,z = v
    for axis, angle in enumerate(angles):
        c,s = math.cos(angle),math.sin(angle)
        if axis == 0: y,z = y*c-z*s,y*s+z*c
        elif axis == 1: x,z = x*c+z*s,-x*s+z*c
        else: x,y = x*c-y*s,x*s+y*c
    return x,y,z


def fragment_vertices(fragment, wall, age):
    """解析弹道与角运动，每次按绝对时间求值，可倒放/随机跳帧。"""
    elapsed = max(0., age - wall['impactSec'] - fragment['delay'])
    vx,vy,vz = fragment['velocity']
    cx,cy = fragment['center']
    vertices=[]
    for z in (-.012,.012):
        for x,y in fragment['triangle']:
            rx,ry,rz = rotate((x-cx,y-cy,z), tuple(a*elapsed for a in fragment['spin']))
            wx,wy,wz = cx+rx+vx*elapsed,cy+ry+vy*elapsed-.5*wall['gravity']*elapsed**2,rz+vz*elapsed
            # 碎片向远处散射，正交渲染器中的显式透视投影不会穿过近裁面。
            projection = wall['depth'] / max(.05, wall['depth'] + wz)
            vertices.append((wx*projection,wy*projection,-wz*.001))
    return vertices


PRISM_FACES = ((0,2,1),(3,4,5),(0,1,4,3),(1,2,5,4),(2,0,3,5))


