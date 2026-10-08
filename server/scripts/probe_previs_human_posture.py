"""完整renderer坐卧无媒体数值探针：只保存JSON，不保存场景、图片、模型或视频。"""
import json
from pathlib import Path
import sys

root=Path(sys.argv[sys.argv.index('--')+1]);root.mkdir(parents=True,exist_ok=True)
script=Path(__file__).with_name('render-manhua-previs.py')
source=script.read_text()
marker="bpy.ops.wm.save_as_mainfile(filepath=str(out/'scene.blend'))"
if source.count(marker)!=1: raise ValueError('无媒体输出隔离定位变化，停止探针')
source=source.replace(marker,"pass  # 无媒体探针仅跳过blend输出，保留生产计算与报告门禁")
cases=[]
for mode in ('recline','sit','rise_to_sit'):
    posture={'supportHeight':.45,'reclineDeg':55}
    posture.update({'mode':'rise_to_sit','startSec':.5,'endSec':2} if mode=='rise_to_sit' else {'mode':'hold','posture':mode})
    spec={'version':1,'durationSec':4,'aspect':'16:9','actors':[{'id':'mother','nameZh':'母亲基础预演','shape':'human',
        'start':[0,0],'end':[0,0],'moveStartSec':0,'moveEndSec':4,'facingDeg':0,
        'humanPosture':posture,'actions':[{'kind':'idle','startSec':0,'endSec':4}]}],
        'cameras':[{'startSec':0,'endSec':4,'position':[4,-11,3.2],'target':[0,0,1],'lens':35}]}
    folder=root/mode;folder.mkdir(exist_ok=True)
    (folder/'input.json').write_text(json.dumps(spec))
    sys.argv=[str(script),'--',str(folder/'input.json'),str(folder)]
    scope={'__name__':'__main__','__file__':str(script)}
    exec(compile(source,str(script),'exec'),scope)
    from previs_human_posture_report import measure_human_posture
    import bpy
    measured=measure_human_posture(spec['actors'][0],bpy.data.objects['mother'],bpy.context.scene,bpy.context.view_layer.update)
    supports=[o for o in bpy.data.objects if o.name.startswith('mother_坐卧支撑_')]
    if len(supports)!=2: raise ValueError('正式renderer未构建座面与靠面')
    if any(p.suffix in ('.blend','.glb','.png','.mp4') for p in folder.rglob('*')): raise ValueError('探针不得写媒体产物')
    cases.append({'mode':mode,'measured':measured,'actors':scope['report']['actors'],'supportObjects':[o.name for o in supports]})
(root/'receipt.json').write_text(json.dumps({'noMedia':True,'cases':cases},ensure_ascii=False,indent=2))
print('HUMAN_POSTURE_NUMERIC_PASS',len(cases))
