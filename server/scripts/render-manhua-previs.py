"""服务端动作白模：输入只读 JSON，固定代码构建关节，不载入用户脚本或 blend。"""
import json
import math
import sys
from pathlib import Path
import bpy
from mathutils import Matrix, Vector
from bpy_extras.object_utils import world_to_camera_view

args = sys.argv[sys.argv.index('--') + 1:]
spec = json.loads(Path(args[0]).read_text())
out = Path(args[1])
out.mkdir(parents=True, exist_ok=True)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
scene = bpy.context.scene
scene.render.engine = 'BLENDER_WORKBENCH'
scene.render.resolution_x, scene.render.resolution_y = (960, 540) if spec['aspect'] == '16:9' else (540, 960)
scene.render.resolution_percentage = 100
scene.render.fps = 24
scene.frame_start, scene.frame_end = 1, spec['durationSec'] * 24
scene.render.image_settings.file_format = 'PNG'
scene.world.color = (.09, .09, .09)
scene.display.shading.light = 'STUDIO'
scene.display.shading.color_type = 'MATERIAL'
scene.display.shading.show_shadows = True
scene.display.shading.show_cavity = True
scene.display.shading.background_type = 'WORLD'

def material(name, color):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*color, 1)
    return mat

def is_sphere_bone(name):
    """建模时 head / body 用球，其余用立方体——见 mesh() 的 sphere 参数。"""
    return name in ('head','body')

def bone_radius(actor, name):
    """骨骼对应实体的半径。建模与出画判定共用，免得两边各写一份日后走样。"""
    if name in ('spine','head'): return .15
    if name=='body': return .33
    if name=='neck': return .15 if actor['shape']=='horse' else .065
    return .065

def bone_margin_radius(actor, name):
    """
    出画判定要留的边距。球骨各方向都是 radius；**立方体骨的角点到骨轴是 radius×√2**，
    只按 radius 留边会漏掉那 0.41×radius 的角（0912 审查实测：单人竖屏收紧后网格最多
    超出判据边界 0.0046 NDC，当时是靠 .02 安全边巧合兜住的，不是判据本身安全）。
    """
    radius = bone_radius(actor, name)
    return radius if is_sphere_bone(name) else radius * 2 ** .5

def mesh(name, a, b, radius, mat, sphere=False):
    a, b = Vector(a), Vector(b)
    if sphere:
        bpy.ops.mesh.primitive_uv_sphere_add(segments=12, ring_count=8)
    else:
        bpy.ops.mesh.primitive_cube_add(size=2)
    obj = bpy.context.object
    obj.name = name
    obj.location = (a+b)/2
    obj.scale = (radius, radius, (b-a).length/2)
    obj.rotation_mode = 'QUATERNION'
    obj.rotation_quaternion = (b-a).to_track_quat('Z', 'Y')
    obj.data.materials.append(mat)
    return obj

ground = material('地面', (.23,.25,.27))
obj = mesh('地面', (0,0,-.12), (0,0,0), 16, ground)

def smooth(value):
    u = max(0., min(1., value))
    return u*u*(3-2*u)

def position(actor, frame):
    t = (frame-1)/24
    u = max(0., min(1., (t-actor['moveStartSec'])/(actor['moveEndSec']-actor['moveStartSec'])))
    return Vector((actor['start'][0]*(1-u)+actor['end'][0]*u,
                   actor['start'][1]*(1-u)+actor['end'][1]*u, 0))

def transform(actor, frame):
    return Matrix.Translation(position(actor, frame)) @ Matrix.Rotation(math.radians(actor['facingDeg']), 4, 'Z')

def ik(hip, end, l1, l2, bend):
    delta = end-hip
    length = min(delta.length, l1+l2-.00001)
    direction = delta.normalized()
    side = Vector(bend)-direction*Vector(bend).dot(direction)
    if side.length < .00001: side = direction.cross(Vector((0,1,0)))
    side.normalize()
    along = (l1*l1-l2*l2+length*length)/(2*length)
    return hip+direction*along+side*math.sqrt(max(0.,l1*l1-along*along)), hip+direction*length

