"""真实骨骼与蒙皮内存测试，无渲染、GLB导出或场景保存。"""
import ast
import copy
import json
from pathlib import Path
import sys
import bpy
from mathutils import Vector
scripts=Path(__file__).resolve().parent
sys.path.insert(0,str(scripts))
from previs_rigged_model import retarget_from_source
from previs_rigged_posture import apply_rigged_posture
out=Path(sys.argv[sys.argv.index('--')+1]);out.mkdir(parents=True,exist_ok=True)
renderer=scripts/'render-manhua-previs.py'
tree=ast.parse(renderer.read_text())
cut=next(i for i,n in enumerate(tree.body) if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='frames' for t in n.targets))
tree.body=tree.body[:cut]
assert not any(isinstance(n,ast.Call) and isinstance(n.func,ast.Attribute) and n.func.attr in ('render','save_as_mainfile','gltf') for n in ast.walk(tree))
source_code=compile(tree,str(renderer),'exec')
fixture=ast.parse((scripts/'test_previs_drama_rigged.py').read_text())
functions=[n for n in fixture.body if isinstance(n,ast.FunctionDef) and n.name in ('rest_points','export_fixture')]
export=next(n for n in functions if n.name=='export_fixture')
# 仅复用内存建骨与蒙皮部分；明确删去导出调用及其后的清理。
end=next(i for i,n in enumerate(export.body) if isinstance(n,ast.Expr) and isinstance(n.value,ast.Call) and isinstance(n.value.func,ast.Attribute) and n.value.func.attr=='gltf')
export.body=export.body[2:end] # 移除清理所有对象的for，保留当前source。
# 原函数头：docstring/import/for，保留import并去for。
original=next(n for n in ast.parse((scripts/'test_previs_drama_rigged.py').read_text()).body if isinstance(n,ast.FunctionDef) and n.name=='export_fixture')
export.body=[original.body[1]]+original.body[3:end]
module=ast.Module(body=functions,type_ignores=[])
assert not any(isinstance(n,ast.Call) and isinstance(n.func,ast.Attribute) and n.func.attr in ('gltf','render','save_as_mainfile') for n in ast.walk(module))
env_fixture={'bpy':bpy,'Vector':Vector}
exec(compile(module,'TEST_ONLY_memory_fixture','exec'),env_fixture)
results=[]
for mode,scale in [(mode,scale) for scale in (.8,1.,1.3) for mode in ('sit','recline','rise_to_sit')]:
    p={'mode':'hold','posture':mode,'supportHeight':.45,'reclineDeg':45} if mode!='rise_to_sit' else {'mode':mode,'startSec':.5,'endSec':1.5,'supportHeight':.45,'reclineDeg':45}
    actor={'id':'mother','nameZh':'坐卧内存检查','shape':'human','start':[1,0],'end':[1,0],'moveStartSec':0,'moveEndSec':2,'facingDeg':35,'actions':[],'humanPosture':p}
    spec={'version':1,'durationSec':2,'aspect':'16:9','actors':[actor],'cameras':[{'startSec':0,'endSec':2,'position':[3,-5,2.5],'target':[0,0,.8],'lens':35}]}
    path=out/(mode+'.json');path.write_text(json.dumps(spec))
    sys.argv=[str(renderer),'--',str(path),str(out)]
    env={'__file__':str(renderer),'__name__':'__main__'};exec(source_code,env)
    source=env['rigs'][0][1]
    env_fixture['export_fixture'](None)
    rig=bpy.context.view_layer.objects.active
    meshes=[m for m in bpy.data.objects if m.parent==rig and m.type=='MESH']
    # 夹具脚底原为.04米，统一归零到地面；与正式导入的归一化一致。
    for mesh in meshes:
        for v in mesh.data.vertices:v.co.z-=.04;v.co*=scale
    bpy.context.view_layer.objects.active=rig
    bpy.ops.object.mode_set(mode='EDIT')
    for bone in rig.data.edit_bones:bone.head.z-=.04;bone.tail.z-=.04;bone.head*=scale;bone.tail*=scale
    bpy.ops.object.mode_set(mode='OBJECT')
    model={'rig':rig,'meshes':meshes,'boneMap':{b.name:b.name for b in rig.data.bones},'restMatrices':{b.name:b.matrix_local.copy() for b in rig.data.bones},'report':{'sourceJobId':'m3d_TEST_ONLY','sha256':'a'*64}}
    retarget_from_source(source,model,1,48)
    report=apply_rigged_posture(model,actor,bpy.context.scene)
    assert report['frames']==48 and len(report['meshMeasurement']['samples'])==48
    results.append({'mode':mode,'scale':scale,'maxSupportGap':max(abs(s['supportGap']) for s in report['samples']),'frames':48})
print(json.dumps({'status':'PASS','cases':results,'mediaProduced':False}))
