"""已授权预演场景的真实三维环绕；固定冻结几何，只移动透视相机。

CLI：blender -b --factory-startup --disable-autoexec --python-exit-code 1
     --python manhua_vfx_bullet3d.py -- spec.json effectId outputDir
只有正式执行此CLI才输出媒体；结构探针直接调用内存准备函数，不调用render。
"""
import hashlib
import json
import math
import os
from pathlib import Path
import struct
import sys
import zlib

sys.path.insert(0,str(Path(__file__).resolve().parent))
from manhua_vfx_bullet3d_math import (
    validate_render_spec,validate_bullet,source_frame,orbit_pose,frame_span,geometry_summary,validate_geometry_budget,
)

MAX_FROZEN_VERTICES=2_000_000
MAX_FROZEN_MESHES=2048
MAX_RENDER_BYTES=2*1024**3
BOUNDARY='本人已完成预演场景中的真实几何冻结与透视相机环绕；保持该场景材质、灯光与环境，不从原视频重建未见场景。'


def _sha(path):
    digest=hashlib.sha256()
    with Path(path).open('rb') as handle:
        for chunk in iter(lambda:handle.read(1024*1024),b''):digest.update(chunk)
    return digest.hexdigest()


def _write_json(path,value):
    path=Path(path);pending=path.with_suffix(path.suffix+'.writing')
    with pending.open('w',encoding='utf8') as file:
        json.dump(value,file,ensure_ascii=False,allow_nan=False,separators=(',',':'))
        file.flush();os.fsync(file.fileno())
    os.replace(pending,path)


def _reject_external_or_driven(bpy):
    """场景只能来自已验真任务；额外禁止外链库、脚本驱动和外部贴图恢复。"""
    if len(bpy.data.libraries):raise ValueError('三维场景不能依赖外部链接库')
    if len(bpy.data.cache_files) or len(bpy.data.movieclips):raise ValueError('三维场景不能依赖外部几何缓存或视频片段')
    blocks=[]
    for name in ('objects','meshes','armatures','curves','metaballs','lattices','textures','materials','worlds','scenes','node_groups','shape_keys','lights','cameras'):
        blocks.extend(getattr(bpy.data,name,()))
    for material in list(bpy.data.materials)+list(bpy.data.worlds):
        if material.node_tree:blocks.append(material.node_tree)
    for block in blocks:
        animation=getattr(block,'animation_data',None)
        if animation and len(animation.drivers):raise ValueError('三维场景含脚本驱动，停止自动求值')
    for text in list(bpy.data.texts):
        bpy.data.texts.remove(text)
    for image in bpy.data.images:
        if image.source in ('VIEWER','GENERATED'):continue
        if image.source!='FILE' or not (image.packed_file or len(image.packed_files)):
            raise ValueError('三维场景贴图未内嵌，不能旁路读取外部资源')



def _collection_members(collection,parents=()):
    if collection.hide_render:return set()
    if collection.name in parents or len(parents)>=64:raise ValueError('集合实例存在循环或层级过深')
    parents=(*parents,collection.name)
    found=set()
    for obj in collection.objects:
        if obj.hide_render:continue
        found.add(obj.name)
        if obj.instance_collection:found.update(_collection_members(obj.instance_collection,parents))
    for child in collection.children:found.update(_collection_members(child,parents))
    return found


def _render_members(view_layer):
    """集合隐藏和view-layer排除都生效；不能只查object.hide_render。"""
    def walk(layer):
        if layer.exclude or layer.collection.hide_render:return set()
        if layer.holdout or layer.indirect_only:raise ValueError('三维环绕暂不支持holdout或仅间接光集合，不能静默改变其可见性')
        found={obj.name for obj in layer.collection.objects if not obj.hide_render}
        for child in layer.children:found.update(walk(child))
        return found
    return walk(view_layer.layer_collection)



def _enable_render_visible_evaluation(scene,view_layer):
    """视口隐藏不等于渲染隐藏；在本进程副本中启用可渲染对象的求值。"""
    seen=set()
    def collection_walk(collection):
        if collection.name in seen or collection.hide_render:return
        seen.add(collection.name);collection.hide_viewport=False
        for obj in collection.objects:
            if obj.hide_render:continue
            obj.hide_viewport=False
            if obj.name in view_layer.objects:obj.hide_set(False)
            if obj.instance_collection:collection_walk(obj.instance_collection)
        for child in collection.children:collection_walk(child)
    def layer_walk(layer):
        if layer.exclude or layer.collection.hide_render:return
        layer.hide_viewport=False
        for child in layer.children:layer_walk(child)
    collection_walk(scene.collection);layer_walk(view_layer.layer_collection)


