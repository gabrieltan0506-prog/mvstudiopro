"""0917 PR-E：文戏六类动作的 Blender 离线验收。

判据一律是「同一根骨头在动作窗口内的真实位移」，并且每条都配一个 idle 反例对照：
反例必须红（位移接近 0），否则这条断言等于没测。阈值写死在这里，不从被测对象反推。
产物与 report 全部保留在输出目录，不清理。
"""
import copy
import json
import math
from pathlib import Path
import runpy
import sys
import bpy

arguments = sys.argv[sys.argv.index('--')+1:]
root = Path(arguments[0])
root.mkdir(parents=True, exist_ok=True)
script = Path(__file__).with_name('render-manhua-previs.py')

BASE = {'version':1, 'durationSec':2, 'aspect':'16:9',
        'actors':[{'id':'阿菁','nameZh':'阿菁','shape':'human','start':[-.4,0],'end':[-.4,0],
                   'moveStartSec':0,'moveEndSec':2,'facingDeg':0,'actions':[]},
                  {'id':'娘','nameZh':'娘','shape':'human','start':[.6,.9],'end':[.6,.9],
                   'moveStartSec':0,'moveEndSec':2,'facingDeg':180,'actions':[]}],
        'cameras':[{'startSec':0,'endSec':2,'position':[2,-5,2.3],'target':[0,0,1],'lens':40}]}

results = []

def build(spec, label, renderer=None):
    renderer = renderer or script
    folder = root/label
    folder.mkdir(exist_ok=True)
    source = folder/'spec.json'
    source.write_text(json.dumps(spec, ensure_ascii=False, indent=2))
    sys.argv = [str(renderer), '--', str(source), str(folder)]
    runpy.run_path(str(renderer), run_name='__main__')
    return folder, json.loads((folder/'report.json').read_text())

def sample(bone, frame, actor_id='阿菁'):
    rig = bpy.data.objects[actor_id]
    bpy.context.scene.frame_set(frame)
    bpy.context.view_layer.update()
    return (rig.matrix_world @ rig.pose.bones[bone].tail).copy()

def measure(label, actions, bone, frame, axis):
    """同一动作 vs idle 反例，量同一根骨头同一帧的差。axis: 'x'/'z'/'xy'/'yaw'"""
    spec = copy.deepcopy(BASE)
    spec['actors'][0]['actions'] = actions
    build(spec, label)
    moved = sample(bone, frame)
    control = copy.deepcopy(BASE)
    control['actors'][0]['actions'] = [{'kind':'idle','startSec':0,'endSec':2}]
    build(control, label+'-idle-control')
    rest = sample(bone, frame)
    if axis == 'xy':
        delta = math.hypot(moved.x-rest.x, moved.y-rest.y)
    elif axis == 'x':
        delta = moved.x-rest.x
    else:
        delta = moved.z-rest.z
    results.append({'case':label,'bone':bone,'frame':frame,'axis':axis,
                    'delta':round(delta,4),'moved':[round(v,4) for v in moved],
                    'rest':[round(v,4) for v in rest]})
    return delta

# 1) 坐下：骨盆明显下沉（反例 idle 必须几乎不动）
sit = measure('sit', [{'kind':'sit','startSec':0,'endSec':2}], 'pelvis', 25, 'z')
assert sit <= -0.18, ('坐下髋部下沉不足', sit)

# 2) 行礼：头部明显前移
bow = measure('bow', [{'kind':'bow','startSec':0,'endSec':2}], 'head', 25, 'x')
assert bow >= 0.18, ('行礼前倾不足', bow)

# 3) 抬手指向：前手抬高并前伸
point_z = measure('gesture_point', [{'kind':'gesture_point','startSec':0,'endSec':2}], 'hand-1', 25, 'z')
point_x = measure('gesture_point-forward', [{'kind':'gesture_point','startSec':0,'endSec':2}], 'hand-1', 25, 'x')
assert point_z >= 0.15, ('指向抬臂高度不足', point_z)
assert point_x >= 0.15, ('指向前伸不足', point_x)

