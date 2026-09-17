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

def build(spec, label):
    folder = root/label
    folder.mkdir(exist_ok=True)
    source = folder/'spec.json'
    source.write_text(json.dumps(spec, ensure_ascii=False, indent=2))
    sys.argv = [str(script), '--', str(source), str(folder)]
    runpy.run_path(str(script), run_name='__main__')
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

# 5) 转身：整具骨架的世界朝向真的转过去了
spec = copy.deepcopy(BASE)
spec['actors'][0]['actions'] = [{'kind':'turn','startSec':0,'endSec':2,'facingDeg':90}]
build(spec, 'turn')
rig = bpy.data.objects['阿菁']
bpy.context.scene.frame_set(48)
bpy.context.view_layer.update()
turned = math.degrees(rig.matrix_world.to_euler().z)
results.append({'case':'turn','endFacingDeg':round(turned,2)})
assert abs(((turned-90+180)%360)-180) <= 2, ('转身没有到达目标朝向', turned)
bpy.context.scene.frame_set(1)
bpy.context.view_layer.update()
start_facing = math.degrees(rig.matrix_world.to_euler().z)
assert abs(start_facing) <= 2, ('转身在首帧就跳到目标，不是插值', start_facing)

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

(root/'report.json').write_text(json.dumps({'blender':bpy.app.version_string,'cases':results},
                                           ensure_ascii=False, indent=2))
print('TEST_OK', json.dumps({'blender':bpy.app.version_string,'cases':len(results)}, ensure_ascii=False))
