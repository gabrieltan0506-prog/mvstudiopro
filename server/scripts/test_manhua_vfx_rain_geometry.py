"""无渲染数字雨几何探针：只创建内存场景，不输出媒体。"""
import sys,json,math
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
import bpy
from manhua_vfx import build_vfx,update_vfx
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
e={'id':'rain','kind':'digital_rain','startSec':0.2,'durationSec':2,'intensity':1,'scale':1,'color':'#35FF82','anchor':{'space':'screen','position':[.5,.5]},'rain':{'columns':36,'speed':.5,'trail':16}}
spec={'version':1,'seed':42,'durationSec':3,'fps':24,'width':640,'height':360,'effects':[e]}
h=build_vfx(spec,bpy.context.scene)
assert len(h[0]['objects'])==576
assert len(h[0]['rain']['meshes'])==2
assert sum(map(len,h[0]['rain']['meshes']))==32
samples=[]
for t in [0,.2,.5,1.5,2.2,2.5,.5]:
 update_vfx(h,spec,t)
 visible=[o for o in h[0]['objects'] if not o.hide_render]
 assert all(math.isfinite(v) for o in visible for v in o.location)
 if t<.2 or t>=2.2: assert not visible
 if t in [.5,1.5]: assert visible
 samples.append({'time':t,'visible':len(visible),'first':tuple(h[0]['objects'][0].location)})
assert samples[2]==samples[-1]
assert all(a.node.inputs[0].is_linked for a in h[0]['rain']['opacity'])
print('RAIN_GEOMETRY_PASS '+json.dumps({'objects':576,'meshes':32,'samples':samples,'rendered':False}))
