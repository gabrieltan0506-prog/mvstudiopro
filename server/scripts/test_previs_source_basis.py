"""真实Blender源轴回归：旧路径逐帧/像素不变，带骨静止无伪动作，实际动作不被归零。"""
import copy
import hashlib
import json
import math
import runpy
import subprocess
import sys
from array import array
from pathlib import Path
import bpy
from mathutils import Matrix

args=sys.argv[sys.argv.index('--')+1:]
source_only='--source-only' in args
if source_only:args.remove('--source-only')
out=Path(args[0]);out.mkdir(parents=True,exist_ok=True)
assert not (out/'receipt.json').exists(), '不得覆盖已有验收回执'
script=Path(__file__).with_name('render-manhua-previs.py')
baseline=Path(args[1]) if len(args)>1 else out/'baseline-renderer.py'
if len(args)<=1:
    baseline.write_bytes(subprocess.check_output(['git','show','b9560e06f75931280b575ea15b7dd96c4233d88f:server/scripts/render-manhua-previs.py'],cwd=script.parents[2]))
assert hashlib.sha256(baseline.read_bytes()).hexdigest()=='d7d28b96c82ad784643a83a6717af1335a281df5af053942349f94f617b90e63', '比较对象必须为修前真实源码'
sys.path.insert(0,str(script.parent))
import previs_rigged_model as module
checks=[]
def persist(file,value):
    with file.open('x') as handle:json.dump(value,handle,ensure_ascii=False,indent=2)
def failure(label,details=None):
    record={'status':'failed','label':label,'details':details,'passedChecks':checks,'blender':bpy.app.version_string}
    persist(out/'failure-receipt.json',record)
    print('PREVIS_SOURCE_BASIS_FAILED',json.dumps(record,ensure_ascii=False))
def check(value,label):
    if not value:
        failure(label)
        raise AssertionError(label)
    checks.append(label)
def actor(name='actor',shape='human',x=0,facing=0):
    return {'id':name,'nameZh':name,'shape':shape,'start':[x,0],'end':[x,0],'moveStartSec':0,'moveEndSec':2,'facingDeg':facing,'actions':[]}
def spec(actors):
    return {'version':1,'durationSec':2,'aspect':'16:9','actors':actors,'cameras':[{'startSec':0,'endSec':2,'position':[5,-7,3],'target':[0,0,1],'lens':35}]}
def build(value,label,renderer=script,prefix=False):
    bpy.ops.wm.read_factory_settings(use_empty=False)
    folder=out/label;folder.mkdir(exist_ok=True)
    source=folder/'spec.json';source.write_text(json.dumps(value,ensure_ascii=False,indent=2))
    sys.argv=[str(renderer),'--',str(source),str(folder)]
    if prefix:
        text=renderer.read_text().split('# 附件/角色只从受控配置和服务端侧载清单构建')[0]
        namespace={'__file__':str(renderer),'__name__':'source_basis_test'}
        exec(compile(text,str(renderer),'exec'),namespace)
        return namespace,folder
    return runpy.run_path(str(renderer),run_name='__main__'),folder
def scene_snapshot(namespace,folder):
    scene=bpy.context.scene;values=array('f')
    for frame in range(1,49):
        scene.frame_set(frame);bpy.context.view_layer.update()
        for _actor,rig,*_ in namespace['rigs']:
            values.extend(v for row in rig.matrix_world for v in row)
            for bone in rig.pose.bones:values.extend(v for row in bone.matrix for v in row)
        graph=bpy.context.evaluated_depsgraph_get()
        for obj in sorted((o for o in scene.objects if o.type=='MESH' and not o.hide_render),key=lambda o:o.name):
            ev=obj.evaluated_get(graph);mesh=ev.to_mesh()
            try:
                values.extend(n for vert in mesh.vertices for n in (ev.matrix_world@vert.co))
            finally:ev.to_mesh_clear()
    scene.frame_set(25)
    scene.render.filepath=str(folder/'frame-0025.png');bpy.ops.render.render(write_still=True)
    image=bpy.data.images.load(str(folder/'frame-0025.png'),check_existing=False)
    pixels=array('f',image.pixels[:])
    with (folder/'pose-and-mesh.f32').open('xb') as handle:handle.write(values.tobytes())
    with (folder/'pixels.f32').open('xb') as handle:handle.write(pixels.tobytes())
    result={'poseAndMeshSha256':hashlib.sha256(values.tobytes()).hexdigest(),
        'pixelSha256':hashlib.sha256(pixels.tobytes()).hexdigest(),
        'pngSha256':hashlib.sha256((folder/'frame-0025.png').read_bytes()).hexdigest(),
        'report':json.loads((folder/'report.json').read_text())}
    persist(folder/'snapshot.json',result)
    return result

