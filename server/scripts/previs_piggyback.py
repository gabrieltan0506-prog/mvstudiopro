"""背负接触解算；供诊断调用，未通过网格与常速验收前不开放生产入口。"""
import math
from mathutils import Vector, Matrix
from previs_contact_ik import solve_limb


def piggyback_motion(pair, frame):
    """源时间上的滑落/接住曲线；旧关系始终返回零。"""
    event = pair.get('slipCatch')
    if not event:
        return 0., 0.
    t = (frame-1)/24
    start, catch, recovered = (event[key] for key in ('slipStartSec', 'catchSec', 'recoverEndSec'))
    depth = event['dropMeters']
    if t <= start or t >= recovered:
        return 0., 0.
    if t < catch:
        u = (t-start)/(catch-start)
        eased = u*u*(3-2*u)
        # 托腿的手短暂跟不上滑落；到最低点必须重新接住。
        return depth*eased, depth*.65*math.sin(math.pi*u)
    u = (t-catch)/(recovered-catch)
    return depth*(1-u*u*(3-2*u)), 0.


def solve_piggyback(carrier, passenger, drop_m=0., support_gap_m=0.):
    """两具同尺度骨点使用承载者局部坐标；返回双方姿态，不修改输入。"""
    poses = [{k: tuple(v.copy() for v in pair) for k, pair in p.items()}
             for p in (carrier, passenger)]
    a, b = poses
    required = ('pelvis', 'spine', 'neck', 'head')
    if any(k not in p for p in poses for k in required):
        raise ValueError('背负需要两名完整人形骨架')
    # 承重前倾绕骨盆旋转，脚掌保留原落点；重新解腿长，避免整人倾倒或滑脚。
    pivot = a['spine'][0].copy()
    # 依据两侧真实腿长计算抬髋余量，避免把源骨架的深屈膝直接当作负重姿态。
    # 保留3%的屈曲余量与原脚落点，不能靠拉长腿或抬脚换取直立。
    lift_limits = []
    for side in (-1, 1):
        upper, lower = a['upper_leg'+str(side)], a['lower_leg'+str(side)]
        root, foot = upper[0], lower[1]
        reach = ((upper[1]-root).length + (lower[1]-lower[0]).length)*.97
        horizontal_sq = (root.x+.045-foot.x)**2 + (root.y-foot.y)**2
        if horizontal_sq >= reach*reach:
            raise ValueError('背负步幅超过负重站立范围，须先缩短步幅')
        lift_limits.append(math.sqrt(reach*reach-horizontal_sq)-(root.z-foot.z))
    lift = Vector((.045, 0, max(0., min(.12, min(lift_limits)))))
    lean = Matrix.Rotation(.22, 3, 'Y')
    for key, pair in list(a.items()):
        if not key.startswith(('upper_leg', 'lower_leg', 'foot')):
            a[key] = tuple(pivot + lift + lean @ (v-pivot) for v in pair)
    for side in (-1, 1):
        key = str(side)
        upper, lower = 'upper_leg'+key, 'lower_leg'+key
        root = a[upper][0] + lift
        target = a[lower][1].copy()
        solved = solve_limb(root, target, (a[upper][1]-a[upper][0]).length,
                            (a[lower][1]-a[lower][0]).length, (1, 0, 0))
        if solved['unreachableDistance'] > .005:
            raise ValueError('背负承重姿态超出腿长，须调整步幅或骨盆高度')
        joint, end = Vector(solved['joint']), Vector(solved['end'])
        a[upper], a[lower] = (root, joint), (joint, end)
    chest = a['spine'][1]
    # 先锁背部间距与乘员骨盆，再由真实肢体长度解算抱肩及托腿接触。
    shift = chest + Vector((-.32, 0, -.12-drop_m)) - b['spine'][0]
    for key, pair in list(b.items()):
        b[key] = tuple(v + shift for v in pair)
    contacts = []

    def limb(pose, upper, lower, end_name, root, target, bend, tip_direction):
        l1 = (pose[upper][1] - pose[upper][0]).length
        l2 = (pose[lower][1] - pose[lower][0]).length
        tip_len = (pose[end_name][1] - pose[end_name][0]).length
        solved = solve_limb(root, target, l1, l2, bend)
        if solved['unreachableDistance'] > .005:
            raise ValueError('背负接触不可达，须调整身体间距或人物尺度')
        joint, end = Vector(solved['joint']), Vector(solved['end'])
        pose[upper] = (root.copy(), joint)
        pose[lower] = (joint, end)
        pose[end_name] = (end, end + Vector(tip_direction).normalized() * tip_len)
        return end

    for side in (-1, 1):
        key = str(side)
        hip = b['upper_leg'+key][0]
        ankle = chest + Vector((-.04, side*.33, -.65))
        limb(b, 'upper_leg'+key, 'lower_leg'+key, 'foot'+key,
             hip, ankle, (1, side*.3, 0), (1, 0, 0))
        knee = b['lower_leg'+key][0]
        support = knee + Vector((0, 0, -.035+support_gap_m))
        wrist = limb(a, 'upper_arm'+key, 'forearm'+key, 'hand'+key,
                     a['upper_arm'+key][0], support, (-.3, side, -.5), (1, 0, .2))
        shoulder = a['upper_arm'+key][0]
        grip = shoulder + Vector((.075, 0, .025))
        hand = limb(b, 'upper_arm'+key, 'forearm'+key, 'hand'+key,
                    b['upper_arm'+key][0], grip, (.4, side, -.3), (1, 0, -.2))
        contacts.append({'side': side, 'supportGap': (wrist-support).length,
                         'shoulderGripGap': (hand-grip).length})
    return a, b, contacts