# 4) 看向：另一位角色在侧后方，上身与头必须偏过去（横向位移）
look = measure('look', [{'kind':'look','startSec':0,'endSec':2,'lookAtId':'娘'}], 'head', 25, 'xy')
assert look >= 0.03, ('看向的头部偏转不足', look)
# 反例：看向不存在的目标不许硬编一个姿势（服务端 schema 已拒，这里兜住渲染层）
missing = copy.deepcopy(BASE)
missing['actors'][0]['actions'] = [{'kind':'look','startSec':0,'endSec':2,'lookAtId':'不存在的人'}]
build(missing, 'look-missing-target')
missing_head = sample('head', 25)
control = copy.deepcopy(BASE)
control['actors'][0]['actions'] = [{'kind':'idle','startSec':0,'endSec':2}]
build(control, 'look-missing-target-idle-control')
idle_head = sample('head', 25)
missing_delta = math.hypot(missing_head.x-idle_head.x, missing_head.y-idle_head.y)
results.append({'case':'look-missing-target','delta':round(missing_delta,4),
                'note':'目标找不到时按不看处理：渲染不崩，也不硬编一个朝向'})
assert missing_delta <= 0.01, ('找不到注视目标却摆出了朝向', missing_delta)

# 5) 转身：整具骨架的世界朝向真的转过去了。
# 0917 二轮审查：原判据让转身一直开到片尾，末帧全靠 smoothstep 饱和才卡进 2° 容差——
# 缓动曲线一改就假红，等于把「到位没有」测成了「缓动曲线还是不是这条」。改成 1 秒收工：
# 末帧 t 已越过 endSec，turn_facing 走的是 `t>=endSec → facing=target` 那条路，判据与缓动
# 完全无关（容差收到 0.05°）。插值不是跳变另用首帧/中点两条严格不等式证明。
def facing_at(frame, actor_id='阿菁'):
    rig = bpy.data.objects[actor_id]
    bpy.context.scene.frame_set(frame)
    bpy.context.view_layer.update()
    return math.degrees(rig.matrix_world.to_euler().z)

spec = copy.deepcopy(BASE)
spec['actors'][0]['actions'] = [{'kind':'turn','startSec':0,'endSec':1,'facingDeg':90}]
build(spec, 'turn')
turned, start_facing, mid_facing = facing_at(48), facing_at(1), facing_at(13)
results.append({'case':'turn','endFacingDeg':round(turned,2),'startFacingDeg':round(start_facing,2),
                'midFacingDeg':round(mid_facing,2),
                'note':'动作 0→1 秒、片长 2 秒：末帧已过 endSec，判据不依赖缓动饱和'})
assert abs(((turned-90+180)%360)-180) <= 0.05, ('转身没有到达目标朝向', turned)
assert abs(start_facing) <= 0.05, ('转身在首帧就跳到目标，不是插值', start_facing)
assert 5 < mid_facing < 85, ('转身中点不在起止之间，不是连续插值', mid_facing)

# 5b) 零间隔：前一个动作的 endSec 就是后一个的 startSec。两个动作在接缝帧必须都已归零，
# 否则接缝上会叠出一个谁也没要的姿势。判据是「接缝帧姿势 == 纯 idle 姿势」，硬等式。
seam = copy.deepcopy(BASE)
seam['actors'][0]['actions'] = [{'kind':'sit','startSec':0,'endSec':1},
                                {'kind':'bow','startSec':1,'endSec':2}]
build(seam, 'zero-gap-seam')
seam_pose = [sample(b, 25) for b in ('pelvis','head','hand-1')]
control = copy.deepcopy(BASE)
control['actors'][0]['actions'] = [{'kind':'idle','startSec':0,'endSec':2}]
build(control, 'zero-gap-seam-idle-control')
seam_rest = [sample(b, 25) for b in ('pelvis','head','hand-1')]
seam_gap = max((a-b).length for a, b in zip(seam_pose, seam_rest))
results.append({'case':'zero-gap-seam','maxDeltaFromIdle':round(seam_gap,5),
                'note':'零间隔接缝帧两个动作都必须已归零'})
