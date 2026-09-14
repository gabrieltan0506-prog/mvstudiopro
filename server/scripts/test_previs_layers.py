"""单帧解析几何验收：真实遮挡、隐藏动画和Z通道；不渲染整片。"""
import json
import sys
from pathlib import Path
import bpy

sys.path.insert(0,str(Path(__file__).resolve().parent))
from render_previs_layers import render_layers
args=sys.argv[sys.argv.index('--')+1:]
out=Path(args[0]);out.mkdir(parents=True,exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
scene=bpy.context.scene
scene.frame_start,scene.frame_end=1,48
scene.render.fps=24
scene.render.resolution_x,scene.render.resolution_y=960,540
scene.render.resolution_percentage=100
world=bpy.data.worlds.new('世界');scene.world=world
camera=bpy.data.cameras.new('Camera');cam=bpy.data.objects.new('Camera',camera);scene.collection.objects.link(cam)
scene.camera=cam
camera.type='ORTHO';camera.ortho_scale=10
camera.clip_start,camera.clip_end=1,11

def cube(name,position,scale):
 bpy.ops.mesh.primitive_cube_add(size=2,location=position)
 obj=bpy.context.object;obj.name=name;obj.scale=scale
 return obj
body=cube('A_身体',(0,0,-5),(1,1,1))
if len(args)>1 and args[1]=='--import-rig':
 data=bpy.data.armatures.new('SourceRig')
 rig=bpy.data.objects.new('SourceRig',data);scene.collection.objects.link(rig)
 bpy.ops.object.select_all(action='DESELECT');rig.select_set(True);bpy.context.view_layer.objects.active=rig
 bpy.ops.object.mode_set(mode='EDIT')
 bone=data.edit_bones.new('root');bone.head=(0,0,0);bone.tail=(0,0,1)
 bpy.ops.object.mode_set(mode='OBJECT')
 body.name='ImportedBodyOriginalName';body.parent=rig
 group=body.vertex_groups.new(name='root');group.add(list(range(len(body.data.vertices))),1,'REPLACE')
 modifier=body.modifiers.new('Skin','ARMATURE');modifier.object=rig
 body.select_set(True)
 bpy.ops.export_scene.gltf(filepath=str(out/'minimal-rig.glb'),export_format='GLB',use_selection=True,export_animations=False)
 bpy.data.objects.remove(body,do_unlink=True);bpy.data.objects.remove(rig,do_unlink=True)
 existing=set(scene.objects)
 bpy.ops.import_scene.gltf(filepath=str(out/'minimal-rig.glb'))
 imported=[o for o in scene.objects if o not in existing]
 rig=next(o for o in imported if o.type=='ARMATURE');rig.name='A_角色骨架'
 imported_mesh=next(o for o in imported if o.type=='MESH')
 assert not imported_mesh.name.startswith('A_')
 # 对齐生产creature的嵌套骨架父链，并使用无角色前缀网格查祖先。
 child=bpy.data.objects.new('A_creature',bpy.data.armatures.new('NestedCreature'))
 scene.collection.objects.link(child);child.parent=rig
 wing=cube('WingOriginalName',(-2.5,0,-5),(.5,.5,1));wing.parent=child

cube('特效_0_explosion_团_0',(0,0,-7),(1.5,1.5,1))
cube('特效_1_smoke_团_0',(2.5,0,-6),(.5,.5,1))
hidden=cube('特效_2_smoke_团_0',(0,0,-2),(.5,.5,.1))
hidden.hide_render=True;hidden.hide_viewport=True
hidden.keyframe_insert('hide_render',frame=1);hidden.keyframe_insert('hide_viewport',frame=1)
hidden.hide_render=False;hidden.hide_viewport=False
hidden.keyframe_insert('hide_render',frame=2);hidden.keyframe_insert('hide_viewport',frame=2)
scene.frame_set(1)
bpy.ops.wm.save_as_mainfile(filepath=str(out/'scene.blend'))
(out/'spec.json').write_text(json.dumps({'actors':[{'id':'A'}],'durationSec':2}))
meta=render_layers(out/'scene.blend',out,frames=[1])
assert not meta['complete'] and len(meta['files'])==3

def pixel(layer,x,y):
 path=out/'layers'/layer/'frame-0001.png'
 image=bpy.data.images.load(str(path),check_existing=False)
 image.colorspace_settings.name='Non-Color'
 result=tuple(image.pixels[(y*960+x)*4:(y*960+x)*4+4])
 bpy.data.images.remove(image)
 return result[0]
result={'actorCenter':pixel('actors',480,270),'effectCenterOccluded':pixel('effects',480,270),
        'effectRight':pixel('effects',720,270),'depthActorCenter':pixel('depth',480,270),
        'depthEffectRight':pixel('depth',720,270),'depthBackground':pixel('depth',10,10)}
(out/'single-frame-acceptance.json').write_text(json.dumps(result,indent=2))
assert result['actorCenter']>.99 and result['effectCenterOccluded']<.01
assert result['effectRight']>.99
if len(args)>1 and args[1]=='--import-rig':
 result['importedRigActorMask']=result['actorCenter']
 result['nestedCreatureActorMask']=pixel('actors',240,270)
 assert result['nestedCreatureActorMask']>.99
 (out/'single-frame-acceptance.json').write_text(json.dumps(result,indent=2))
assert abs(result['depthActorCenter']-.3)<.003
assert abs(result['depthEffectRight']-.4)<.003
assert result['depthBackground']>.999
print('LAYERS_SINGLE_FRAME_PASS',json.dumps(result))
