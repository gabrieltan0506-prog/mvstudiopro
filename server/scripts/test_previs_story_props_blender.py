"""新增道具模块的无渲染Blender数值探针；不保存场景、不输出图片或视频。"""
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
import bpy
from mathutils import Vector
from previs_story_props import build_story_props
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
scene=bpy.context.scene;scene.frame_start=1;scene.frame_end=48
arm=bpy.data.armatures.new('story-prop-math-probe')
rig=bpy.data.objects.new('story-prop-math-probe',arm);scene.collection.objects.link(rig)
bpy.context.view_layer.objects.active=rig;rig.select_set(True)
bpy.ops.object.mode_set(mode='EDIT')
geometry={'upper_arm1':((0,0,1.4),(.25,.1,1.2)),'forearm1':((.25,.1,1.2),(.5,0,1.2)),'hand1':((.5,0,1.2),(.6,0,1.2)),'head':((0,0,1.5),(0,0,1.8))}
for name,(head,tail) in geometry.items():
 bone=arm.edit_bones.new(name);bone.head=head;bone.tail=tail
arm.edit_bones['forearm1'].parent=arm.edit_bones['upper_arm1']
arm.edit_bones['hand1'].parent=arm.edit_bones['forearm1']
bpy.ops.object.mode_set(mode='OBJECT')
for frame in range(1,49):
 scene.frame_set(frame)
 rig.location=(0,frame*.001,0);rig.keyframe_insert('location',frame=frame)
 for bone in rig.pose.bones:
  bone.rotation_mode='QUATERNION'
  for key in ('location','rotation_quaternion','scale'):bone.keyframe_insert(key,frame=frame)
actor={'id':'holder','shape':'human','riggedModel':{'sourceJobId':'test-story-prop'}}
model={'actorId':'holder','rig':rig,'boneMap':{name:name for name in geometry}}
def bone(name,offset=None):return {'type':'bone','actorId':'holder','bone':name,'along':0,'offset':offset or [0,0,0]}
def key(t,anchor,visible=True):return {'timeSec':t,'anchor':anchor,'visible':visible,'scale':1,'rotation':[0,0,0],'fill':.5}
spec={'actors':[actor],'storyProps':[
 {'id':'bowl','kind':'bowl','grip':{'actorId':'holder','hand':'hand1','offset':[0,0,-.02]},'keyframes':[key(0,bone('hand1',[0,0,.02])),key(2,bone('hand1',[.03,0,.02]))]},
 {'id':'needle','kind':'needle','keyframes':[key(0,bone('hand1')),key(1,bone('head',[.03,0,0])),key(2,bone('head',[.03,0,0]))]},
 {'id':'drop','kind':'blood_drop','keyframes':[key(0,bone('head')),key(1,{'type':'prop','propId':'bowl','offset':[0,0,.03]}),key(2,{'type':'prop','propId':'bowl','offset':[0,0,.03]},False)]},
 {'id':'glow','kind':'sleeve_glow','keyframes':[key(0,bone('hand1'),False),key(1,bone('hand1'),True),key(2,bone('hand1'),True)]},
]}
if '--knife-jar-only' in sys.argv:
    world={'type':'world','position':[.5,0,1.2]}
    spec['storyProps']=[
      {'id':'knife','kind':'knife','grip':{'actorId':'holder','hand':'hand1','offset':[0,0,-.16],'startSec':0,'endSec':.75},'keyframes':[key(0,bone('hand1',[0,0,.16])),key(.75,bone('hand1',[0,0,.16]),False),key(2,bone('hand1',[0,0,.16]),False)]},
      {'id':'jar','kind':'jar','grip':{'actorId':'holder','hand':'hand1','offset':[0,0,-.02],'startSec':.75,'endSec':1.5},'keyframes':[key(0,bone('hand1',[0,0,.02]),False),key(.75,bone('hand1',[0,0,.02])),key(1.5,world),key(2,world)]},
    ]
handles=build_story_props(spec,[(actor,rig,None,None,None)],scene,lambda _a,_f:True,[model])
if '--knife-jar-only' in sys.argv:
    knife,jar=handles
    assert len(knife['objects'])==2 and len(jar['objects'])==2
    assert max(v.co.z for v in jar['objects'][0].data.vertices)>.29
    assert all(obj.get('previs_animation_object') for h in handles for obj in h['objects'])
    assert all('gripResidual' in sample for sample in knife['samples'][:18])
    assert all('gripResidual' in sample for sample in jar['samples'][18:36])
    assert all('gripResidual' not in sample for sample in jar['samples'][36:])
    for sample in jar['samples'][36:]:
        assert max(abs(sample['position'][i]-world['position'][i]) for i in range(3))<1e-6
        assert abs(sample['fillLevel']-.5)<1e-6
    print('STORY_PROPS_KNIFE_JAR_OK frames=48 distinctGeometry=2 sequentialGrip=1 fixedTable=1 fill=0.5 rendered=0')
elif '--fill-only' in sys.argv:
    bowl=handles[0]
    assert len(bowl['objects'])==2
    assert all(obj.get('previs_animation_object') for obj in bowl['objects'])
    assert all(abs(sample['fillLevel']-.5)<1e-8 for sample in bowl['samples'])
    for frame in (1,24,48):
        scene.frame_set(frame);bpy.context.view_layer.update()
        liquid=bowl['objects'][1]
        assert not liquid.hide_render
        assert abs(liquid.location.z-.0575)<1e-6
        assert abs(liquid.scale.x-.09)<1e-6
    print('STORY_PROPS_FILL_OK frames=48 fill=0.5 exportedObjects=2 rendered=0')
else:
    assert all(len(h['samples'])==48 for h in handles)
    assert all(obj.get('previs_animation_object') for h in handles for obj in h['objects'])
    assert len(handles[0]['objects'])==2
    assert all(abs(sample['fillLevel']-.5)<1e-8 for sample in handles[0]['samples'])
    assert max(s['gripResidual'] for s in handles[0]['samples'])<.005
    assert not any(s['visible'] for s in handles[3]['samples'][:24])
    assert all(s['visible'] for s in handles[3]['samples'][24:])
    for sample in handles[1]['samples'][24:]:
     scene.frame_set(sample['frame']);bpy.context.view_layer.update()
     pb=rig.pose.bones['head'];matrix=rig.matrix_world @ pb.matrix
     expected=rig.matrix_world @ pb.head+matrix.to_quaternion() @ Vector((.03,0,0))
     assert (Vector(sample['position'])-expected).length<1e-5
    try:
     build_story_props(spec,[(actor,rig,None,None,None)],scene,lambda _a,_f:True,[])
     raise AssertionError('应拒绝隐藏源骨替代真实模型')
    except ValueError as error:
     assert '真实模型' in str(error)
    print('STORY_PROPS_NUMERIC_OK frames=48 props=4 rendered=0 realRigMapping=1 gripResidual<0.005 retainedNeedle=1 sleeveVisibility=1')
