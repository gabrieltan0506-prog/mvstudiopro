"""杯体、果摊的确定性分块几何与先快后慢运动；不读取原片或执行外部代码。"""
import hashlib
import math
import random

KINDS = ('cup_fracture', 'fruit_stall_fracture')


def validate_prop(kind, params, duration):
    from manhua_vfx_math import keys, number
    keys(params, ('impactSec', 'spread', 'slowMotion', 'gravity', 'staggerSec', 'holdStartSec', 'holdDurationSec'))
    for key, lo, hi in (('impactSec', 0, 30), ('spread', .1, 3), ('slowMotion', .03, 1),
                        ('gravity', 0, 6), ('staggerSec', 0, .5), ('holdStartSec', 0, 30), ('holdDurationSec', .1, 10)):
        number(params[key], lo, hi, key)
    if kind not in KINDS:
        raise ValueError('未知道具碎裂类型')
    if kind == 'cup_fracture' and params['staggerSec'] != 0:
        raise ValueError('单个杯体不接受连续爆点间隔')
    last = params['impactSec'] + (3 * params['staggerSec'] if kind == 'fruit_stall_fracture' else 0)
    if last >= duration:
        raise ValueError('最后一个爆点须位于图层时间窗内')
    if params['holdStartSec']<=last or params['holdStartSec']+params['holdDurationSec']>duration:
        raise ValueError('定格须晚于全部爆点且不超出图层时间窗')
    return last


def paused_age(age, params):
    if age<params['holdStartSec']:return age
    if age<params['holdStartSec']+params['holdDurationSec']:return params['holdStartSec']
    return age-params['holdDurationSec']


def motion_clock(age, params, group):
    """爆发0.10秒保持常速，随后连续减速；不改变任何视频帧时间。"""
    elapsed = max(0., paused_age(age, params) - params['impactSec'] - group * params['staggerSec'])
    return min(elapsed, .10) + max(0., elapsed - .10) * params['slowMotion']


def fragment_pose(fragment, age, params):
    moving = age >= params['impactSec'] + fragment['group'] * params['staggerSec']
    t = motion_clock(age, params, fragment['group'])
    center, velocity = fragment['center'], fragment['velocity']
    position = [center[i] + velocity[i] * params['spread'] * t for i in range(3)]
    position[1] -= .5 * params['gravity'] * t * t
    return {'position': position, 'rotation': [value * t for value in fragment['spin']],
            'visible': moving or fragment['material'] not in ('coffee', 'juice'),
            'exploded': moving, 'motionSec': t}


