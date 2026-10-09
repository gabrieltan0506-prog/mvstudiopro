"""真实三维子弹时间的纯数据契约；不从图片或单片推断几何。"""
import hashlib
import math
from pathlib import Path
import re
import uuid

BULLET_DEFAULTS = {'freezeSec': 0., 'startAngleDeg': -45., 'sweepDeg': 360.,
                   'radius': 4., 'height': 1.6, 'target': [0., 0., 1.], 'lensMm': 50.}
MAX_SCENE_BYTES = 512 * 1024 * 1024
MAX_VERTEX_FRAMES = 12_000_000


def number(value, lo, hi, name):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not lo <= value <= hi:
        raise ValueError('三维环绕参数无效：' + name)
    return value


def validate_bullet(value):
    fields=set(BULLET_DEFAULTS)|{'sceneJobId','sceneScopeId','clipId'}
    if not isinstance(value,dict) or set(value)!=fields:
        raise ValueError('三维环绕字段不完整或含旧单片参数')
    if not isinstance(value['sceneJobId'],str) or not re.fullmatch(r'prv_[a-f0-9]{48}',value['sceneJobId']):
        raise ValueError('必须选择本人已完成的真实预演场景')
    try:
        uuid.UUID(value['sceneScopeId'])
    except (ValueError,AttributeError,TypeError):
        raise ValueError('三维场景项目身份无效')
    if not isinstance(value['clipId'],str) or not 1<=len(value['clipId'])<=160:
        raise ValueError('三维场景片段身份无效')
    for name,lo,hi in [('freezeSec',0,30),('startAngleDeg',-360,360),('sweepDeg',-360,360),
                       ('radius',.5,30),('height',-10,30),('lensMm',18,100)]:
        number(value[name],lo,hi,name)
    if abs(value['sweepDeg'])<30:
        raise ValueError('真实环绕角度至少30度')
    if not isinstance(value['target'],list) or len(value['target'])!=3:
        raise ValueError('真实环绕必须提供三维目标点')
    for axis in value['target']:number(axis,-100,100,'target')
    return value


def frame_span(event,fps):
    first=math.ceil(event['startSec']*fps-1e-9)
    end=event['startSec']+event['durationSec']
    stop=math.ceil(end*fps-1e-9)
    # 与服务端逐帧的绝对秒比较严格同源，避免浮点边界纳入窗外帧。
    while first/fps<event['startSec']:first+=1
    while first>0 and (first-1)/fps>=event['startSec']:first-=1
    while stop/fps<end:stop+=1
    while stop>first and (stop-1)/fps>=end:stop-=1
    if stop-first<2:
        raise ValueError('三维环绕时间窗至少包含两帧')
    return first,stop


def orbit_pose(params,progress):
    progress=number(progress,0,1,'progress')
    angle=math.radians(params['startAngleDeg']+params['sweepDeg']*progress)
    target=params['target']
    position=[target[0]+params['radius']*math.cos(angle),
              target[1]+params['radius']*math.sin(angle),target[2]+params['height']]
    return {'position':position,'target':list(target),'lensMm':params['lensMm']}


def source_frame(freeze_sec,frame_start,frame_end,fps):
    number(fps,.1,240,'source fps')
    if not isinstance(frame_start,int) or not isinstance(frame_end,int) or frame_end<frame_start:
        raise ValueError('源三维场景时间轴无效')
    duration=(frame_end-frame_start+1)/fps
    number(freeze_sec,0,30,'freezeSec')
    if freeze_sec>=duration:
        raise ValueError('冻结秒位超出源三维场景时间轴')
    return frame_start+freeze_sec*fps



def validate_geometry_budget(vertices,active_frames):
    if type(vertices) is not int or type(active_frames) is not int or not 4<=vertices<=2_000_000 or not 1<=active_frames<=1800:
        raise ValueError('真实三维顶点数或活动帧数无效')
    if vertices*active_frames>MAX_VERTEX_FRAMES:
        raise ValueError('三维环绕超过1200万顶点帧预算，请缩短三维时窗或使用已保存的低模代理场景')
    return vertices*active_frames


def geometry_summary(points,mesh_count):
    """仿射秩检查：旋转后的单平面同样拒绝，不用XYZ边界冒充体积。"""
    if mesh_count<1 or len(points)<4:
        raise ValueError('真实三维场景缺少可见网格')
    if any(not math.isfinite(float(v)) for p in points for v in p):
        raise ValueError('真实几何存在非有限顶点')
    lo=[min(p[k] for p in points) for k in range(3)]
    hi=[max(p[k] for p in points) for k in range(3)]
    diagonal=math.dist(lo,hi)
    if diagonal<1e-6:
        raise ValueError('真实几何尺寸为空')
    p0=points[0]
    p1=max(points,key=lambda p:sum((p[k]-p0[k])**2 for k in range(3)))
    axis=[p1[k]-p0[k] for k in range(3)]
    def cross(p):
        v=[p[k]-p0[k] for k in range(3)]
        return [axis[1]*v[2]-axis[2]*v[1],axis[2]*v[0]-axis[0]*v[2],axis[0]*v[1]-axis[1]*v[0]]
    p2=max(points,key=lambda p:sum(v*v for v in cross(p)))
    normal=cross(p2);length=math.sqrt(sum(v*v for v in normal))
    if length<diagonal*diagonal*1e-8:
        raise ValueError('场景只有点或直线，不能三维环绕')
    normal=[v/length for v in normal]
    thickness=max(abs(sum((p[k]-p0[k])*normal[k] for k in range(3))) for p in points)
    if thickness<diagonal*1e-5:
        raise ValueError('场景只有共面几何，不能伪装真实三维环绕')
    return {'meshes':mesh_count,'vertices':len(points),'minimum':lo,'maximum':hi,
            'nonPlanarThickness':thickness}