def report_diff(left,right,where='$'):
    if type(left)!=type(right):return [{'path':where,'baseline':left,'current':right}]
    if isinstance(left,dict):
        result=[]
        for key in sorted(set(left)|set(right)):
            if key not in left or key not in right:result.append({'path':where+'.'+key,'baselinePresent':key in left,'currentPresent':key in right,'baseline':left.get(key),'current':right.get(key)})
            else:result.extend(report_diff(left[key],right[key],where+'.'+key))
        return result
    if isinstance(left,list):
        result=[]
        if len(left)!=len(right):result.append({'path':where+'.length','baseline':len(left),'current':len(right)})
        for i,(a,b) in enumerate(zip(left,right)):result.extend(report_diff(a,b,where+'['+str(i)+']'))
        return result
    return [] if left==right else [{'path':where,'baseline':left,'current':right}]
def numeric_diff(left,right):
    a=array('f');a.frombytes(left.read_bytes());b=array('f');b.frombytes(right.read_bytes())
    count=0;maximum=0.;nonfinite=0
    for x,y in zip(a,b):
        if x!=y:
            count+=1
            if math.isfinite(x) and math.isfinite(y):maximum=max(maximum,abs(x-y))
            else:nonfinite+=1
    return {'baselineComponents':len(a),'currentComponents':len(b),'differentComponents':count+abs(len(a)-len(b)),
        'maximumAbsoluteDifference':maximum,'nonfiniteDifferences':nonfinite,'completeRawBaseline':str(left),'completeRawCurrent':str(right)}