def prop_fragments(event, seed):
    """每块都有闭合实体或可弯曲薄片、材质职责、初始位置、爆点组和独立转速。"""
    rng = random.Random(seed ^ int(hashlib.sha256(event['id'].encode()).hexdigest()[:8], 16))
    result = []

    def add(vertices, faces, material, group=0, face_materials=None):
        center = [sum(v[i] for v in vertices) / len(vertices) for i in range(3)]
        angle = rng.uniform(0, math.tau)
        speed = rng.uniform(.55, 1.35)
        result.append({'vertices': [[v[i] - center[i] for i in range(3)] for v in vertices],
                       'faces': faces, 'center': center, 'material': material,
                       'faceMaterials': face_materials, 'group': group,
                       'velocity': [math.cos(angle) * speed, abs(math.sin(angle)) * speed + .25,
                                    rng.uniform(-.5, .5)],
                       'spin': [rng.uniform(-6, 6) for _ in range(3)]})

    box_faces = [(0, 1, 2, 3), (7, 6, 5, 4), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)]

    def box(center, size, material, group):
        x, y, z = center; a, b, c = (value / 2 for value in size)
        add([(x-a,y-b,z-c),(x+a,y-b,z-c),(x+a,y+b,z-c),(x-a,y+b,z-c),
             (x-a,y-b,z+c),(x+a,y-b,z+c),(x+a,y+b,z+c),(x-a,y+b,z+c)], box_faces, material, group)

    def drop(center, radius, material, group):
        x,y,z = center
        verts=[(x+radius,y,z),(x-radius,y,z),(x,y+radius*1.8,z),(x,y-radius*1.8,z),
               (x,y,z+radius),(x,y,z-radius)]
        faces=[(a,b,c) for a,b in ((0,2),(2,1),(1,3),(3,0)) for c in (4,5)]
        add(verts,faces,material,group)

    if event['kind'] == 'cup_fracture':
        # 有厚度的杯壁，三层十六瓣；每瓣含三段弧线，不用平片冒充圆杯。
        for row in range(3):
            y0,y1 = -.24 + row*.16, -.24 + (row+1)*.16
            for column in range(16):
                vertices=[]
                for radius_delta in (0., -.024):
                    for y in (y0,y1):
                        radius=.20 + (y+.24)*.08 + radius_delta
                        for j in range(4):
                            angle=(column+j/3)*math.tau/16
                            vertices.append((radius*math.cos(angle),y,radius*math.sin(angle)))
                faces=[]
                for j in range(3):
                    faces.extend([(j,j+1,j+5,j+4),(j+12,j+13,j+9,j+8),
                                  (j+8,j+9,j+1,j),(j+4,j+5,j+13,j+12)])
                faces.extend([(0,4,12,8),(3,11,15,7)])
                add(vertices,faces,'ceramic')
        # 杯底有实体厚度；把手由相接的弯曲管段组成，爆裂后仍可识别曲率。
        for i in range(16):
            a,b=i*math.tau/16,(i+1)*math.tau/16
            vertices=[(0,y,0) for y in (-.26,-.24)]
            vertices += [(r*math.cos(t),y,r*math.sin(t)) for y in (-.26,-.24) for t in (a,b) for r in (.20,)]
            add(vertices,[(0,2,3),(1,5,4),(0,1,4,2),(2,4,5,3),(3,5,1,0)],'ceramic')
        for i in range(12):
            vertices=[]
            for j in (i,i+1):
                angle=-math.pi*.65+j/12*math.pi*1.3
                for k in range(6):
                    cross=k*math.tau/6
                    r=.15+.026*math.cos(cross)
                    vertices.append((.22+r*math.cos(angle),.01+r*math.sin(angle),.026*math.sin(cross)))
            faces=[(k,(k+1)%6,(k+1)%6+6,k+6) for k in range(6)] + [tuple(range(5,-1,-1)),tuple(range(6,12))]
            add(vertices,faces,'ceramic')
        for i in range(40):
            a=rng.uniform(0,math.tau);r=rng.uniform(0,.16)
            drop((r*math.cos(a),.16,r*math.sin(a)),rng.uniform(.008,.018),'coffee',0)
    else:
        # 四组摊位各有完整木箱、两颗分瓣水果、花瓣和纸张，沿街方向依次炸开。
        for group in range(4):
            cx=(group-1.5)*.40
            for level in range(3):
                y=-.20+level*.06
                box((cx,y,.14),(.36,.045,.035),'wood',group)
                box((cx,y,-.14),(.36,.045,.035),'wood',group)
                for side in (-1,1):box((cx+side*.17,y,0),(.035,.045,.30),'wood',group)
            for side in (-1,1):box((cx+side*.09,-.23,0),(.15,.025,.30),'wood',group)
            for fruit in range(2):
                center=(cx+(fruit-.5)*.16,-.01,.02+(fruit-.5)*.06)
                radius=.102
                skin='lemon' if (group+fruit)%2 else 'apple'
                for wedge in range(8):
                    vertices=[]
                    for longitude in (wedge*math.tau/8,(wedge+1)*math.tau/8):
                        for latitude in range(9):
                            phi=latitude*math.pi/8
                            vertices.append((center[0]+radius*math.sin(phi)*math.cos(longitude),
                                             center[1]+radius*math.cos(phi),
                                             center[2]+radius*math.sin(phi)*math.sin(longitude)))
                    faces=[(j,j+1,j+10,j+9) for j in range(8)]
                    # 两个切面从果心闭合到弧面，分离后显露果肉。
                    vertices.append(center)
                    faces += [(18,j+1,j) for j in range(8)] + [(18,j+9,j+10) for j in range(8)]
                    add(vertices,faces,skin,group,[skin]*8+['flesh']*16)
            for i in range(12):
                drop((cx+rng.uniform(-.12,.12),.03,rng.uniform(-.10,.10)),rng.uniform(.007,.014),'juice',group)
            for i in range(8):
                x=cx+rng.uniform(-.12,.12);y=rng.uniform(.07,.16);z=rng.uniform(-.10,.10)
                # 弯曲花瓣，中央脊线产生折面，不是全屏平面贴花。
                add([(x-.015,y,z),(x,y+.03,z+.014),(x+.015,y,z),(x,y-.024,z+.008)],
                    [(0,1,3),(1,2,3)],'petal',group)
            for i in range(4):
                x=cx+rng.uniform(-.12,.12);y=-.09+i*.005;z=rng.uniform(-.1,.1)
                add([(x-.04,y,z-.025),(x+.04,y,z-.025),(x+.04,y+.008,z+.025),(x-.04,y+.008,z+.025)],
                    [(0,1,2,3)],'paper',group)
    if len(result)>256 or sum(len(fragment['vertices']) for fragment in result)>6000:
        raise ValueError('道具碎裂几何超过预算')
    return result
