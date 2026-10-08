"""真实带骨背负：真实骨长IK、求值蒙皮接触和分角色地面条件，不代替常速审片。"""
import math


def _source(model):
    row=model['report']
    return {'actorId':model['actorId'],'sourceJobId':row['sourceJobId'],'sha256':row['sha256']}


def _zone(model, names):
    import bpy
    graph=bpy.context.evaluated_depsgraph_get()
    points=[]
    for obj in model['meshes']:
        groups={obj.vertex_groups[model['boneMap'][n]].index for n in names if model['boneMap'][n] in obj.vertex_groups}
        ids={v.index for v in obj.data.vertices if sum(g.weight for g in v.groups if g.group in groups)>=.35}
        evaluated=obj.evaluated_get(graph);mesh=evaluated.to_mesh()
        try:
            if mesh is None or len(mesh.vertices)!=len(obj.data.vertices):raise ValueError('背负实际蒙皮拓扑变化')
            points.extend(evaluated.matrix_world @ mesh.vertices[i].co for i in ids)
        finally:evaluated.to_mesh_clear()
    if len(points)<3 or any(not all(math.isfinite(x) for x in p) for p in points):
        raise ValueError('背负缺少实际手、膝、肩或脚部蒙皮权重')
    return points


def _bone(model,name):return model['rig'].pose.bones[model['boneMap'][name]]


def _aim(model,bone,start,end,frame):
    import bpy
    from mathutils import Vector,Matrix
    rotation=bone.matrix.to_quaternion()
    rotation=(rotation @ Vector((0,1,0))).rotation_difference((end-start).normalized()) @ rotation
    bone.rotation_mode='QUATERNION';bone.matrix=Matrix.Translation(start) @ rotation.to_matrix().to_4x4()
    bpy.context.view_layer.update()
    for key in ('location','rotation_quaternion','scale'):bone.keyframe_insert(key,frame=frame)


def _shift_pelvis(model,world_delta,frame):
    import bpy
    pelvis=_bone(model,'pelvis');matrix=pelvis.matrix.copy()
    matrix.translation+=model['rig'].matrix_world.inverted().to_3x3() @ world_delta
    pelvis.rotation_mode='QUATERNION';pelvis.matrix=matrix;bpy.context.view_layer.update()
    for key in ('location','rotation_quaternion','scale'):pelvis.keyframe_insert(key,frame=frame)


def _limb(model,upper_name,lower_name,end_name,target,bend,frame):
    from mathutils import Vector
    from previs_contact_ik import solve_limb
    rig=model['rig'];upper,lower,end=[_bone(model,n) for n in (upper_name,lower_name,end_name)]
    root=upper.head.copy();goal=rig.matrix_world.inverted() @ target
    result=solve_limb(tuple(root),tuple(goal),upper.bone.length,lower.bone.length,bend)
    if result['unreachableDistance']>.005:raise ValueError(f'真实背负接触超出本人骨长可达范围: {model["actorId"]} {end_name} frame={frame} root={tuple(root)} goal={tuple(goal)} lengths={upper.bone.length,lower.bone.length} excess={result["unreachableDistance"]}')
    joint,tip=Vector(result['joint']),Vector(result['end']);direction=(end.tail-end.head).normalized()
    _aim(model,upper,root,joint,frame);_aim(model,lower,joint,tip,frame)
    _aim(model,end,tip,tip+direction*end.bone.length,frame)


def _palm_to(model,hand,target,frame):
    from mathutils import Vector
    side=hand[4:]
    for _ in range(4):
        points=_zone(model,[hand]);palm=min(points,key=lambda p:(p-target).length)
        error=(palm-target).length
        if error<=.003:return error
        wrist=model['rig'].matrix_world @ _bone(model,hand).head
        _limb(model,'upper_arm'+side,'forearm'+side,hand,wrist+(target-palm),(-.3,int(side),-.5),frame)
    error=min((p-target).length for p in _zone(model,[hand]))
    if error>.005:raise ValueError('真实背负手掌网格未接触目标表面')
    return error


