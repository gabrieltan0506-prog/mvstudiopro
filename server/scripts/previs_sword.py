"""人体白模右手练习剑。固定尺寸与双人事件，无外部资产或可执行输入。"""
import math
import bpy
from mathutils import Vector
from bpy_extras.object_utils import world_to_camera_view

BLADE = .75
CONTACT = BLADE / 2
HAND = .09
HALF_WIDTH = .025
READY_DIRECTION = Vector((.8, 0, .6))


def smooth(u):
    u = max(0., min(1., u))
    return u*u*(3-2*u)


def validate_swords(spec):
    for actor in spec['actors']:
        weapon = actor.get('weapon')
        if weapon and (weapon != 'practice_sword' or actor['shape'] != 'human'
                       or actor.get('riggedModel') or any(a['kind'] != 'idle' for a in actor['actions'])):
            raise ValueError('练习剑只支持人体白模待机与持剑格挡')
    actors = {a['id']: a for a in spec['actors']}
    for event in spec.get('interactions', []):
        pair = [actors.get(event[k], {}) for k in ('actorId', 'targetActorId')]
        if event['kind'] == 'sword_guard':
            if not all(a.get('weapon') == 'practice_sword' for a in pair):
                raise ValueError('持剑格挡需要双方装备练习剑')
        elif any(a.get('weapon') for a in pair):
            raise ValueError('持剑角色不能使用徒手接触事件')


def aim(pose, tip, direction, ik):
    direction = direction.normalized()
    shoulder = pose['upper_arm-1'][0]
    wrist = tip-direction*HAND
    length = (wrist-shoulder).length
    if not .04 < length < .57998:
        raise ValueError('持剑手腕不可达，请调整双方距离和朝向')
    elbow, actual = ik(shoulder, wrist, .29, .29, (0, -1, -.4))
    pose['upper_arm-1'] = (shoulder, elbow)
    pose['forearm-1'] = (elbow, actual)
    pose['hand-1'] = (actual, actual+direction*HAND)


def apply_swords(spec, frame, poses, transforms, ik):
    t = (frame-1)/24
    # 事件外也保持同一持握姿态，切镜不重置或卸下剑。
    for actor in spec['actors']:
        if not actor.get('weapon'):
            continue
        pose = poses[actor['id']]
        tip = pose['upper_arm-1'][0]+Vector((.27, -.08, -.20))
        aim(pose, tip, READY_DIRECTION, ik)
    for event in spec.get('interactions', []):
        if event['kind'] != 'sword_guard':
            continue
        start, contact, end = (event[k] for k in ('startSec', 'contactSec', 'endSec'))
        if not start < t < end:
            continue
        aid, tid = event['actorId'], event['targetActorId']
        am, tm = transforms[aid], transforms[tid]
        between = tm.translation-am.translation
        between.z = 0
        if between.length < .4:
            raise ValueError('双方站位过近，无法进行持剑格挡')
        forward = between.normalized()
        for matrix, facing in ((am, forward), (tm, -forward)):
            if (matrix.to_3x3() @ Vector((1, 0, 0))).dot(facing) < .85:
                raise ValueError('持剑格挡须双方基本相向')
        center = (am.translation+tm.translation)/2+Vector((0, 0, 1.40))
        before = t <= contact
        u = (t-start)/(contact-start) if before else (t-contact)/(end-contact)
        weight = smooth(u) if before else 1-smooth(u)
        for actor_id, matrix, direction in ((aid, am, forward), (tid, tm, -forward)):
            pose = poses[actor_id]
            # 受方卸力仅从接触后开始；事件结束回到同一准备姿态。
            reaction = math.sin(math.pi*u) if not before and actor_id == tid else 0.
            recoil = Vector((-.05*reaction, 0, -.02*reaction))
            if reaction:
                a, b = pose['spine']
                pose['spine'] = (a, b+recoil)
                for name in list(pose):
                    if name in ('neck', 'head') or name.startswith(('upper_arm', 'forearm', 'hand')):
                        a, b = pose[name]
                        pose[name] = (a+recoil, b+recoil)
            blade_direction = (direction+Vector((0, 0, 1))).normalized()
            local_direction = matrix.to_3x3().inverted() @ blade_direction
            blade_center = center+direction.cross(Vector((0, 0, 1)))*HALF_WIDTH
            wanted = matrix.inverted() @ (blade_center-blade_direction*CONTACT)
            base = pose['hand-1'][1]
            tip = base.lerp(wanted, weight)
            if before and actor_id == aid:
                tip += Vector((-.10, 0, .06))*math.sin(math.pi*u)
            aim(pose, tip, READY_DIRECTION.lerp(local_direction, weight), ik)