assert seam_gap <= 0.002, ('零间隔接缝帧叠出了残留姿势', seam_gap)
# 反例对照：同一段在动作中点必须明显不是 idle，证明上面的 0 不是因为动作压根没生效
build(seam, 'zero-gap-seam-midaction')
mid_gap = max((sample(b, 13)-r).length for b, r in zip(('pelvis','head','hand-1'), seam_rest))
results.append({'case':'zero-gap-seam-midaction','maxDeltaFromIdle':round(mid_gap,5)})
assert mid_gap >= 0.05, ('零间隔用例的动作压根没生效，接缝断言等于没测', mid_gap)

# 6) 走位：两臂在步态周期内反相摆动（idle 走同样位移时不摆臂）
spec = copy.deepcopy(BASE)
spec['actors'][0]['end'] = [1.2, 0]
spec['actors'][0]['actions'] = [{'kind':'walk','startSec':0,'endSec':2}]
build(spec, 'walk')
swings = []
for frame in range(6, 43, 3):
    front = sample('hand-1', frame)
    back = sample('hand1', frame)
    rig = bpy.data.objects['阿菁']
    swings.append(front.x-back.x)
amplitude = max(swings)-min(swings)
spec_control = copy.deepcopy(BASE)
spec_control['actors'][0]['end'] = [1.2, 0]
spec_control['actors'][0]['actions'] = [{'kind':'idle','startSec':0,'endSec':2}]
build(spec_control, 'walk-idle-control')
control_swings = [sample('hand-1', f).x - sample('hand1', f).x for f in range(6, 43, 3)]
control_amplitude = max(control_swings)-min(control_swings)
results.append({'case':'walk','swingAmplitude':round(amplitude,4),
                'idleSwingAmplitude':round(control_amplitude,4)})
assert amplitude >= 0.12, ('走位摆臂幅度不足', amplitude)
assert control_amplitude <= amplitude/3, ('反例对照失效：不摆臂的 idle 也测出了摆臂', control_amplitude, amplitude)

# 6b) 走位必须是异侧摆臂，不能同手同脚。
# 判据：同侧手与同侧脚的「前后领先量」在整个步态里必须负相关。阈值 -0.2 写死在这里；
# 把 points() 里 swing 的相位改回同相，这条会翻成 +0.35 左右而变红（0917 审查实测）。
def _pearson(xs, ys):
    mx = sum(xs)/len(xs); my = sum(ys)/len(ys)
    num = sum((a-mx)*(b-my) for a, b in zip(xs, ys))
    den = (sum((a-mx)**2 for a in xs)*sum((b-my)**2 for b in ys))**.5
    return num/den if den > 1e-9 else 0.
build(spec, 'walk-phase')
foot_lead = [sample('lower_leg-1', f).x - sample('lower_leg1', f).x for f in range(1, 25)]
hand_lead = [sample('hand-1', f).x - sample('hand1', f).x for f in range(1, 25)]
phase = _pearson(foot_lead, hand_lead)
results.append({'case':'walk-phase','pearsonFootHandLead':round(phase,4),
                'note':'同侧手脚必须反相；正相关＝同手同脚'})
assert phase <= -0.2, ('走位同手同脚：同侧手脚前后领先量正相关', phase)

# 7) 转身与分段运动轨迹是两套朝向真源：渲染层必须硬失败，不能静默按轨迹走、把转身吞掉。
clash = copy.deepcopy(BASE)
clash['actors'][0]['end'] = [.8, 0]
clash['actors'][0]['motionRoute'] = [
    {'timeSec':0,'position':[-.4,0],'facingDeg':0},
    {'timeSec':(2*24-1)/24,'position':[.8,0],'facingDeg':0}]
clash['actors'][0]['actions'] = [{'kind':'turn','startSec':0,'endSec':2,'facingDeg':180}]
raised = None
try:
    build(clash, 'turn-plus-route')
