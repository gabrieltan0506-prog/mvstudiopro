"""Blender内存网格正负例；不渲染、不保存场景、不导出媒体。"""
import sys
from pathlib import Path
import bpy
sys.path.insert(0,str(Path(__file__).resolve().parent))
from previs_rigged_contact_mesh import measure_contact_mesh
for obj in list(bpy.data.objects): bpy.data.objects.remove(obj,do_unlink=True)
mesh=bpy.data.meshes.new('TEST_ONLY_feet')
mesh.from_pydata([(x,y,z) for y in (-.2,.2) for x,z in ((0,0),(.1,0),(0,.1))],[],[(0,1,2),(3,4,5)])
obj=bpy.data.objects.new('TEST_ONLY_skin',mesh)
bpy.context.scene.collection.objects.link(obj)
for side,ids in [('right',[0,1,2]),('left',[3,4,5])]:obj.vertex_groups.new(name=side).add(ids,1,'REPLACE')
model={'meshes':[obj],'boneMap':{'foot-1':'right','foot1':'left'}}
bpy.context.scene.frame_set(7)
row=measure_contact_mesh(model,[1,2,3]);assert row['footVertices']==[3,3] and len(row['samples'])==3
assert bpy.context.scene.frame_current==7
checks=2

def reject(fn, message):
    global checks
    try:fn()
    except ValueError as e:assert message in str(e),str(e)
    else:raise AssertionError(message)
    assert bpy.context.scene.frame_current==7
    checks+=1
reject(lambda:measure_contact_mesh(model,[2,1]),'帧窗')
reject(lambda:measure_contact_mesh(model,[1,1]),'帧窗')
obj.location.z=-.02
reject(lambda:measure_contact_mesh(model,[1,2]),'穿地')
obj.location.z=.05
reject(lambda:measure_contact_mesh(model,[1,2]),'支撑')
obj.location.z=0
obj.vertex_groups['left'].remove([3,4,5])
reject(lambda:measure_contact_mesh(model,[1,2]),'双脚')
obj.vertex_groups['left'].add([3,4,5],1,'REPLACE')
modifier=obj.modifiers.new('TEST_ONLY_topology','SOLIDIFY')
reject(lambda:measure_contact_mesh(model,[1,2]),'拓扑')
obj.modifiers.remove(modifier)
# 世界变换与每帧求值必须真实读取，不能只读原始mesh局部坐标。
obj.location.z=0;obj.keyframe_insert('location',frame=1)
obj.location.z=-.1;obj.keyframe_insert('location',frame=2)
reject(lambda:measure_contact_mesh(model,[1,2]),'穿地')
print({'checks':checks,'status':'PASS','mediaProduced':False})
