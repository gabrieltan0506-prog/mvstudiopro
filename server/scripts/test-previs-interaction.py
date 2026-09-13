"""Blender离线双人接触验收，保留每次输入/报告/场景，不调用网络或清理证据。"""
import copy
import hashlib
from array import array
import json
from pathlib import Path
import runpy
import sys
import bpy

arguments = sys.argv[sys.argv.index('--')+1:]
root = Path(arguments[0])
baseline_script = Path(arguments[1]) if len(arguments)>1 else None
root.mkdir(parents=True, exist_ok=True)
script = Path(__file__).with_name('render-manhua-previs.py')
base = {'version':1, 'durationSec':2, 'aspect':'16:9',
        'actors':[{'id':name, 'nameZh':name, 'shape':'human', 'start':[x,0], 'end':[x,0],
                   'moveStartSec':0, 'moveEndSec':2, 'facingDeg':facing, 'actions':[]}
                  for name,x,facing in [('攻击者',-.35,0),('受方',.35,180)]],
        'cameras':[{'startSec':0,'endSec':2,'position':[2,-5,2.3], 'target':[0,0,1], 'lens':40}]}
results=[]
def build(spec, label, renderer=script):
    folder=root/label
    folder.mkdir(exist_ok=True)
    source=folder/'spec.json'
    source.write_text(json.dumps(spec,ensure_ascii=False,indent=2))
    sys.argv=[str(renderer),'--',str(source),str(folder)]
    runpy.run_path(str(renderer),run_name='__main__')
    return folder, json.loads((folder/'report.json').read_text())

for kind in ('strike_recoil','strike_guard'):
    spec=copy.deepcopy(base)
    spec['interactions']=[{'id':kind,'kind':kind,'actorId':'攻击者','targetActorId':'受方',
                           'startSec':0,'contactSec':1,'endSec':2}]
    folder, report=build(spec,kind)
    assert report['interactions'][0]['contactFrame']==25
    assert report['interactions'][0]['contactError'] <= .005
    assert all(a['stanceDrift']<=.005 for a in report['actors'])
    # 同一接触事件必须在结束前有可见受方反应，而非独立出手循环。
    rig=bpy.data.objects['受方']
    bpy.context.scene.frame_set(1)
    bpy.context.view_layer.update()
    initial=rig.pose.bones['spine' if kind=='strike_recoil' else 'hand1'].tail.copy()
    bpy.context.scene.frame_set(37 if kind=='strike_recoil' else 25)
    bpy.context.view_layer.update()
    delta=(rig.pose.bones['spine' if kind=='strike_recoil' else 'hand1'].tail-initial).length
    assert delta>.02
    results.append({'kind':kind,'report':report,'reactionDistance':delta})
    if kind=='strike_recoil':
        spec['actors'].reverse()
        _, reversed_report=build(spec,'reversed-actor-order')
        assert reversed_report['interactions']==report['interactions']
        results.append({'kind':'reversed-actor-order','identicalContact':True})

# 远距离不允许借IK钳位、拉长骨头或把规划点当真实接触通过。
spec=copy.deepcopy(base)
spec['actors'][1]['start']=spec['actors'][1]['end']=[3,0]
spec['interactions']=[{'id':'unreachable','kind':'strike_recoil','actorId':'攻击者','targetActorId':'受方',
                      'startSec':0,'contactSec':1,'endSec':2}]
folder=root/'unreachable';folder.mkdir(exist_ok=True)
source=folder/'spec.json';source.write_text(json.dumps(spec,ensure_ascii=False,indent=2))
sys.argv=[str(script),'--',str(source),str(folder)]
try:
    runpy.run_path(str(script),run_name='__main__')
except ValueError as error:
    assert '不可达' in str(error)
    results.append({'kind':'unreachable','rejected':True,'error':str(error)})
else:
    raise AssertionError('不可达接触未被拒绝')

# 每个拒绝案例独立持久化输入，避免错误被下一个场景掩盖。
from previs_interaction import validate_interactions
for label, change in [
    ('self',lambda s:s['interactions'][0].update(targetActorId='攻击者')),
    ('missing',lambda s:s['interactions'][0].update(targetActorId='不存在')),
    ('non-human',lambda s:s['actors'][1].update(shape='horse')),
    ('off-frame',lambda s:s['interactions'][0].update(contactSec=1.01)),
    ('end-contact',lambda s:s['interactions'][0].update(contactSec=2)),
    ('overlap',lambda s:s['actors'][0]['actions'].append({'kind':'guard','startSec':.5,'endSec':1.5})),
    ('duplicate',lambda s:s['interactions'].append(copy.deepcopy(s['interactions'][0]))),
]:
    candidate=copy.deepcopy(base)
    candidate['interactions']=[{'id':'event','kind':'strike_guard','actorId':'攻击者','targetActorId':'受方',
                               'startSec':0,'contactSec':1,'endSec':2}]
    change(candidate)
    (root/(label+'-spec.json')).write_text(json.dumps(candidate,ensure_ascii=False,indent=2))
    try:
        validate_interactions(candidate)
    except ValueError as error:
        results.append({'kind':label,'rejected':True,'error':str(error)})
    else:
        raise AssertionError(label+'未被拒绝')

if baseline_script:
    # 基础分支的全部骨骼逐帧矩阵与接触帧像素比较；空可选字段不得改旧画面。
    comparisons=[]
    for label, renderer, extra in [('baseline',baseline_script,{}),('absent',script,{}),('empty',script,{'interactions':[]})]:
        folder,report=build({**base,**extra},label,renderer)
        poses=[]
        for frame in range(1,49):
            bpy.context.scene.frame_set(frame)
            bpy.context.view_layer.update()
            poses.append({actor['id']:{bone.name:[list(row) for row in bone.matrix] for bone in bpy.data.objects[actor['id']].pose.bones}
                          for actor in base['actors']})
        (folder/'poses.json').write_text(json.dumps(poses,ensure_ascii=False))
        bpy.context.scene.frame_set(25)
        bpy.context.scene.render.filepath=str(folder/'frame-25.png')
        bpy.ops.render.render(write_still=True)
        image=bpy.data.images.load(str(folder/'frame-25.png'),check_existing=False)
        pixel_sha=hashlib.sha256(array('f',image.pixels[:]).tobytes()).hexdigest()
        bpy.data.images.remove(image)
        comparisons.append({'label':label,'report':report,'poseSha256':hashlib.sha256(json.dumps(poses).encode()).hexdigest(),
                            'pixelSha256':pixel_sha,
                            'imageSha256':hashlib.sha256((folder/'frame-25.png').read_bytes()).hexdigest()})
    # PNG含各场景路径/时间元数据，文件SHA可以不同；像素SHA才是画面不变判据。
    (root/'legacy-comparison.json').write_text(json.dumps(comparisons,ensure_ascii=False,indent=2))
    assert len({c['poseSha256'] for c in comparisons})==1
    assert len({c['pixelSha256'] for c in comparisons})==1
    assert comparisons[0]['report']==comparisons[1]['report']==comparisons[2]['report']
    results.append({'kind':'legacy-pixel-and-pose','comparisons':comparisons})
(root/'validation.json').write_text(json.dumps(results,ensure_ascii=False,indent=2))
print('PREVIS_INTERACTION_VALIDATED',json.dumps(results,ensure_ascii=False))