def action_amounts(actor, t):
    values = {'wind':0.,'strike':0.,'guard':0.,'recoil':0.}
    for action in actor['actions']:
        if not action['startSec'] <= t <= action['endSec']: continue
        u = (t-action['startSec'])/(action['endSec']-action['startSec'])
        if action['kind'] == 'strike':
            values['wind'] = smooth(u/.30)*(1-smooth((u-.30)/.12))
            values['strike'] = smooth((u-.30)/.12)*(1-smooth((u-.65)/.35))
        elif action['kind'] in ('guard','recoil'):
            values[action['kind']] = smooth(u/.20)*(1-smooth((u-.75)/.25))
    return values

def points(actor, frame, contacts):
    t = (frame-1)/24
    amounts = action_amounts(actor,t)
    horse = actor['shape'] == 'horse'
    keys = list(contacts)
    hip_z = (1.02 if horse else .80)-.09*amounts['wind']-.08*amounts['recoil']
    inv = transform(actor,frame).inverted()
    ankles = {key:inv @ contacts[key] for key in keys}
    hips = {key:Vector((offset[0],offset[1],hip_z)) for key,offset in foot_offsets(actor).items()}
    limb = .53 if horse else .43
    lower = 0.
    for key in keys:
        d = hips[key]-ankles[key]
        lower = max(lower,d.z-math.sqrt(max(.0001,(limb*2-.01)**2-d.x*d.x-d.y*d.y)))
    p = {}
    for key in keys:
        hip = hips[key]-Vector((0,0,lower))
        knee, ankle = ik(hip,ankles[key],limb,limb,(1,0,0))
        p['upper_leg'+key]=(hip,knee)
        p['lower_leg'+key]=(knee,ankle)
        p['foot'+key]=(ankle,ankle+Vector((.17,0,0)))
    if horse:
        p['body']=(Vector((-.7,0,1.2-lower)),Vector((.65,0,1.2-lower)))
        p['neck']=(Vector((.6,0,1.15-lower)),Vector((.85,0,1.9-lower)))
        p['head']=(Vector((.7,0,1.96-lower)),Vector((1.3,0,1.96-lower)))
    else:
        pelvis=Vector((0,0,hip_z-lower))
        chest=pelvis+Vector((.10*amounts['strike']-.08*amounts['recoil'],0,.43))
        neck=chest+Vector((0,0,.14))
        p['pelvis']=(pelvis-Vector((0,0,.08)),pelvis)
        p['spine']=(pelvis,chest)
        p['neck']=(chest,neck)
        p['head']=(neck,neck+Vector((-.045*amounts['recoil'],0,.28)))
        for s in (-1,1):
            shoulder=chest+Vector((0,s*.21,0))
            x=.10+.43*amounts['strike']-.25*amounts['wind'] if s==-1 else .12
            hand=shoulder+Vector((x+.18*amounts['guard'],s*.13,-.34+.35*amounts['wind']+.31*amounts['strike']+.50*amounts['guard']+.40*amounts['recoil']))
            elbow,hand=ik(shoulder,hand,.29,.29,(0,s,-.4))
            p['upper_arm'+str(s)]=(shoulder,elbow)
            p['forearm'+str(s)]=(elbow,hand)
            p['hand'+str(s)]=(hand,hand+(hand-elbow).normalized()*.09)
    return p

def foot_offsets(actor):
    if actor['shape']=='horse':
        return {str(i):(x,y) for i,(x,y) in enumerate([(-.60,-.25),(.60,.25),(-.60,.25),(.60,-.25)])}
    return {'-1':(-.08,-.15),'1':(.08,.15)}

