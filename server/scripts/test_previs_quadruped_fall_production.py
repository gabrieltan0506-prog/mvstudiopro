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
for mode,duration in [('collapse',4),('hold',2)]:
    folder=out/mode;folder.mkdir(exist_ok=True)
    fall={'mode':mode,'side':'left'}
    if mode=='collapse':fall.update(startSec=0,foldSec=1,groundSec=2)
    spec={'version':1,'durationSec':duration,'aspect':'16:9',
          'actors':[{'id':'horse','nameZh':'马倒地结构探针','shape':'horse','start':[0,0],'end':[0,0],
                     'moveStartSec':0,'moveEndSec':duration,'facingDeg':0,'actions':[], 'quadrupedFall':fall}],
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
    results[mode]={'frames':len(rows),'heldFrames':len(held),'maxFloorError':max(abs(r['minimumHeight']) for r in rows),
                   'maxHeldTorsoHeight':max(r['torsoMinimumHeight'] for r in held),
                   'minHeldTorsoTilt':min(r['torsoTiltDeg'] for r in held),
                   'minHeldLegFold':min(v for r in held for v in r['legFoldDeg']),
                   'firstHeldRoot':held[0]['root'],'lastHeldRoot':held[-1]['root']}
assert math.dist(results['collapse']['lastHeldRoot'],results['hold']['firstHeldRoot'])<.005
result={'cases':results,'mediaProduced':False,'normalSpeedValidated':False,'riggedModelValidated':False}
(out/'fall-probe.json').write_text(json.dumps(result,indent=2))
print('QUADRUPED_FALL_PROBE '+json.dumps(result))