def validate_piggyback(spec):
    """渲染器再次校验关系，不依赖前端已执行验证。"""
    pair = spec.get('piggyback')
    if not pair:
        return None
    if not {'carrierId','passengerId'}.issubset(pair) or set(pair)-{'carrierId','passengerId','slipCatch','setDown'}:
        raise ValueError('背负关系字段无效')
    event = pair.get('slipCatch')
    if event:
        if set(event) != {'slipStartSec', 'catchSec', 'recoverEndSec', 'dropMeters'} or not all(
                isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) for v in event.values()):
            raise ValueError('背负滑落事件字段无效')
        if not (0 <= event['slipStartSec'] and
                event['slipStartSec']+.2 <= event['catchSec'] and
                event['catchSec']+.2 <= event['recoverEndSec'] <= spec['durationSec'] and
                .06 <= event['dropMeters'] <= .18):
            raise ValueError('背负滑落须依次设置开始、接住、恢复，且不超出本段')
    actors = {a['id']: a for a in spec['actors']}
    aid, bid = pair['carrierId'], pair['passengerId']
    if aid == bid or aid not in actors or bid not in actors:
        raise ValueError('背负需要两名不同的在场人物')
    a, b = actors[aid], actors[bid]
    if any(p['shape'] != 'human' or p.get('creature') or p.get('weapon') or p.get('riggedModel') for p in (a, b)):
        raise ValueError('背负当前只允许已验基础人形骨架，完整网格尚待验收')
    if spec.get('waterEmergence') or any(aid in (e['actorId'], e['targetActorId']) or bid in (e['actorId'], e['targetActorId']) for e in spec.get('interactions', [])):
        raise ValueError('背负与出水或同人物其他接触冲突')
    if any(e['kind'] not in ('walk', 'idle') and (not pair.get('setDown') or e['startSec'] < pair['setDown']['endSec']) for e in a['actions']) or any(e['kind'] != 'idle' for e in b['actions']):
        raise ValueError('背负乘员不能叠加独立动作')
    if any(a.get(k) != b.get(k) for k in ('start', 'end', 'facingDeg', 'moveStartSec', 'moveEndSec', 'motionRoute')):
        raise ValueError('背负双方须使用同一站位路线')
    down=pair.get('setDown')
    if down:
        if set(down)!={'startSec','groundSec','releaseSec','endSec'} or not all(isinstance(v,(float,int)) and not isinstance(v,bool) and math.isfinite(v) and abs(v*24-round(v*24))<1e-6 for v in down.values()):
            raise ValueError('放下时序字段无效')
        if not (0<=down['startSec'] and down['startSec']+.75<=down['groundSec'] and down['groundSec']+.25<=down['releaseSec'] and down['releaseSec']+.25<=down['endSec']<=spec['durationSec']-1/24):
            raise ValueError('放下须按顺序完成降低、落地、松手、起身')
        if event and event['recoverEndSec']>down['startSec']: raise ValueError('滑落接住与放下冲突')
        route=a.get('motionRoute')
        moving=any(down['startSec']<n['timeSec'] and down['endSec']>route[i-1]['timeSec'] and (n['position']!=route[i-1]['position'] or n['facingDeg']!=route[i-1]['facingDeg']) for i,n in enumerate(route or []) if i>0) if route else (a['start']!=a['end'] and down['startSec']<a['moveEndSec'] and down['endSec']>a['moveStartSec'])
        if moving or any(e['kind']!='idle' and e['startSec']<down['endSec'] and e['endSec']>down['startSec'] for e in a['actions']):
            raise ValueError('放下期间必须停稳，不叠加其他动作')
    return pair