def _render_instances(graph,view_layer):
    import bpy
    visible=_render_members(view_layer)
    # DepsgraphObjectInstance游标离开迭代即失效，立即复制值，不能list()保存RNA游标。
    rows=[(row.object.original.name,row.matrix_world.copy(),row.parent.original.name if row.parent else None,row.is_instance,row.show_self)
          for row in graph.object_instances]
    # 多层集合实例保留实际instance.matrix_world，不把源集合排除误当实例不可见。
    for _ in range(64):
        previous=len(visible)
        for name,_,parent_name,_,_ in rows:
            parent=bpy.data.objects[parent_name or name]
            if parent.name in visible and parent.instance_collection and not parent.hide_render:
                visible.update(_collection_members(parent.instance_collection))
        if len(visible)==previous:break
    else:raise ValueError('三维场景集合实例层级超过64层')
    result=[]
    for name,matrix,parent_name,is_instance,show_self in rows:
        original=bpy.data.objects[name]
        parent=bpy.data.objects[parent_name] if parent_name else None
        if not show_self or original.hide_render:continue
        if is_instance:
            if parent is None or parent.hide_render or parent.name not in visible:continue
            collection=parent.instance_collection
            if collection and original.name not in _collection_members(collection):continue
        elif original.name not in visible:continue
        result.append((original.evaluated_get(graph),matrix))
    return result


def geometry_fingerprint(meshes):
    """逐帧读取真实冻结顶点/矩阵，不能只复写首次计算的SHA冒充姿态不变。"""
    import numpy as np
    digest=hashlib.sha256()
    for obj in meshes:
        vertices=np.empty(len(obj.data.vertices)*3,dtype='<f4')
        obj.data.vertices.foreach_get('co',vertices)
        digest.update(struct.pack('<II',len(obj.data.vertices),len(obj.data.polygons)))
        digest.update(vertices.tobytes())
        digest.update(np.asarray(obj.matrix_world,dtype='<f8').tobytes())
    return digest.hexdigest()


