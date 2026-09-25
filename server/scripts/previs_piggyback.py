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
    if set(pair) not in ({'carrierId', 'passengerId'}, {'carrierId', 'passengerId', 'slipCatch'}):
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
    if any(e['kind'] not in ('walk', 'idle') for e in a['actions']) or any(e['kind'] != 'idle' for e in b['actions']):
        raise ValueError('背负乘员不能叠加独立动作')
    if any(a.get(k) != b.get(k) for k in ('start', 'end', 'facingDeg', 'moveStartSec', 'moveEndSec', 'motionRoute')):
        raise ValueError('背负双方须使用同一站位路线')
    return pair


def apply_piggyback(pair, poses, frame):
    """双方同一根变换；一次更新两人的局部姿态，顺序不依赖演员列表。"""
    aid, bid = pair['carrierId'], pair['passengerId']
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
        rows.append({'frame': frame, 'supportError': max(support), 'expectedSupportGap': expected_gap,
                     'actualDropMeters': actual_drop, 'gripError': max(grip), 'passengerFootHeight': min(heights)})
    boundary = ('从已背稳到中途滑落、接住并复位的基础人形预演；不含上背、放下或完整衣物网格验收。'
                if pair.get('slipCatch') else
                '整段已背稳的基础人形预演；不含上背、放下或完整衣物网格验收。')
    return {**pair, 'samples': rows, 'boundaryZh': boundary}
