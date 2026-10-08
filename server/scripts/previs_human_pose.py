"""只校验人工提供的人体关节点；不识别人形，不生成骨骼或媒体。"""
import math


def validate_human_arm_pose(points, pose):
    if pose not in ("A", "T", "bent_arms"):
        raise ValueError("人体姿态须为 A/T 或直立屈臂")
    required = [key + str(side) for side in (-1, 1) for key in ("upper_arm", "forearm", "hand", "upper_leg", "lower_leg")]
    for name in required:
        pair = points.get(name)
        if pair is None or len(pair) != 2 or any(len(v) != 3 or any(not math.isfinite(float(x)) for x in v) for v in pair):
            raise ValueError("人工关节点须完整且坐标有限")
        if not .02 <= math.dist(*pair) <= 1:
            raise ValueError("人工骨长不在支持范围")
    for side in (-1, 1):
        suffix = str(side)
        upper, forearm, hand = (points[key + suffix] for key in ("upper_arm", "forearm", "hand"))
        if any(math.dist(a[1], b[0]) > .005 for a, b in ((upper, forearm), (forearm, hand))):
            raise ValueError("人工手臂关节必须连续")
        if pose == "bent_arms":
            # 屈臂的手可在胸前，不能套用展臂末端宽度；左右肩仍必须明确。
            if upper[0][1] * side <= 0:
                raise ValueError("屈臂关节点须明确左右肩，不能交换或位于中轴")
        else:
            arm = tuple(b-a for a, b in zip(upper[0], hand[1]))
            if arm[1] * side < .25 or abs(arm[0]) > .15 or arm[2] > .05 or arm[2] < -.7:
                raise ValueError("人工关节点不符合 +X 朝向的 A/T 展臂范围")
            if pose == "T" and abs(arm[2]) > .08:
                raise ValueError("T 型手臂必须接近水平")
        for key in ("upper_leg", "lower_leg"):
            head, tail = points[key + suffix]
            if tail[2] >= head[2]:
                raise ValueError("腿部关节点必须符合直立姿态")


def human_posture_lean(posture, t):
    """坐起后保持；后续镜头可用 hold/sit 延续，不自动回到站姿。"""
    if posture['mode'] == 'hold':
        return 0. if posture['posture'] == 'sit' else math.radians(posture['reclineDeg'])
    u = max(0., min(1., (t-posture['startSec'])/(posture['endSec']-posture['startSec'])))
    return math.radians(posture['reclineDeg'])*(1-u*u*(3-2*u))


def apply_human_posture(points, posture, t):
    """基础人形坐卧：躯干绕座面支点旋转，双腿复用两节IK，全部原骨長保持。"""
    from previs_contact_ik import solve_limb
    p = {name: tuple(tuple(v) for v in pair) for name, pair in points.items()}
    pivot = p['spine'][0]
    angle = human_posture_lean(posture, t)
    c, s = math.cos(angle), math.sin(angle)
    # pelvis段长为.08米，支撑面接其下端；躯干坐起围绕同一支点。
    pelvis_length = math.dist(*p['pelvis'])
    center = (pivot[0], pivot[1], posture['supportHeight']+pelvis_length)
    def rotate(v):
        x,y,z = (v[i]-pivot[i] for i in range(3))
        return (center[0]+c*x-s*z, center[1]+y, center[2]+s*x+c*z)
    out = {name: tuple(rotate(v) for v in pair) for name,pair in p.items()}
    # 骨盆保持竖直坐在支撑面；上身后仰不让骨盆支点悬空。
    out['pelvis'] = ((center[0],center[1],posture['supportHeight']), center)
    for side in ('-1','1'):
        hip,knee = p['upper_leg'+side]
        _,ankle = p['lower_leg'+side]
        _,toe = p['foot'+side]
        root = (center[0], hip[1], center[2])
        target = (center[0]+.32, ankle[1], ankle[2])
        upper,lower = math.dist(hip,knee),math.dist(knee,ankle)
        solved = solve_limb(root,target,upper,lower,(1,0,0))
        if solved['unreachableDistance']>.005:
            raise ValueError('坐卧支撑高度超出腿长可达范围')
        end=solved['end']
        out['upper_leg'+side]=(root,solved['joint'])
        out['lower_leg'+side]=(solved['joint'],end)
        out['foot'+side]=(end,(end[0]+math.dist(ankle,toe),end[1],end[2]))
    return out


def validate_human_posture(actor, spec):
    p=actor.get('humanPosture')
    if p is None: return
    if not isinstance(p,dict) or p.get('mode') not in ('hold','rise_to_sit'):
        raise ValueError('坐卧模式无效')
    keys={'mode','supportHeight','reclineDeg'}|({'posture'} if p['mode']=='hold' else {'startSec','endSec'})
    if set(p)!=keys or (p['mode']=='hold' and p['posture'] not in ('sit','recline')):
        raise ValueError('坐卧字段不完整或含未知字段')
    for key,low,high in [('supportHeight',.25,.65),('reclineDeg',25,70)]:
        if type(p[key]) not in (float,int) or not math.isfinite(p[key]) or not low<=p[key]<=high:
            raise ValueError('坐卧支撑高度或后仰角无效')
    if (actor['shape']!='human' or any(actor.get(k) is not None for k in ('creature','motionRoute','visibleRanges'))
        or any(a['kind']!='idle' for a in actor['actions']) or any(abs(a-b)>1e-6 for a,b in zip(actor['start'],actor['end']))
        or any(c.get('actorId')==actor['id'] for c in spec.get('handContacts',[]))
        or any(prop.get('grip',{}).get('actorId')==actor['id'] for prop in spec.get('storyProps',[]))
        or spec.get('waterEmergence') or (spec.get('piggyback') and actor['id'] in (spec['piggyback']['carrierId'],spec['piggyback']['passengerId']))
        or any(actor['id'] in (e['actorId'],e['targetActorId']) for e in spec.get('interactions',[]))):
        raise ValueError('坐卧支撑仅限原地整段人体idle，不支持位移、出水或双人接触叠加')
    if p['mode']=='rise_to_sit':
        times=[p['startSec'],p['endSec']]
        if (any(type(t) not in (float,int) or not math.isfinite(t) or t<0 or abs(t*24-round(t*24))>1e-6 for t in times)
            or times[1]-times[0]<.5 or times[1]>(spec['durationSec']*24-1)/24):
            raise ValueError('坐起秒窗须24帧对齐、至少0.5秒且末帧前完成')
