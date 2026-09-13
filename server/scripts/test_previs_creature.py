"""Blender内独立结构验收；可选--render生成真实视觉小样，不联网。"""
import json
import math
import subprocess
import sys
from pathlib import Path
import bpy
from mathutils import Vector
from bpy_extras.object_utils import world_to_camera_view

sys.path.insert(0, str(Path(__file__).resolve().parent))
from previs_creature import build_creature, summarize, world_vertices

out = Path(sys.argv[sys.argv.index('--')+1])
out.mkdir(parents=True, exist_ok=True)
assert not (out/'receipt.json').exists(), '验收目录必须独立，不能覆盖已有回执'
scene = bpy.context.scene
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
scene.render.fps = 24
scene.frame_start, scene.frame_end = 1, 96
scene.render.resolution_x, scene.render.resolution_y = 960, 540
scene.render.resolution_percentage = 100
data = bpy.data.armatures.new('验收主体')
owner = bpy.data.objects.new('horse-test', data)
scene.collection.objects.link(owner)
bpy.context.view_layer.objects.active = owner
owner.select_set(True)
bpy.ops.object.mode_set(mode='EDIT')
bone = data.edit_bones.new('body')
bone.head, bone.tail = (-.7,0,1.2),(.65,0,1.2)
bpy.ops.object.mode_set(mode='OBJECT')
for frame in range(1,97):
    owner.location.x = (frame-1)/240
    owner.keyframe_insert('location',frame=frame)
actor = {'id':'horse-test','shape':'horse','creature':{'preset':'four_tail_black_wings','transformStartSec':.5,'transformEndSec':2.5}}
points = lambda frame: {'body':(Vector((-.7,0,1.2)),Vector((.65,0,1.2)))}
(out/'request.json').write_text(json.dumps(actor,ensure_ascii=False,indent=2))
before = len(bpy.data.objects)
assert build_creature({'id':'plain','shape':'horse'},owner,scene,points) is None
assert len(bpy.data.objects) == before
invalid = [dict(actor,shape='human'),dict(actor,creature={**actor['creature'],'transformEndSec':.6}),dict(actor,creature={**actor['creature'],'transformEndSec':math.nan}),dict(actor,creature={**actor['creature'],'tails':5}),dict(actor,creature={**actor['creature'],'transformEndSec':4})]
for candidate in invalid:
    try:
        build_creature(candidate,owner,scene,points)
    except ValueError:
        pass
    else:
        raise AssertionError('非法配置未拒绝')
assert len(bpy.data.objects) == before
# 最后实际帧结束的边界值可接受，且该帧进度精确到终态。
from previs_creature import _config, _smooth
last_time = (scene.frame_end-1)/scene.render.fps
edge = _config(dict(actor,creature={**actor['creature'],'transformEndSec':last_time}),last_time)
assert _smooth((last_time-edge['transformStartSec'])/(edge['transformEndSec']-edge['transformStartSec'])) == 1
handle = build_creature(actor,owner,scene,points)
report = summarize(handle)
assert report['tailBones'] == 12 and report['wingBones'] == 6
assert report['meshObjects'] == 36
assert handle['rig'].parent == owner and handle['rig']['ownerId'] == actor['id']
assert len(owner.data.bones) == 1, '不得修改原型骨架'
bpy.ops.object.camera_add(location=(7,-9,6))
camera = bpy.context.object
camera.rotation_euler = (Vector((-.2,0,1.1))-camera.location).to_track_quat('-Z','Y').to_euler()
camera.data.lens = 35
scene.camera = camera
checks = []
tips = []
for frame in range(1,97):
    scene.frame_set(frame)
    bpy.context.view_layer.update()
    verts = list(world_vertices(handle))
    assert all(math.isfinite(v) for p in verts for v in p)
    projected = [world_to_camera_view(scene,camera,p) for p in verts]
    offscreen = sum(not(.02 <= p.x <= .98 and .02 <= p.y <= .98 and p.z > 0) for p in projected)
    assert offscreen == 0, (frame,offscreen)
    gap = max((b.head-b.parent.tail).length for b in handle['rig'].pose.bones if b.parent)
    assert gap < .0001, (frame,gap)
    if frame in (1,37,61,96):
        checks.append({'frame':frame,'vertices':len(verts),'chainGap':gap,'offscreenVertices':offscreen,'progress':report['stages'][frame-1]['progress']})
    tips.append(tuple(handle['rig'].pose.bones['tail_0_2'].tail))
