"""生产掩口函数内存回归；新独立臂链、头锚点、脚蒙皮，不用旧两具模型，不输出媒体。"""
import sys
from pathlib import Path
import bpy
from mathutils import Vector
sys.path.insert(0,str(Path(__file__).resolve().parent))
from previs_rigged_model import apply_cough_contact
for o in list(bpy.data.objects):bpy.data.objects.remove(o,do_unlink=True)
data=bpy.data.armatures.new('contact_runtime');rig=bpy.data.objects.new('contact_runtime',data)
bpy.context.scene.collection.objects.link(rig);bpy.context.view_layer.objects.active=rig;rig.select_set(True)
coords={'upper_arm-1':((0,-.2,1.2),(.05,-.4,1.05)), 'forearm-1':((.05,-.4,1.05),(.2,-.55,1.)), 'hand-1':((.2,-.55,1.),(.27,-.55,1.)), 'head':((0,0,1.4),(0,0,1.65)), 'foot-1':((0,-.15,.04),(.15,-.15,.04)), 'foot1':((0,.15,.04),(.15,.15,.04))}
bpy.ops.object.mode_set(mode='EDIT')
for name,(a,b) in coords.items():
 bone=data.edit_bones.new(name);bone.head=a;bone.tail=b
for child,parent in [('forearm-1','upper_arm-1'),('hand-1','forearm-1')]:data.edit_bones[child].parent=data.edit_bones[parent];data.edit_bones[child].use_connect=True
bpy.ops.object.mode_set(mode='OBJECT')
vertices=[];faces=[];groups={}
for name,center in [('hand-1',(.22,-.55,1.)),('foot-1',(.03,-.15,0)),('foot1',(.03,.15,0))]:
 start=len(vertices);vertices.extend([tuple(center[i]+offset[i] for i in range(3)) for offset in [(-.02,0,0),(.02,0,0),(0,.02,0)]])
 faces.append((start,start+1,start+2));groups[name]=list(range(start,start+3))
mesh=bpy.data.meshes.new('contact_runtime_skin');mesh.from_pydata(vertices,[],faces);obj=bpy.data.objects.new('contact_runtime_skin',mesh);bpy.context.scene.collection.objects.link(obj)
for name,ids in groups.items():obj.vertex_groups.new(name=name).add(ids,1,'REPLACE')
obj.modifiers.new('skin','ARMATURE').object=rig
for frame in range(1,49):
 bpy.context.scene.frame_set(frame)
 for bone in rig.pose.bones:
  bone.rotation_mode='QUATERNION'
  for prop in ('location','rotation_quaternion','scale'):bone.keyframe_insert(prop,frame=frame)
model={'rig':rig,'meshes':[obj],'boneMap':{n:n for n in coords},'restMatrices':{b.name:b.matrix_local.copy() for b in data.bones},'report':{'targetHeight':1.7}}
rows=apply_cough_contact(model,[{'kind':'cough','startSec':0,'endSec':2}],1,48)
report=model['report']['coughContact']
assert len(rows)==48 and len(report['handMeasurement']['samples'])==48
assert len(report['meshMeasurement']['samples'])==48
assert max(r['targetResidual'] for r in rows)<.005
try:
 apply_cough_contact(model,[{'kind':'cough','startSec':0,'endSec':1.19}],1,48)
except ValueError as e: assert '至少1.2秒' in str(e)
else: raise AssertionError('短掩口未拒绝')
# 先前动作改变了臂链，重新恢复全部已烘焙姿态，验证非整帧结束也在最后有效帧收回。
for frame in range(1,49):
 bpy.context.scene.frame_set(frame)
 for bone in rig.pose.bones:
  bone.matrix_basis.identity()
  for prop in ('location','rotation_quaternion','scale'):bone.keyframe_insert(prop,frame=frame)
rows=apply_cough_contact(model,[{'kind':'cough','startSec':0,'endSec':1.21}],1,48)
assert rows[-1]['hold']==0 and model['report']['coughContact']['handMeasurement']['samples'][-1]['recoveryError']<.0001
for frame in range(1,73):
 bpy.context.scene.frame_set(frame)
 for bone in rig.pose.bones:
  bone.matrix_basis.identity()
  for prop in ('location','rotation_quaternion','scale'):bone.keyframe_insert(prop,frame=frame)
rows=apply_cough_contact(model,[{'kind':'cough','startSec':0,'endSec':1.5},{'kind':'cough','startSec':1.5,'endSec':3}],1,72)
assert len(rows)==72 and len({r['frame'] for r in rows})==72
assert rows[35]['hold']==0 and rows[36]['hold']==0 and rows[-1]['hold']==0
print({'status':'PASS','adjacentFrames':72,'mediaProduced':False,'projectCharacterValidated':False})
