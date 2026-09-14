"""本地真实出水场景验收；不渲染、不调用上游，保留完整场景与失败报告。"""
import copy
import json
import runpy
import sys
from pathlib import Path
import bpy
from mathutils import Vector
from bpy_extras.object_utils import world_to_camera_view

args = sys.argv[sys.argv.index('--')+1:]
source, out = Path(args[0]), Path(args[1])
out.mkdir(parents=True, exist_ok=True)
base = json.loads(source.read_text())
renderer = Path(__file__).with_name('render-manhua-previs.py')


def build(spec, name):
    folder = out/name
    folder.mkdir(exist_ok=True)
    src = folder/'spec.json'
    src.write_text(json.dumps(spec, ensure_ascii=False, indent=2))
    sys.argv = [str(renderer), '--', str(src), str(folder)]
    result = runpy.run_path(str(renderer), run_name='__main__')
    return folder, result


receipts = []
# 输入必须含真实shared契约导出的配置，两种节奏只改crossSec。
for mode in ('simultaneous', 'staggered'):
    spec = copy.deepcopy(base)
    water = spec['waterEmergence']
    water['mode'] = mode
    for i, event in enumerate(water['events']):
        event['crossSec'] = 1.0+(i*.25 if mode == 'staggered' else 0.)
    folder, state = build(spec, mode)
    report = json.loads((folder/'report.json').read_text())['waterEmergence']
    assert report['mode'] == mode
    assert report['preset'] == 'geometric_splash_v1'
    assert not report['overlaps'] and not report['offscreenFrames']
    bpy.ops.wm.open_mainfile(filepath=str(folder/'scene.blend'))
    scene = bpy.context.scene
    maximum_error = 0.
    saved_vertices = []
    for row, event in zip(report['events'], water['events']):
        assert row['actorId'] == event['actorId']
        assert len(row['samples']) == scene.frame_end
        assert row['crossFrame'] == round(event['crossSec']*24)+1
        rig = bpy.data.objects[row['actorId']]
        obj = bpy.data.objects[row['actorId']+'_独立冲击浪']
        assert len(obj.data.vertices) > 100
        assert len([o for o in scene.objects if o.name.startswith(row['actorId']+'_独立冲击浪')]) == 1
        for sample in row['samples']:
            frame = sample['frame']
            scene.frame_set(frame)
            bpy.context.view_layer.update()
            head = rig.matrix_world @ rig.pose.bones['head'].tail
            maximum_error = max(maximum_error, (head-Vector(sample['head'])).length)
            assert (rig.matrix_world.translation-Vector(sample['root'])).length < 1e-5
            if frame < row['crossFrame']:
                assert head.z < 0
            elif frame == row['crossFrame']:
                assert abs(head.z) < 1e-5
            if (frame-1)/24 >= event['crossSec']+event['riseSec']:
                assert abs(rig.matrix_world.translation.z-event['height']) < 1e-5
            start_frame = round(event['crossSec']*24)+1
            expected_active = start_frame <= frame < start_frame+round(event['waveDurationSec']*24)
            assert sample['active'] == expected_active
            if not expected_active:
                assert sample['worldBounds'] is None and sample['screenBounds'] is None
                continue
            evaluated = obj.evaluated_get(bpy.context.evaluated_depsgraph_get())
            mesh = evaluated.to_mesh()
            try:
                points = [evaluated.matrix_world @ v.co for v in mesh.vertices]
                projected = [world_to_camera_view(scene, scene.camera, p) for p in points]
                for key, actual, dimensions in (('worldBounds', points, 3), ('screenBounds', projected, 2)):
                    for axis in range(dimensions):
                        assert abs(min(p[axis] for p in actual)-sample[key]['min'][axis]) < 1e-5
                        assert abs(max(p[axis] for p in actual)-sample[key]['max'][axis]) < 1e-5
                saved_vertices.append({'actorId': row['actorId'], 'frame': frame, 'vertices': [list(p) for p in points]})
            finally:
                evaluated.to_mesh_clear()
    assert maximum_error < 1e-5
    (folder/'restored-mesh-vertices.json').write_text(json.dumps(saved_vertices))
    # 移动真实水花网格至其他演员位置，测量须能发现；禁止仅用计划半径判定。
    from previs_water import measure_water
    handles = {'mode': mode, 'events': [
        {'event': event, 'rig': bpy.data.objects[event['actorId']],
         'object': bpy.data.objects[event['actorId']+'_独立冲击浪'],
         'headHeight': row['headHeight']}
        for event, row in zip(water['events'], report['events'])]}
    if len(handles['events']) > 1:
        a, b = handles['events'][:2]
        before = a['object'].location.copy()
        a['object'].location = b['object'].location.copy()
        mutated = measure_water(handles, [], scene)
        (folder/'injected-overlap.json').write_text(json.dumps(mutated, ensure_ascii=False))
        assert any(row['kind'] == 'world' for row in mutated['overlaps'])
        assert any(row['kind'] == 'screen' for row in mutated['overlaps'])
        a['object'].location = before
    obj = handles['events'][0]['object']
    before = obj.location.copy()
    try:
        obj.location.x += 10000
        mutated = measure_water(handles, [], scene)
        (folder/'injected-offscreen.json').write_text(json.dumps(mutated, ensure_ascii=False))
        assert mutated['offscreenFrames']
    finally:
        obj.location = before
        bpy.context.view_layer.update()
    receipts.append({'mode': mode, 'frames': scene.frame_end, 'actors': len(report['events']),
                     'crossFrames': [r['crossFrame'] for r in report['events']],
                     'maxRestoredHeadError': maximum_error, 'actualMeshMutationDetected': True})
(out/'acceptance.json').write_text(json.dumps(receipts, ensure_ascii=False, indent=2))
print(json.dumps(receipts, ensure_ascii=False))