def prepare_frozen_scene(scene,params,spec,*,active_frames):
    """从内存真实场景取评估后的可见几何快照；只冻结现有数据，不重建/生成替身。"""
    import bpy
    from mathutils import Vector
    validate_bullet(params)
    _reject_external_or_driven(bpy)
    fps=scene.render.fps/scene.render.fps_base
    frozen_frame=source_frame(params['freezeSec'],scene.frame_start,scene.frame_end,fps)
    source={'fps':fps,'frameStart':scene.frame_start,'frameEnd':scene.frame_end,
            'freezeSec':params['freezeSec'],'frozenFrame':frozen_frame}
    scene.frame_set(math.floor(frozen_frame),subframe=frozen_frame%1)
    _enable_render_visible_evaluation(scene,bpy.context.view_layer)
    bpy.context.view_layer.update()
    graph=bpy.context.evaluated_depsgraph_get()
    original_objects=list(scene.objects)
    snapshots=[];lights=[];points=[];vertex_count=0
    # 先物化实例列表，防止新增对象改变正在迭代的depsgraph。
    instances=_render_instances(graph,bpy.context.view_layer)
    try:
        for evaluated,matrix in instances:
            if evaluated.type=='LIGHT':
                light_data=evaluated.data.copy();light_data.animation_data_clear()
                if light_data.node_tree:light_data.node_tree.animation_data_clear()
                light=bpy.data.objects.new('冻结灯光_'+str(len(lights))+'_'+evaluated.name,light_data)
                scene.collection.objects.link(light);light.matrix_world=matrix
                lights.append(light)
                continue
            if evaluated.type in ('CAMERA','ARMATURE','EMPTY'):continue
            if evaluated.type not in ('MESH','CURVE','FONT','SURFACE','META'):
                raise ValueError('三维环绕不支持当前可见对象类型：'+evaluated.type)
            mesh=bpy.data.meshes.new_from_object(evaluated,preserve_all_data_layers=True,depsgraph=graph)
            if not mesh or not mesh.vertices or not mesh.polygons:
                if mesh:bpy.data.meshes.remove(mesh)
                continue
            vertex_count+=len(mesh.vertices)
            if vertex_count>MAX_FROZEN_VERTICES or len(snapshots)>=MAX_FROZEN_MESHES:
                bpy.data.meshes.remove(mesh)
                raise ValueError('三维场景冻结几何超过200万顶点或2048网格预算')
            obj=bpy.data.objects.new('冻结三维_'+str(len(snapshots))+'_'+evaluated.name,mesh)
            scene.collection.objects.link(obj);obj.matrix_world=matrix
            snapshots.append(obj)
            points.extend(tuple(matrix@v.co) for v in mesh.vertices)
        vertex_frames=validate_geometry_budget(vertex_count,active_frames)
        summary=geometry_summary(points,len(snapshots))
        # 真正冻结材质/灯光/环境：保留当前frame，后续绝不推进场景时间。
        for obj in original_objects:
            if obj.type=='CAMERA':
                bpy.data.objects.remove(obj,do_unlink=True)
            else:
                obj.hide_render=True
        camera_data=bpy.data.cameras.new('子弹时间_真实透视相机')
        camera_data.type='PERSP';camera_data.sensor_width=36
        camera_data.lens=params['lensMm'];camera_data.clip_start=.01
        diagonal=math.dist(summary['minimum'],summary['maximum'])
        camera_data.clip_end=max(1000.,diagonal*4+math.dist(params['target'],summary['minimum'])+100)
        camera=bpy.data.objects.new(camera_data.name,camera_data)
        scene.collection.objects.link(camera);scene.camera=camera
        try:scene.render.engine='BLENDER_EEVEE_NEXT'
        except TypeError:scene.render.engine='BLENDER_EEVEE'
        if hasattr(scene,'eevee') and hasattr(scene.eevee,'taa_render_samples'):scene.eevee.taa_render_samples=32
        scene.render.resolution_x=spec['width'];scene.render.resolution_y=spec['height']
        scene.render.resolution_percentage=100
        scene.render.fps=round(spec['fps']);scene.render.fps_base=round(spec['fps'])/spec['fps']
        scene.render.film_transparent=False
        scene.render.image_settings.file_format='PNG'
        scene.render.image_settings.color_mode='RGBA';scene.render.image_settings.color_depth='8'
        scene.render.image_settings.compression=35
        scene.render.use_compositing=False;scene.render.use_sequencer=False
        scene.render.pixel_aspect_x=1;scene.render.pixel_aspect_y=1
        scene.render.use_border=False
        if hasattr(scene.render,'use_motion_blur'):scene.render.use_motion_blur=False
        if hasattr(scene,'eevee') and hasattr(scene.eevee,'use_motion_blur'):scene.eevee.use_motion_blur=False
        bpy.context.view_layer.update()
        handle={'scene':scene,'camera':camera,'meshes':snapshots,'lights':lights,'sourceScene':source,
                'sourceGeometry':summary,'vertexFrames':vertex_frames,'frozenGeometrySHA':geometry_fingerprint(snapshots)}
        handle['visibilitySamples']=validate_orbit_visibility(handle,params,spec)
        return handle
    except Exception:
        for light in lights:
            data=light.data;bpy.data.objects.remove(light,do_unlink=True)
            if data.users==0:bpy.data.lights.remove(data)
        for obj in snapshots:
            mesh=obj.data;bpy.data.objects.remove(obj,do_unlink=True)
            if mesh.users==0:bpy.data.meshes.remove(mesh)
        raise


def update_orbit(handle,params,progress):
    import bpy
    from mathutils import Vector
    pose=orbit_pose(params,progress)
    camera=handle['camera'];camera.location=pose['position']
    camera.rotation_euler=(Vector(pose['target'])-camera.location).to_track_quat('-Z','Y').to_euler()
    camera.data.lens=pose['lensMm']
    bpy.context.view_layer.update()
    current=geometry_fingerprint(handle['meshes'])
    if current!=handle['frozenGeometrySHA']:
        raise ValueError('冻结几何发生变化，拒绝将运动场景冒充子弹时间')
    return {**pose,'type':camera.data.type,'matrixWorld':[list(row) for row in camera.matrix_world],
            'frozenGeometrySHA':current}



