"""离线两张同帧亮灭对照；只改变爆点灯能量，保留几何与相机。"""
import bpy
import json
import os
import sys
from mathutils import Vector
from bpy_extras.object_utils import world_to_camera_view
sys.path.insert(0, os.path.dirname(__file__))
from previs_effects import build_effects
out = sys.argv[sys.argv.index('--')+1]
os.makedirs(out,exist_ok=True)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
scene=bpy.context.scene
scene.frame_end=48
scene.render.resolution_x=384
scene.render.resolution_y=256
scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG'
mat=bpy.data.materials.new('受光角色灰材质')
mat.diffuse_color=(.45,.45,.45,1)
bpy.ops.mesh.primitive_cube_add(size=1,location=(1.5,0,.9))
actor=bpy.context.object
actor.name='受光验证角色'
actor.scale=(.65,.65,1.8)
actor.data.materials.append(mat)
bpy.ops.mesh.primitive_plane_add(size=12)
bpy.context.object.data.materials.append(mat)
bpy.ops.object.camera_add(location=(-4,-7,3))
cam=bpy.context.object
cam.rotation_euler=(Vector((.5,0,.8))-cam.location).to_track_quat('-Z','Y').to_euler()
cam.data.type='ORTHO'
cam.data.ortho_scale=5
scene.camera=cam
handles=build_effects({'effects':[{'id':'flash','kind':'explosion','startSec':.5,'durationSec':1,'origin':[0,0,.2],'radius':.7,'height':1,'wind':[0,0]}]},scene)
scene.frame_set(13)
bpy.context.view_layer.update()
points=[world_to_camera_view(scene,cam,actor.matrix_world@Vector(c)) for c in actor.bound_box]
with open(os.path.join(out,'lighting-region.json'),'w') as f:json.dump({'x0':min(p.x for p in points),'x1':max(p.x for p in points),'y0':min(p.y for p in points),'y1':max(p.y for p in points)},f)
scene.render.filepath=os.path.join(out,'lighting-on.png')
bpy.ops.render.render(write_still=True)
handles[0]['light'].data.animation_data_clear()
handles[0]['light'].data.energy=0
scene.render.filepath=os.path.join(out,'lighting-off.png')
bpy.ops.render.render(write_still=True)
on = bpy.data.images.load(os.path.join(out,'lighting-on.png'), check_existing=False)
off = bpy.data.images.load(os.path.join(out,'lighting-off.png'), check_existing=False)
a, b = list(on.pixels), list(off.pixels)
x0,x1=min(p.x for p in points),max(p.x for p in points)
y0,y1=min(p.y for p in points),max(p.y for p in points)
# 取角色包围框中央的保守内区，排除周边地面和火团。
xs=range(int((x0*.75+x1*.25)*384),int((x0*.25+x1*.75)*384))
ys=range(int((y0*.75+y1*.25)*256),int((y0*.25+y1*.75)*256))
diffs=[abs(a[(y*384+x)*4+c]-b[(y*384+x)*4+c]) for y in ys for x in xs for c in range(3)]
mean=sum(diffs)/len(diffs)
with open(os.path.join(out,'lighting-acceptance.json'),'w') as f:json.dump({'actorRegionMeanRgbDelta':mean,'changedValues':sum(d>1/255 for d in diffs),'sampleValues':len(diffs),'onlyPointEnergyChanged':True},f,indent=2)
assert mean > .01, '角色受光差异不足，不能用energy代替画面验收'
print('LIGHTING_AB_RENDERED')
