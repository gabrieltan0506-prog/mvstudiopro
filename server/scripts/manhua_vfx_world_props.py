"""真实动画场景中的选择性定格：人物/相机照常求值，只暂停道具运动时钟。"""
import hashlib
import json
import math
from pathlib import Path
import re
import struct
import sys
import uuid

sys.path.insert(0,str(Path(__file__).resolve().parent))
from manhua_vfx_math import keys, number, validate_spec, state_at, srgb
from manhua_vfx_bullet3d_math import validate_scene_path
from manhua_vfx_bullet3d import _reject_external_or_driven, _enable_render_visible_evaluation, _render_members, _transparent_png, _write_json, _sha
from manhua_vfx_prop_math import paused_age
from manhua_vfx_world_contract import validate_world_options
from manhua_vfx_world_quality import bind_scene_actors, resolve_actor_rig, configure_world_lighting, physical_material, measure_world_clearance, prop_world_fingerprint


def validate_world_spec(spec,event_id,asset_root):
    events=[e for e in spec.get('effects',[]) if e.get('id')==event_id]
    if len(events)!=1:raise ValueError('三维定格图层身份不唯一')
    e=events[0]
    keys(e,('id','kind','startSec','durationSec','color','scale','intensity','anchor','prop','world','scenePath','sceneSha256'),('sceneActors',))
    if e['kind']!='prop_scene':raise ValueError('不是人物活动三维定格方案')
    w=e['world']
    keys(w,('sceneJobId','sceneScopeId','clipId','sourceStartSec','propKind','position','yawDeg','size'),('choreography','render','environment'))
    validate_world_options(w,e.get('sceneActors'))
    if not isinstance(w['sceneJobId'],str) or not re.fullmatch(r'prv_[a-f0-9]{48}',w['sceneJobId']):raise ValueError('场景任务编号无效')
    try:uuid.UUID(w['sceneScopeId'])
    except (ValueError,TypeError,AttributeError):raise ValueError('场景范围编号无效')
    if not isinstance(w['clipId'],str) or not 1<=len(w['clipId'])<=160:raise ValueError('场景片段编号无效')
    if w['propKind'] not in ('cup_fracture','fruit_stall_fracture'):raise ValueError('道具类型无效')
    for field,lo,hi in [('sourceStartSec',0,30),('yawDeg',-180,180),('size',.05,4)]:number(w[field],lo,hi,field)
    if not isinstance(w['position'],list) or len(w['position'])!=3:raise ValueError('须提供三维道具坐标')
    for value in w['position']:number(value,-100,100,'position')
    if e['scale']!=1 or e['intensity']!=1 or e['anchor']!={'space':'screen','position':[.5,.5]}:raise ValueError('三维场景不接受画面挂点或轨迹')
    validate_scene_path(e['scenePath'],e['sceneSha256'],asset_root,e['id'])
    prop={key:value for key,value in e.items() if key not in ('world','scenePath','sceneSha256','sceneActors')}
    prop['kind']=w['propKind']
    validate_spec({**spec,'effects':[prop]})
    return e,prop