def validate_scene_path(value,digest,asset_root,event_id):
    if not isinstance(value,str) or not value or '\x00' in value or len(value)>4096:
        raise ValueError('缺少服务端准备的三维场景路径')
    if not isinstance(digest,str) or not re.fullmatch(r'[a-f0-9]{64}',digest):
        raise ValueError('缺少三维场景版本SHA')
    root=Path(asset_root).resolve();scenes=(root/'scenes').resolve()
    if scenes.parent!=root:
        raise ValueError('三维场景目录越界')
    path=Path(value)
    path=(path if path.is_absolute() else root/path).resolve()
    if path.parent!=scenes or path.name!='scene-'+event_id+'.blend' or not path.is_file():
        raise ValueError('三维场景必须为本请求scenes目录的固定文件')
    size=path.stat().st_size
    if not 12<=size<=MAX_SCENE_BYTES:
        raise ValueError('三维场景体积无效或超过512MB')
    sha=hashlib.sha256()
    with path.open('rb') as file:
        header=file.read(12)
        if not header.startswith(b'BLENDER'):
            raise ValueError('三维场景不是未压缩Blender文件')
        sha.update(header)
        for chunk in iter(lambda:file.read(1024*1024),b''):sha.update(chunk)
    if sha.hexdigest()!=digest:
        raise ValueError('三维场景SHA与已授权版本不一致')
    return path


def validate_render_spec(spec,event_id,asset_root):
    if not isinstance(spec,dict) or set(spec)!={'version','seed','effects','durationSec','fps','width','height'} or not isinstance(spec.get('effects'),list):
        raise ValueError('三维环绕任务配置无效')
    if spec['version']!=1 or isinstance(spec['version'],bool) or not isinstance(spec['seed'],int) or isinstance(spec['seed'],bool) or not 0<=spec['seed']<=2147483647:
        raise ValueError('三维环绕版本或种子无效')
    if not 1<=len(spec['effects'])<=12:raise ValueError('三维环绕图层数无效')
    number(spec.get('durationSec'),1/60,30,'durationSec');number(spec.get('fps'),12,60,'fps')
    for name in ('width','height'):
        value=number(spec.get(name),16,1920,name)
        if not isinstance(value,int) or value%2:raise ValueError('画幅必须为偶数整数')
    pixels=spec['width']*spec['height'];frames=math.ceil(spec['durationSec']*spec['fps'])
    if pixels>1920*1080 or pixels*frames>1920*1080*900:
        raise ValueError('三维环绕超过像素帧预算')
    rows=[e for e in spec['effects'] if isinstance(e,dict) and e.get('id')==event_id]
    if len(rows)!=1 or rows[0].get('kind')!='bullet_time':raise ValueError('未找到唯一三维环绕图层')
    event=rows[0]
    if set(event)!={'id','kind','startSec','durationSec','color','scale','intensity','anchor','bullet','scenePath','sceneSha256'}:
        raise ValueError('三维环绕图层字段无效，旧单片/路径别名不受支持')
    if not isinstance(event['color'],str) or not re.fullmatch(r'#[0-9a-fA-F]{6}',event['color']):raise ValueError('图层颜色无效')
    if not re.fullmatch(r'[A-Za-z0-9_-]{1,80}',event_id):raise ValueError('三维环绕图层身份无效')
    validate_bullet(event.get('bullet'))
    number(event.get('startSec'),0,spec['durationSec'],'startSec')
    number(event.get('durationSec'),1/60,30,'effect durationSec')
    if event['startSec']+event['durationSec']>spec['durationSec']+1e-9:
        raise ValueError('三维环绕超出原片时间窗')
    first,stop=frame_span(event,spec['fps'])
    minimum=max(3,math.ceil(abs(event['bullet']['sweepDeg'])/30)+1)
    if stop-first<minimum:
        raise ValueError('真实三维环绕至少%d帧，相邻相机角度不得超过30度'%minimum)
    if event.get('scale')!=1 or event.get('intensity')!=1 or event.get('anchor')!={'space':'screen','position':[.5,.5]}:
        raise ValueError('真实三维环绕替换完整画幅，不能透明缩放或添加二维轨迹')
    for other in spec['effects']:
        if other is event:continue
        if max(event['startSec'],other['startSec'])<min(event['startSec']+event['durationSec'],other['startSec']+other['durationSec'])-1e-9:
            raise ValueError('真实三维环绕时间窗不能与其他效果重叠')
    path=validate_scene_path(event.get('scenePath'),event.get('sceneSha256'),asset_root,event_id)
    return event,path
