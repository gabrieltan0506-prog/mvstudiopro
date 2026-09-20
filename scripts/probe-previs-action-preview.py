"""用生产 Blender 场景生成动作库预览采样，不复制姿态公式。
再生：Blender --background --python scripts/probe-previs-action-preview.py -- <证据目录>
仅操作新建的基础人形场景，不读取用户模型或网络。
"""
import hashlib
import json
import math
import runpy
import sys
from pathlib import Path
import bpy
from bpy_extras.object_utils import world_to_camera_view

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'server/scripts/render-manhua-previs.py'
OUTPUT = Path(sys.argv[sys.argv.index('--') + 1]).resolve()
OUTPUT.mkdir(parents=True, exist_ok=True)
BASE = {'version': 1, 'durationSec': 2, 'aspect': '16:9',
        'actors': [{'id': 'preview-human', 'nameZh': '基础人形', 'shape': 'human',
                    'start': [0, 0], 'end': [0, 0], 'moveStartSec': 0, 'moveEndSec': 2,
                    'facingDeg': 0, 'actions': []}],
        'cameras': [{'startSec': 0, 'endSec': 2, 'position': [2, -5, 2.3],
                     'target': [0, 0, .9], 'lens': 40}]}
clips = {}
checks = {}
world_samples = {}
for kind in ('idle', 'guard', 'strike', 'bow', 'walk'):
    spec = json.loads(json.dumps(BASE))
    if kind == 'walk':
        spec['actors'][0]['start'] = [0, -.6]
        spec['actors'][0]['end'] = [0, .6]
    spec['actors'][0]['actions'] = [{'kind': kind, 'startSec': 0, 'endSec': 2}]
    folder = OUTPUT / kind
    folder.mkdir(exist_ok=True)
    spec_file = folder / 'spec.json'
    spec_file.write_text(json.dumps(spec, ensure_ascii=False, indent=2))
    sys.argv = [str(SOURCE), '--', str(spec_file), str(folder)]
    runpy.run_path(str(SOURCE), run_name='__main__')
    rig = bpy.data.objects['preview-human']
    scene = bpy.context.scene
    names = [bone.name for bone in rig.pose.bones]
    frames = []
    world_frames = []
    min_dot = 1.
    max_step = 0.
    max_step_detail = None
    for frame in range(1, 49):
        scene.frame_set(frame)
        bpy.context.view_layer.update()
        projected = []
        world = []
        for name in names:
            bone = rig.pose.bones[name]
            endpoints = [rig.matrix_world @ bone.head, rig.matrix_world @ bone.tail]
            xy = []
            for endpoint in endpoints:
                p = world_to_camera_view(scene, scene.camera, endpoint)
                assert all(math.isfinite(v) for v in (*endpoint, p.x, p.y, p.z)), (kind, frame, name, '非有限值')
                assert .03 < p.x < .97 and .03 < p.y < .97 and p.z > 0, (kind, frame, name, '出画')
                xy.extend([round(p.x * 320, 3), round((1-p.y) * 180, 3)])
            projected.append(xy)
            world.append([list(v) for v in endpoints])
            if world_frames:
                previous = world_frames[-1][len(world)-1]
                from mathutils import Vector
                old_direction = Vector(previous[1])-Vector(previous[0])
                direction = endpoints[1]-endpoints[0]
                min_dot = min(min_dot, old_direction.normalized().dot(direction.normalized()))
                step = max((endpoints[i]-Vector(previous[i])).length for i in (0, 1))
                if step > max_step:
                    max_step = step
                    max_step_detail = {'frame': frame, 'bone': name}
        frames.append(projected)
        world_frames.append(world)
    assert min_dot > 0, (kind, '相邻帧骨轴翻转', min_dot)
    # 快速出手可超过每帧25厘米；只拒绝超过整臂长的单帧位移，保留实际最大值供审片。
    assert max_step < .58, (kind, '相邻帧位移超过整臂长', max_step)
    clips[kind] = {'bones': names, 'frames': frames}
    checks[kind] = {'framesChecked': 48, 'bones': len(names), 'finite': True, 'insideCamera': True,
                    'minAdjacentBoneDirectionDot': min_dot, 'maxWorldStepMeters': max_step,
                    'maxStepAt': max_step_detail, 'uniqueFrames': len({json.dumps(f) for f in frames})}
    world_samples[kind] = world_frames
    (folder / 'world-frames.json').write_text(json.dumps(world_frames))
assert checks['idle']['uniqueFrames'] == 1
for kind in ('guard', 'strike', 'bow'):
    bone = 'head' if kind == 'bow' else 'hand-1'
    index = clips[kind]['bones'].index(bone)
    from mathutils import Vector
    rest = Vector(world_samples['idle'][0][index][1])
    delta = max((Vector(frame[index][1])-rest).length for frame in world_samples[kind])
    assert delta > .15, (kind, '相对待机没有明显动作', delta)
    checks[kind]['maxDeltaFromIdleMeters'] = delta
source_files = {str(SOURCE.relative_to(ROOT)): hashlib.sha256(SOURCE.read_bytes()).hexdigest()}
for module in list(sys.modules.values()):
    filename = getattr(module, '__file__', None)
    if filename:
        path = Path(filename).resolve()
        if path.suffix == '.py' and path.is_relative_to(ROOT / 'server/scripts'):
            source_files[str(path.relative_to(ROOT))] = hashlib.sha256(path.read_bytes()).hexdigest()
data = {'fps': 24, 'durationSec': 2, 'width': 320, 'height': 180, 'sourceFiles': source_files, 'clips': clips}
(OUTPUT / 'samples.json').write_text(json.dumps(data, ensure_ascii=False))
(OUTPUT / 'frame-checks.json').write_text(json.dumps(checks, ensure_ascii=False, indent=2))
target = ROOT / 'client/src/components/canvas/ManhuaPrevisActionPreview.samples.ts'
target.write_text('/** 由生产 Blender 骨架逐帧采样生成；再生见 scripts/probe-previs-action-preview.py。不得手编动作数据。 */\n'
                  + 'export const PREVIS_ACTION_PREVIEW_SAMPLES = ' + json.dumps(data, ensure_ascii=False, separators=(',', ':')) + ';\n')
print(json.dumps({'generated': str(target), 'checks': checks}, ensure_ascii=False))
