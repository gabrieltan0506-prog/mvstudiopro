"""双人事件的受控姿态编排。所有目标由同一帧双方实际站位计算，不读取用户脚本。"""
import math
from mathutils import Vector


def smooth(value):
    u = max(0., min(1., value))
    return u*u*(3-2*u)


def validate_interactions(spec):
    actors = {a['id']: a for a in spec['actors']}
    events = spec.get('interactions', [])
    occupied = {}
    ids = set()
    for event in events:
        if event['id'] in ids or event['kind'] not in ('strike_recoil', 'strike_guard', 'sword_guard'):
            raise ValueError('互动编号重复或动作类型无效')
        ids.add(event['id'])
        if event['actorId'] == event['targetActorId']:
            raise ValueError('互动需要两名不同角色')
        for key in ('actorId', 'targetActorId'):
            if key not in event or event[key] not in actors or actors[event[key]]['shape'] != 'human':
                raise ValueError('互动只支持已存在的两名人形角色')
        times = [event[k] for k in ('startSec', 'contactSec', 'endSec')]
        if any(not isinstance(t, (float, int)) or isinstance(t, bool) or not math.isfinite(t)
               or abs(t*24-round(t*24)) > 1e-6 for t in times):
            raise ValueError('互动时间必须对齐24帧时间轴')
        start, contact, end = times
        if not 0 <= start < contact < end <= spec['durationSec'] or contact >= spec['durationSec']:
            raise ValueError('互动起点、接触点与终点次序无效')
        for key in ('actorId', 'targetActorId'):
            actor = actors[event[key]]
            for a, b in occupied.get(actor['id'], []) + [(a['startSec'], a['endSec']) for a in actor['actions']]:
                if start < b and a < end:
                    raise ValueError('互动与角色其他动作时间冲突')
            occupied.setdefault(actor['id'], []).append((start, end))
    return events


def arm_tip(pose, side):
    return pose['hand'+str(side)][1]


def aim_arm(pose, side, tip, ik):
    """拳端接触，腕点向肩收回9cm；不可达不伪装成接触成功。"""
    key = str(side)
    shoulder = pose['upper_arm'+key][0]
    delta = tip-shoulder
    if delta.length < .10001 or delta.length > .66998:
        raise ValueError('双人接触不可达，请调整双方距离或站位')
    wrist = tip-delta.normalized()*.09
    elbow, actual_wrist = ik(shoulder, wrist, .29, .29, (0, side, -.4))
    pose['upper_arm'+key] = (shoulder, elbow)
    pose['forearm'+key] = (elbow, actual_wrist)
    pose['hand'+key] = (actual_wrist, tip)


def apply_interactions(events, frame, poses, transforms, ik):
    """输入同一帧所有人的局部骨点；统一修改双方，且与角色枚举顺序无关。"""
    t = (frame-1)/24
    for event in events:
        if event['kind'] == 'sword_guard':
            continue
        start, contact, end = (event[k] for k in ('startSec', 'contactSec', 'endSec'))
        if not start < t < end:
            continue
        aid, tid = event['actorId'], event['targetActorId']
        attack, target = poses[aid], poses[tid]
        am, tm = transforms[aid], transforms[tid]
        # 受击只在真实接触时刻后发生；回到事件结束时的中性姿态。
        reaction = math.sin(math.pi*max(0., (t-contact)/(end-contact))) if t >= contact else 0.
        recoil = Vector((-.06*reaction, 0, -.025*reaction))
        if event['kind'] == 'strike_recoil':
            a, b = target['spine']
            target['spine'] = (a, b+recoil)
            for name in list(target):
                if name in ('neck', 'head') or name.startswith(('upper_arm', 'forearm', 'hand')):
                    a, b = target[name]
                    target[name] = (a+recoil, b+recoil)
            target_tip = tm @ (target['spine'][1]+Vector((.15, 0, 0)))
        else:
            # 格挡者右手提前抬到胸前，双方在同一事件接触该手端点。
            guard = smooth((t-start)/(contact-start)) if t <= contact else 1-smooth((t-contact)/(end-contact))
            desired = target['spine'][1]+Vector((.28, 0, .10))
            tip = arm_tip(target, 1).lerp(desired, guard)
            aim_arm(target, 1, tip, ik)
            target_tip = tm @ arm_tip(target, 1)
        # 接触帧到同一目标；之前蓄力，之后恢复，双方同一事件时钟。
        base = arm_tip(attack, -1)
        wanted = am.inverted() @ target_tip
        if t <= contact:
            u = (t-start)/(contact-start)
            wind = base+Vector((-.12, 0, .08))
            tip = base.lerp(wind, smooth(u/.30)) if u < .30 else wind.lerp(wanted, smooth((u-.30)/.70))
        else:
            tip = wanted.lerp(base, smooth((t-contact)/(end-contact)))
        aim_arm(attack, -1, tip, ik)


def measure_interactions(events, rigs, scene, update):
    """从烘焙后真实pose读回接触，不使用规划坐标充当验收值。"""
    by_id = {actor['id']: rig for actor, rig, *_ in rigs}
    result = []
    for event in events:
        if event['kind'] == 'sword_guard':
            continue
        frame = math.floor(event['contactSec']*24+.5)+1
        scene.frame_set(frame)
        update()
        attack, target = by_id[event['actorId']], by_id[event['targetActorId']]
        actual = attack.matrix_world @ attack.pose.bones['hand-1'].tail
        wanted = target.matrix_world @ (target.pose.bones['hand1'].tail if event['kind'] == 'strike_guard'
                  else target.pose.bones['spine'].tail+Vector((.15, 0, 0)))
        result.append({**{k:event[k] for k in ('id', 'kind', 'actorId', 'targetActorId')},
                       'contactFrame':frame, 'contactError':(actual-wanted).length,
                       'actualPoint':list(actual), 'targetPoint':list(wanted)})
    return result