def _contact_target(model,part,side):
    """目标取真实蒙皮外表面，非源人偶骨点；侧膝下缘/肩前上缘。"""
    from mathutils import Vector
    rig=model['rig'];inverse=rig.matrix_world.inverted()
    if part=='knee':
        joint=rig.matrix_world @ _bone(model,'lower_leg'+side).head
        length=_bone(model,'lower_leg'+side).bone.length
        candidates=[p for p in _zone(model,['upper_leg'+side,'lower_leg'+side]) if (p-joint).length<max(.08,length*.4)]
        if len(candidates)<3:raise ValueError('真实膝周蒙皮不足，不能伪造托膝点')
        return min(candidates,key=lambda p:(inverse @ p).z).copy()
    joint=rig.matrix_world @ _bone(model,'upper_arm'+side).head
    length=_bone(model,'upper_arm'+side).bone.length
    candidates=[p for p in _zone(model,['spine','upper_arm'+side]) if (p-joint).length<max(.08,length*.5)]
    if len(candidates)<3:raise ValueError('真实肩部蒙皮不足，不能伪造抱肩点')
    return max(candidates,key=lambda p:(inverse @ p).x+.4*(inverse @ p).z).copy()


def apply_rigged_piggyback(pair,models,scene):
    import bpy
    from mathutils import Vector
    if not pair:return None
    by_id={m['actorId']:m for m in models}
    present=[key in by_id for key in (pair['carrierId'],pair['passengerId'])]
    if not any(present):return None
    if not all(present) or pair.get('slipCatch') or pair.get('setDown'):
        raise ValueError('真实背负须双方模型齐全，暂不支持滑落或放下组合')
    carrier,passenger=[by_id[pair[key]] for key in ('carrierId','passengerId')]
    frames={}
    for frame in range(scene.frame_start,scene.frame_end+1):
        scene.frame_set(frame);bpy.context.view_layer.update()
        soles=[min(p.z for p in _zone(carrier,['foot'+side])) for side in ('-1','1')]
        _shift_pelvis(carrier,Vector((0,0,-min(soles))),frame)
        cr=carrier['rig'];pr=passenger['rig'];basis=cr.matrix_world.to_quaternion()
        chest=cr.matrix_world @ _bone(carrier,'spine').tail
        scale=(_bone(carrier,'upper_leg1').bone.length+_bone(carrier,'lower_leg1').bone.length)/.86
        pelvis=pr.matrix_world @ _bone(passenger,'pelvis').head
        arm_reach=sum(_bone(passenger,n+'1').bone.length for n in ('upper_arm','forearm'))
        shoulder_height=((pr.matrix_world @ _bone(passenger,'upper_arm1').head)-pelvis).z
        desired=chest+basis @ Vector((-min(.30*scale,.48*arm_reach),0,.18*scale-shoulder_height))
        _shift_pelvis(passenger,desired-pelvis,frame)
        # 使用每条实际腿长设置折腿目标，随后以真实膝周网格决定托手位置。
        for side in ('-1','1'):
            legscale=(_bone(passenger,'upper_leg'+side).bone.length+_bone(passenger,'lower_leg'+side).bone.length)/.86
            ankle=chest+basis @ Vector((-.04*scale,int(side)*.33*legscale,-.65*legscale))
            _limb(passenger,'upper_leg'+side,'lower_leg'+side,'foot'+side,ankle,(1,int(side)*.3,0),frame)
        targets={}
        for side in ('-1','1'):
            knee=_contact_target(passenger,'knee',side)
            _palm_to(carrier,'hand'+side,knee,frame)
            shoulder=_contact_target(carrier,'shoulder',side)
            _palm_to(passenger,'hand'+side,shoulder,frame)
            targets[side]={'knee':list(knee),'shoulder':list(shoulder)}
        frames[frame]=targets
    scene.frame_set(1)
    return {'carrier':carrier,'passenger':passenger,'targets':frames,'blockTargets':{}}


