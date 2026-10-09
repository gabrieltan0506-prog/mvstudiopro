"""真实双足/四足路线的落脚修正与蒙皮测量；不代替常速表演验收。"""
import math


def leg_contract(shape):
    if shape=='human':
        return [('hindLeft','1','upper_leg1','lower_leg1','foot1'),('hindRight','-1','upper_leg-1','lower_leg-1','foot-1')]
    if shape=='horse':
        return [('frontLeft','1','upper_arm1','forearm1','hand1'),('frontRight','3','upper_arm-1','forearm-1','hand-1'),
                ('hindLeft','2','upper_leg1','lower_leg1','foot1'),('hindRight','0','upper_leg-1','lower_leg-1','foot-1')]
    raise ValueError('落脚修正只接受已绑定的人形或四足')


def stance_runs(flags):
    """每帧都归属唯一连续在地/摆动区间，末帧不能被切掉。"""
    if not flags or any(type(flag) is not bool for flag in flags):raise ValueError('落脚时间窗无效')
    runs=[];start=0
    for index in range(1,len(flags)+1):
        if index==len(flags) or flags[index]!=flags[start]:
            runs.append((start,index-1,flags[start]));start=index
    return runs


def apply_grounded_route(model,actor,source_contacts,source_stance,scene):
    import bpy
    from mathutils import Matrix,Vector
    from previs_contact_ik import solve_limb
    if not actor.get('motionRoute'):return None
    if any(action['kind'] not in ('idle','walk','limp_front_left') for action in actor['actions']):
        raise ValueError('真实模型路线落脚不能覆盖独立表演动作')
    if actor.get('humanPosture') or actor.get('quadrupedFall') or actor.get('hitReaction'):
        raise ValueError('真实模型路线落脚不能覆盖接触姿态')
    rig=model['rig'];mapping=model['boneMap'];rest=model['restMatrices'];meshes=model['meshes']
    count=scene.frame_end-scene.frame_start+1
    if scene.frame_start!=1 or not 48<=count<=720:raise ValueError('落脚帧数超出支持范围')
    scale=model['report']['targetHeight']/1.7
    feet=[]
    for label,key,upper_key,lower_key,foot_key in leg_contract(actor['shape']):
        upper,lower,foot=[rig.pose.bones[mapping[name]] for name in (upper_key,lower_key,foot_key)]
        selections=[];minimum=math.inf;vertices=0
        for obj in meshes:
            group=obj.vertex_groups.get(foot.name)
            ids=[v.index for v in obj.data.vertices if group and sum(g.weight for g in v.groups if g.group==group.index)>=.5]
            local=rig.matrix_world.inverted()@obj.matrix_world
            minimum=min(minimum,min(((local@obj.data.vertices[i].co).z for i in ids),default=math.inf))
            vertices+=len(ids);selections.append((obj,ids,local))
        if vertices<3 or not math.isfinite(minimum):raise ValueError('角色%s的%s缺少可测量足底蒙皮'%(actor['id'],label))
        # 固定同一组足底顶点，不能每帧换一个最低点掩盖滑步。
        soles=[(obj,[i for i in ids if (local@obj.data.vertices[i].co).z<=minimum+.02*scale]) for obj,ids,local in selections]
        if sum(len(ids) for _,ids in soles)<3:raise ValueError('真实足底采样不足，须先修正模型蒙皮')
        ankle=rest[foot.name].translation.copy();ankle.z-=minimum
        bend=rest[lower.name].translation-rest[upper.name].translation
        axis=rest[foot.name].translation-rest[upper.name].translation
        bend-=axis.normalized()*bend.dot(axis.normalized())
        if bend.length<1e-5:bend=Vector((1,0,0))
        injured=actor['shape']=='horse' and key=='1' and any(a['kind']=='limp_front_left' for a in actor['actions'])
        flags=[key in source_stance[f] for f in range(1,count+1)]
        windows={f+1:(a+1,b+1,stance) for a,b,stance in stance_runs(flags) for f in range(a,b+1)}
        feet.append({'label':label,'key':key,'upper':upper,'lower':lower,'foot':foot,'ankle':ankle,'bend':bend,
                     'restRotation':rest[foot.name].to_quaternion(),'selections':soles,'vertices':vertices,
                     'windows':windows,'injured':injured,'anchor':None,'lastTarget':None,'swing':None})
    roots={}
    for frame in range(1,count+1):scene.frame_set(frame);roots[frame]=rig.matrix_world.copy()

    selected={obj.name:{foot['label']:set(next(ids for mesh,ids in foot['selections'] if mesh==obj)) for foot in feet} for obj in meshes}
    def measure():
        graph=bpy.context.evaluated_depsgraph_get();floor=math.inf;positions={foot['label']:[] for foot in feet}
        for obj in meshes:
            evaluated=obj.evaluated_get(graph);mesh=evaluated.to_mesh()
            try:
                if not mesh or len(mesh.vertices)!=len(obj.data.vertices):raise ValueError('落脚测量网格拓扑与蒙皮不一致')
                for vertex in mesh.vertices:
                    point=evaluated.matrix_world@vertex.co
                    if not all(math.isfinite(value) for value in point):raise ValueError('落脚网格含无效坐标')
                    floor=min(floor,point.z)
                    for foot in feet:
                        if vertex.index in selected[obj.name][foot['label']]:positions[foot['label']].append(point.copy())
            finally:evaluated.to_mesh_clear()
        return floor,{name:{'minimum':min(p.z for p in points),'center':sum(points,Vector())/len(points)} for name,points in positions.items()}

    def key_bone(bone,matrix,frame):
        bone.rotation_mode='QUATERNION';bone.matrix=matrix;bpy.context.view_layer.update()
        for prop in ('location','rotation_quaternion','scale'):bone.keyframe_insert(prop,frame=frame)

    def solve(foot,target,rotation,frame):
        upper,lower,end=foot['upper'],foot['lower'],foot['foot'];inverse=rig.matrix_world.inverted()
        local=inverse@target
        answer=solve_limb(tuple(upper.head),tuple(local),upper.bone.length,lower.bone.length,tuple(foot['bend']))
        if answer['unreachableDistance']>.005:raise ValueError('第%d帧%s落点超出真实骨长，请缩短路线'%(frame,foot['label']))
        knee,ankle=Vector(answer['joint']),Vector(answer['end'])
        for bone,a,b in ((upper,upper.head.copy(),knee),(lower,knee,ankle)):
            rest_rotation=rest[bone.name].to_quaternion()
            delta=(rest_rotation@Vector((0,1,0))).rotation_difference((b-a).normalized())
            key_bone(bone,Matrix.Translation(a)@(delta@rest_rotation).to_matrix().to_4x4(),frame)
        key_bone(end,Matrix.Translation(ankle)@(rig.matrix_world.to_quaternion().inverted()@rotation).to_matrix().to_4x4(),frame)
        return ((rig.matrix_world@end.head)-target).length

    samples=[];final_baselines=[]
    result={'actorId':actor['id'],'rigKind':'quadruped' if actor['shape']=='horse' else 'human',
            'frames':count,'footVertices':{foot['label']:foot['vertices'] for foot in feet},'samples':samples,
            'meshMeasured':True,'normalSpeedValidated':False,'finalMeshVerified':False}
    model['report']['groundedRoute']=result
    for frame in range(1,count+1):
        scene.frame_set(frame);bpy.context.view_layer.update();root=roots[frame];targets={};rotations={}
        for foot in feet:
            first,last,stance=foot['windows'][frame]
            if foot['injured']:
                local=root.inverted()@source_contacts[frame][foot['key']]
                delta=(local-Vector((.6,.25,.065)))*scale
                target=root@(foot['ankle']+delta)
                rotation=root.to_quaternion()@foot['restRotation']
            elif stance:
                if frame==first:
                    foot['stanceTarget']=foot['lastTarget'].copy() if foot['lastTarget'] is not None else root@foot['ankle']
                    foot['stanceRotation']=foot.get('lastRotation',root.to_quaternion()@foot['restRotation'])
                    foot['anchor']=None
                target=foot['stanceTarget'].copy();rotation=foot['stanceRotation']
            else:
                if frame==first:
                    before=foot['lastTarget'].copy() if foot['lastTarget'] is not None else root@foot['ankle']
                    foot['swing']=(before,roots[last]@foot['ankle'],foot.get('lastRotation',root.to_quaternion()@foot['restRotation']),roots[last].to_quaternion()@foot['restRotation'])
                before,goal,r0,r1=foot['swing'];u=(frame-first)/max(1,last-first);ease=u*u*(3-2*u)
                target=before.lerp(goal,ease);target.z+=.09*scale*math.sin(math.pi*u);rotation=r0.slerp(r1,ease)
                foot['anchor']=None
            targets[foot['label']]=target;rotations[foot['label']]=rotation
        # 只降低必要的骨盆高度使真实骨长可达；超过体型预算时明确失败。
        lower_by=0.;inverse=root.inverted()
        for foot in feet:
            delta=foot['upper'].head-inverse@targets[foot['label']]
            reach=foot['upper'].bone.length+foot['lower'].bone.length-.002
            if delta.x*delta.x+delta.y*delta.y>=reach*reach:raise ValueError('路线横向步幅超出真实腿长')
            lower_by=max(lower_by,delta.z-math.sqrt(reach*reach-delta.x*delta.x-delta.y*delta.y))
        if lower_by>.18*scale:raise ValueError('落脚需要过度下蹲，请修正角色绑定或缩短步幅')
        if lower_by>0:
            pelvis=rig.pose.bones[mapping['pelvis']];matrix=pelvis.matrix.copy();matrix.translation.z-=lower_by+.005
            key_bone(pelvis,matrix,frame)
        residuals={}
        for iteration in range(4):
            for foot in feet:residuals[foot['label']]=solve(foot,targets[foot['label']],rotations[foot['label']],frame)
            floor,measured=measure();adjust=False
            for foot in feet:
                stance=foot['windows'][frame][2] and not foot['injured'];value=measured[foot['label']]
                if stance:
                    if abs(value['minimum'])>.002:
                        targets[foot['label']].z-=value['minimum'];adjust=True
                    if foot['anchor'] is not None:
                        delta=value['center']-foot['anchor'];delta.z=0
                        if delta.length>.002:targets[foot['label']]-=delta;adjust=True
                elif value['minimum']<0:
                    targets[foot['label']].z-=value['minimum'];adjust=True
            if not adjust:break
        if floor<-.005:raise ValueError('第%d帧真实角色网格穿地'%frame)
        foot_rows=[]
        for foot in feet:
            stance=foot['windows'][frame][2] and not foot['injured'];value=measured[foot['label']]
            if stance and foot['anchor'] is None:foot['anchor']=value['center'].copy()
            delta=value['center']-foot['anchor'] if stance else Vector();delta.z=0
            if value['minimum']<-.005 or (stance and (value['minimum']>.03 or delta.length>.015)):
                raise ValueError('第%d帧%s实际足底失去支撑或滑步'%(frame,foot['label']))
            if foot['injured'] and value['minimum']<.035*scale:raise ValueError('伤腿实际蹄面落地，不能冒称卸载')
            foot_rows.append({'foot':foot['label'],'stance':stance,'soleHeight':value['minimum'],'stanceSlip':delta.length,'ankleResidual':residuals[foot['label']]})
            # 使用已经求值的真实踝点衔接下一个摆动窗，避免约束修正后再跳回旧目标。
            foot['lastTarget']=(root@foot['foot'].head).copy();foot['lastRotation']=rotations[foot['label']].copy()
        samples.append({'frame':frame,'minimumHeight':floor,'feet':foot_rows})
        final_baselines.append((floor,{name:{'minimum':value['minimum'],'center':value['center'].copy()} for name,value in measured.items()}))
    def verify_final_mesh():
        # 后续头颈/表情/接触处理不能悄悄使此前足底回执失效；重新读取最终烘焙网格。
        result['finalMeshVerified']=False
        for frame,(expected_floor,expected_feet) in enumerate(final_baselines,1):
            scene.frame_set(frame);bpy.context.view_layer.update();floor,actual=measure()
            if abs(floor-expected_floor)>.0001 or any(abs(actual[name]['minimum']-value['minimum'])>.0001 or
                (actual[name]['center']-value['center']).length>.0001 for name,value in expected_feet.items()):
                raise ValueError('第%d帧后续处理改变了实际足底，请先修正表演与落脚冲突'%frame)
        result['finalMeshVerified']=True
    model['_verifyGroundedRoute']=verify_final_mesh
    return result


def verify_grounded_route(model):
    verify=model.get('_verifyGroundedRoute')
    if not callable(verify):raise ValueError('真实模型缺少最终落脚网格复核器')
    verify()
