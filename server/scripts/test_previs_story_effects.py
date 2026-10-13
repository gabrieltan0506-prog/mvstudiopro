"""有界剧情特效真实Blender开发探针；所有模型/贴图均现场生成测试夹具。"""
import sys,json,math,copy
from pathlib import Path
import bpy
from mathutils import Vector
sys.path.insert(0,str(Path(__file__).resolve().parent))
from previs_story_props import build_story_props
from previs_scene_effects import build_scene_effects,measure_scene_effects,validate_scene_effects

out=Path(sys.argv[sys.argv.index('--')+1]).resolve();out.mkdir(parents=True,exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True);scene=bpy.context.scene;scene.frame_start=1;scene.frame_end=48;scene.render.fps=24;scene.render.fps_base=1
scene.render.engine='BLENDER_WORKBENCH';scene.render.resolution_x=480;scene.render.resolution_y=360;scene.render.resolution_percentage=100
arm=bpy.data.armatures.new('测试头颈骨');rig=bpy.data.objects.new('测试人体',arm);scene.collection.objects.link(rig);bpy.context.view_layer.objects.active=rig;rig.select_set(True);bpy.ops.object.mode_set(mode='EDIT')
for name,a,b in [('spine',(0,0,.4),(0,0,1)),('neck',(0,0,1),(0,0,1.1)),('head',(0,0,1.1),(0,0,1.4))]:
 bone=arm.edit_bones.new(name);bone.head=a;bone.tail=b
bpy.ops.object.mode_set(mode='OBJECT')
image=bpy.data.images.new('测试基础色',width=2,height=2);image.pixels=[.7,.48,.39,1]*4;image.pack()
material=bpy.data.materials.new('测试原始贴图');material.use_nodes=True;p=material.node_tree.nodes.get('Principled BSDF');tex=material.node_tree.nodes.new('ShaderNodeTexImage');tex.image=image;material.node_tree.links.new(tex.outputs['Color'],p.inputs['Base Color'])
meshes=[]
for name,loc,scale,bone in [('测试头部',(0,0,1.25),(.18,.16,.2),'head'),('测试躯干',(0,0,.7),(.22,.14,.3),'spine')]:
 bpy.ops.mesh.primitive_uv_sphere_add(segments=16,ring_count=8,location=loc);obj=bpy.context.object;obj.name=name;obj.scale=scale;bpy.ops.object.transform_apply(location=True,rotation=True,scale=True);obj.parent=rig;obj.data.materials.append(material);group=obj.vertex_groups.new(name=bone);group.add(list(range(len(obj.data.vertices))),1,'REPLACE');modifier=obj.modifiers.new('测试真实蒙皮','ARMATURE');modifier.object=rig;meshes.append(obj)
