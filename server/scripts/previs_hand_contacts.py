"""明确的人手到马头颈接触；只做既有两骨IK与接触报告，不生成新动作引擎。"""
def hand_contact_amount(c,t):
    def smooth(v):
        u=max(0.,min(1.,v));return u*u*(3-2*u)
    if t<c['startSec'] or t>c['endSec']:return 0.
    into=1. if c['contactSec']==c['startSec'] else smooth((t-c['startSec'])/(c['contactSec']-c['startSec']))
    out=1. if c['endSec']==c['releaseSec'] else smooth((c['endSec']-t)/(c['endSec']-c['releaseSec']))
    return into*out


def solve_hand_to_world(rig,mapping,hand_name,target_world,frame):
    import bpy
    from mathutils import Matrix,Vector
    from previs_contact_ik import solve_limb
    side=hand_name[4:]
    names=['upper_arm'+side,'forearm'+side,'hand'+side]
    upper,lower,hand=[rig.pose.bones[mapping[name] if mapping else name] for name in names]
    target=rig.matrix_world.inverted() @ target_world
    shoulder=upper.head.copy();bend=lower.head-upper.head
    solution=solve_limb(tuple(shoulder),tuple(target),upper.bone.length,lower.bone.length,tuple(bend))
    world_scale=max(rig.matrix_world.to_scale())
    if solution['unreachableDistance']*world_scale>.005:
        raise ValueError('接触目标超过真实手臂可达距离，请调整人物站位')
    elbow,wrist=Vector(solution['joint']),Vector(solution['end'])
    hand_direction=(hand.tail-hand.head).normalized()
    for bone,start,end in ((upper,shoulder,elbow),(lower,elbow,wrist),(hand,wrist,wrist+hand_direction*hand.bone.length)):
        rotation=bone.matrix.to_quaternion()
        rotation=(rotation @ Vector((0,1,0))).rotation_difference((end-start).normalized()) @ rotation
        bone.rotation_mode='QUATERNION'
        bone.matrix=Matrix.Translation(start) @ rotation.to_matrix().to_4x4()
        bpy.context.view_layer.update()
        for key in ('location','rotation_quaternion','scale'):bone.keyframe_insert(key,frame=frame)
    residual=(rig.matrix_world @ hand.head-target_world).length
    if residual>.005:raise ValueError('真实手腕未落到本次接触目标')
    return residual


def apply_hand_contacts(spec,rigs,scene,actor_visible,models=None):
    import bpy
    from mathutils import Vector
    actors={a['id']:(a,rig) for a,rig,*_ in rigs}
    real={m['actorId']:m for m in models or []}
    def actual(actor_id):
        actor,rig=actors[actor_id];model=real.get(actor_id)
        if model:return actor,model['rig'],model['boneMap'],{'kind':'riggedModel','sourceJobId':actor['riggedModel']['sourceJobId'],'sha256':model['inspection']['sha256']}
        if actor.get('riggedModel'):raise ValueError('人马接触缺少实际模型，不得使用隐藏源白模')
        return actor,rig,None,{'kind':'sourceRig'}
    rows=[]
    for c in spec.get('handContacts') or []:
        actor,rig,mapping,source=actual(c['actorId'])
        target,target_rig,target_map,target_source=actual(c['targetActorId'])
        hand=rig.pose.bones[mapping[c['hand']] if mapping else c['hand']]
        target_bone=target_rig.pose.bones[target_map[c['bone']] if target_map else c['bone']]
        samples=[]
        for frame in range(1,scene.frame_end+1):
            scene.frame_set(frame);bpy.context.view_layer.update()
            amount=hand_contact_amount(c,(frame-1)/24)
            world=target_rig.matrix_world @ target_bone.head.lerp(target_bone.tail,c.get('along',.5))
            rotation=(target_rig.matrix_world @ target_bone.matrix).to_quaternion()
            world+=rotation @ Vector(c.get('offset',[0,0,0]))
            original=rig.matrix_world @ hand.head
            desired=original.lerp(world,amount)
            if amount>0 and not(actor_visible(actor,frame) and actor_visible(target,frame)):
                raise ValueError('人马接触窗口内角色消失')
            residual=solve_hand_to_world(rig,mapping,c['hand'],desired,frame) if amount>0 else 0.
            actual_hand=rig.matrix_world @ hand.head
            samples.append({'frame':frame,'amount':amount,'wrist':list(actual_hand),'original':list(original),'target':list(world),'desired':list(desired),'residual':residual})
        rows.append({'id':c['id'],'actorId':c['actorId'],'targetActorId':c['targetActorId'],'hand':c['hand'],'bone':c['bone'],'source':source,'targetSource':target_source,'samples':samples})
    scene.frame_set(1)
    return rows
