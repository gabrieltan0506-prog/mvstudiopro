"""独立带层级骨架/蒙皮内存探针；无渲染、导出或场景保存，不复用旧两具诊断模型。"""
import ast,json,sys,math
from pathlib import Path
import bpy
from mathutils import Matrix,Vector
scripts=Path(__file__).resolve().parent;sys.path.insert(0,str(scripts))
from previs_rigged_model import retarget_from_source
from previs_rigged_piggyback import apply_rigged_piggyback,measure_rigged_piggyback,apply_rigged_piggyback_block,_palm_to,_zone
out=Path(sys.argv[sys.argv.index('--')+1]);out.mkdir(parents=True,exist_ok=True)
block_mode='--block' in sys.argv
renderer=scripts/'render-manhua-previs.py';tree=ast.parse(renderer.read_text())
cut=next(i for i,n in enumerate(tree.body) if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='frames' for t in n.targets));tree.body=tree.body[:cut]
assert not any(isinstance(n,ast.Call) and isinstance(n.func,ast.Attribute) and n.func.attr in ('render','save_as_mainfile','gltf') for n in ast.walk(tree))
actor={'nameZh':'内存骨架','shape':'human','start':[1.2,-.7],'end':[1.8,-.3],'moveStartSec':0,'moveEndSec':2,'facingDeg':25,'actions':[]}
pair={'carrierId':'carrier','passengerId':'passenger'}
spec={'version':1,'durationSec':2,'aspect':'16:9','actors':[{**actor,'id':n} for n in ('carrier','passenger')], 'piggyback':pair,'cameras':[{'startSec':0,'endSec':2,'position':[3,-5,2.5],'target':[0,0,1],'lens':35}]}
if block_mode:
    for a in spec['actors']:a['end']=a['start'];a['moveEndSec']=3
    spec['durationSec']=3
    holder={**actor,'id':'holder','start':[1.2+.45*math.cos(math.radians(25))+.3*math.sin(math.radians(25)),-.7+.45*math.sin(math.radians(25))-.3*math.cos(math.radians(25))],'facingDeg':205,'moveEndSec':3}
    holder['end']=holder['start'];spec['actors'].append(holder)
    pair['blockBowl']={'hand':'hand-1','bowlId':'bowl','startSec':0,'contactSec':.5,'releaseSec':1.5,'endSec':2.5,'offset':[0,-.16,0]}
    anchor={'type':'bone','actorId':'holder','bone':'hand-1','along':1,'offset':[0,0,0]}
    spec['storyProps']=[{'id':'bowl','kind':'bowl','grip':{'actorId':'holder','hand':'hand-1','offset':[0,0,-.02]},'keyframes':[{'timeSec':t,'anchor':anchor,'visible':True,'scale':1,'fill':.5,'rotation':[0,0,0]} for t in (0,3)]}]
    spec['cameras'][0]['endSec']=3
path=out/'input.json';path.write_text(json.dumps(spec));sys.argv=[str(renderer),'--',str(path),str(out)]
env={'__file__':str(renderer),'__name__':'__main__'};exec(compile(tree,str(renderer),'exec'),env)
models=[]
for actor,source,*_ in env['rigs']:
    if actor['id']=='holder':continue
    rig=bpy.data.objects.new('TEST_HIERARCHY_'+actor['id'],source.data.copy());bpy.context.scene.collection.objects.link(rig)
    bpy.context.view_layer.objects.active=rig;rig.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    bones=rig.data.edit_bones
    for b in bones:
        if b.name=='pelvis':continue
        if b.name=='spine':parent='pelvis'
        elif b.name=='neck':parent='spine'
        elif b.name=='head':parent='neck'
        elif b.name.startswith('upper_arm'):parent='spine'
        elif b.name.startswith('forearm'):parent='upper_arm'+b.name[7:]
        elif b.name.startswith('hand'):parent='forearm'+b.name[4:]
        elif b.name.startswith('upper_leg'):parent='pelvis'
        elif b.name.startswith('lower_leg'):parent='upper_leg'+b.name[9:]
        elif b.name.startswith('foot'):parent='lower_leg'+b.name[4:]
        else:raise AssertionError(b.name)
        b.parent=bones[parent];b.use_connect=False
    bpy.ops.object.mode_set(mode='OBJECT')
    meshes=[]
    for obj in list(source.children):
        if obj.type!='MESH':continue
        new=obj.copy();new.data=obj.data.copy();new.animation_data_clear();bpy.context.scene.collection.objects.link(new);new.parent=rig
        for mod in new.modifiers:
            if mod.type=='ARMATURE':mod.object=rig
        meshes.append(new)
    if actor['id']=='passenger':
        rig.data.transform(Matrix.Scale(.92,4))
        for obj in meshes:obj.data.transform(Matrix.Scale(.92,4))
    model={'actorId':actor['id'],'rig':rig,'meshes':meshes,'boneMap':{b.name:b.name for b in rig.data.bones},'restMatrices':{b.name:b.matrix_local.copy() for b in rig.data.bones},'report':{'sourceJobId':'TEST_ONLY_'+actor['id'],'sha256':('a' if actor['id']=='carrier' else 'b')*64}}
    retarget_from_source(source,model,1,bpy.context.scene.frame_end);models.append(model)
handle=apply_rigged_piggyback(pair,models,bpy.context.scene)
if block_mode:apply_rigged_piggyback_block(pair,handle,env['story_prop_handles'],bpy.context.scene)
result=measure_rigged_piggyback(pair,handle,bpy.context.scene)
(out/'rigged-piggyback.json').write_text(json.dumps(result,indent=2))
assert len(result['samples'])==bpy.context.scene.frame_end and result['carrier']['sourceJobId']!=result['passenger']['sourceJobId']
print(json.dumps({'status':'PASS','frames':len(result['samples']),'mediaProduced':False,'normalSpeedValidated':False,'maxSupportError':max(r['supportError'] for r in result['samples']),'maxGripError':max(r['gripError'] for r in result['samples'])}))

# 负例确实进入生产失败门禁，禁止缺权重/不可达时退回骨点。
try:_palm_to(models[0],'hand-1',Vector((100,100,100)),1)
except ValueError as e:assert '可达' in str(e)
else:raise AssertionError('不可达目标未拒绝')
bad={**models[0],'meshes':[]}
try:_zone(bad,['hand-1'])
except ValueError as e:assert '蒙皮权重' in str(e)
else:raise AssertionError('缺蒙皮未拒绝')
print('NEGATIVE_PASS unreachable=1 missing_weights=1')
