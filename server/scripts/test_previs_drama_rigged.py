"""0917 PR-E 三轮审查：文戏动作在**真实带骨模型**上的离线验收。

test_previs_drama_actions.py 只量棍人。棍人对了不等于真模对了：retarget_from_source
只烘旋转、骨盆位移按身高比例缩放，身材与棍人不同时落座高度/脚底接触会偏。这里自造两个
不同身高（1.0 倍 / 1.5 倍棍人身高）的带骨夹具，实跑 sit / bow / look，量可证伪的量：

  ① 骨盆下沉是否**与身高成比例**（反例：把 previs_rigged_model 的比例缩放钉成 1，必须红）
  ② 坐下时**脚底相对站立的升降**（离地/穿地多少米），阈值写死
  ③ 膝关节朝向与源棍人同号且明显弯曲（反例：绝不允许反向顶出）

实测结论（本机 Blender，两具夹具）：**带骨真模坐下会穿地**。棍人的静止姿态腿本来就屈着
31.3°（站位 IK 的结果），真模的静止姿态腿是直的，重定向只传「相对各自静止姿态的旋转增量」，
于是只传过去 28.3°，腿够不着地：1.7 米模型 −21.4 厘米、2.55 米模型 −32.2 厘米，与身高成正比。
因此坐下在提交 schema 与渲染层两处对带骨角色**直接拒绝**；本脚本既验拒绝，也在去掉门禁的
副本里把真实穿地深度量出来留档——不量就等于拿免责声明代替判据。走位实测抬脚残差 ≤2.0 厘米、
不穿地，行礼/指向/看向按身高等比转移，均照常放行。

运行：blender -b --factory-startup --python-exit-code 1 --python 此脚本 -- 输出目录
不联网、不渲染视频；夹具 GLB、spec、report 全部保留在输出目录供复核。
夹具是仅测试用的几何体，绝非已验收人物资产。
"""
import copy
import hashlib
import json
import math
from pathlib import Path
import runpy
import shutil
import sys
import bpy
from mathutils import Vector

arguments = sys.argv[sys.argv.index('--')+1:]
root = Path(arguments[0])
root.mkdir(parents=True, exist_ok=True)
scripts_dir = Path(__file__).resolve().parent
renderer = scripts_dir/'render-manhua-previs.py'

# 身高：A = 1.0 倍、B = 1.5 倍。1.5 正是「身材与棍人不同」这条边界要压的倍数。
HEIGHT_A, HEIGHT_B = 1.70, 2.55
results = []
notes = []


# ---------------------------------------------------------------- 夹具
def rest_points():
    p = {'pelvis': ((0, 0, .85), (0, 0, .95)), 'spine': ((0, 0, .95), (0, 0, 1.35)),
         'neck': ((0, 0, 1.35), (0, 0, 1.5)), 'head': ((0, 0, 1.5), (0, 0, 1.75))}
    for side in (-1, 1):
        s = str(side)
        p.update({'upper_arm'+s: ((0, side*.2, 1.35), (0, side*.5, 1.35)),
                  'forearm'+s: ((0, side*.5, 1.35), (0, side*.8, 1.35)),
                  'hand'+s: ((0, side*.8, 1.35), (0, side*.9, 1.35)),
                  'upper_leg'+s: ((0, side*.14, .85), (0, side*.14, .46)),
                  'lower_leg'+s: ((0, side*.14, .46), (0, side*.14, .08)),
                  'foot'+s: ((0, side*.14, .08), (.18, side*.14, .08))})
    return p


