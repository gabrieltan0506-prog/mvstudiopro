"""倒地接触回执直接读取评估后的网格和实际骨架，缺失躯干权重即失败。"""
import math
from previs_quadruped_fall import fall_progress


def ground_and_measure_fall(actor, rig, meshes, scene, mapping=None, model_report=None):
    import bpy
    from mathutils import Vector
    fall = actor['quadrupedFall']
    mapping = mapping or {'pelvis': 'body', 'spine': 'body', **{
        name+suffix: source+key for suffix, front, hind in (('1','1','2'),('-1','3','0'))
        for name,source,key in [('upper_arm','upper_leg',front),('forearm','lower_leg',front),
                                ('upper_leg','upper_leg',hind),('lower_leg','lower_leg',hind)]}}
    torso_names = set(mapping[name] for name in ('pelvis','spine'))
    if any(name not in rig.pose.bones for name in mapping.values()):
        raise ValueError('倒地缺少实际骨骼映射')
    selected = {}
    for mesh in meshes:
        groups = {mesh.vertex_groups[name].index for name in torso_names if name in mesh.vertex_groups}
        selected[mesh.name] = {v.index for v in mesh.data.vertices if sum(g.weight for g in v.groups if g.group in groups) >= .5}
    torso_count = sum(len(indices) for indices in selected.values())
    if torso_count < 3:
        raise ValueError('倒地缺少可测量的真实躯干蒙皮权重')
    original = scene.frame_current
    samples = []
    previous_held = None
    def read_mesh():
        graph = bpy.context.evaluated_depsgraph_get()
        all_z, torso_z = [], []
        for mesh in meshes:
            evaluated = mesh.evaluated_get(graph)
            data = evaluated.to_mesh()
            try:
                if not data or len(data.vertices) != len(mesh.data.vertices):
                    raise ValueError('倒地网格拓扑与权重索引不一致')
                for vertex in data.vertices:
                    z = float((evaluated.matrix_world @ vertex.co).z)
                    if not math.isfinite(z): raise ValueError('倒地网格包含非有限坐标')
                    all_z.append(z)
                    if vertex.index in selected[mesh.name]: torso_z.append(z)
            finally:
                evaluated.to_mesh_clear()
        if not all_z or not torso_z: raise ValueError('倒地真实网格或躯干为空')
        return min(all_z), min(torso_z)
    try:
        for frame in range(1,scene.frame_end+1):
            scene.frame_set(frame); bpy.context.view_layer.update()
            fold, roll, held = fall_progress(fall,(frame-1)/24)
            floor, _ = read_mesh()
            # 每帧只修正垂直根位置；不改骨长、关节姿态或横向落点。
            if fold > 0 or fall['mode'] == 'hold':
                matrix = rig.matrix_world.copy(); matrix.translation.z -= floor
                rig.matrix_world = matrix; rig.keyframe_insert('location',frame=frame)
                bpy.context.view_layer.update()
            floor, torso = read_mesh()
            name = mapping['spine']
            delta = rig.matrix_world.to_3x3() @ rig.pose.bones[name].matrix.to_3x3() @ rig.data.bones[name].matrix_local.to_3x3().inverted()
            up = (delta @ Vector((0,0,1))).normalized()
            tilt = math.degrees(math.acos(max(-1.,min(1.,up.z))))
            folds=[]
            for suffix in ('1','-1'):
                for upper,lower in (('upper_arm','forearm'),('upper_leg','lower_leg')):
                    a=rig.pose.bones[mapping[upper+suffix]];b=rig.pose.bones[mapping[lower+suffix]]
                    av=(a.tail-a.head).normalized();bv=(b.tail-b.head).normalized()
                    folds.append(math.degrees(math.acos(max(-1.,min(1.,av.dot(bv))))))
            root=list(rig.matrix_world.translation)
            if floor < -.005 or (fold > 0 and abs(floor) > .005):
                raise ValueError('倒地实际网格穿地或失去地面支撑')
            if held and (torso > .08 or tilt < 75 or min(folds) < 75):
                raise ValueError('倒地未形成真实躯干侧卧支撑与四腿折叠')
            if held and previous_held and max(abs(root[i]-previous_held[i]) for i in range(3))>.005:
                raise ValueError('倒地保持阶段实际根位置漂移')
            if held: previous_held=root
            samples.append({'frame':frame,'held':held,'minimumHeight':floor,'torsoMinimumHeight':torso,
                            'torsoTiltDeg':tilt,'torsoUp':list(up),'legFoldDeg':folds,'root':root})
    finally:
        scene.frame_set(original);bpy.context.view_layer.update()
    source={'kind':'sourceRig'} if model_report is None else {'kind':'riggedModel','sourceJobId':model_report['sourceJobId'],'sha256':model_report['sha256']}
    return {'actorId':actor['id'],'rootSource':source,'torsoVertices':torso_count,'samples':samples,
            'meshMeasured':True,'normalSpeedValidated':False}