def plan_contacts(actor):
    offsets=foot_offsets(actor)
    anchors={key:transform(actor,1) @ Vector((*offset,.065)) for key,offset in offsets.items()}
    result={}
    stance={}
    keys=list(offsets)
    for start in range(1,scene.frame_end+1,6):
        end=min(scene.frame_end,start+5)
        chosen=keys[((start-1)//6)%len(keys)]
        goal=transform(actor,end) @ Vector((*offsets[chosen],.065))
        before=anchors[chosen].copy()
        moving=(goal-before).length>.035
        for f in range(start,end+1):
            u=(f-start)/max(1,end-start)
            lift=before.lerp(goal,smooth(u)) if moving else before.copy()
            if moving: lift.z+=.09*math.sin(math.pi*u)
            result[f]={key:(lift.copy() if key==chosen else p.copy()) for key,p in anchors.items()}
            stance[f]=[key for key in keys if key!=chosen or not moving]
        if moving: anchors[chosen]=goal
    return result,stance

rigs=[]
for index,actor in enumerate(spec['actors']):
    contacts,stance=plan_contacts(actor)
    rest=points(actor,1,contacts[1])
    data=bpy.data.armatures.new(actor['id'])
    rig=bpy.data.objects.new(actor['id'],data)
    scene.collection.objects.link(rig)
    bpy.context.view_layer.objects.active=rig
    rig.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    for name,(a,b) in rest.items():
        bone=data.edit_bones.new(name);bone.head=a;bone.tail=b
    bpy.ops.object.mode_set(mode='OBJECT')
    color=material(actor['nameZh'],[(.65,.72,.75),(.72,.58,.55),(.60,.64,.51),(.63,.59,.72),(.65,.69,.54),(.55,.65,.69)][index])
    for name,(a,b) in rest.items():
        radius=bone_radius(actor,name)
        obj=mesh(actor['id']+'_'+name,a,b,radius,color,name in ('head','body'))
        bpy.ops.object.select_all(action='DESELECT')
        obj.select_set(True);bpy.context.view_layer.objects.active=obj
        bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
        obj.parent=rig
        group=obj.vertex_groups.new(name=name)
        group.add(list(range(len(obj.data.vertices))),1,'REPLACE')
        modifier=obj.modifiers.new('关节','ARMATURE');modifier.object=rig
    max_error=0.
    for frame in range(1,scene.frame_end+1):
        scene.frame_set(frame)
        rig.matrix_world=transform(actor,frame)
        rig.keyframe_insert('location',frame=frame);rig.keyframe_insert('rotation_euler',frame=frame)
        for name,(a,b) in points(actor,frame,contacts[frame]).items():
            pb=rig.pose.bones[name]
            d=b-a
            pb.rotation_mode='QUATERNION'
            pb.matrix=Matrix.Translation(a) @ d.to_track_quat('Y','Z').to_matrix().to_4x4() @ Matrix.Diagonal((1,d.length/pb.bone.length,1,1))
            for prop in ('location','rotation_quaternion','scale'):pb.keyframe_insert(prop,frame=frame)
            if name.startswith('lower_leg'):
                key=name[len('lower_leg'):]
                max_error=max(max_error,(rig.matrix_world @ b-contacts[frame][key]).length)
    if max_error>.005: raise ValueError('关节落点不可达，请缩短路线或延长移动区间')
    rigs.append((actor,rig,contacts,stance,max_error))

bpy.ops.object.camera_add()
camera=bpy.context.object
scene.camera=camera
camera.data.sensor_width=36
for shot in spec['cameras']:
    # 与提交 schema 的 Math.round 一致，避免 .5 时 Python 银行家舍入错一帧。
    begin=math.floor(shot['startSec']*24+.5)+1
    end=math.floor(shot['endSec']*24+.5)
    camera.location=shot['position']
    camera.rotation_euler=(Vector(shot['target'])-camera.location).to_track_quat('-Z','Y').to_euler()
    camera.data.lens=shot['lens']
    for f in (begin,end):
        for prop in ('location','rotation_euler'):camera.keyframe_insert(prop,frame=f)
        camera.data.keyframe_insert('lens',frame=f)

# 整数帧已烘焙；跨版本兼容 legacy Action 与 layered Action，只处理相机插值。
def curves(action):
    if hasattr(action,'fcurves'): yield from action.fcurves
    elif hasattr(action,'layers'):
        for layer in action.layers:
            for strip in layer.strips:
                for bag in strip.channelbags: yield from bag.fcurves
for obj in (camera,camera.data):
    for fc in curves(obj.animation_data.action):
        for key in fc.keyframe_points:key.interpolation='CONSTANT'

# 竖屏构图（0911 验收实测「人物偏小」→ 0912 实测定案）：
# Blender 默认 AUTO 传感器拟合把 36mm 套在**较长边**上，横屏套宽、竖屏套高，
# 于是同一个镜头在竖屏的垂直视场从 32.3° 张到 54.4°（lens 35 解析可验），
# 人物占画面高度按骨骼端点（头顶到脚尖）量是 33.1% → 18.6%，按网格包围盒量是
# 34.8% → 19.6%；两种口径的比值都是 1.78，即 36 / (36×9/16)。
#
# 但直接改成竖向拟合会把多角色挤出画：实测三角色（±1.6m）2/3 出画、
# 六角色紧凑站位（±2m）3/6 出画，都是从「全在画内」变坏。
# 所以只在**收紧后所有人仍在画内**时才收紧；挤得下就给更饱满的构图，挤不下就维持原样。
# 决策在渲染前做完，写进 scene.blend，渲染端不需要知道这件事。
# 这里扫**全部骨骼**，不是报告口径的头+脚。收紧会把横向半宽从 2.31m 压到 1.30m
# （8m 处 lens 35），出手动作的手臂伸展量约 0.6m 正好落在头脚与画框之间：
# 只看头脚会判「全在画内」而把手臂切出去，并且报告也看不见（审查实测：两角色 ±1.0m
# 做 strike，hand 出画 25 帧、forearm 24 帧、upper_arm 17 帧，报告却是 offscreenFrames 全 0）。
# 收紧是可选的增益，判据必须比报告更严——宁可不收紧，不能切掉手。
def _ndc_per_meter():
    """
    世界系 1 米在画面 NDC 上占多宽 × 深度。透视投影下 NDC 偏移 = 半径 × 本系数 ÷ 深度，
    所以每帧算一次（相机是动画的，逐镜会跳），逐骨骼只做乘除，不再多投影。
    """
    basis=camera.matrix_world.to_3x3()
    right=(basis @ Vector((1,0,0))).normalized()
    up=(basis @ Vector((0,1,0))).normalized()
    forward=(basis @ Vector((0,0,-1))).normalized()
    ref=camera.matrix_world.translation+forward*8.
    p0=world_to_camera_view(scene,camera,ref)
    # 取不到比例就等于边距失效。返回 0 会让判定变**松**，与整段「宁可不收紧」的取向相反，
    # 所以返回 None 让调用方直接判「收不下」。ref 恒在相机正前方 8m，正常走不到这里。
    if p0.z<=0: return None
    px=world_to_camera_view(scene,camera,ref+right)
    py=world_to_camera_view(scene,camera,ref+up)
    return abs(px.x-p0.x)*p0.z, abs(py.y-p0.y)*p0.z

def _bones_in_frame():
    """
    收紧是否会切到人。三点比报告口径更严，因为收紧只是可选增益，切掉肢体的代价高得多：
    ① 扫全部骨骼，不只头和脚——出手时手臂伸展约 0.6m，正好落在头脚与收紧后画框之间，
       只看头脚会判「全在画内」而把手切出去，报告同样口径所以也看不见（0912 审查实测：
       两角色 ±1.0m 出手，hand 出画 25 帧、forearm 24、upper_arm 17，报告却是零出画）。
    ② 首尾两端都采样，不只 tail。这些骨没有父子关系，head 是独立端点。
    ③ 按实体粗细留边距。骨骼是中轴线，模型有半径，只看中轴线会漏掉外壳那一圈。
       human 也不例外——它的极值点并不都落在骨骼端点上。
       边距按 {@link bone_margin_radius}：球骨用 radius，立方体骨用 radius×√2（角点距离）。
       对两个屏幕轴一律用同一个值，沿骨轴方向属于保守多留。
       实证：马站 x=-0.35 竖屏，只看中轴线判 tight，带粗细判 auto——推翻收紧的是
       `body` 骨（半径 .33）端点那一圈余量。
    """
    for frame in range(1,scene.frame_end+1):
        scene.frame_set(frame)
        bpy.context.view_layer.update()
        scale=_ndc_per_meter()
        if scale is None: return False
        kx,ky=scale
        for actor,rig,_c,_s,_e in rigs:
            for bone in rig.pose.bones:
                radius=bone_margin_radius(actor,bone.name)
                for point in (bone.head,bone.tail):
                    p=world_to_camera_view(scene,camera,rig.matrix_world @ point)
                    if p.z<=0: return False
                    # 实体厚度也会改变相机深度；r*k/z 只覆盖与成像面平行的圆盘，
                    # 斜视时会漏掉靠近相机的角点。用四个视锥侧平面的法向长度
                    # 检查端点包围球，保证整条骨骼胶囊都落在 2% 安全边内。
                    mx=radius*math.hypot(kx,.48)/p.z
                    my=radius*math.hypot(ky,.48)/p.z
                    if not (.02 <= p.x-mx and p.x+mx <= .98): return False
                    if not (.02 <= p.y-my and p.y+my <= .98): return False
    return True

if scene.render.resolution_y > scene.render.resolution_x:
    _before_fit,_before_h = camera.data.sensor_fit, camera.data.sensor_height
    _fit_before = _bones_in_frame()
    camera.data.sensor_fit='VERTICAL'
    camera.data.sensor_height=36*9/16
    # 只有「原本全在画内、收紧后仍全在画内」才采用；原本就出画的场景不改口径，免得掩盖既有问题
    if not (_fit_before and _bones_in_frame()):
        camera.data.sensor_fit,camera.data.sensor_height=_before_fit,_before_h
    scene.frame_set(1)
    bpy.context.view_layer.update()

report={'frames':scene.frame_end,'fps':24,'actors':[],'warnings':[],
        'portraitFraming':('tight' if camera.data.sensor_fit=='VERTICAL' else 'auto') if scene.render.resolution_y>scene.render.resolution_x else 'landscape'}
# 收紧与否是 1.78 倍的二值跳变，站位或动作跨过临界点画面会整体突变。
# 这个决定原本只落在 report.json 里、前端看不到，用户会看到「有的竖屏变大了、有的没变」
# 却拿不到任何解释——所以退回时写一条人话进 warnings（前端已在展示 warnings）。
if report['portraitFraming']=='auto':
    report['warnings'].append('竖屏未收紧构图：按当前站位与动作，收紧后会有人物被切出画，已保持原画幅。想要更饱满的竖屏构图，可让角色更靠近画面中心或缩小彼此间距。')
for actor,rig,contacts,stance,error in rigs:
    offscreen=[]
    drift=0.
    previous={}
    for frame in range(1,scene.frame_end+1):
        scene.frame_set(frame)
        bpy.context.view_layer.update()
        for key in foot_offsets(actor):
            actual=rig.matrix_world @ rig.pose.bones['lower_leg'+key].tail
            if key in stance[frame] and key in previous and previous[key][0]==frame-1 and previous[key][1]:
                drift=max(drift,(actual-previous[key][2]).length)
            previous[key]=(frame,key in stance[frame],actual.copy())
        names=['head']+['foot'+key for key in foot_offsets(actor)]
        if any(not (.02 <= (p:=world_to_camera_view(scene,camera,rig.matrix_world @ rig.pose.bones[name].tail)).x <= .98 and .02 <= p.y <= .98 and p.z>0) for name in names): offscreen.append(frame)
    report['actors'].append({'id':actor['id'],'nameZh':actor['nameZh'],'bones':len(rig.pose.bones),'contactError':error,'stanceDrift':drift,'offscreenFrames':offscreen})
    if offscreen:report['warnings'].append(actor['nameZh']+'存在头或脚出画，请人工审查镜头覆盖')
(out/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
if any(actor['stanceDrift']>.005 for actor in report['actors']):
    raise ValueError('支撑脚漂移未过验收')
frames=out/'frames';frames.mkdir(exist_ok=True)
scene.render.filepath=str(frames/'frame-')
bpy.ops.wm.save_as_mainfile(filepath=str(out/'scene.blend'))
# 只准备受控场景。服务端永久保存报告与场景后才启动独立渲染进程。
print('MANHUA_PREVIS_PREPARED')
