"""Blender内存测试：双足/四足真实网格落脚；不渲染、不保存、不导出媒体。"""
import math
import sys
from pathlib import Path
import bpy
from mathutils import Matrix,Vector
sys.path.insert(0,str(Path(__file__).resolve().parent))
from previs_rigged_walk import apply_grounded_route,verify_grounded_route,leg_contract,stance_runs


def fixture(shape,limp=False):
    for obj in list(bpy.data.objects):bpy.data.objects.remove(obj,do_unlink=True)
    scene=bpy.context.scene;scene.frame_start=1;scene.frame_end=48
    data=bpy.data.armatures.new('TEST_ONLY');rig=bpy.data.objects.new('TEST_ONLY',data);scene.collection.objects.link(rig)
    bpy.context.view_layer.objects.active=rig;rig.select_set(True);bpy.ops.object.mode_set(mode='EDIT')
    pelvis=data.edit_bones.new('pelvis');pelvis.head=(0,0,1);pelvis.tail=(0,0,1.2)
    for _,_,upper,lower,foot in leg_contract(shape):
        side=1 if not foot.endswith('-1') else -1
        x=(.6 if upper.startswith('upper_arm') else -.6) if shape=='horse' else 0
        nodes=[(x,.2*side,1),(x+.08,.2*side,.55),(x,.2*side,.10),(x+.18,.2*side,.10)]
        for index,name in enumerate((upper,lower,foot)):
            bone=data.edit_bones.new(name);bone.head=nodes[index];bone.tail=nodes[index+1]
            bone.parent=data.edit_bones[(upper,lower)[index-1]] if index else pelvis
    bpy.ops.object.mode_set(mode='OBJECT')
    vertices=[];faces=[];groups=[]
    for _,_,_,_,foot in leg_contract(shape):
        ankle=rig.data.bones[foot].head_local;first=len(vertices)
        vertices.extend([(ankle.x+x,ankle.y+y,z) for z in (0,.12) for y in (-.055,.055) for x in (-.06,.20)])
        faces.extend([tuple(first+i for i in face) for face in ((0,1,3,2),(4,6,7,5),(0,4,5,1),(2,3,7,6),(0,2,6,4),(1,5,7,3))])
        groups.append((foot,list(range(first,first+8))))
    mesh=bpy.data.meshes.new('TEST_ONLY_skin');mesh.from_pydata(vertices,[],faces);mesh.update()
    obj=bpy.data.objects.new('TEST_ONLY_skin',mesh);scene.collection.objects.link(obj);obj.parent=rig
    for name,ids in groups:obj.vertex_groups.new(name=name).add(ids,1,'REPLACE')
    modifier=obj.modifiers.new('TEST_ONLY_armature','ARMATURE');modifier.object=rig
    mapping={name:name for name in rig.data.bones.keys()}
    model={'rig':rig,'boneMap':mapping,'meshes':[obj],'restMatrices':{bone.name:bone.matrix_local.copy() for bone in rig.data.bones},'report':{'targetHeight':1.7}}
    contacts={};stance={};keys=[row[1] for row in leg_contract(shape)]
    if limp:keys.remove('1')
    for frame in range(1,49):
        scene.frame_set(frame);rig.matrix_world=Matrix.Translation((.3*(frame-1)/47,0,0))@Matrix.Rotation(math.radians(10*(frame-1)/47),4,'Z')
        rig.keyframe_insert('location',frame=frame);rig.keyframe_insert('rotation_euler',frame=frame)
        chosen=keys[((frame-1)//6)%len(keys)];stance[frame]=[key for key in keys if key!=chosen]
        contacts[frame]={'1':rig.matrix_world@Vector((.6,.25,.16+.10*math.sin(frame/6)**2))}
    scene.frame_set(1);bpy.context.view_layer.update()
    actor={'id':'TEST_ONLY','shape':shape,'motionRoute':[{}],'actions':[{'kind':'limp_front_left'}] if limp else []}
    return model,actor,contacts,stance,scene


assert stance_runs([True,False,False,True])==[(0,0,True),(1,2,False),(3,3,True)]
checks=1
for shape,limp in [('human',False),('horse',False),('horse',True)]:
    model,actor,contacts,stance,scene=fixture(shape,limp)
    report=apply_grounded_route(model,actor,contacts,stance,scene)
    verify_grounded_route(model)
    assert report['finalMeshVerified'] is True
    assert report['frames']==48 and len(report['samples'])==48
    assert set(report['footVertices'])=={row[0] for row in leg_contract(shape)}
    assert all(len(row['feet'])==(4 if shape=='horse' else 2) for row in report['samples'])
    assert all(row['minimumHeight']>=-.005 for row in report['samples'])
    assert max(foot['stanceSlip'] for row in report['samples'] for foot in row['feet'])<=.015
    assert all(not foot['stance'] for row in report['samples'] for foot in row['feet'] if limp and foot['foot']=='frontLeft')
    print({'kind':shape,'limp':limp,'maxSlip':max(foot['stanceSlip'] for row in report['samples'] for foot in row['feet']),'minimumHeight':min(row['minimumHeight'] for row in report['samples'])})
    checks+=6
model,actor,contacts,stance,scene=fixture('horse')
model['meshes'][0].vertex_groups.remove(model['meshes'][0].vertex_groups['hand1'])
try:apply_grounded_route(model,actor,contacts,stance,scene)
except ValueError as error:assert '足底蒙皮' in str(error)
else:raise AssertionError('缺失前蹄权重未拒绝')
checks+=1
model,actor,contacts,stance,scene=fixture('human')
apply_grounded_route(model,actor,contacts,stance,scene)
model['meshes'][0].data.vertices[0].co.z-=.1
try:verify_grounded_route(model)
except ValueError as error:assert '后续处理' in str(error)
else:raise AssertionError('最终足底被改变却没有拒绝')
checks+=4
print({'status':'PASS','checks':checks,'mediaProduced':False})
