"""仅Blender内存验证烘焙；不渲染、保存工程或导出媒体。"""
import math
import sys
from pathlib import Path
import bpy
from mathutils import Vector
sys.path.insert(0, str(Path(__file__).resolve().parent))
from manhua_vfx_stage_export import bake_world_animation

for obj in list(bpy.data.objects):bpy.data.objects.remove(obj,do_unlink=True)
scene=bpy.context.scene;scene.frame_start=1;scene.frame_end=48;scene.render.fps=24
parent=bpy.data.objects.new('TEST_ONLY_parent',None);scene.collection.objects.link(parent)
for frame,x in [(1,0),(48,.4)]:parent.location=(x,0,0);parent.rotation_euler.z=x;parent.keyframe_insert('location',frame=frame);parent.keyframe_insert('rotation_euler',frame=frame)
rig=bpy.data.objects.new('TEST_ONLY_rig',bpy.data.armatures.new('TEST_ONLY_armature'));scene.collection.objects.link(rig)
rig.parent=parent;bpy.context.view_layer.objects.active=rig;rig.select_set(True)
bpy.ops.object.mode_set(mode='EDIT');bone=rig.data.edit_bones.new('TEST_ONLY_bone');bone.head=(0,0,0);bone.tail=(0,0,1);bpy.ops.object.mode_set(mode='OBJECT')
bone=rig.pose.bones[0];bone.rotation_mode='XYZ'
for frame,angle in [(1,0),(48,.2)]:bone.rotation_euler.y=angle;bone.keyframe_insert('rotation_euler',frame=frame)
bpy.ops.mesh.primitive_cube_add(size=.2,location=(0,0,.5));body=bpy.context.object;body.name='TEST_ONLY_body';body.parent=rig
group=body.vertex_groups.new(name=bone.name);group.add(list(range(8)),1,'REPLACE');modifier=body.modifiers.new('TEST_ONLY_skin','ARMATURE');modifier.object=rig
bpy.ops.mesh.primitive_cube_add(size=.1,location=(1,0,1));fragment=bpy.context.object;fragment.name='TEST_ONLY_fragment'
material=bpy.data.materials.new('TEST_ONLY_material');material.use_nodes=True;fragment.data.materials.append(material)
camera=bpy.data.objects.new('TEST_ONLY_camera',bpy.data.cameras.new('TEST_ONLY_camera_data'));scene.collection.objects.link(camera);scene.camera=camera
camera.location=(0,-5,2);camera.rotation_euler=(Vector((0,0,1))-camera.location).to_track_quat('-Z','Y').to_euler()
spec={'fps':24,'durationSec':2,'width':64,'height':64}
handle={'actors':[body],'prop':{'objects':[fragment]},'rigs':[rig]}
def update(scene,*args):
    time=args[-1];scene.frame_set(round(time*24)+1);fragment.location=(1+min(time,.8),0,1);bpy.context.view_layer.update();return {'active':True}
def points():
    evaluated=body.evaluated_get(bpy.context.evaluated_depsgraph_get());mesh=evaluated.to_mesh()
    try:return [evaluated.matrix_world@v.co for v in mesh.vertices]
    finally:evaluated.to_mesh_clear()
expected=[]
for frame in range(48):update(scene,None,None,None,None,frame/24);expected.append(points())
objects,rigs,timeline,proof=bake_world_animation(scene,handle,{}, {},spec,update)
assert len(timeline['frames'])==len(proof)==48 and timeline['fragmentIds']==[fragment.name]
for frame in range(48):
    scene.frame_set(frame+1);bpy.context.view_layer.update()
    assert max((a-b).length for a,b in zip(points(),expected[frame]))<.0001
    assert abs(fragment.matrix_world.translation.x-(1+min(frame/24,.8)))<.0001
    assert set(timeline['frames'][frame]['visibleObjectIds'])=={body.name,fragment.name}
print('VFX_STAGE_BAKE_TEST_ONLY_PASS: 48帧父变换/蒙皮世界顶点/碎片定格保留；无渲染、无导出')