try:
    # 旧白模、附件、互动均运行修前/修后真实完整renderer，比较每帧骨+网格和原帧字节。
    plain=spec([actor()]);plain['actors'][0]['actions']=[{'kind':'strike','startSec':0,'endSec':2}]
    horse=spec([actor('horse','horse')]);horse['actors'][0]['creature']={'preset':'four_tail_black_wings','transformStartSec':.25,'transformEndSec':1.5}
    pair=spec([actor('left',x=-.35),actor('right',x=.35,facing=180)])
    pair['interactions']=[{'id':'guard','kind':'strike_guard','actorId':'left','targetActorId':'right','startSec':0,'contactSec':1,'endSec':2}]
    comparisons=[]
    for name,value in ([] if source_only else [('plain-strike',plain),('creature',horse),('interaction',pair)]):
        rows=[]
        for tag,renderer in [('baseline',baseline),('current',script)]:
            try:
                namespace,folder=build(value,name+'-'+tag,renderer)
                rows.append(scene_snapshot(namespace,folder))
            except Exception as error:
                failure(name+'-'+tag+'构建或取样失败',{'errorType':type(error).__name__,'error':str(error),'completedRows':rows})
                raise
        persist(out/(name+'-comparison.json'),rows)
        compared=['poseAndMeshSha256','pixelSha256','report']
        difference={'case':name,'keys':{key:{'equal':rows[0][key]==rows[1][key]} for key in compared},
            'reportDifferences':report_diff(rows[0]['report'],rows[1]['report']),
            'poseAndMesh':numeric_diff(out/(name+'-baseline')/'pose-and-mesh.f32',out/(name+'-current')/'pose-and-mesh.f32'),
            'pixels':numeric_diff(out/(name+'-baseline')/'pixels.f32',out/(name+'-current')/'pixels.f32')}
        persist(out/(name+'-differences.json'),difference)
        control=None
        if name=='creature':
            # 同一基线重建一次作只读诊断控制，绝不替代或放宽修前/修后精确门禁。
            control_namespace,control_folder=build(value,name+'-baseline-repeat',baseline)
            control_row=scene_snapshot(control_namespace,control_folder)
            control={'case':name,'baselineRendererSha256':hashlib.sha256(baseline.read_bytes()).hexdigest(),
                'keys':{key:{'equal':rows[0][key]==control_row[key]} for key in compared},
                'reportDifferences':report_diff(rows[0]['report'],control_row['report']),
                'poseAndMesh':numeric_diff(out/(name+'-baseline')/'pose-and-mesh.f32',control_folder/'pose-and-mesh.f32'),
                'pixels':numeric_diff(out/(name+'-baseline')/'pixels.f32',control_folder/'pixels.f32'),
                'failedKeys':[key for key in compared if rows[0][key]!=control_row[key]],
                'boundary':'同源控制不证明差异原因，不豁免原精确门禁'}
            persist(out/(name+'-same-baseline-comparison.json'),[rows[0],control_row])
            persist(out/(name+'-same-baseline-differences.json'),control)
        # PNG内嵌File/Date/RenderTime随目录与墙钟变化，比较真实解码像素而不是伪称容器字节相同。
        failed=[key for key in compared if rows[0][key]!=rows[1][key]]
        if failed:
            failure(name+'比较失败',{'failedKeys':failed,'differences':difference,'sameBaselineControl':control,'comparisonFile':str(out/(name+'-comparison.json'))})
            raise AssertionError(name+'比较失败：'+','.join(failed))
        if control and control['failedKeys']:
            failure(name+'同基线控制比较失败',control)
            raise AssertionError(name+'同基线控制比较失败：'+','.join(control['failedKeys']))
        check(True,name+'逐帧骨网格/原帧像素/报告与修前完全一致')
        comparisons.append({'name':name,**rows[1]})

    def delta_error(rig):
        return max(abs(v-(1 if i==j else 0)) for bone in rig.pose.bones
            for i,row in enumerate((bone.matrix.to_quaternion()@bone.bone.matrix_local.to_quaternion().inverted()).to_matrix()) for j,v in enumerate(row))
    rigged=actor();rigged['riggedModel']={'sourceJobId':'m3d_TEST_SOURCE_ONLY'}
    namespace,folder=build(spec([rigged]),'rigged-static',prefix=True)
    source=namespace['rigs'][0][1];errors=[]
    for frame in range(1,49):
        bpy.context.scene.frame_set(frame);bpy.context.view_layer.update();errors.append(delta_error(source))
    check(max(errors)<1e-5,'带骨零动作48帧rest到pose为单位旋转')
    static_max=max(errors)

    # 真实来源函数继续驱动，不从首次动画采样推导基准；零动作仍保留目标原T-pose。
    moving=copy.deepcopy(rigged);moving['actions']=[{'kind':'strike','startSec':0,'endSec':2}]
    namespace,folder=build(spec([moving]),'rigged-strike',prefix=True)
    source=namespace['rigs'][0][1]
    bpy.context.scene.frame_set(25);bpy.context.view_layer.update()
    check(delta_error(source)>.05,'真实strike动作仍产生非零源旋转')
    strike_error=delta_error(source)
    # 消费者用真实生产retarget；目标仅为测试骨架，明确不冒充公开角色视觉验收。
    data=bpy.data.armatures.new('仅测试目标')
    target=bpy.data.objects.new('仅测试目标',data);bpy.context.scene.collection.objects.link(target)
    bpy.ops.object.select_all(action='DESELECT');target.select_set(True);bpy.context.view_layer.objects.active=target
    bpy.ops.object.mode_set(mode='EDIT')
    for semantic in module.SEMANTIC_BONES:
        original=source.data.bones[semantic]
        bone=data.edit_bones.new(semantic);bone.head=original.head_local;bone.tail=original.tail_local;bone.matrix=original.matrix_local.copy()
    bpy.ops.object.mode_set(mode='OBJECT')
    model={'rig':target,'boneMap':{name:name for name in module.SEMANTIC_BONES},'restMatrices':{b.name:b.matrix_local.copy() for b in target.data.bones},'report':{}}
    module.retarget_from_source(source,model,1,48)
    bpy.context.scene.frame_set(25);bpy.context.view_layer.update()
    check(delta_error(target)>.05,'真实生产retarget消费者保留strike非零旋转')
    # 首帧被明确赋予合法非零骨旋转时，retarget不得将它一概归零。
    bpy.context.scene.frame_set(1)
    bone=source.pose.bones['head'];rest=bone.bone.matrix_local
    bone.matrix=Matrix.Translation(rest.translation)@Matrix.Rotation(.2,4,'Z')@rest.to_quaternion().to_matrix().to_4x4()
    bone.keyframe_insert('rotation_quaternion',frame=1);bpy.context.view_layer.update()
    module.retarget_from_source(source,model,1,1)
    bpy.context.scene.frame_set(1);bpy.context.view_layer.update()
    first_delta=target.pose.bones['head'].matrix.to_quaternion()@target.data.bones['head'].matrix_local.to_quaternion().inverted()
    check(abs(first_delta.angle-.2)<1e-4,'非零首帧动作被消费者保留而非归零')
    public_results=[]
    if len(args)>2:
        check(len(args)==4,'公开模型复验须同时指定核心GLB与控制器JSON')
        core=Path(args[2]);config=json.loads(Path(args[3]).read_text())
        check(hashlib.sha256(core.read_bytes()).hexdigest()=='26c6d3d3ef99ac61c50beac84afe22f1ea6d826f8cb116ce4bc142cbccf156b6','公开模型必须为已验原SHA')
        def vertices(model):
            graph=bpy.context.evaluated_depsgraph_get();values=[]
            for obj in model['meshes']:
                ev=obj.evaluated_get(graph);mesh=ev.to_mesh()
                try:values.extend(ev.matrix_world@v.co for v in mesh.vertices)
                finally:ev.to_mesh_clear()
            return values
        for label,value in [('static',rigged),('strike',moving)]:
            namespace,folder=build(spec([value]),'public-'+label,prefix=True)
            source=namespace['rigs'][0][1]
            model=module.import_rigged_model(core,'公开模型复验',config['boneMap'],config['forwardAxis'],1.7)
            initial=vertices(model)
            module.retarget_from_source(source,model,1,48)
            maximum=0.;minima=[];bone_error=0.
            for frame in range(1,49):
                bpy.context.scene.frame_set(frame);bpy.context.view_layer.update()
                actual=vertices(model)
                maximum=max(maximum,max((a-b).length for a,b in zip(actual,initial)))
                minima.append(min(v.z for v in actual))
                for bone in model['rig'].pose.bones:
                    rest=model['restMatrices'][bone.name]
                    bone_error=max(bone_error,max(abs(bone.matrix[i][j]-rest[i][j]) for i in range(4) for j in range(4)))
            if label=='static':
                check(maximum<1e-4 and max(abs(z) for z in minima)<1e-5,'公开core零动作48帧网格保持原静止且minZ归零')
                check(bone_error<1e-4,'公开core零动作实际骨姿态保持原rest')
                check(max(v.y for v in actual)-min(v.y for v in actual)>1.4,'明确保留公开core原T-pose而非冒充自然垂臂站姿')
            else:
                check(maximum>.05,'公开core真实strike48帧实际网格非零运动')
            public_results.append({'case':label,'maximumVertexDisplacement':maximum,'minimumZRange':[min(minima),max(minima)],'maximumBoneMatrixDifference':bone_error})
    receipt={'checks':checks,'count':len(checks),'blender':bpy.app.version_string,'scope':'source-only' if source_only else 'full-suite',
        'skippedLegacyCases':['plain-strike','creature','interaction'] if source_only else [],
        'staticMaximumMatrixError':static_max,'strikeMatrixDelta':strike_error,
        'nonzeroFirstFrameAngle':first_delta.angle,'legacyComparisons':comparisons,'publicCore':public_results,
        'boundary':'source-only不执行旧路径回归，不覆盖或豁免此前像素失败；只修源轴，不实现目标自然站姿；Linux/公开角色新主渲染另验'}
    (out/'receipt.json').write_text(json.dumps(receipt,ensure_ascii=False,indent=2))
    print('PREVIS_SOURCE_BASIS_VALIDATED',json.dumps(receipt,ensure_ascii=False))
except Exception as error:
    if not (out/'failure-receipt.json').exists():
        failure('测试执行异常',{'errorType':type(error).__name__,'error':str(error)})
    raise