for f in range(1,49):rig.location.x=.03*math.sin((f-1)/47*math.tau);rig.keyframe_insert('location',frame=f)
bpy.ops.object.camera_add(location=(2,-3,1.7));scene.camera=bpy.context.object;scene.camera.rotation_euler=(Vector((0,0,1))-scene.camera.location).to_track_quat('-Z','Y').to_euler();scene.camera.data.lens=55
actor={'id':'fixture','shape':'human'};binding={'actorId':'fixture','shape':'human','isRiggedModel':True,'rig':rig,'meshes':meshes,'boneMap':{b.name:b.name for b in rig.pose.bones}}
anchor={'type':'bone','actorId':'fixture','bone':'spine','along':1,'offset':[.02,-.02,.02]}
spec={'actors':[actor],'storyProps':[{'id':'test-needle','kind':'needle','keyframes':[{'timeSec':0,'visible':True,'anchor':{'type':'world','position':[-.7,0,1]}},{'timeSec':.25,'visible':True,'anchor':{'type':'world','position':[-.6,0,1]}},{'timeSec':.75,'visible':True,'anchor':anchor},{'timeSec':2,'visible':True,'anchor':anchor}]}]}
props=build_story_props(spec,[(actor,rig)],scene,lambda a,f:True)
events=[{'id':'tail','actorId':'fixture','kind':'needle_trail','propId':'test-needle','startSec':.25,'endSec':.75,'color':'#FFD477','radius':.003,'trailSec':.25},
{'id':'smoke','actorId':'fixture','kind':'acupoint_smoke','propId':'test-needle','startSec':1,'endSec':1.75,'color':'#202228','radius':.04,'rise':.2,'density':18,'offset':[.01,-.08,0]},
{'id':'warm','actorId':'fixture','kind':'complexion','startSec':1,'endSec':1.75,'color':'#F3AE98','strength':.25}]
# 所有负例在创建效果对象前执行，不能靠下游异常误判通过。
rejected=0
for change in ('foreign_prop','smoke_early','no_rig','short_warm','over_time'):
 bad=copy.deepcopy(events);bindings=[binding.copy()]
 if change=='foreign_prop':bad[0]['propId']='missing'
 elif change=='smoke_early':bad[1]['startSec']=.5
 elif change=='no_rig':bindings[0]['isRiggedModel']=False
 elif change=='short_warm':bad[2]['endSec']=1+1/24
 else:bad[0]['endSec']=2
 try:validate_scene_effects(bad,scene,bindings,props)
 except ValueError:rejected+=1
 else:raise AssertionError('负例未拒绝 '+change)
handles=build_scene_effects(events,scene,[binding],evidence_dir=out,story_props=props);report=measure_scene_effects(handles,scene)
assert all(len(row['samples'])==48 for row in report)
assert max(s['attachmentError'] for r in report[:2] for s in r['samples'])<.005
assert max(s['trailLength'] for s in report[0]['samples'])>.05
assert max(s['density'] for s in report[1]['samples'])>1
assert report[2]['samples'][-1]['strength']>.249 and report[2]['samples'][0]['strength']==0
assert all(s['maskConnected'] and s['texturePreserved'] for s in report[2]['samples'])
assert meshes[1].data.materials[0]==material and not meshes[1].data.attributes.get('warm_头颈权重')
original_pixels=list(image.pixels);mesh_names=[obj.name for obj in meshes];effect_names=[obj.name for h in handles for obj in h['objects']];mat_names=[r['material'] for r in handles[2]['materials']]
def snapshot():
 values=[]
 for f in range(1,49):
  scene.frame_set(f);bpy.context.view_layer.update()
  values.append([float(v) for name in effect_names for row in bpy.data.objects[name].matrix_world for v in row]+[bpy.data.materials[n].node_tree.nodes['warm_时间强度'].inputs[1].default_value for n in mat_names])
 return values
before=snapshot();scene.frame_set(1);bpy.ops.wm.save_as_mainfile(filepath=str(out/'scene.blend'));bpy.ops.wm.open_mainfile(filepath=str(out/'scene.blend'));scene=bpy.context.scene;after=snapshot()
error=max(abs(a-b) for row0,row1 in zip(before,after) for a,b in zip(row0,row1));assert error<1e-6
assert list(bpy.data.images['测试基础色'].pixels)==original_pixels
for f in (13,31,43):
 scene.frame_set(f);scene.render.filepath=str(out/f'frame-{f:04}.png');scene.render.image_settings.file_format='PNG';bpy.ops.render.render(write_still=True)
result={'syntheticDevelopmentOnly':True,'onlineAcceptance':False,'blender':bpy.app.version_string,'frames':48,'effects':3,'rejectedInputs':rejected,'savedReopenMaxError':error,'originalTextureUnchanged':True,'bodyMaterialUnchanged':True,'headOnlyMask':True,'maximumSmokeDensity':max(s['density'] for s in report[1]['samples'])}
(out/'report.json').write_text(json.dumps(report,ensure_ascii=False));(out/'result.json').write_text(json.dumps(result,ensure_ascii=False));print('STORY_EFFECTS_BLENDER_PASS '+json.dumps(result),flush=True)