def apply_piggyback(pair, poses, frame, fixed=None):
    """双方同一根变换；一次更新两人的局部姿态，顺序不依赖演员列表。"""
    aid, bid = pair['carrierId'], pair['passengerId']
    if pair.get('setDown'):
        if fixed is None: raise ValueError('放下参考姿态容器缺失')
        if (frame-1)/24 >= pair['setDown']['startSec'] and not fixed:
            fixed.update({k:{name:tuple(v.copy() for v in vs) for name,vs in poses[k].items()} for k in (aid,bid)})
        poses[aid], poses[bid] = set_down_pose(pair, poses[aid], poses[bid], frame, fixed)
        return
    drop, gap = piggyback_motion(pair, frame)
    poses[aid], poses[bid], _ = solve_piggyback(poses[aid], poses[bid], drop, gap)


def measure_piggyback(pair, rigs, scene, update):
    """逐帧读取最终骨架托腿、抱肩与悬空脚，区别于承载者接地。"""
    by_id = {actor['id']: rig for actor, rig, *_ in rigs}
    a, b = by_id[pair['carrierId']], by_id[pair['passengerId']]
    rows = []
    for frame in range(1, scene.frame_end+1):
        scene.frame_set(frame)
        update()
        support, grip, heights = [], [], []
        for side in (-1, 1):
            key = str(side)
            wrist = a.matrix_world @ a.pose.bones['forearm'+key].tail
            knee_target = b.matrix_world @ (b.pose.bones['lower_leg'+key].head + Vector((0, 0, -.035)))
            hand = b.matrix_world @ b.pose.bones['forearm'+key].tail
            shoulder = a.matrix_world @ (a.pose.bones['upper_arm'+key].head + Vector((.075, 0, .025)))
            support.append((wrist-knee_target).length)
            grip.append((hand-shoulder).length)
            heights.append((b.matrix_world @ b.pose.bones['foot'+key].head).z)
        _, expected_gap = piggyback_motion(pair, frame)
        actual_drop = (a.matrix_world @ a.pose.bones['spine'].tail).z - (b.matrix_world @ b.pose.bones['spine'].head).z - .12
        t=(frame-1)/24
        down=pair.get('setDown')
        stage=('carried' if t<=down['startSec'] else 'lowering' if t<down['groundSec'] else 'supported' if t<down['releaseSec'] else 'released' if t<down['endSec'] else 'seated') if down else None
        rows.append({'frame': frame, 'supportError': max(support), 'expectedSupportGap': expected_gap,
                     'actualDropMeters': actual_drop, 'gripError': max(grip), 'passengerFootHeight': min(heights),
                     **({'stage':stage,'pelvisHeight':(b.matrix_world @ b.pose.bones['spine'].head).z,'passengerRoot':list(b.matrix_world.translation)} if down else {})})
    boundary = ('从已背稳到中途滑落、接住并复位的基础人形预演；不含上背、放下或完整衣物网格验收。'
                if pair.get('slipCatch') else
                '整段已背稳的基础人形预演；不含上背、放下或完整衣物网格验收。')
    if pair.get('setDown'): boundary='连续降低、落地支撑、松手和起身；乘员留在原地。程序接触检查不代替逐帧画面与常速验收。'
    return {**pair, 'samples': rows, 'boundaryZh': boundary}