except Exception as error:
    raised = str(error)
results.append({'case':'turn-plus-route','raised':raised})
assert raised and '转身' in raised, ('转身叠轨迹没有硬失败，白模会静默不转', raised)
# 反例对照：去掉转身、只留同一条轨迹必须正常跑完，证明上面红的是转身叠加而不是轨迹本身
route_only = copy.deepcopy(clash)
route_only['actors'][0]['actions'] = []
build(route_only, 'turn-plus-route-negative-control')
results.append({'case':'turn-plus-route-negative-control','note':'同一条轨迹去掉转身可正常渲染'})

# 8) 看向正后方：目标左右穿越背后时肩线不许翻转。
# 判据是**肩线偏航的逐帧增量**（肩线向量由 points() 里 Rot(look_yaw) 直接决定），
# 阈值写死 2°/帧；反例是把淡出系数 reach 钉成 1（等于恢复「硬夹到 ±55°」的旧行为），
# 同一场必须翻出 ≥60°/帧的跳变，证明这条断言真的能红。
def head_of(bone, frame, actor_id='阿菁'):
    rig = bpy.data.objects[actor_id]
    bpy.context.scene.frame_set(frame)
    bpy.context.view_layer.update()
    return (rig.matrix_world @ rig.pose.bones[bone].head).copy()

def shoulder_yaw_deg(frame):
    """肩线相对中位的偏航。中位肩线是 +Y，look_yaw 把它绕 Z 转过去。"""
    left = head_of('upper_arm1', frame)
    right = head_of('upper_arm-1', frame)
    d = left-right
    return math.degrees(math.atan2(-d.x, d.y))

def max_step(frames):
    values = [shoulder_yaw_deg(f) for f in frames]
    return max(abs(b-a) for a, b in zip(values, values[1:])), values

behind = copy.deepcopy(BASE)
# 目标在正后方 2.6 米处由右后方划到左后方，中途精确穿过 180°
behind['actors'][1].update({'start':[-3,-.8], 'end':[-3,.8], 'moveStartSec':0, 'moveEndSec':2})
behind['actors'][0]['actions'] = [{'kind':'look','startSec':0,'endSec':2,'lookAtId':'娘'}]
build(behind, 'look-behind')
behind_step, behind_values = max_step(range(1, 49))
results.append({'case':'look-behind','maxYawStepDeg':round(behind_step,4),
                'maxAbsYawDeg':round(max(abs(v) for v in behind_values),4),
                'note':'正后方超出 GIVEUP：整段不转，逐帧增量必须≈0'})
assert behind_step <= 2., ('看向正后方时肩线逐帧跳变', behind_step)
assert max(abs(v) for v in behind_values) <= 2., ('目标在正后方却硬转了肩线', behind_values[:4])

# 反例①：同一段把淡出关掉（reach 恒为 1＝旧的硬夹 ±55°），必须红
broken = root/'TEST_ONLY-render-giveup-disabled.py'
source = script.read_text()
marker = 'reach=1-smooth((abs(desired)-LOOK_YAW_LIMIT)/(LOOK_YAW_GIVEUP-LOOK_YAW_LIMIT))'
assert source.count(marker) == 1, '反例对照失效：淡出写法已变，请同步本用例'
broken.write_text(source.replace(marker, 'reach=1.'))
build(behind, 'look-behind-giveup-disabled', broken)
broken_step, _ = max_step(range(1, 49))
results.append({'case':'look-behind-giveup-disabled','maxYawStepDeg':round(broken_step,4),
                'note':'反例：reach 恒为 1＝旧的硬夹 ±55°，肩线在正后方翻转'})
assert broken_step >= 60., ('反例对照没红：旧行为量不出正后方跳变，说明判据测不到这件事', broken_step)