def validate_orbit_visibility(handle,params,spec):
    """关键轨道角度须有真实顶点进入视锥；避免错误target输出全空背景。"""
    import bpy
    import numpy as np
    points=[]
    for obj in handle['meshes']:
        vertices=np.empty((len(obj.data.vertices),3),dtype=np.float64)
        obj.data.vertices.foreach_get('co',vertices.ravel())
        homogeneous=np.column_stack((vertices,np.ones(len(vertices))))
        points.append(homogeneous@np.asarray(obj.matrix_world,dtype=np.float64).T)
    world=np.concatenate(points,axis=0)
    count=max(3,math.ceil(abs(params['sweepDeg'])/30)+1)
    samples=[]
    for index in range(count):
        progress=index/(count-1)
        update_orbit(handle,params,progress)
        camera=handle['camera']
        projection=camera.calc_matrix_camera(bpy.context.evaluated_depsgraph_get(),x=spec['width'],y=spec['height'],scale_x=1,scale_y=1)
        matrix=np.asarray(projection@camera.matrix_world.inverted(),dtype=np.float64)
        clip=world@matrix.T;w=clip[:,3]
        inside=(w>0)&np.all(np.abs(clip[:,:3])<=w[:,None],axis=1)
        visible=int(np.count_nonzero(inside))
        if not visible:
            raise ValueError('环绕角度%.2f度没有可验证进入视锥的真实几何，请调整target/radius/height/lensMm'%(params['startAngleDeg']+params['sweepDeg']*progress))
        samples.append({'progress':progress,'visibleVertices':visible})
    return samples


def _transparent_png(width,height):
    """窗外只写透明占位帧，不启动任何三维渲染。"""
    def chunk(kind,data):return struct.pack('>I',len(data))+kind+data+struct.pack('>I',zlib.crc32(kind+data)&0xffffffff)
    raw=b''.join(b'\0'+b'\0'*(width*4) for _ in range(height))
    return b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',width,height,8,6,0,0,0))+chunk(b'IDAT',zlib.compress(raw,6))+chunk(b'IEND',b'')


def render(spec_path,event_id,output):
    import bpy
    spec_path=Path(spec_path).resolve();output=Path(output)
    raw=spec_path.read_bytes();spec=json.loads(raw)
    event,scene_path=validate_render_spec(spec,event_id,spec_path.parent)
    output.mkdir(parents=True,exist_ok=True)
    if any(output.iterdir()):raise ValueError('三维输出目录已有产物，查询原任务而非覆盖')
    (output/'input.raw.json').write_bytes(raw)
    manifest={'version':1,'renderer':'manhua-vfx-bullet-real3d-1','complete':False,
              'width':spec['width'],'height':spec['height'],'fps':spec['fps'],
              'frameCount':math.ceil(spec['durationSec']*spec['fps']),
              'implementationSha256':{name:_sha(Path(__file__).with_name(name)) for name in ('manhua_vfx_bullet3d.py','manhua_vfx_bullet3d_math.py')},
              'eventId':event_id,'sceneSha256':event['sceneSha256'],'sceneJobId':event['bullet']['sceneJobId'],
              'alpha':'straight','colorSpace':'sRGB','boundaryZh':BOUNDARY,'frames':[],'files':[],'renderedBytes':0}
    _write_json(output/'manifest.json',manifest)
    try:
        bpy.ops.wm.open_mainfile(filepath=str(scene_path),load_ui=False,use_scripts=False)
        first,stop=frame_span(event,spec['fps'])
        handle=prepare_frozen_scene(bpy.context.scene,event['bullet'],spec,active_frames=stop-first)
        manifest.update({key:handle[key] for key in ('sourceScene','sourceGeometry','frozenGeometrySHA','visibilitySamples','vertexFrames')})
        transparent=_transparent_png(spec['width'],spec['height'])
        for index in range(manifest['frameCount']):
            active=first<=index<stop
            path=output/('frame-%06d.png'%(index+1))
            camera=None
            if active:
                camera=update_orbit(handle,event['bullet'],(index-first)/(stop-first-1))
                handle['scene'].render.filepath=str(path)
                bpy.ops.render.render(write_still=True)
                if geometry_fingerprint(handle['meshes'])!=handle['frozenGeometrySHA']:
                    raise ValueError('渲染后冻结几何发生变化')
            else:
                path.write_bytes(transparent)
            size=path.stat().st_size
            if size<=0 or size>32*1024*1024:raise ValueError('三维输出帧为空或超过32MB')
            manifest['renderedBytes']+=size
            if manifest['renderedBytes']>MAX_RENDER_BYTES:raise ValueError('三维帧序列超过2GB')
            manifest['files'].append({'frame':index+1,'path':path.name,'bytes':size,'sha256':_sha(path)})
            manifest['frames'].append({'frame':index+1,'timeSec':index/spec['fps'],'active':active,
                                       'camera':camera,'frozenGeometrySHA':handle['frozenGeometrySHA']})
            _write_json(output/'manifest.json',manifest)
        manifest['complete']=True;_write_json(output/'manifest.json',manifest)
    except Exception as error:
        manifest['error']=str(error);_write_json(output/'manifest.json',manifest)
        raise


if __name__=='__main__':
    args=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
    if len(args)!=3:raise SystemExit('参数：spec.json effectId outputDir')
    render(*args)