def prepare_world_scene(scene,event,prop,spec):
    import bpy
    from manhua_vfx import material
    from manhua_vfx_prop import build_prop_fracture
    _reject_external_or_driven(bpy)
    source_fps=scene.render.fps/scene.render.fps_base
    source_start,source_end=scene.frame_start,scene.frame_end
    duration=(source_end-source_start+1)/source_fps
    if event['world']['sourceStartSec']+event['durationSec']>duration+1e-9:raise ValueError('人物动画时窗超出源场景')
    scene.frame_set(source_start)
    _enable_render_visible_evaluation(scene,bpy.context.view_layer)
    visible=_render_members(bpy.context.view_layer)
    meshes=[obj for obj in scene.objects if obj.type=='MESH' and obj.name in visible]
    if event.get('sceneActors'):
        all_rigs=[obj for obj in scene.objects if obj.type=='ARMATURE']
        bound_rigs={resolve_actor_rig(row,all_rigs) for row in event['sceneActors']}
        # 入场前隐藏的角色仍须绑定；不能只读取首帧可见网格而丢失后来入场的角色。
        for obj in scene.objects:
            if obj.type=='MESH' and obj not in meshes and any(mod.type=='ARMATURE' and mod.object in bound_rigs and mod.show_render for mod in obj.modifiers):meshes.append(obj)
    actors=[];rigs={}
    for obj in meshes:
        bound=[mod.object for mod in obj.modifiers if mod.type=='ARMATURE' and mod.object is not None and mod.show_render]
        if bound and len(obj.data.vertices)>0:
            actors.append(obj)
            for rig in bound:rigs[rig.name]=rig
    if not actors or not rigs:raise ValueError('所选场景没有可渲染的带骨人物，不能冒充人物穿行')
    for obj in meshes:
        estimate=len(obj.data.vertices)
        for mod in obj.modifiers:
            if not mod.show_render:continue
            if mod.type not in ('ARMATURE','SUBSURF','SOLIDIFY','MIRROR','BEVEL','WEIGHTED_NORMAL','CORRECTIVE_SMOOTH'):
                raise ValueError('人物场景含未烘焙或不支持的网格修改器，请保存已烘焙版本')
            if mod.type=='SUBSURF':
                if mod.render_levels>2:raise ValueError('人物细分层级超过2，须先保存低模场景')
                estimate*=4**mod.render_levels
            if mod.type=='BEVEL' and mod.segments>4:raise ValueError('人物倒角分段超过预算')
        if estimate>2_000_000:raise ValueError('人物求值网格超过预算')
    vertices=sum(len(obj.data.vertices) for obj in meshes)
    if vertices<4 or vertices>2_000_000 or vertices*math.ceil(event['durationSec']*spec['fps'])>12_000_000:
        raise ValueError('人物场景超过三维顶点帧预算，请选择已保存的低模场景或缩短片段')
    if scene.camera is None or scene.camera.data.type!='PERSP':raise ValueError('人物活动三维场景须含有效透视相机')
    groups=bind_scene_actors(event['sceneActors'],actors,list(rigs.values())) if event.get('sceneActors') else []
    render=event['world'].get('render')
    if (render or event['world'].get('choreography')) and not groups:raise ValueError('新三维方案缺少服务端角色绑定')
    handle=build_prop_fracture(prop,spec,scene,physical_material if render else material,srgb(prop['color']),physical=bool(render))
    root=bpy.data.objects.new(event['id']+'_世界道具挂点',None);scene.collection.objects.link(root)
    root.location=event['world']['position'];root.rotation_euler=(math.pi/2,0,math.radians(event['world']['yawDeg']))
    root.scale=(event['world']['size'],)*3
    for obj in handle['objects']:obj.parent=root
    engines={item.identifier for item in scene.render.bl_rna.properties['engine'].enum_items}
    scene.render.engine='BLENDER_EEVEE_NEXT' if 'BLENDER_EEVEE_NEXT' in engines else 'BLENDER_EEVEE'
    lighting=configure_world_lighting(scene,render,meshes) if render else None
    scene.render.resolution_x=spec['width'];scene.render.resolution_y=spec['height'];scene.render.resolution_percentage=100
    scene.render.film_transparent=False;scene.render.use_compositing=False;scene.render.use_sequencer=False
    scene.render.image_settings.file_format='PNG';scene.render.image_settings.color_mode='RGBA';scene.render.image_settings.color_depth='8'
    scene.render.image_settings.compression=35
    return {'prop':handle,'root':root,'actors':actors,'rigs':list(rigs.values()),'groups':groups,'lighting':lighting,'sourceFps':source_fps,
            'sourceFrameStart':source_start,'sourceFrameEnd':source_end,'sourceVertices':vertices}


