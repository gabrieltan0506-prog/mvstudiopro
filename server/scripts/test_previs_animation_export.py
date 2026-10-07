import bpy,sys,runpy,json
from pathlib import Path
from mathutils import Vector
out=Path(sys.argv[sys.argv.index('--')+1]) if '--' in sys.argv else Path('/tmp/ep2-animation-export-fixture');out.mkdir(exist_ok=True)
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
scene=bpy.context.scene;scene.frame_start=1;scene.frame_end=48;scene.render.fps=24;scene.render.resolution_x=540;scene.render.resolution_y=960
bpy.ops.object.armature_add();rig=bpy.context.object;rig.name='fixture-rig'
bpy.ops.mesh.primitive_cube_add();obj=bpy.context.object;obj.name='fixture-mesh';obj['previs_animation_object']=True
obj.parent=rig;mod=obj.modifiers.new('skin','ARMATURE');mod.object=rig;group=obj.vertex_groups.new(name=rig.data.bones[0].name);group.add(list(range(8)),1,'REPLACE')
for f in range(1,49):
 scene.frame_set(f);rig.pose.bones[0].rotation_mode='XYZ';rig.pose.bones[0].rotation_euler.y=(f-1)*.01;rig.pose.bones[0].keyframe_insert('rotation_euler',frame=f)
 obj.hide_render=f>24;obj.keyframe_insert('hide_render',frame=f)
bpy.ops.object.camera_add(location=(0,-8,3));cam=bpy.context.object;scene.camera=cam
for f in range(1,49):
 cam.location.x=0 if f<=24 else 2;cam.rotation_euler=(Vector((0,0,1))-cam.location).to_track_quat('-Z','Y').to_euler();cam.keyframe_insert('location',frame=f);cam.keyframe_insert('rotation_euler',frame=f)
 cam.data.lens=35 if f<=24 else 50;cam.data.keyframe_insert('lens',frame=f)
sys.argv=['fixture','--',str(out)]
runpy.run_path(str(Path.cwd()/'server/scripts/export_previs_animation.py'),run_name='__main__')
print('FIXTURE_EXPORT_COMPLETE')
