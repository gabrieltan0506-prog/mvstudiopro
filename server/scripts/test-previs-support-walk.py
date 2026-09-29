"""专用隔离机搀扶探针：烘焙后逐帧读双侧接触，反例必须拒绝。"""
import copy, json, runpy, sys
from pathlib import Path
root=Path(sys.argv[sys.argv.index('--')+1]); root.mkdir(parents=True,exist_ok=True)
renderer=Path(__file__).with_name('render-manhua-previs.py')
sys.path.insert(0,str(renderer.parent))
spec={'version':1,'durationSec':4,'aspect':'16:9','actors':[
 {'id':name,'nameZh':name,'shape':'human','start':[0,y],'end':[1,y], 'moveStartSec':1.25,'moveEndSec':3.75,'facingDeg':0,
  'actions':[{'kind':'walk','startSec':1.25,'endSec':3.75}]} for name,y in [('扶助者',0),('被扶者',.65)]],
 'interactions':[{'id':'support','kind':'support_walk','actorId':'扶助者','targetActorId':'被扶者','startSec':0,'contactSec':1,'endSec':4}],
 'cameras':[{'startSec':0,'endSec':4,'position':[3,-5,2.4],'target':[.5,.3,1],'lens':35}]}
def run(value,name):
 from previs_interaction import validate_interactions
 validate_interactions(value)
 folder=root/name;folder.mkdir(exist_ok=True);source=folder/'spec.json';source.write_text(json.dumps(value,ensure_ascii=False))
 sys.argv=[str(renderer),'--',str(source),str(folder)];runpy.run_path(str(renderer),run_name='__main__')
 return json.loads((folder/'report.json').read_text())
report=run(spec,'valid')
assert len(report['interactions'][0]['supportSamples'])==72
reverse=copy.deepcopy(spec);reverse['actors'].reverse()
assert run(reverse,'reverse')['interactions']==report['interactions']
rejected=[]
for name in ['distance','opposite','sit','early-end','rig','sliding','stationary']:
 bad=copy.deepcopy(spec)
 if name=='distance':bad['actors'][1]['start'][1]=bad['actors'][1]['end'][1]=1.5
 if name=='opposite':bad['actors'][1]['facingDeg']=180
 if name=='sit':bad['actors'][1]['actions']=[{'kind':'sit','startSec':0,'endSec':4}]
 if name=='early-end':bad['interactions'][0]['endSec']=3
 if name=='sliding':bad['actors'][0]['moveStartSec']=0
 if name=='stationary':bad['actors'][0]['end']=bad['actors'][0]['start'][:]
 if name=='rig':bad['actors'][1]['riggedModel']={'invalid':'probe'}
 try:run(bad,name)
 except ValueError as e:rejected.append({'name':name,'error':str(e)})
 else:raise AssertionError(name+'未拒绝')
(root/'validation.json').write_text(json.dumps({'samples':72,'reversedOrder':True,'rejected':rejected},ensure_ascii=False,indent=2))
print('SUPPORT_WALK_VALIDATED',len(rejected))
