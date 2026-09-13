"""Blender内核验真：完整帧、变换、灯光绑定、保存恢复及无特效零改动。"""
import json
import os
import sys
import bpy
from mathutils import Vector
sys.path.insert(0, os.path.dirname(__file__))
from previs_effects import build_effects, measure_effects

out = sys.argv[sys.argv.index('--')+1] if '--' in sys.argv else '/tmp/previs-effects-kernel'
os.makedirs(out, exist_ok=True)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
scene = bpy.context.scene
scene.frame_end = 48
scene.render.engine = 'BLENDER_WORKBENCH'
count = len(scene.objects)
assert build_effects({}, scene) == []
assert scene.render.engine == 'BLENDER_WORKBENCH' and len(scene.objects) == count
spec = {'effects': [
 {'id':'explosion','kind':'explosion','startSec':.5,'durationSec':1,'origin':[0,0,0],'radius':1,'height':2,'wind':[.5,.25]},
 {'id':'smoke','kind':'smoke','startSec':1/24,'durationSec':.5,'origin':[3,0,0],'radius':.5,'height':1,'wind':[-.5,0]}]}
with open(os.path.join(out,'spec.json'),'w') as f: json.dump(spec,f,ensure_ascii=False,indent=2)
handles = build_effects(spec, scene)
rows = measure_effects(handles, scene)
assert len(rows) == 2 and all(len(r['samples']) == 48 for r in rows)
assert not rows[0]['samples'][11]['visible'] and rows[0]['samples'][12]['visible']
assert rows[0]['samples'][12]['lightEnergy'] == 1400
assert rows[0]['samples'][17]['lightEnergy'] == 0
assert not rows[0]['samples'][36]['visible']
assert all(s['lightEnergy'] == 0 for s in rows[1]['samples'])
assert rows[1]['samples'][1]['visible'] and not rows[1]['samples'][13]['visible']
assert rows[0]['samples'][24]['center'][0] > rows[0]['samples'][12]['center'][0]
for frame in range(13, 18):
 scene.frame_set(frame)
 bpy.context.view_layer.update()
 assert (handles[0]['light'].matrix_world.translation-Vector((0,0,0))).length < 1e-6
# 回读证据必须能发现真实对象偏移，不能返回规划位置。
scene.frame_set(13)
root = handles[0]['root']
root.location.x = 7
root.keyframe_insert('location',frame=13)
assert measure_effects(handles,scene)[0]['samples'][12]['center'][0] == 7
root.location.x = 0
root.keyframe_insert('location',frame=13)
rows = measure_effects(handles, scene)
identities = [(h['root'].name,h['light'].name,[o.name for o in h['parts']]) for h in handles]
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(out,'scene.blend'))
bpy.ops.wm.open_mainfile(filepath=os.path.join(out,'scene.blend'))
scene = bpy.context.scene
restored = [{'event':e,'root':bpy.data.objects[r],'light':bpy.data.objects[l],'parts':[bpy.data.objects[n] for n in p]} for e,(r,l,p) in zip(spec['effects'],identities)]
assert measure_effects(restored,scene) == rows
with open(os.path.join(out,'report.json'),'w') as f: json.dump(rows,f,ensure_ascii=False,indent=2)
with open(os.path.join(out,'acceptance.json'),'w') as f: json.dump({'frames':48,'events':2,'savedRestored':True,'mutationDetected':True,'pointLightAnchored':True,'noEffectsUnchanged':True,'fractionalFrameEndInvisible':True,'blenderVersion':bpy.app.version_string},f,indent=2)
print('EFFECTS_KERNEL_PASS')