def actor_fingerprint(handle):
    import bpy
    digest=hashlib.sha256();graph=bpy.context.evaluated_depsgraph_get()
    visible=_render_members(bpy.context.view_layer)
    if not any(obj.name in visible for obj in handle['actors']):return digest.hexdigest()
    for obj in sorted(handle['actors'],key=lambda x:x.name):
        if obj.name not in visible:continue
        evaluated=obj.evaluated_get(graph);mesh=evaluated.to_mesh()
        try:
            if not mesh or not mesh.vertices:raise ValueError('人物求值后几何为空')
            digest.update(obj.name.encode())
            # 读取真实变形网格的有界采样；附完整骨架矩阵，区分动画和仅相机移动。
            step=max(1,len(mesh.vertices)//96)
            for index in range(0,len(mesh.vertices),step):
                point=evaluated.matrix_world@mesh.vertices[index].co;digest.update(struct.pack('<3d',*point))
        finally:evaluated.to_mesh_clear()
    for rig in sorted(handle['rigs'],key=lambda x:x.name):
        evaluated=rig.evaluated_get(graph)
        for bone in evaluated.pose.bones:
            for row in evaluated.matrix_world@bone.matrix:digest.update(struct.pack('<4d',*row))
    return digest.hexdigest()


def update_world_scene(scene,handle,event,prop,spec,time):
    import bpy
    from manhua_vfx_prop import update_prop_fracture
    state=state_at(event,time)
    elapsed=time-event['startSec']
    source_frame=handle['sourceFrameStart']+(event['world']['sourceStartSec']+max(0.,elapsed))*handle['sourceFps']
    if state['active']:
        scene.frame_set(math.floor(source_frame),subframe=source_frame%1)
    # 道具透明度也用暂停时钟；人物与相机仍用原始source_frame。
    frozen_state=state_at(prop,event['startSec']+paused_age(elapsed,event['prop']))
    frozen_state['active']=state['active']
    state['opacity']=frozen_state['opacity'] if state['active'] else 0
    proof=update_prop_fracture(handle['prop'],prop,time,frozen_state)
    bpy.context.view_layer.update()
    quality={}
    if handle['groups'] and state['active']:
        clearance=event['world'].get('choreography',{}).get('clearanceMeters',.01 if event['world'].get('render') else 0)
        moving_ids=[route['actorId'] for route in event['world'].get('choreography',{}).get('routes',[])]
        quality['clearance']=measure_world_clearance(handle['groups'],handle['prop']['objects'],clearance,_render_members(bpy.context.view_layer),moving_ids)
        quality['worldPropSha256']=prop_world_fingerprint(handle['prop'])
    evaluated_camera=scene.camera.evaluated_get(bpy.context.evaluated_depsgraph_get())
    projection=evaluated_camera.calc_matrix_camera(bpy.context.evaluated_depsgraph_get(),x=spec['width'],y=spec['height'],
        scale_x=scene.render.pixel_aspect_x,scale_y=scene.render.pixel_aspect_y)
    return {'id':event['id'],'kind':event['kind'],**state,**proof,
            **quality,
            'sourceFrame':source_frame if state['active'] else None,
            'actorPoseSha256':actor_fingerprint(handle) if state['active'] else None,
            'cameraMatrixWorld':[list(row) for row in scene.camera.matrix_world],
            'cameraClip':[scene.camera.data.clip_start,scene.camera.data.clip_end],
            'cameraVfovRad':2*math.atan(1/projection[1][1]),
            'cameraType':scene.camera.data.type,'boundaryZh':'本人已保存三维人物动画照常播放；仅新增道具定格，同场几何计算遮挡，不推断原片未见动作。'}


def preflight_hold(scene,handle,event,prop,spec,output=None):
    """提交首帧渲染前逐个定格帧求值，静态人物或活动碎片直接失败。"""
    poses=set();actors=set();world_poses=set();per_actor={};count=0;rows=[]
    for index in range(math.ceil(spec['durationSec']*spec['fps'])):
        time=index/spec['fps'];age=time-event['startSec']
        if not 0<=age<event['durationSec']:continue
        proof=update_world_scene(scene,handle,event,prop,spec,time)
        clearance=proof.get('clearance')
        rows.append({'frame':index+1,'timeSec':time,'sourceFrame':proof['sourceFrame'],'clearance':clearance})
        if clearance and clearance['issues']:
            if output:_write_json(output,{'complete':False,'frames':rows,'error':'角色之间或角色与碎片保守净空不足'})
            raise ValueError('第%d帧角色之间或角色与碎片保守净空不足，请调整路线或道具位置'%(index+1))
        if not (event['prop']['holdStartSec']<=age<event['prop']['holdStartSec']+event['prop']['holdDurationSec']):continue
        if not proof['active'] or not proof['held']:raise ValueError('定格预检时窗与实际求值不一致')
        poses.add(proof['poseSha256']);actors.add(proof['actorPoseSha256']);count+=1
        if 'worldPropSha256' in proof:world_poses.add(proof['worldPropSha256'])
        if clearance:
            for row in clearance['actors']:
                if row['visible']:per_actor.setdefault(row['actorId'],set()).add(row['poseSha256'])
    if count<2 or len(poses)!=1:raise ValueError('定格预检未得到至少两帧一致的道具几何')
    if len(actors)<2:raise ValueError('定格预检人物未活动，请调整动画起点或选择真实人物动画')
    if world_poses and len(world_poses)!=1:raise ValueError('道具父变换或实际世界网格在定格窗内变化')
    for route in event['world'].get('choreography',{}).get('routes',[]):
        if len(per_actor.get(route['actorId'],set()))<2:raise ValueError('穿行角色%s在定格窗没有实际动作'%route['actorId'])
    if output:_write_json(output,{'complete':True,'frames':rows})
    return {'frames':count,'propPoses':len(poses),'actorPoses':len(actors),'worldPropPoses':len(world_poses),
            'actorPoseCounts':{actor:len(poses) for actor,poses in per_actor.items()},'checkedActiveFrames':len(rows)}


def render(spec_path,event_id,output):
    import bpy
    out=Path(output);out.mkdir(parents=True,exist_ok=True)
    if (out/'manifest.json').exists() or any(out.glob('frame-*.png')):raise ValueError('输出已有回执，禁止覆盖或自动重做')
    raw=Path(spec_path).read_bytes();(out/'input.raw.json').write_bytes(raw)
    spec=json.loads(raw);event,prop=validate_world_spec(spec,event_id,Path(spec_path).resolve().parent)
    bpy.ops.wm.open_mainfile(filepath=event['scenePath'])
    scene=bpy.context.scene;handle=prepare_world_scene(scene,event,prop,spec)
    preflight=preflight_hold(scene,handle,event,prop,spec,out/'preflight.raw.json')
    count=math.ceil(spec['durationSec']*spec['fps'])
    manifest={'complete':False,'eventId':event_id,'sceneJobId':event['world']['sceneJobId'],'sceneSha256':event['sceneSha256'],
              'sourceFps':handle['sourceFps'],'sourceFrameStart':handle['sourceFrameStart'],'sourceFrameEnd':handle['sourceFrameEnd'],
              'sourceVertices':handle['sourceVertices'],'actorMeshes':[obj.name for obj in handle['actors']],
              'width':spec['width'],'height':spec['height'],'fps':spec['fps'],'frameCount':count,
              'alpha':'straight','colorSpace':'sRGB','frames':[],'files':[],'renderedBytes':0,
              'preflight':preflight,'lighting':handle['lighting'],'sceneActors':event.get('sceneActors'),
              'blenderVersion':bpy.app.version_string,'implementationSha256':{name:_sha(Path(__file__).with_name(name)) for name in ('manhua_vfx_world_props.py','manhua_vfx_world_quality.py','manhua_vfx_world_contract.py','manhua_vfx_prop.py','manhua_vfx_prop_math.py')}}
    _write_json(out/'manifest.json',manifest)
    if event['world'].get('environment'):
        from manhua_vfx_stage_export import export_world_animation
        try:
            manifest['frames']=export_world_animation(scene,handle,event,prop,spec,out,update_world_scene)
        except Exception as error:
            manifest['error']=str(error);_write_json(out/'manifest.json',manifest);raise
        manifest['nativeStageExport']={'glbSha256':_sha(out/'world-animation.glb'),
            'framesSha256':_sha(out/'world-animation.frames.json'),'complete':True}
        # 图片由同相机3DGS消费者产生，不能把仅有GLB的回执标为影片完成。
        _write_json(out/'manifest.json',manifest)
        print('MANHUA_VFX_STAGE_EXPORTED',flush=True)
        return
    transparent=_transparent_png(spec['width'],spec['height']);held_props=set();held_actors=set()
    export_layers=event['world'].get('render',{}).get('exportLayers',False)
    if export_layers:manifest['separated']={'version':1,'complete':False,'frames':[],'bytes':0,'depthEncoding':'linear_z_pass_clip_normalized_u16'}
    try:
        for index in range(count):
            time=index/spec['fps'];proof=update_world_scene(scene,handle,event,prop,spec,time)
            path=out/('frame-%06d.png'%(index+1))
            if proof['active']:
                scene.render.filepath=str(path);bpy.ops.render.render(write_still=True)
                if proof['held']:held_props.add(proof['poseSha256']);held_actors.add(proof['actorPoseSha256'])
            else:path.write_bytes(transparent)
            size=path.stat().st_size
            if size<=0 or size>32*1024*1024:raise ValueError('三维定格输出帧为空或超限')
            manifest['renderedBytes']+=size
            if manifest['renderedBytes']>2*1024**3:raise ValueError('三维定格帧序列超过2GB')
            manifest['files'].append({'frame':index+1,'path':path.name,'bytes':size,'sha256':_sha(path)})
            manifest['frames'].append({'frame':index+1,'timeSec':time,'effects':[proof]})
            if export_layers:
                from manhua_vfx_world_layers import render_world_layers
                separated=render_world_layers(scene,handle,out,index+1,proof['active'])
                manifest['separated']['frames'].append(separated)
                manifest['separated']['bytes']+=sum(file['bytes'] for file in separated['files'])
                if manifest['separated']['bytes']>512*1024**2:raise ValueError('分层输出超过512MiB，请缩短片段')
            _write_json(out/'manifest.json',manifest)
            print('MANHUA_VFX_PROGRESS '+json.dumps({'frame':index+1,'frameCount':count}),flush=True)
        if len(held_props)!=1:raise ValueError('定格窗内道具几何仍在运动，停止交付')
        if len(held_actors)<2:raise ValueError('所选定格窗内人物没有可验证动作，请调整动画起点或选择真实人物动画')
        if export_layers:manifest['separated']['complete']=True
        manifest['complete']=True;_write_json(out/'manifest.json',manifest)
    except Exception as error:
        manifest['error']=str(error);_write_json(out/'manifest.json',manifest);raise


if __name__=='__main__':
    args=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
    if len(args)!=3:raise SystemExit('参数：spec.json effectId outputDir')
    render(*args)
