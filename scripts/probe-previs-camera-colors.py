"""直接运行生产场景，核对逐帧相机与视线位置、四色材质，另渲染首中末帧。"""
import json
import math
import runpy
import sys
from pathlib import Path
import bpy

root = Path(__file__).resolve().parents[1]
folder = Path(sys.argv[sys.argv.index('--') + 1]).resolve()
source = root / 'server/scripts/render-manhua-previs.py'
sys.argv = [str(source), '--', str(folder / 'spec.json'), str(folder)]
scope = runpy.run_path(str(source), run_name='__main__')
scene = bpy.context.scene
camera = scene.camera
samples = []
for frame in range(1, scene.frame_end + 1):
    scene.frame_set(frame)
    expected = scope['camera_position_at']((frame - 1) / 24)
    assert (camera.location - expected).length < 1e-5, (frame, list(camera.location), list(expected))
    samples.append(list(camera.location))
    for shot in scope['spec']['cameras']:
        if shot.get('orbitDeg') is not None and math.floor(shot['startSec']*24+.5)+1 <= frame <= math.floor(shot['endSec']*24+.5):
            radius = math.hypot(shot['position'][0]-shot['target'][0],shot['position'][1]-shot['target'][1])
            assert abs(math.hypot(camera.location.x-shot['target'][0],camera.location.y-shot['target'][1])-radius)<1e-5
assert samples[0] != samples[-1]
colors = [list(bpy.data.materials[actor['nameZh']].diffuse_color) for actor in scope['spec']['actors']]
assert len({tuple(color) for color in colors}) == 4
for frame in (1, 24, 48):
    scene.frame_set(frame)
    scene.render.filepath = str(folder / f'frame-{frame}.png')
    bpy.ops.render.render(write_still=True)
(folder / 'camera-colors-probe.json').write_text(json.dumps({'framesChecked':len(samples), 'positions':samples, 'colors':colors, 'boundaryZh':'验证位置与材质，不等于动作逐帧视觉验收'}, ensure_ascii=False, indent=2))
print('CAMERA_COLORS_PROBE_PASS')