def set_down_pose(pair, carrier, passenger, frame, fixed):
    """从背负连续降低到落地坐姿，支撑后松手；不切换既成姿态。"""
    event = pair['setDown']
    t = (frame-1)/24
    if t <= event['startSec']:
        drop, gap = piggyback_motion(pair, frame)
        a, b, _ = solve_piggyback(carrier, passenger, drop, gap)
        return a, b
    def ease(x):
        x=max(0.,min(1.,x)); return x*x*(3-2*x)
    lower=ease((t-event['startSec'])/(event['groundSec']-event['startSec']))
    release=ease((t-event['groundSec'])/(event['releaseSec']-event['groundSec']))
    rise=ease((t-event['releaseSec'])/(event['endSec']-event['releaseSec']))
    current_carrier=carrier
    carrier,passenger=fixed[pair['carrierId']],fixed[pair['passengerId']]
    carried_a, carried_b, _ = solve_piggyback(carrier, passenger)
    def copy_pose(p): return {k:tuple(v.copy() for v in vs) for k,vs in p.items()}
    a, b = copy_pose(carried_a), copy_pose(carried_b)
    def shift_torso(p, source, target):
        delta=target-source['spine'][0]
        for k,vs in source.items():
            if not k.startswith(('upper_leg','lower_leg','foot')): p[k]=tuple(v+delta for v in vs)
    # 承载者下蹲；松手后从同一落点起身。腿端点由IK保持接地。
    crouch=Vector((.10,0,.32))
    hip=carried_a['spine'][0].lerp(crouch,lower).lerp(carrier['spine'][0],rise)
    shift_torso(a,carried_a,hip)
    for k,vs in list(a.items()):
        if not k.startswith(('upper_leg','lower_leg','foot')): a[k]=tuple(v.lerp(carrier[k][i],rise) for i,v in enumerate(vs))
    # 乘员落地后固定坐在原地，后续承载者位移不再驱动乘员。
    seat=Vector((-.24,0,.14))
    mother_hip=carried_b['spine'][0].lerp(seat,lower)
    shift_torso(b,carried_b,mother_hip)
    def limb(p, source, upper, lower_key, tip, root, target, bend, direction):
        l1=(source[upper][1]-source[upper][0]).length
        l2=(source[lower_key][1]-source[lower_key][0]).length
        result=solve_limb(root,target,l1,l2,bend)
        if result['unreachableDistance']>.005: raise ValueError('放下动作接触不可达，须调整角色间距')
        joint,end=Vector(result['joint']),Vector(result['end'])
        length=(source[tip][1]-source[tip][0]).length
        p[upper]=(root,joint);p[lower_key]=(joint,end)
        p[tip]=(end,end+Vector(direction).normalized()*length)
    for side in (-1,1):
        key=str(side)
        root=carried_a['upper_leg'+key][0]+hip-carried_a['spine'][0]
        limb(a,carrier,'upper_leg'+key,'lower_leg'+key,'foot'+key,root,carrier['lower_leg'+key][1],(1,0,0),(1,0,0))
        root=carried_b['upper_leg'+key][0]+mother_hip-carried_b['spine'][0]
        ankle=carried_b['lower_leg'+key][1].lerp(Vector((.18,side*.33,.065)),lower)
        limb(b,passenger,'upper_leg'+key,'lower_leg'+key,'foot'+key,root,ankle,(1,side*.2,0),(1,0,0))
        support=b['lower_leg'+key][0]+Vector((0,0,-.035))
        natural=carrier['forearm'+key][1]
        wrist=support.lerp(natural,rise)
        limb(a,carrier,'upper_arm'+key,'forearm'+key,'hand'+key,a['upper_arm'+key][0],wrist,(-.3,side,-.5),(1,0,.2))
        grip=a['upper_arm'+key][0]+Vector((.075,0,.025))
        lap=b['lower_leg'+key][0]+Vector((-.04,0,.07))
        limb(b,passenger,'upper_arm'+key,'forearm'+key,'hand'+key,b['upper_arm'+key][0],grip.lerp(lap,release),(.4,side,-.3),(1,0,-.2))
    if t >= event['endSec']:
        a=copy_pose(current_carrier)
    return a,b
