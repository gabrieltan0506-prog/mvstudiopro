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
        if event['id'] in ids or event['kind'] not in ('strike_recoil', 'strike_guard', 'sword_guard', 'support_walk'):
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
        if event['kind']=='support_walk' and (end!=spec['durationSec'] or contact-start<1 or spec.get('waterEmergence') or
                any(actors[event[k]].get('riggedModel') or actors[event[k]].get('weapon') for k in ('actorId','targetActorId')) or
                any(event[k] in (spec.get('piggyback',{}).get('carrierId'),spec.get('piggyback',{}).get('passengerId')) for k in ('actorId','targetActorId'))):
            raise ValueError('搀扶需要基础人体、至少1秒扶稳、保持至片尾，不能叠加背负或出水')
        if event['kind']=='support_walk':
            from previs_route import route_pose
            def root_at(actor,t):
                if actor.get('motionRoute'): return route_pose(actor,t)[0]
                u=max(0.,min(1.,(t-actor['moveStartSec'])/(actor['moveEndSec']-actor['moveStartSec'])))
                return Vector((*actor['start'],0)).lerp(Vector((*actor['end'],0)),u)
            for key in ('actorId','targetActorId'):
                participant=actors[event[key]]; origin=root_at(participant,start)
                if any((root_at(participant,f/24)-origin).length>.005 for f in range(round(start*24),round(contact*24)+1)):
                    raise ValueError('搀扶抬手至扶稳期间须停立，路线必须包含停顿节点')
                if (root_at(participant,(spec['durationSec']*24-1)/24)-origin).length<.1:
                    raise ValueError('扶稳同行需要真实走位，不能只站着搭肩')
        for key in ('actorId', 'targetActorId'):
            actor = actors[event[key]]
            for a, b in occupied.get(actor['id'], []) + [(a['startSec'], a['endSec']) for a in actor['actions'] if not (event['kind']=='support_walk' and a['kind'] in ('walk','idle'))]:
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
        if event['kind']=='support_walk':
            # 同帧实际根矩阵确定近侧，不按演员数组顺序猜测；扶稳后每帧检查空间和朝向。
            relative=am.inverted() @ tm.translation
            side=1 if relative.y>0 else -1
            if t>=contact and (abs(relative.x)>.10 or not .55<=abs(relative.y)<=.75 or
                               am.to_quaternion().rotation_difference(tm.to_quaternion()).angle>.05):
                raise ValueError('搀扶双方须同向同步，保持0.55—0.75米侧向间距且前后差不超过0.1米')
            weight=smooth((t-start)/(contact-start))
            shoulder=am @ attack['upper_arm'+str(side)][0]
            patient_side=-side
            wanted=tm.inverted() @ shoulder
            aim_arm(target,patient_side,arm_tip(target,patient_side).lerp(wanted,weight),ik)
            a,b=target['forearm'+str(patient_side)]
            support=am.inverted() @ (tm @ a.lerp(b,.5))
            aim_arm(attack,side,arm_tip(attack,side).lerp(support,weight),ik)
            continue
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
        if event['kind']=='support_walk':
            samples=[]
            attack,target=by_id[event['actorId']],by_id[event['targetActorId']]
            for frame in range(round(event['contactSec']*24)+1,round(event['endSec']*24)+1):
                scene.frame_set(frame); update()
                relative=attack.matrix_world.inverted() @ target.matrix_world.translation
                side=1 if relative.y>0 else -1
                grip=target.matrix_world @ target.pose.bones['hand'+str(-side)].tail
                shoulder=attack.matrix_world @ attack.pose.bones['upper_arm'+str(side)].head
                support=attack.matrix_world @ attack.pose.bones['hand'+str(side)].tail
                forearm=target.pose.bones['forearm'+str(-side)]
                wanted=target.matrix_world @ forearm.head.lerp(forearm.tail,.5)
                samples.append({'frame':frame,'actualPoint':list(support),'targetPoint':list(wanted),
                                'gripPoint':list(grip),'shoulderPoint':list(shoulder)})
            first=samples[0]
            result.append({**{k:event[k] for k in ('id','kind','actorId','targetActorId')},
                           'contactFrame':first['frame'],'contactError':(Vector(first['actualPoint'])-Vector(first['targetPoint'])).length,
                           'actualPoint':first['actualPoint'],'targetPoint':first['targetPoint'],'supportSamples':samples})
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
