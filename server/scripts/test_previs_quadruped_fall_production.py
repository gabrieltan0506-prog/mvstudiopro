"""倒地无媒体探针：实际源骨、显示网格与生产报告；不渲染、不保存blend。"""
import ast
import json
import math
import sys
from pathlib import Path

repo=Path(__file__).resolve().parent
sys.path.insert(0,str(repo))
script=repo/'render-manhua-previs.py'
out=Path(sys.argv[sys.argv.index('--')+1]);out.mkdir(parents=True,exist_ok=True)
module=ast.parse(script.read_text(),filename=str(script))
cut=next(i for i,node in enumerate(module.body) if isinstance(node,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='frames' for t in node.targets))
module.body=module.body[:cut]
assert not any(isinstance(n,ast.Call) and isinstance(n.func,ast.Attribute) and n.func.attr in ('render','save_as_mainfile') for n in ast.walk(module))
code=compile(module,str(script),'exec')
results={}
for mode,duration in [('collapse',4),('hold',2),('moving',4),('moving_hold',2)]:
    folder=out/mode;folder.mkdir(exist_ok=True)
    fall={'mode':'collapse' if mode=='moving' else 'hold' if mode=='moving_hold' else mode,'side':'left'}
    if mode=='collapse':fall.update(startSec=0,foldSec=1,groundSec=2)
    if mode=='moving':fall.update(startSec=1,foldSec=2,groundSec=3)
    start=[.8,0] if mode=='moving_hold' else [0,0]
    end=[.8,0] if mode in ('moving','moving_hold') else [0,0]
    spec={'version':1,'durationSec':duration,'aspect':'16:9',
          'actors':[{'id':'horse','nameZh':'马倒地结构探针','shape':'horse','start':start,'end':end,
                     'moveStartSec':0,'moveEndSec':2.5 if mode=='moving' else duration,'facingDeg':0,'actions':[], 'quadrupedFall':fall}],
          'cameras':[{'startSec':0,'endSec':duration,'position':[3,-5,2.5],'target':[0,0,.8],'lens':35}]}
    source=folder/'spec.json';source.write_text(json.dumps(spec,ensure_ascii=False))
    sys.argv=[str(script),'--',str(source),str(folder)]
    env={'__file__':str(script),'__name__':'__main__'}
    exec(code,env)
    rows=env['report']['quadrupedFalls'][0]['samples']
    held=[r for r in rows if r['held']]
    assert len(rows)==duration*24 and held
    assert env['report']['quadrupedFalls'][0]['meshMeasured'] is True
    assert env['report']['quadrupedFalls'][0]['rootSource']=={'kind':'sourceRig'}
    assert max(abs(r['minimumHeight']) for r in rows)<.005
    assert max(r['torsoMinimumHeight'] for r in held)<.08
    assert min(r['torsoTiltDeg'] for r in held)>=75
    assert min(v for r in held for v in r['legFoldDeg'])>=75
    assert min(r['torsoUp'][1] for r in held)>.96
    assert max(math.dist(held[0]['root'],r['root']) for r in held)<.005
    if mode=='moving':
        from previs_quadruped_fall import fall_movement_progress
        actual=spec['actors'][0]
        assert all(abs(row['root'][0]-.8*fall_movement_progress(actual,i/24))<.005 for i,row in enumerate(rows))
        assert abs(rows[0]['root'][0])<.005 and abs(rows[60]['root'][0]-.8)<.005
        assert rows[24]['root'][0]>rows[23]['root'][0]
        assert max(abs(row['root'][0]-.8) for row in rows[60:])<.005
    results[mode]={'frames':len(rows),'heldFrames':len(held),'maxFloorError':max(abs(r['minimumHeight']) for r in rows),
                   'maxHeldTorsoHeight':max(r['torsoMinimumHeight'] for r in held),
                   'minHeldTorsoTilt':min(r['torsoTiltDeg'] for r in held),
                   'minHeldLegFold':min(v for r in held for v in r['legFoldDeg']),
                   'firstHeldRoot':held[0]['root'],'lastHeldRoot':held[-1]['root']}
assert math.dist(results['collapse']['lastHeldRoot'],results['hold']['firstHeldRoot'])<.005
assert math.dist(results['moving']['lastHeldRoot'],results['moving_hold']['firstHeldRoot'])<.005
result={'cases':results,'mediaProduced':False,'normalSpeedValidated':False,'riggedModelValidated':False}
(out/'fall-probe.json').write_text(json.dumps(result,indent=2))
print('QUADRUPED_FALL_PROBE '+json.dumps(result))