def export_fixture(path):
    """自造一套 16 骨 + 实际蒙皮网格并导出 GLB。只用于测试。"""
    import previs_rigged_model as prm
    for existing in list(bpy.data.objects):
        bpy.data.objects.remove(existing, do_unlink=True)
    points = rest_points()
    data = bpy.data.armatures.new('TEST_ONLY_骨架')
    rig = bpy.data.objects.new('TEST_ONLY_骨架', data)
    bpy.context.scene.collection.objects.link(rig)
    bpy.ops.object.select_all(action='DESELECT')
    rig.select_set(True)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode='EDIT')
    for name, (head, tail) in points.items():
        bone = data.edit_bones.new(name)
        bone.head, bone.tail = head, tail
    for child, parent in prm.PARENTS.items():
        data.edit_bones[child].parent = data.edit_bones[parent]
    bpy.ops.object.mode_set(mode='OBJECT')
    vertices, faces, groups = [], [], {}
    for name, (head, tail) in points.items():
        center = (Vector(head)+Vector(tail))/2
        begin = len(vertices)
        # 刻意不对称：任何一根骨转错都能在网格上量出来
        for x, y, z in ((-.05, -.03, -.04), (.08, -.03, -.04), (.08, .03, -.04), (-.05, .03, -.04),
                        (-.05, -.03, .04), (.08, -.03, .04), (.08, .03, .04), (-.05, .03, .04)):
            vertices.append(tuple(center+Vector((x, y, z))))
        groups[name] = list(range(begin, begin+8))
        faces.extend(tuple(begin+v for v in face)
                     for face in ((0, 1, 2, 3), (4, 7, 6, 5), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)))
    mesh_data = bpy.data.meshes.new('TEST_ONLY_几何体')
    mesh_data.from_pydata(vertices, [], faces)
    obj = bpy.data.objects.new('TEST_ONLY_角色', mesh_data)
    bpy.context.scene.collection.objects.link(obj)
    for name, indexes in groups.items():
        obj.vertex_groups.new(name=name).add(indexes, 1.0, 'REPLACE')
    modifier = obj.modifiers.new('真实蒙皮', 'ARMATURE')
    modifier.object = rig
    obj.parent = rig
    bpy.ops.object.select_all(action='DESELECT')
    rig.select_set(True)
    obj.select_set(True)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.export_scene.gltf(filepath=str(path), export_format='GLB',
                              use_selection=True, export_animations=False)
    for existing in list(bpy.data.objects):
        bpy.data.objects.remove(existing, do_unlink=True)


sys.path.insert(0, str(scripts_dir))
fixture_a = root/'TEST_ONLY-drama-rigged-a.glb'
fixture_b = root/'TEST_ONLY-drama-rigged-b.glb'
export_fixture(fixture_a)
shutil.copyfile(fixture_a, fixture_b)


# ---------------------------------------------------------------- 场景
BASE = {'version': 1, 'durationSec': 2, 'aspect': '16:9',
        'actors': [{'id': '矮个', 'nameZh': '矮个', 'shape': 'human', 'assetRef': 'TEST_ONLY-char-a',
                    'start': [-1.1, 0], 'end': [-1.1, 0], 'moveStartSec': 0, 'moveEndSec': 2,
                    'facingDeg': 0, 'actions': [],
                    'riggedModel': {'sourceJobId': 'm3d_TEST_ONLY_a', 'forwardAxis': '+X',
                                    'targetHeight': HEIGHT_A}},
                   {'id': '高个', 'nameZh': '高个', 'shape': 'human', 'assetRef': 'TEST_ONLY-char-b',
                    'start': [1.1, 0], 'end': [1.1, 0], 'moveStartSec': 0, 'moveEndSec': 2,
                    'facingDeg': 0, 'actions': [],
                    'riggedModel': {'sourceJobId': 'm3d_TEST_ONLY_b', 'forwardAxis': '+X',
                                    'targetHeight': HEIGHT_B}}],
        'cameras': [{'startSec': 0, 'endSec': 2, 'position': [4, -11, 3.2], 'target': [0, 0, 1.3],
                     'lens': 35}]}
FIXTURES = {'矮个': fixture_a, '高个': fixture_b}


