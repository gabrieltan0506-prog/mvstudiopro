"""新增人马手部接触的无媒体数值探针；不保存场景或渲染，不复跑旧模型诊断。"""
import sys,math
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
import bpy
from previs_hand_contacts import apply_hand_contacts
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
scene=bpy.context.scene;scene.frame_start=1;scene.frame_end=48

def rig(name,geometry,parents):
 data=bpy.data.armatures.new(name);obj=bpy.data.objects.new(name,data);scene.collection.objects.link(obj)
 bpy.context.view_layer.objects.active=obj;obj.select_set(True);bpy.ops.object.mode_set(mode='EDIT')
 for key,(a,b) in geometry.items():
  bone=data.edit_bones.new(key);bone.head=a;bone.tail=b
 for child,parent in parents.items():data.edit_bones[child].parent=data.edit_bones[parent]
 bpy.ops.object.mode_set(mode='OBJECT');obj.select_set(False)
 return obj
human=rig('contact-human',{'upper_arm1':((0,0,1.4),(.25,.1,1.2)),'forearm1':((.25,.1,1.2),(.5,0,1.2)),'hand1':((.5,0,1.2),(.6,0,1.2))},{'forearm1':'upper_arm1','hand1':'forearm1'})
horse=rig('contact-horse',{'neck':((.3,-.1,1.1),(.4,-.1,1.3)),'head':((.4,-.1,1.3),(.55,-.1,1.3))},{'head':'neck'})
for frame in range(1,49):
 scene.frame_set(frame)
 for obj in (human,horse):
  obj.location=(0, .015*math.sin(frame/10) if obj==horse else 0,0)
  obj.keyframe_insert('location',frame=frame)
  for bone in obj.pose.bones:
   bone.rotation_mode='QUATERNION'
   for key in ('location','rotation_quaternion','scale'):bone.keyframe_insert(key,frame=frame)
actors=[{'id':'human','shape':'human','riggedModel':{'sourceJobId':'human-job'}},{'id':'horse','shape':'horse','riggedModel':{'sourceJobId':'horse-job'}}]
models=[{'actorId':a['id'],'rig':obj,'boneMap':{b.name:b.name for b in obj.pose.bones},'inspection':{'sha256':sha*64}} for a,obj,sha in zip(actors,[human,horse],['a','b'])]
c={'id':'touch','actorId':'human','hand':'hand1','targetActorId':'horse','bone':'neck','along':1,'offset':[0,0,0],'startSec':0,'contactSec':.5,'releaseSec':1.5,'endSec':2}
spec={'actors':actors,'handContacts':[c]}
rigs=[(actors[0],human,None,None,None),(actors[1],horse,None,None,None)]
rows=apply_hand_contacts(spec,rigs,scene,lambda a,f:True,models)
row=rows[0]
assert len(row['samples'])==48
assert row['source']['sourceJobId']=='human-job' and row['targetSource']['sourceJobId']=='horse-job'
assert max(s['residual'] for s in row['samples'])<.005
held=[s for s in row['samples'] if s['amount']>.999999]
assert len(held)>=24
assert max(s['target'][1] for s in held)-min(s['target'][1] for s in held)>.001
for s in held:assert math.dist(s['wrist'],s['target'])<.005
assert row['samples'][0]['amount']==0
try:
 apply_hand_contacts(spec,rigs,scene,lambda a,f:True,models[:1])
 raise AssertionError('应拒绝没有实际马模型')
except ValueError as error:assert '实际模型' in str(error)
print('HAND_CONTACTS_NUMERIC_OK frames=48 heldFrames=%d movingHorse=1 wristResidual<0.005 realSourceIdentity=1 rendered=0'%len(held))
