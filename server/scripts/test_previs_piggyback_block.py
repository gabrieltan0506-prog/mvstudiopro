"""挡碗无媒体探针：运行实际准备链至报告，禁止进入保存场景及渲染尾部。"""
import ast
import json
import sys
from pathlib import Path

repo=Path(__file__).resolve().parent
sys.path.insert(0,str(repo))
script=repo/'render-manhua-previs.py'
out=Path(sys.argv[sys.argv.index('--')+1]);out.mkdir(parents=True,exist_ok=True)
actor={'nameZh':'结构探针','shape':'human','start':[0,0],'end':[0,0],
       'moveStartSec':0,'moveEndSec':3,'facingDeg':0,'actions':[]}
anchor={'type':'bone','actorId':'holder','bone':'hand-1','along':1,'offset':[0,0,0]}
spec={'version':1,'durationSec':3,'aspect':'16:9',
      'actors':[{**actor,'id':'carrier'},{**actor,'id':'passenger'},
                {**actor,'id':'holder','start':[.65,-.3],'end':[.65,-.3],'facingDeg':180}],
      'piggyback':{'carrierId':'carrier','passengerId':'passenger','blockBowl':{
          'hand':'hand-1','bowlId':'bowl','startSec':0,'contactSec':.5,
          'releaseSec':1.5,'endSec':2.5,'offset':[0,-.16,0]}},
      'storyProps':[{'id':'bowl','kind':'bowl','grip':{'actorId':'holder','hand':'hand-1','offset':[0,0,-.02]},
                     'keyframes':[{'timeSec':0,'anchor':anchor,'visible':True,'scale':1,'fill':.5,'rotation':[0,0,0]},
                                  {'timeSec':3,'anchor':anchor,'visible':True,'scale':1,'fill':.5,'rotation':[0,0,0]}]}],
      'cameras':[{'startSec':0,'endSec':3,'position':[3,-5,2.5],'target':[0,0,1.2],'lens':35}]}
source=out/'spec.json';source.write_text(json.dumps(spec))
# 只执行实际准备链，截断既有frames目录/保存blend尾部；不替换生产解算函数。
module=ast.parse(script.read_text(),filename=str(script))
cut=next(i for i,node in enumerate(module.body) if isinstance(node,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='frames' for t in node.targets))
module.body=module.body[:cut]
assert not any(isinstance(n,ast.Call) and isinstance(n.func,ast.Attribute) and n.func.attr in ('render','save_as_mainfile') for n in ast.walk(module))
sys.argv=[str(script),'--',str(source),str(out)]
env={'__file__':str(script),'__name__':'__main__'}
exec(compile(module,str(script),'exec'),env)
report=env['report'];rows=report['piggyback']['samples']
assert len(rows)==72
assert max(r['supportError'] for r in rows)<.005
assert max(r['gripError'] for r in rows)<.005
assert min(r['passengerFootHeight'] for r in rows)>=.1
assert max(r['blockError'] for r in rows)<.005
assert all(r['supportSide']==1 for r in rows)
assert rows[0]['blockAmount']==0 and rows[-1]['blockAmount']==0 and rows[24]['blockAmount']==1
result={'frames':len(rows),'maxSupportError':max(r['supportError'] for r in rows),
        'maxShoulderGripError':max(r['gripError'] for r in rows),
        'maxBlockError':max(r['blockError'] for r in rows),'mediaProduced':False,'normalSpeedValidated':False}
(out/'block-probe.json').write_text(json.dumps(result,indent=2))
print('PIGGYBACK_BLOCK_PROBE '+json.dumps(result))