def build(spec, label, renderer_path=None):
    folder = root/label
    folder.mkdir(exist_ok=True)
    manifest = []
    for actor in spec['actors']:
        local = folder/(actor['id']+'.glb')
        shutil.copyfile(FIXTURES[actor['id']], local)
        raw = local.read_bytes()
        manifest.append({'actorId': actor['id'], 'localPath': str(local),
                         'sha256': hashlib.sha256(raw).hexdigest(), 'bytes': len(raw),
                         'sourceJobId': actor['riggedModel']['sourceJobId']})
    (folder/'spec.json').write_text(json.dumps(spec, ensure_ascii=False, indent=2))
    (folder/'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2))
    script = Path(renderer_path or renderer)
    sys.argv = [str(script), '--', str(folder/'spec.json'), str(folder), str(folder/'manifest.json')]
    runpy.run_path(str(script), run_name='__main__')
    return json.loads((folder/'report.json').read_text())


def with_actions(label, actions_by_actor, renderer_path=None):
    spec = copy.deepcopy(BASE)
    for actor in spec['actors']:
        actor['actions'] = copy.deepcopy(actions_by_actor.get(actor['id'], []))
    return build(spec, label, renderer_path)


def at(frame):
    bpy.context.scene.frame_set(frame)
    bpy.context.view_layer.update()


def target_rig(actor_id):
    return bpy.data.objects[actor_id+'_角色骨架']


def bone_head(rig, name, frame):
    at(frame)
    return (rig.matrix_world @ rig.pose.bones[name].head).copy()


def bone_tail(rig, name, frame):
    at(frame)
    return (rig.matrix_world @ rig.pose.bones[name].tail).copy()


def mesh_min_z(actor_id, frame):
    """真实蒙皮网格的最低点。脚底接不接地只能量网格，不能拿骨骼中轴线代替。"""
    at(frame)
    rig = target_rig(actor_id)
    graph = bpy.context.evaluated_depsgraph_get()
    lowest = None
    for obj in rig.children:
        if obj.type != 'MESH':
            continue
        evaluated = obj.evaluated_get(graph)
        data = evaluated.to_mesh()
        try:
            for vertex in data.vertices:
                z = (evaluated.matrix_world @ vertex.co).z
                lowest = z if lowest is None else min(lowest, z)
        finally:
            evaluated.to_mesh_clear()
    if lowest is None:
        raise AssertionError('取不到带骨网格顶点：' + actor_id)
    return lowest


def source_height(actor_id):
    rig = bpy.data.objects[actor_id]
    return (max(b.tail_local.z for b in rig.data.bones)
            - min(b.head_local.z for b in rig.data.bones))


# ---------------------------------------------------------------- ① 站立基线
idle_report = with_actions('idle-control', {'矮个': [{'kind': 'idle', 'startSec': 0, 'endSec': 2}],
                                            '高个': [{'kind': 'idle', 'startSec': 0, 'endSec': 2}]})
assert idle_report['models'] and len(idle_report['models']) == 2, '两个带骨模型没有全部进入报告'
stick_height = {a: source_height(a) for a in ('矮个', '高个')}
scale = {'矮个': HEIGHT_A/stick_height['矮个'], '高个': HEIGHT_B/stick_height['高个']}
idle_pelvis = {a: bone_head(target_rig(a), 'pelvis', 25).z for a in ('矮个', '高个')}
idle_stick_pelvis = {a: bone_head(bpy.data.objects[a], 'pelvis', 25).z for a in ('矮个', '高个')}
idle_floor = {a: mesh_min_z(a, 25) for a in ('矮个', '高个')}
results.append({'case': 'idle-baseline', 'stickHeight': {k: round(v, 4) for k, v in stick_height.items()},
                'targetHeight': {'矮个': HEIGHT_A, '高个': HEIGHT_B},
                'heightScale': {k: round(v, 4) for k, v in scale.items()},
                'idlePelvisZ': {k: round(v, 4) for k, v in idle_pelvis.items()},
                'idleMeshFloorZ': {k: round(v, 4) for k, v in idle_floor.items()}})
# 身高倍数必须真的是 1.5 倍，否则下面「按身高成比例」的判据是拿两个同高模型自证
assert abs(scale['高个']/scale['矮个'] - 1.5) <= 0.001, ('夹具身高倍数不是 1.5', scale)


# ---------------------------------------------------------------- ② 坐下
def measure_sit(label, renderer_path=None):
    with_actions(label, {'矮个': [{'kind': 'sit', 'startSec': 0, 'endSec': 2}],
                         '高个': [{'kind': 'sit', 'startSec': 0, 'endSec': 2}]}, renderer_path)
    row = {}
    for actor_id in ('矮个', '高个'):
        rig = target_rig(actor_id)
        stick = bpy.data.objects[actor_id]
        knee = bone_head(rig, 'lower_leg-1', 25)
        hip = bone_head(rig, 'upper_leg-1', 25)
        ankle = bone_tail(rig, 'lower_leg-1', 25)
        stick_knee = bone_head(stick, 'lower_leg-1', 25)
        stick_hip = bone_head(stick, 'upper_leg-1', 25)
        stick_ankle = bone_tail(stick, 'lower_leg-1', 25)
        row[actor_id] = {
            'pelvisSink': bone_head(rig, 'pelvis', 25).z - idle_pelvis[actor_id],
            'stickPelvisSink': bone_head(stick, 'pelvis', 25).z - idle_stick_pelvis[actor_id],
            'floorShift': mesh_min_z(actor_id, 25) - idle_floor[actor_id],
            'meshFloorZ': mesh_min_z(actor_id, 25),
            # 膝盖相对髋—踝连线的前后量（+ = 向前顶出，正确；− = 反关节）
            'kneeForward': knee.x - (hip.x+ankle.x)/2,
            'stickKneeForward': stick_knee.x - (stick_hip.x+stick_ankle.x)/2,
        }
    return row


# ②-0 提交与渲染两处都必须**拒绝**带骨角色坐下（穿地实测见下）。
sit_rejected = None
try:
    with_actions('sit-must-be-rejected', {'矮个': [{'kind': 'sit', 'startSec': 0, 'endSec': 2}]})
except Exception as error:
    sit_rejected = str(error)
results.append({'case': 'sit-rigged-rejected', 'raised': sit_rejected})
# 反例对照：同一场去掉坐下必须跑得通，证明红的是坐下门禁而不是这个场景本身
with_actions('sit-rejected-negative-control', {'矮个': [{'kind': 'idle', 'startSec': 0, 'endSec': 2}]})

# ②-A 门禁拦掉之后，穿地到底有多深还是要量出来并留档——不量就等于拿免责声明代替判据。
# 在输出目录的**副本**里去掉门禁（server/scripts 原文件一个字节不动），跑同一场量真实数值。
def patched_scripts(label, replacements):
    folder = root/label
    if folder.exists():
        shutil.rmtree(folder)
    shutil.copytree(scripts_dir, folder, ignore=shutil.ignore_patterns('test_*', '__pycache__'))
    for filename, marker, patch in replacements:
        target = folder/filename
        text = target.read_text()
        assert text.count(marker) == 1, '反例对照失效，写法已变，请同步本用例：'+marker
        target.write_text(text.replace(marker, patch))
    return folder


def run_with(folder, runner):
    for name in [n for n in list(sys.modules) if n.startswith('previs_')]:
        del sys.modules[name]
    sys.path.insert(0, str(folder))
    try:
        return runner(folder/'render-manhua-previs.py')
    finally:
        sys.path.remove(str(folder))
        for name in [n for n in list(sys.modules) if n.startswith('previs_')]:
            del sys.modules[name]


SIT_GATE = "        raise ValueError('带骨角色暂不支持坐下：静止姿态差会让脚穿地（1.70 米约 21 厘米），待重定向补偿后开放（PR-F）；棍人角色可以坐下，带骨角色的看向/转身/行礼不受影响')"
SIT_GATE_OFF = "        pass  # TEST_ONLY 去掉门禁，只为量出真实穿地深度"
nogate = patched_scripts('TEST_ONLY-sit-gate-off-scripts',
                         [('render-manhua-previs.py', SIT_GATE, SIT_GATE_OFF)])
sit = run_with(nogate, lambda renderer_path: measure_sit('sit-gate-off-measured', renderer_path))
for actor_id in ('矮个', '高个'):
    r = sit[actor_id]
    # 「严格按可见身高等比」的理想值。真实实现按**骨骼跨度**比缩放（mesh 包围盒比骨骼端点跨度
    # 高出网格半厚），所以会系统性偏浅一点点；偏多少由下面的断言写死上限，不粉饰。
    r['visualScale'] = scale[actor_id]
    r['idealPelvisSink'] = r['stickPelvisSink']*scale[actor_id]
    r['sinkShortfallRatio'] = r['pelvisSink']/r['idealPelvisSink']
results.append({'case': 'sit', **{k: {n: round(v, 5) for n, v in r.items()} for k, r in sit.items()}})
sink_ratio = sit['高个']['pelvisSink']/sit['矮个']['pelvisSink']
results.append({'case': 'sit-proportional', 'sinkRatio': round(sink_ratio, 5),
                'note': '两个夹具几何完全相同、只差 1.5 倍身高：下沉量之比必须正好 1.5'})

# ---------------------------------------------------------------- ③ 反例对照：把比例缩放改坏
# 只在输出目录下的**副本**里改，server/scripts 原文件一个字节都不动；改坏之后上面的比例判据必须红。
RATIO_MARKER = '    ratio = target_height / max(source_height, .00001)'
broken_dir = patched_scripts('TEST_ONLY-broken-ratio-scripts', [
    ('render-manhua-previs.py', SIT_GATE, SIT_GATE_OFF),
    ('previs_rigged_model.py', RATIO_MARKER, '    ratio = 1.0  # TEST_ONLY 反例：故意去掉身高比例缩放')])
broken = run_with(broken_dir, lambda renderer_path: measure_sit('sit-broken-ratio-negative-control', renderer_path))
broken_ratio = broken['高个']['pelvisSink']/broken['矮个']['pelvisSink']
results.append({'case': 'sit-broken-ratio-negative-control', 'sinkRatio': round(broken_ratio, 5),
                'pelvisSink': {k: round(v['pelvisSink'], 5) for k, v in broken.items()},
                'note': '比例缩放钉成 1 时两个模型下沉量相同，下沉比≈1，上面的 1.5 倍判据必须红'})

# ---------------------------------------------------------------- ③-B 走位：脚必须踩在地上
walk_spec = copy.deepcopy(BASE)
for _a in walk_spec['actors']:
    _a['end'] = [_a['start'][0]+1.6, _a['start'][1]]
    _a['actions'] = [{'kind': 'walk', 'startSec': 0, 'endSec': 2}]
build(walk_spec, 'walk')
walk_floor = {a: [mesh_min_z(a, f) for f in range(1, 49)] for a in ('矮个', '高个')}
results.append({'case': 'walk-foot-contact',
                'minFloorZ': {k: round(min(v), 5) for k, v in walk_floor.items()},
                'maxFloorZ': {k: round(max(v), 5) for k, v in walk_floor.items()},
                'note': '走位不改髋高，只有抬脚残差；穿地为负，实测必须≥-0.5 厘米'})

# ---------------------------------------------------------------- ④ 行礼
with_actions('bow', {'矮个': [{'kind': 'bow', 'startSec': 0, 'endSec': 2}],
                     '高个': [{'kind': 'bow', 'startSec': 0, 'endSec': 2}]})
bow = {a: bone_tail(target_rig(a), 'head', 25) for a in ('矮个', '高个')}
with_actions('bow-idle-control', {'矮个': [{'kind': 'idle', 'startSec': 0, 'endSec': 2}],
                                  '高个': [{'kind': 'idle', 'startSec': 0, 'endSec': 2}]})
idle_head = {a: bone_tail(target_rig(a), 'head', 25) for a in ('矮个', '高个')}
bow_forward = {a: bow[a].x-idle_head[a].x for a in ('矮个', '高个')}
bow_drop = {a: bow[a].z-idle_head[a].z for a in ('矮个', '高个')}
bow_ratio = bow_forward['高个']/bow_forward['矮个']
results.append({'case': 'bow', 'headForward': {k: round(v, 5) for k, v in bow_forward.items()},
                'headDrop': {k: round(v, 5) for k, v in bow_drop.items()},
                'forwardRatio': round(bow_ratio, 5),
                'note': '行礼是纯旋转：头前移量必须与身高同比例放大'})

# ---------------------------------------------------------------- ⑤ 看向
look_spec = copy.deepcopy(BASE)
look_spec['actors'][1]['start'] = look_spec['actors'][1]['end'] = [1.1, 1.6]
look_spec['actors'][0]['actions'] = [{'kind': 'look', 'startSec': 0, 'endSec': 2, 'lookAtId': '高个'}]
build(look_spec, 'look')


def shoulder_yaw(actor_id):
    d = bone_head(target_rig(actor_id), 'upper_arm1', 25)-bone_head(target_rig(actor_id), 'upper_arm-1', 25)
    return math.degrees(math.atan2(-d.x, d.y))


def stick_head_tilt(actor_id):
    rig = bpy.data.objects[actor_id]
    d = bone_tail(rig, 'head', 25)-bone_head(rig, 'head', 25)
    return math.degrees(math.atan2(d.y, d.x)), math.hypot(d.x, d.y), d.length


def head_tilt(actor_id):
    """头骨的水平倾角与幅度。重定向只烘旋转，所以能量到的是骨向，不是肩点位移。"""
    rig = target_rig(actor_id)
    d = bone_tail(rig, 'head', 25)-bone_head(rig, 'head', 25)
    return math.degrees(math.atan2(d.y, d.x)), math.hypot(d.x, d.y)


look_head_deg, look_head_mag = head_tilt('矮个')
stick_head_deg, stick_head_mag, stick_head_len = stick_head_tilt('矮个')
target_head_len = (bone_tail(target_rig('矮个'), 'head', 25)-bone_head(target_rig('矮个'), 'head', 25)).length
look_shoulder_yaw = shoulder_yaw('矮个')
look_control = copy.deepcopy(look_spec)
look_control['actors'][0]['actions'] = [{'kind': 'idle', 'startSec': 0, 'endSec': 2}]
build(look_control, 'look-idle-control')
idle_head_deg, idle_head_mag = head_tilt('矮个')
idle_shoulder_yaw = shoulder_yaw('矮个')
# 目标相对 矮个 的真实方位：+X 2.2 米、+Y 1.6 米
expected_deg = math.degrees(math.atan2(1.6, 2.2))
results.append({'case': 'look',
                'headAzimuthDeg': round(look_head_deg, 4), 'headXYLength': round(look_head_mag, 5),
                'idleHeadXYLength': round(idle_head_mag, 5),
                'expectedAzimuthDeg': round(expected_deg, 4),
                'shoulderYawDeltaDeg': round(look_shoulder_yaw-idle_shoulder_yaw, 4),
                'stickHeadAzimuthDeg': round(stick_head_deg, 4),
                'stickHeadTiltDeg': round(math.degrees(math.asin(min(1., stick_head_mag/stick_head_len))), 4),
                'modelHeadTiltDeg': round(math.degrees(math.asin(min(1., look_head_mag/target_head_len))), 4),
                'note': '真模看向只有头骨真的转过去；棍人那份「肩线跟着转」是**位置**偏移，'
                        '重定向只烘旋转，肩线偏转在真模上必然是 0——这是边界，已写进回执 boundaryZh'})

# ---------------------------------------------------------------- 先落档，再判定
# 判据红不红都要把真实数值写下来：宁可报「真模落座偏浅 X 厘米」，也不要粉饰。
(root/'report.json').write_text(json.dumps(
    {'blender': bpy.app.version_string, 'cases': results, 'notes': notes},
    ensure_ascii=False, indent=2))

failures = []


def expect(condition, label, *values):
    if not condition:
        failures.append((label, [round(v, 5) if isinstance(v, float) else v for v in values]))


expect(sit_rejected is not None and '坐下' in sit_rejected,
       '带骨角色坐下没有被拒绝：会渲出一个脚在地里的片子', sit_rejected)
for actor_id in ('矮个', '高个'):
    r = sit[actor_id]
    # ②-1 坐下必须真的坐下去
    expect(r['pelvisSink'] <= -0.15, '坐下骨盆没有明显下沉：'+actor_id, r['pelvisSink'])
    # ②-2 与「严格按可见身高等比」的偏差：实测系统性偏浅，上限写死 5%（1.7 米角色约 1.6 厘米）
    expect(0.95 <= r['sinkShortfallRatio'] <= 1.0,
           '落座深度偏离等比超过 5%：'+actor_id, r['sinkShortfallRatio'], r['pelvisSink'], r['idealPelvisSink'])
    # ②-3 膝盖必须向前顶、且与源棍人同号（负号＝反关节）
    expect(r['stickKneeForward'] > 0.02, '源棍人自己就没把膝盖顶出来，判据失去参照：'+actor_id, r['stickKneeForward'])
    expect(r['kneeForward'] > 0.02, '真模膝关节没有前顶或已反向：'+actor_id, r['kneeForward'])
    expect(r['kneeForward']*r['stickKneeForward'] > 0, '真模膝关节与棍人反向：'+actor_id,
           r['kneeForward'], r['stickKneeForward'])
    # ②-4 脚底：坐下相对自己站立的升降。实测**会穿地**——阈值按实测边界写死并写进回执边界，
    # 不允许悄悄放宽；真模身材与棍人不同时这项必须人工复核。
    # ②-4 脚底：实测**会穿地**，深度与身高成正比。这条不是「应该是 0」，而是把已知的坏
    # 值钉死：门禁一旦被误删、或落脚校正上线后穿地消失，这条都会红，逼着同步门禁与边界文案。
    expect(-0.66*abs(r['pelvisSink']) >= r['floorShift'] >= -0.72*abs(r['pelvisSink']),
           '带骨坐下的穿地深度变了：请同步坐下门禁与回执 boundaryZh 的实测数值：'+actor_id,
           r['floorShift'], r['pelvisSink'], r['floorShift']/abs(r['pelvisSink']))
expect(abs(sink_ratio-1.5) <= 0.01, '高个的下沉量不是矮个的 1.5 倍', sink_ratio)
expect(abs(broken_ratio-1.5) > 0.05, '反例对照没红：去掉比例缩放后下沉比仍是 1.5', broken_ratio)
for actor_id in ('矮个', '高个'):
    expect(bow_forward[actor_id] >= 0.15*scale[actor_id], '真模行礼前倾不足：'+actor_id, bow_forward[actor_id])
    expect(bow_drop[actor_id] <= -0.05, '真模行礼头没有下沉：'+actor_id, bow_drop[actor_id])
expect(abs(bow_ratio-1.5) <= 0.01, '行礼前倾量没有按身高同比例放大', bow_ratio)
for actor_id in ('矮个', '高个'):
    expect(min(walk_floor[actor_id]) >= -0.005, '走位时脚穿地：'+actor_id, min(walk_floor[actor_id]))
    expect(max(walk_floor[actor_id]) <= 0.03, '走位抬脚残差过大：'+actor_id, max(walk_floor[actor_id]))
    expect(max(walk_floor[actor_id]) >= 0.005, '走位压根没抬脚，反例对照失效：'+actor_id, max(walk_floor[actor_id]))
# 看向：头骨必须真的朝目标方位转过去（方位误差 3°），idle 反例的水平分量必须≈0
expect(look_head_mag >= 0.03, '真模看向的头骨没有水平偏转', look_head_mag)
expect(idle_head_mag <= 0.005, '反例对照失效：idle 的头骨也有水平偏转', idle_head_mag)
expect(abs(((look_head_deg-expected_deg+180) % 360)-180) <= 3.,
       '真模看向的头骨方位没有指向目标', look_head_deg, expected_deg)
# 肩线在真模上必然不转：写成硬等式，将来哪天真做了上身重定向，这条会红并提醒同步边界文案
expect(abs(look_shoulder_yaw-idle_shoulder_yaw) <= 0.01,
       '真模肩线居然转了：上身重定向已变，请同步回执 boundaryZh 与本用例',
       look_shoulder_yaw-idle_shoulder_yaw)

if failures:
    raise AssertionError(json.dumps(failures, ensure_ascii=False, indent=2))
print('TEST_OK', json.dumps({'blender': bpy.app.version_string, 'cases': len(results)}, ensure_ascii=False))