assert checks[0]['vertices'] == 0
assert checks[1]['vertices'] == 288 and 0 < checks[1]['progress'] < 1
assert checks[2]['progress'] == 1 and checks[3]['vertices'] == 288
assert (Vector(tips[60])-Vector(tips[-1])).length > .01, '终态尾链没有运动'
if '--render' in sys.argv:
    # 仅用于附件小样的固定白模马体，不代替主renderer整合验收。
    body_parts = [((-.03,0,1.2),(.8,.32,.35)),((.72,0,1.55),(.22,.23,.52)),
                  ((.96,0,1.91),(.36,.21,.22)),((1.04,-.12,2.16),(.06,.06,.20)),
                  ((1.04,.12,2.16),(.06,.06,.20))]
    body_parts += [((x,y,.62),(.10,.10,.55)) for x in (-.53,.48) for y in (-.22,.22)]
    for index,(location,scale) in enumerate(body_parts):
        bpy.ops.mesh.primitive_uv_sphere_add(segments=12,ring_count=6,location=location)
        part = bpy.context.object
        part.name = '视觉夹具马体_'+str(index)
        part.scale = scale
        part.parent = owner
        part.color = (.68,.71,.75,1.)
    scene.render.engine = 'BLENDER_WORKBENCH'
    scene.display.shading.light = 'STUDIO'
    scene.display.shading.color_type = 'MATERIAL'
    scene.display.shading.show_shadows = True
    scene.display.shading.show_cavity = True
    scene.display.shading.background_type = 'WORLD'
    scene.world.color = (.055,.065,.08)
scene.frame_set(61)
bpy.ops.wm.save_as_mainfile(filepath=str(out/'scene.blend'))
(out/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
# 丢弃全部旧对象引用，从保存后的工程重建读取句柄，证明不是仅内存动画。
bpy.ops.wm.open_mainfile(filepath=str(out/'scene.blend'))
scene = bpy.context.scene
saved_rig = bpy.data.objects['horse-test_creature']
saved = {'rig':saved_rig,'meshes':[o for o in bpy.data.objects if o.type == 'MESH' and o.parent == saved_rig]}
readback = []
for frame in (1,37,61,96):
    scene.frame_set(frame)
    bpy.context.view_layer.update()
    verts = list(world_vertices(saved))
    assert len(verts) == (0 if frame == 1 else 288)
    root = saved_rig.matrix_world @ saved_rig.pose.bones['tail_0_0'].head
    expected = saved_rig.parent.matrix_world @ Vector((-.72,-.1125,1.22))
    assert (root-expected).length < .0001, '保存回读后附件脱离同一主体'
    extent = max(p.y for p in verts)-min(p.y for p in verts) if verts else 0
    readback.append({'frame':frame,'vertices':len(verts),'ownerAnchorError':(root-expected).length,'widthY':extent})
assert readback[2]['widthY'] > readback[1]['widthY'] * 1.5, '中段到终态没有真实展翼几何增长'
(out/'readback.json').write_text(json.dumps(readback,ensure_ascii=False,indent=2))
rendered_frames = 0
if '--render' in sys.argv:
    images = out/'frames'
    images.mkdir()
    scene.render.image_settings.file_format = 'PNG'
    scene.render.filepath = str(images/'frame-')
    bpy.ops.render.render(animation=True)
    rendered_frames = len(list(images.glob('frame-*.png')))
    assert rendered_frames == 96
    subprocess.run(['ffmpeg','-y','-framerate','24','-i',str(images/'frame-%04d.png'),'-c:v','libx264','-pix_fmt','yuv420p','-movflags','+faststart',str(out/'creature-preview.mp4')],check=True)
receipt = {'ok':True,'blender':bpy.app.version_string,'framesChecked':96,'tailBones':12,'wingBones':6,'meshes':36,'verticesPerVisibleFrame':288,'invalidRejected':len(invalid),'samples':checks,'readback':readback,'renderedFrames':rendered_frames,'boundary':'模块结构与逐帧实际网格投影及可选视觉夹具小样，非整厂UI/渲染/计费验收'}
(out/'receipt.json').write_text(json.dumps(receipt,ensure_ascii=False,indent=2))
print(json.dumps(receipt,ensure_ascii=False))
