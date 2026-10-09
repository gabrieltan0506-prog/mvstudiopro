"""实际求值手部蒙皮回执正负例；仅Blender内存，不渲染/保存/导出。"""
import sys
from pathlib import Path
import bpy
sys.path.insert(0,str(Path(__file__).resolve().parent))
from previs_cough_measurement import measure_cough_hand
for obj in list(bpy.data.objects):bpy.data.objects.remove(obj,do_unlink=True)
data=bpy.data.armatures.new('hand_memory');rig=bpy.data.objects.new('hand_memory',data)
bpy.context.scene.collection.objects.link(rig);bpy.context.view_layer.objects.active=rig;rig.select_set(True)
bpy.ops.object.mode_set(mode='EDIT');bone=data.edit_bones.new('hand');bone.head=(0,0,1);bone.tail=(.1,0,1);bpy.ops.object.mode_set(mode='OBJECT')
mesh=bpy.data.meshes.new('skin_memory');mesh.from_pydata([(0,-.02,1),(.06,0,1),(0,.02,1)],[],[(0,1,2)])
obj=bpy.data.objects.new('skin_memory',mesh);bpy.context.scene.collection.objects.link(obj)
obj.vertex_groups.new(name='hand').add([0,1,2],1,'REPLACE');modifier=obj.modifiers.new('actual_skin','ARMATURE');modifier.object=rig
model={'rig':rig,'meshes':[obj],'boneMap':{'hand-1':'hand'}}
rows=[{'frame':1,'hold':1.,'scale':1.,'target':(.03,0,1),'baselineWrist':(0,0,1)}, {'frame':2,'hold':0.,'scale':1.,'target':(.03,0,1),'baselineWrist':(0,0,1)}]
bpy.context.scene.frame_set(7)
result=measure_cough_hand(model,rows);assert result['handVertices']==3 and len(result['samples'])==2 and bpy.context.scene.frame_current==7
checks=1

def rejects(fn,text):
    global checks
    try:fn()
    except ValueError as e: assert text in str(e), str(e)
    else:raise AssertionError(text)
    assert bpy.context.scene.frame_current==7
    checks+=1
obj.location.x=1
rejects(lambda:measure_cough_hand(model,rows),'未跟随')
obj.location.x=0
rejects(lambda:measure_cough_hand(model,[{**rows[1],'baselineWrist':(1,0,1)}]),'未回到')
rejects(lambda:measure_cough_hand(model,[{**rows[0],'target':(1,0,1)}]),'未跟随')
obj.vertex_groups['hand'].remove([2]);rejects(lambda:measure_cough_hand(model,rows),'权重')
print({'status':'PASS','checks':checks,'mediaProduced':False,'projectCharacterValidated':False})