def apply_rigged_piggyback_block(pair,handle,props,scene):
    import bpy
    from mathutils import Vector
    from previs_piggyback import piggyback_block_amount
    block=pair.get('blockBowl')
    if not block:return
    prop=next((p for p in props if p['spec']['id']==block['bowlId']),None)
    if prop is None:raise ValueError('真实背负挡碗缺少实际道具')
    model=handle['carrier'];obj=prop['objects'][0]
    for frame in range(scene.frame_start,scene.frame_end+1):
        scene.frame_set(frame);bpy.context.view_layer.update()
        amount=piggyback_block_amount(block,frame)
        if amount<=0:continue
        if not prop['samples'][frame-1]['visible']:raise ValueError('真实背负挡碗时碗不可见')
        knee=Vector(handle['targets'][frame][block['hand'][4:]]['knee'])
        destination=obj.matrix_world.translation+obj.matrix_world.to_quaternion() @ Vector(block['offset'])
        target=knee.lerp(destination,amount)
        _palm_to(model,block['hand'],target,frame)
        handle['blockTargets'][frame]=list(target)
        for side in ('-1','1'):
            _palm_to(handle['passenger'],'hand'+side,_contact_target(model,'shoulder',side),frame)
    scene.frame_set(1)


def measure_rigged_piggyback(pair,handle,scene):
    import bpy
    from mathutils import Vector
    from previs_piggyback import piggyback_block_amount
    if handle is None:return None
    carrier,passenger=handle['carrier'],handle['passenger'];rows=[]
    block=pair.get('blockBowl')
    for frame in range(scene.frame_start,scene.frame_end+1):
        scene.frame_set(frame);bpy.context.view_layer.update()
        amount=piggyback_block_amount(block,frame);support=[];grip=[]
        for side in ('-1','1'):
            targets={'knee':_contact_target(passenger,'knee',side),'shoulder':_contact_target(carrier,'shoulder',side)}
            if not block or amount<=0 or side!=block['hand'][4:]:
                support.append(min((p-Vector(targets['knee'])).length for p in _zone(carrier,['hand'+side])))
            grip.append(min((p-Vector(targets['shoulder'])).length for p in _zone(passenger,['hand'+side])))
        carrier_soles=[min(p.z for p in _zone(carrier,['foot'+side])) for side in ('-1','1')]
        passenger_soles=[min(p.z for p in _zone(passenger,['foot'+side])) for side in ('-1','1')]
        length_error=max(abs((b.tail-b.head).length-b.bone.length) for m in (carrier,passenger) for b in m['rig'].pose.bones)
        block_error=0
        if amount>0:
            target=Vector(handle['blockTargets'][frame])
            block_error=min((p-target).length for p in _zone(carrier,[block['hand']]))
        if max(support+grip+[block_error])>.005 or min(carrier_soles)<-.005 or min(carrier_soles)>.03 or max(carrier_soles)>.18 or min(passenger_soles)<.1 or length_error>.001:
            raise ValueError('真实背负接触、载者落脚、乘员悬空或骨长未通过')
        rows.append({'frame':frame,'supportError':max(support),'gripError':max(grip),'carrierSoleHeights':carrier_soles,
                     'passengerSoleHeights':passenger_soles,'maxBoneLengthError':length_error,'blockAmount':amount,'blockError':block_error})
    scene.frame_set(1)
    return {**({'blockBowl':block} if block else {}),'carrier':_source(carrier),'passenger':_source(passenger),'samples':rows,
            'meshMeasured':True,'normalSpeedValidated':False,'boundaryZh':'实际蒙皮手掌对膝肩接触、载者足底与乘员悬空；未代表衣物互穿、物理承重或常速画面验收。'}
