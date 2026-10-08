"""求值手部蒙皮与同帧腕点、头部锚点、收手基线的几何回执。"""
import math


def measure_cough_hand(model, rows):
    import bpy
    from mathutils import Vector
    rig=model['rig']; name=model['boneMap']['hand-1']
    selected=[]; count=0
    for mesh in model['meshes']:
        group=mesh.vertex_groups.get(name)
        ids={v.index for v in mesh.data.vertices if group is not None and sum(g.weight for g in v.groups if g.group==group.index)>=.5}
        selected.append(ids); count+=len(ids)
    if count<3: raise ValueError('掩口缺少实际手部蒙皮权重')
    original=bpy.context.scene.frame_current; samples=[]
    try:
        for row in rows:
            bpy.context.scene.frame_set(row['frame']); bpy.context.view_layer.update()
            graph=bpy.context.evaluated_depsgraph_get()
            hand=rig.pose.bones[name]
            wrist=rig.matrix_world @ hand.head
            target=rig.matrix_world @ Vector(row['target'])
            baseline=rig.matrix_world @ Vector(row['baselineWrist'])
            vertices=[]
            for mesh,ids in zip(model['meshes'],selected):
                evaluated=mesh.evaluated_get(graph);data=evaluated.to_mesh()
                try:
                    if data is None or len(data.vertices)!=len(mesh.data.vertices):raise ValueError('掩口蒙皮拓扑变化')
                    vertices.extend(evaluated.matrix_world @ data.vertices[i].co for i in ids)
                finally:evaluated.to_mesh_clear()
            if any(not all(math.isfinite(v) for v in p) for p in vertices):raise ValueError('掩口蒙皮坐标无效')
            target_gap=min((p-target).length for p in vertices)
            wrist_gap=min((p-wrist).length for p in vertices)
            recovery=(wrist-baseline).length
            tolerance=.12*row['scale']
            if wrist_gap>tolerance or (row['hold']>.99 and target_gap>tolerance):raise ValueError('实际手部蒙皮未跟随掩口锚点')
            if row['hold']<.025 and recovery>.025*row['scale']:raise ValueError('掩口手部未回到原动作基线')
            samples.append({'frame':row['frame'],'scale':row['scale'],'hold':row['hold'],'handTargetGap':target_gap,'handWristGap':wrist_gap,'recoveryError':recovery})
    finally:
        bpy.context.scene.frame_set(original);bpy.context.view_layer.update()
    return {'handVertices':count,'samples':samples,'meshMeasured':True,'anchorKind':'head-relative-estimate','mouthAnatomyValidated':False}