# 反例②：目标在够得着的侧前方时肩线必须真的转过去，证明上面的「≈0」不是因为看向压根没生效
side = copy.deepcopy(BASE)
side['actors'][1].update({'start':[.4,1.2], 'end':[.4,1.2]})
side['actors'][0]['actions'] = [{'kind':'look','startSec':0,'endSec':2,'lookAtId':'娘'}]
build(side, 'look-side-positive-control')
side_yaw = shoulder_yaw_deg(25)
results.append({'case':'look-side-positive-control','yawDeg':round(side_yaw,3),
                'note':'侧前方目标在上限内：肩线必须真的转过去'})
assert side_yaw >= 20., ('够得着的侧向目标也没转肩线，看向整体失效', side_yaw)

# 11) 切镜首帧的注视目标必须跟着新机位走（0917 终审 1498-R1-01）
# 判据不是「头动了」，而是「注视方向与那一帧相机自己的 location 同源」——
# 只量头有没有移动的话，取到上一台机位照样会动，等于没测。
cut = copy.deepcopy(BASE)
cut['cameras'] = [
    {'startSec':0,'endSec':1,'position':[0,-5,2],'target':[0,0,1],'lens':40},
    {'startSec':1,'endSec':2,'position':[5,0,2],'target':[0,0,1],'lens':40},
]
cut['actors'][0]['actions'] = [{'kind':'look','startSec':0,'endSec':2,'lookAtId':'camera'}]
cut['actors'][1]['actions'] = []
build(cut, 'look-camera-cut')

rig = bpy.data.objects['阿菁']
def head_azimuth_and_camera(frame):
    bpy.context.scene.frame_set(frame)
    bpy.context.view_layer.update()
    head = rig.pose.bones['head']
    world = rig.matrix_world
    d = (world @ head.tail) - (world @ head.head)
    cam = bpy.data.objects['Camera'] if 'Camera' in bpy.data.objects else bpy.context.scene.camera
    return math.degrees(math.atan2(d.y, d.x)), cam.matrix_world.translation.copy()

rows = []
for frame in (24, 25, 26):
    azimuth, cam_pos = head_azimuth_and_camera(frame)
    origin = rig.matrix_world.translation
    want = math.degrees(math.atan2(cam_pos.y-origin.y, cam_pos.x-origin.x))
    rows.append({'frame':frame,'headAzimuthDeg':round(azimuth,3),
                 'cameraPos':[round(v,3) for v in cam_pos],
                 'cameraAzimuthDeg':round(want,3),
                 'deltaDeg':round(abs(((azimuth-want+180)%360)-180),3)})
results.append({'case':'look-camera-cut','rows':rows,
                'note':'注视方位与当帧相机方位同侧；切镜帧（25）必须跟新机位，不能停在旧机位'})

# 24 帧仍是旧机位、25/26 帧已是新机位——先确认夹具本身真的切镜了，否则下面的断言是空的
assert rows[0]['cameraPos'] != rows[1]['cameraPos'], ('夹具没有切镜，本用例无效', rows)
assert rows[1]['cameraPos'] == rows[2]['cameraPos'], ('切镜后机位不稳定', rows)
# 判据：切镜帧与其后一帧的注视方位必须与**当帧相机**方位一致（新机位在正前方 0°，不受 ±55° 夹取影响）。
# 不能只判「和旧机位不同」——旧机位在侧后方会被夹到 ±55°，差值天然就大，那样的断言恒真。
# 实测过：把 camera_position_at 改回 `startSec <= t <= endSec` 的旧版，下面两条会红。
assert rows[1]['deltaDeg'] <= 2, ('切镜首帧仍朝着上一台机位看', rows)
assert rows[2]['deltaDeg'] <= 2, ('切镜后第二帧的注视目标不是当帧机位', rows)
# 切镜前一帧的目标是侧后方的旧机位，会被偏航上限夹住——记下来说明夹取仍在起作用
assert rows[0]['deltaDeg'] > 20, ('切镜前一帧没有按旧机位在侧后方处理', rows)

(root/'report.json').write_text(json.dumps({'blender':bpy.app.version_string,'cases':results},
                                           ensure_ascii=False, indent=2))
print('TEST_OK', json.dumps({'blender':bpy.app.version_string,'cases':len(results)}, ensure_ascii=False))
