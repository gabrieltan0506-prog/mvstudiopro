"""正式道具模块的无图像数值验证：不渲染媒体，不访问外部服务。"""
import json
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
import bpy
from previs_story_props import build_story_props
bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
scene=bpy.context.scene; scene.frame_start=1; scene.frame_end=101
D=4.2
anchor={'type':'world','position':[0,0,0]}
def keys(rotation=None):
    return [{'timeSec':t,'anchor':anchor,'visible':True,'scale':1,'rotation':rotation if t else [0,0,0],'fill':0} for t in (0,D)]
spec={'durationSec':D,'actors':[],'storyProps':[
    {'id':'wall','kind':'folding_wall','proxy':{'size':[2,.15,3],'color':[.6,.6,.6]},'keyframes':keys([0,0,1])},
    {'id':'chair','kind':'chair_burst_text','proxy':{'size':[.52,.5,1.1],'color':[.4,.3,.2],
      'burst':{'startSec':1.1,'burstEndSec':1.7,'gatherStartSec':2.1,'gatherEndSec':3.3,'text':'真人把关','textPosition':[-.5,0,1.2],'textWidth':1.1}},'keyframes':keys([0,0,0])},
    {'id':'card','kind':'information_panel','proxy':{'size':[.6,.03,.4],'color':[.4,.5,.6],'label':'问题'},'keyframes':keys([0,0,0])},
]}
handles=build_story_props(spec,[],scene,lambda *_: True)
chair=next(h for h in handles if h['spec']['id']=='chair')
# 从实际对象测量，检查同一椅子在不同阶段互斥；每帧已由正式模块烘焙。
from previs_workflow_props import measure_workflow_state
objects=chair['objects']
for frame,counts in [(1,(6,0,False)),(40,(0,48,False)),(85,(0,0,True))]:
    scene.frame_set(frame); bpy.context.view_layer.update()
    state=measure_workflow_state(objects)
    assert (state['chairPartsVisible'],state['fragmentsVisible'],state['textVisible'])==counts,state
    if counts[2]: assert state['targetMaxError']<.00001,state
assert all(len(h['samples'])==101 for h in handles)
args=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
if args:
    Path(args[0]).write_text(json.dumps({'spec':spec,'report':[{'id':p['id'],'kind':p['kind'],'samples':h['samples']} for p,h in zip(spec['storyProps'],handles)]},ensure_ascii=False))
print('WORKFLOW_PROPS_NUMERIC_PASS frames=101 chairParts=6 fragments=48 ChineseMesh=true; no media render')