def build_swords(spec, rigs, scene):
    handles = []
    for actor, rig, *_ in rigs:
        if not actor.get('weapon'):
            continue
        bpy.ops.object.empty_add()
        root = bpy.context.object
        root.name = actor['id']+'_练习剑'
        # 本地Y轴与手骨一致：握柄穿过掌心，剑刃自手端延伸。
        for name, low, high, width, color in (
                ('剑刃', HAND, HAND+BLADE, HALF_WIDTH, (.75, .8, .86)),
                ('护手', HAND-.015, HAND+.015, .13, (.25, .28, .3)),
                ('握柄', -.07, HAND-.015, .035, (.20, .12, .07))):
            bpy.ops.mesh.primitive_cube_add(size=2)
            obj = bpy.context.object
            obj.name = actor['id']+'_'+name
            obj.parent = root
            obj.location = (0, (low+high)/2, 0)
            obj.scale = (width, (high-low)/2, .018)
            mat = bpy.data.materials.new(obj.name)
            mat.diffuse_color = (*color, 1)
            obj.data.materials.append(mat)
        for frame in range(1, scene.frame_end+1):
            scene.frame_set(frame)
            bpy.context.view_layer.update()
            bone = rig.pose.bones['hand-1']
            root.matrix_world = rig.matrix_world @ bone.matrix
            for prop in ('location', 'rotation_euler', 'scale'):
                root.keyframe_insert(prop, frame=frame)
        handles.append((actor, rig, root))
    return handles


def measure_swords(handles, events, scene):
    rows = []
    by_id = {actor['id']: (rig, root) for actor, rig, root in handles}
    for actor, rig, root in handles:
        samples = []
        for frame in range(1, scene.frame_end+1):
            scene.frame_set(frame)
            bpy.context.view_layer.update()
            wrist = rig.matrix_world @ rig.pose.bones['hand-1'].head
            tip = rig.matrix_world @ rig.pose.bones['hand-1'].tail
            base = root.matrix_world @ Vector((0, HAND, 0))
            end = root.matrix_world @ Vector((0, HAND+BLADE, 0))
            projected = [world_to_camera_view(scene, scene.camera, p) for p in (base, end)]
            samples.append({'frame': frame, 'wrist': list(wrist), 'bladeBase': list(base),
                            'bladeTip': list(end), 'contactPoint': list(root.matrix_world @ Vector((-HALF_WIDTH, HAND+CONTACT, 0))), 'gripError': (root.matrix_world.translation-wrist).length,
                            'handEndError': (tip-base).length,
                            'offscreen': any(p.z <= 0 or not .02 <= p.x <= .98 or not .02 <= p.y <= .98 for p in projected)})
        rows.append({'actorId': actor['id'], 'preset': 'practice_sword', 'bladeLength': BLADE,
                     'samples': samples})
    contacts = []
    for event in events:
        if event['kind'] != 'sword_guard':
            continue
        frame = round(event['contactSec']*24)+1
        scene.frame_set(frame)
        bpy.context.view_layer.update()
        points = [by_id[event[key]][1].matrix_world @ Vector((-HALF_WIDTH, HAND+CONTACT, 0))
                  for key in ('actorId', 'targetActorId')]
        contacts.append({**{k: event[k] for k in ('id', 'kind', 'actorId', 'targetActorId')},
                         'contactFrame': frame, 'contactError': (points[0]-points[1]).length,
                         'actualPoint': list(points[0]), 'targetPoint': list(points[1])})
    return rows, contacts
