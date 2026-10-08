"""既有人马骨锚接触及双手扶坐蒙皮接触；复用两骨IK，不代替承重和衣物审片。"""
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


def _surface_baseline(c,model,target_model,scene):
    """先采原轨迹和固定蒙皮顶点，再烘焙，避免新关键帧污染后续帧的原姿态。"""
    import bpy
    from mathutils import Vector
    from previs_rigged_piggyback import _zone
    side=c['hand'][4:]
    rig=model['rig'];target_rig=target_model['rig']
    names=['upper_arm'+side,'forearm'+side,c['hand']]
    hand=rig.pose.bones[model['boneMap'][c['hand']]]
    target_bone=target_rig.pose.bones[target_model['boneMap'][c['bone']]]
    rows=[];hand_index=None;target_index=None
    for frame in range(1,scene.frame_end+1):
        scene.frame_set(frame);bpy.context.view_layer.update()
        targets=_zone(target_model,[c['bone']],'扶坐');palms=_zone(model,[c['hand']],'扶坐')
        if target_index is None:
            anchor=target_rig.matrix_world @ target_bone.head.lerp(target_bone.tail,c.get('along',.5))
            anchor+=(target_rig.matrix_world @ target_bone.matrix).to_quaternion() @ Vector(c.get('offset',[0,0,0]))
            target_index=min(range(len(targets)),key=lambda i:(targets[i]-anchor).length)
            hand_index=min(range(len(palms)),key=lambda i:(palms[i]-targets[target_index]).length)
        rows.append({'original':(rig.matrix_world @ hand.head).copy(),
                     'surfaceOriginal':palms[hand_index].copy(),'surfaceTarget':targets[target_index].copy(),
                     'handIndex':hand_index,'targetIndex':target_index,'pose':[(rig.pose.bones[model['boneMap'][name]],rig.pose.bones[model['boneMap'][name]].matrix.copy()) for name in names]})
    return rows


def _surface_contact(c,model,baseline,amount,frame):
    import bpy
    from previs_rigged_piggyback import _zone
    rig=model['rig'];hand=rig.pose.bones[model['boneMap'][c['hand']]]
    for bone,matrix in baseline['pose']:
        bone.rotation_mode='QUATERNION';bone.matrix=matrix.copy();bpy.context.view_layer.update()
    surface_goal=baseline['surfaceOriginal'].lerp(baseline['surfaceTarget'],amount)
    desired=baseline['original'].copy()
    for _ in range(6):
        palm=_zone(model,[c['hand']],'扶坐')[baseline['handIndex']]
        if (palm-surface_goal).length<=.003:break
        desired=rig.matrix_world @ hand.head+(surface_goal-palm)
        solve_hand_to_world(rig,model['boneMap'],c['hand'],desired,frame)
    palm=_zone(model,[c['hand']],'扶坐')[baseline['handIndex']]
    error=(palm-surface_goal).length
    if error>.005:raise ValueError('扶坐真实手部蒙皮未接触本次上臂表面轨迹')
    for bone,_ in baseline['pose']:
        for key in ('location','rotation_quaternion','scale'):bone.keyframe_insert(key,frame=frame)
    wrist=rig.matrix_world @ hand.head
    return desired,{'original':list(baseline['surfaceOriginal']),'target':list(baseline['surfaceTarget']),
                    'desired':list(surface_goal),'hand':list(palm),'residual':error},(wrist-desired).length


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
    # TS入口已校验双手/窗口；此处也拒绝任何绕过入口的单手或隐藏源人偶请求。
    baselines={}
    for c in spec.get('handContacts') or []:
        target=actors[c['targetActorId']][0]
        if target['shape']!='human':continue
        model=real.get(c['actorId']);target_model=real.get(c['targetActorId'])
        pair=[other for other in spec['handContacts'] if other['actorId']==c['actorId'] and other['targetActorId']==c['targetActorId'] and all(other[k]==c[k] for k in ('startSec','contactSec','releaseSec','endSec'))]
        posture=target.get('humanPosture') or {}
        if not model or not target_model or len(pair)!=2 or len([r for r in spec['handContacts'] if r['targetActorId']==c['targetActorId']])!=2 or {r['hand'] for r in pair}!={'hand-1','hand1'} or {r['bone'] for r in pair}!={'upper_arm-1','upper_arm1'}:
            raise ValueError('扶坐须双方真实模型及同窗双手两侧上臂，不得沿用源人偶')
        if posture.get('mode') not in ('hold','rise_to_sit') or (posture['mode']=='hold' and posture.get('posture')!='sit') or (posture['mode']=='rise_to_sit' and (c['contactSec']>posture['startSec'] or c['releaseSec']<posture['endSec'])):
            raise ValueError('扶坐保持窗口未覆盖实际坐起或坐稳')
        baselines[c['id']]=_surface_baseline(c,model,target_model,scene)
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
            baseline=baselines.get(c['id'])
            original=baseline[frame-1]['original'].copy() if baseline else rig.matrix_world @ hand.head
            desired=original.lerp(world,amount)
            if amount>0 and not(actor_visible(actor,frame) and actor_visible(target,frame)):
                raise ValueError('人马接触窗口内角色消失')
            surface=None
            if baseline:
                desired,surface,residual=_surface_contact(c,real[c['actorId']],baseline[frame-1],amount,frame)
            else:
                residual=solve_hand_to_world(rig,mapping,c['hand'],desired,frame) if amount>0 else 0.
            actual_hand=rig.matrix_world @ hand.head
            sample={'frame':frame,'amount':amount,'wrist':list(actual_hand),'original':list(original),'target':list(world),'desired':list(desired),'residual':residual}
            if surface:sample['surface']=surface
            samples.append(sample)
        row={'id':c['id'],'actorId':c['actorId'],'targetActorId':c['targetActorId'],'hand':c['hand'],'bone':c['bone'],'source':source,'targetSource':target_source,'samples':samples}
        if baseline:row['_surfaceIndices']=(baseline[0]['handIndex'],baseline[0]['targetIndex'])
        rows.append(row)
    scene.frame_set(1)
    return rows


def measure_hand_contacts(rows,models,scene):
    """在全部姿态、道具及特效完成后重新求值最终蒙皮，禁止使用烘焙时的旧点冒充产物。"""
    import bpy
    from mathutils import Vector
    from previs_rigged_piggyback import _zone
    by_id={model['actorId']:model for model in models}
    for row in rows:
        indices=row.pop('_surfaceIndices',None)
        if indices is None:continue
        model=by_id[row['actorId']];target=by_id[row['targetActorId']]
        hand=model['rig'].pose.bones[model['boneMap'][row['hand']]]
        for sample in row['samples']:
            scene.frame_set(sample['frame']);bpy.context.view_layer.update()
            wrist=model['rig'].matrix_world @ hand.head
            palm=_zone(model,[row['hand']],'扶坐')[indices[0]]
            target_point=_zone(target,[row['bone']],'扶坐')[indices[1]]
            sample['wrist']=list(wrist);sample['residual']=(wrist-Vector(sample['desired'])).length
            surface=sample['surface'];surface['hand']=list(palm);surface['target']=list(target_point)
            surface['residual']=(palm-Vector(surface['desired'])).length
            expected=Vector(surface['original']).lerp(target_point,sample['amount'])
            if sample['residual']>.005 or surface['residual']>.005 or (expected-Vector(surface['desired'])).length>1e-5:
                raise ValueError('扶坐最终动画蒙皮或腕点偏离已求解接触，不得交付旧报告')
    scene.frame_set(1)
    return rows
