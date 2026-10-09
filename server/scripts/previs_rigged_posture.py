"""按真实目标骨长修正坐卧支撑；网格与常速须分别验收。"""
import math


def apply_rigged_posture(model, actor, scene):
    import bpy
    from mathutils import Matrix, Vector
    from previs_contact_ik import solve_limb
    from previs_human_pose import human_posture_lean
    from previs_rigged_contact_mesh import measure_contact_mesh
    posture = actor.get('humanPosture')
    if not posture:
        return None
    rig, mapping = model['rig'], model['boneMap']
    rest = model['restMatrices']
    pelvis = rig.pose.bones[mapping['pelvis']]
    original_frame = scene.frame_current
    # 从当前目标骨架取得静止足骨，所有腿长均取目标本身。
    feet = {side: rest[mapping['foot'+side]].copy() for side in ('-1','1')}
    selected = []
    for mesh in model['meshes']:
        group = mesh.vertex_groups.get(mapping['pelvis'])
        ids = {v.index for v in mesh.data.vertices if group is not None and
               sum(g.weight for g in v.groups if g.group == group.index) >= .5}
        selected.append(ids)
    if sum(map(len,selected)) < 3:
        raise ValueError('坐卧缺少实际骨盆支撑蒙皮权重')

    def pelvis_minimum():
        graph=bpy.context.evaluated_depsgraph_get()
        values=[]
        for mesh,ids in zip(model['meshes'],selected):
            evaluated=mesh.evaluated_get(graph); data=evaluated.to_mesh()
            try:
                if data is None or len(data.vertices)!=len(mesh.data.vertices):
                    raise ValueError('坐卧蒙皮拓扑已变化')
                values.extend((evaluated.matrix_world @ data.vertices[i].co).z for i in ids)
            finally:evaluated.to_mesh_clear()
        if not values or not all(math.isfinite(v) for v in values):
            raise ValueError('坐卧骨盆网格测量无效')
        return min(values)

    def set_matrix(bone, matrix, frame):
        bone.rotation_mode='QUATERNION'; bone.matrix=matrix
        bpy.context.view_layer.update()
        for prop in ('location','rotation_quaternion','scale'):bone.keyframe_insert(prop,frame=frame)

    def aim(bone,start,end,frame):
        rotation=bone.matrix.to_quaternion()
        rotation=(rotation @ Vector((0,1,0))).rotation_difference((end-start).normalized()) @ rotation
        set_matrix(bone,Matrix.Translation(start) @ rotation.to_matrix().to_4x4(),frame)

    samples=[]
    try:
        for frame in range(scene.frame_start,scene.frame_end+1):
            scene.frame_set(frame);bpy.context.view_layer.update()
            # 目标静止脊柱可能略斜；将实际躯干轴落在本次角度，保留骨长与轴向滚转。
            angle=human_posture_lean(posture,(frame-1)/24)
            spine=rig.pose.bones[mapping['spine']]
            start=spine.head.copy()
            aim(spine,start,start+Vector((-math.sin(angle),0,math.cos(angle)))*spine.bone.length,frame)
            delta=posture['supportHeight']-pelvis_minimum()
            matrix=pelvis.matrix.copy()
            matrix.translation += rig.matrix_world.inverted().to_3x3() @ Vector((0,0,delta))
            set_matrix(pelvis,matrix,frame)
            for side in ('-1','1'):
                upper,lower,foot=[rig.pose.bones[mapping[name+side]] for name in ('upper_leg','lower_leg','foot')]
                root=upper.head.copy(); ankle=feet[side].translation.copy()
                # 座位前方落脚距离随真实腿长缩放，不复制基础人体脚点。
                ankle.x += .32*(upper.bone.length+lower.bone.length)/.86
                solved=solve_limb(tuple(root),tuple(ankle),upper.bone.length,lower.bone.length,(1,0,0))
                if solved['unreachableDistance']>.005:raise ValueError('坐卧支撑高度超出真实腿长可达范围')
                aim(upper,root,Vector(solved['joint']),frame)
                aim(lower,Vector(solved['joint']),Vector(solved['end']),frame)
                set_matrix(foot,Matrix.Translation(Vector(solved['end'])) @ feet[side].to_quaternion().to_matrix().to_4x4(),frame)
            support_gap=pelvis_minimum()-posture['supportHeight']
            spine=rig.pose.bones[mapping['spine']]
            direction=spine.tail-spine.head
            lean=math.atan2(-direction.x,direction.z)
            length_error=max(abs((b.tail-b.head).length-b.bone.length) for b in rig.pose.bones)
            if abs(support_gap)>.005 or length_error>.001 or abs(lean-human_posture_lean(posture,(frame-1)/24))>.02:
                raise ValueError('真实坐卧支撑、骨长或躯干后仰未达到配置')
            samples.append({'frame':frame,'supportGap':support_gap,'spineLeanRad':lean,'maxBoneLengthError':length_error})
        mesh=measure_contact_mesh(model,list(range(scene.frame_start,scene.frame_end+1)))
    finally:
        scene.frame_set(original_frame);bpy.context.view_layer.update()
    return {'actorId':actor['id'],'sourceJobId':model['report']['sourceJobId'],'sha256':model['report']['sha256'],
            'mode':posture['mode'],'frames':len(samples),'samples':samples,'meshMeasurement':mesh,
            'meshValidated':False,'normalSpeedValidated':False}
