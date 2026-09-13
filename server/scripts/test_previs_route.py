"""三人攻防分段轨真实场景回读；完整碰撞证据先落盘，再做验收断言。"""
import copy
import json
import math
import runpy
import sys
from pathlib import Path
import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree

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
    runpy.run_path(str(renderer), run_name='__main__')
    return folder


def tree(objects):
    vertices, polygons = [], []
    depsgraph = bpy.context.evaluated_depsgraph_get()
    for obj in objects:
        evaluated = obj.evaluated_get(depsgraph)
        mesh = evaluated.to_mesh()
        try:
            offset = len(vertices)
            vertices.extend(evaluated.matrix_world @ v.co for v in mesh.vertices)
            polygons.extend(tuple(offset+i for i in p.vertices) for p in mesh.polygons)
        finally:
            evaluated.to_mesh_clear()
    return BVHTree.FromPolygons(vertices, polygons)


def read_scene(folder, spec, collisions):
    report = json.loads((folder/'report.json').read_text())
    bpy.ops.wm.open_mainfile(filepath=str(folder/'scene.blend'))
    scene = bpy.context.scene
    poses, roots, hits = {}, {}, []
    for frame in range(1, scene.frame_end+1):
        scene.frame_set(frame)
        bpy.context.view_layer.update()
        poses[frame], roots[frame] = {}, {}
        for actor in spec['actors']:
            rig = bpy.data.objects[actor['id']]
            poses[frame][actor['id']] = {b.name: [list(rig.matrix_world @ b.head), list(rig.matrix_world @ b.tail)] for b in rig.pose.bones}
            m = rig.matrix_world
            roots[frame][actor['id']] = {'root': list(m.translation), 'facingDeg': math.degrees(math.atan2(m[1][0],m[0][0]))}
        for event in report.get('interactions', []):
            if frame == event['contactFrame']:
                tips = [bpy.data.objects[event[k]+'_练习剑'].matrix_world @ Vector((-.025,.09+.75/2,0)) for k in ('actorId','targetActorId')]
                assert (tips[0]-tips[1]).length < 1e-5
                assert (tips[0]-Vector(event['actualPoint'])).length < 1e-5
                assert (tips[1]-Vector(event['targetPoint'])).length < 1e-5
        if collisions:
            bodies = {a['id']: [o for o in scene.objects if o.type == 'MESH' and o.name.startswith(a['id']+'_') and not o.name.endswith(('_剑刃','_护手','_握柄'))] for a in spec['actors']}
            body_trees = {aid: tree(objects) for aid, objects in bodies.items()}
            frame_hits = {'frame': frame, 'swordBody': [], 'bodyBody': []}
            for i, actor in enumerate(spec['actors']):
                aid = actor['id']
                if actor.get('weapon'):
                    blade = tree([bpy.data.objects[aid+'_剑刃']])
                    for bid, objects in bodies.items():
                        other = tree([o for o in objects if o.name != aid+'_hand-1']) if aid == bid else body_trees[bid]
                        if blade.overlap(other):
                            frame_hits['swordBody'].append([aid,bid])
                for other in spec['actors'][i+1:]:
                    bid = other['id']
                    if body_trees[aid].overlap(body_trees[bid]):
                        frame_hits['bodyBody'].append([aid,bid])
            hits.append(frame_hits)
    (folder/'restored-poses.json').write_text(json.dumps(poses))
    (folder/'restored-roots.json').write_text(json.dumps(roots))
    if collisions:
        (folder/'actual-collisions.json').write_text(json.dumps(hits, indent=2))
    return report, poses, roots, hits


sys.path.insert(0, str(renderer.parent))
from previs_route import route_pose
assert route_pose({}, 0) is None
short = {'motionRoute': [{'timeSec':0,'position':[0,0],'facingDeg':170},{'timeSec':2,'position':[2,0],'facingDeg':-170}]}
mid, facing = route_pose(short,1)
assert (mid-Vector((1,0,0))).length < 1e-6 and abs(facing-180) < 1e-6
short['motionRoute'][0]['facingDeg']=0
short['motionRoute'][1]['facingDeg']=180
assert abs(route_pose(short,1)[1]-90) < 1e-6
folder = build(base, 'valid')
report, poses, roots, hits = read_scene(folder, base, True)
assert len(base['actors']) == 3
assert len(report['interactions']) == 2
assert all(e['contactError'] < 1e-5 for e in report['interactions'])
for row in report.get('motionRoutes', []):
    assert len(row['samples']) == report['frames']
    for sample in row['samples']:
        actual = roots[sample['frame']][row['actorId']]
        assert (Vector(actual['root'])-Vector(sample['root'])).length < 1e-5
        assert abs((actual['facingDeg']-sample['facingDeg']+180)%360-180) < 1e-4
assert len(report.get('motionRoutes', [])) == sum(bool(a.get('motionRoute')) for a in base['actors'])
max_step = max((Vector(poses[f][a][b][i])-Vector(poses[f-1][a][b][i])).length for f in range(2,report['frames']+1) for a in poses[f] for b in poses[f][a] for i in (0,1))
boundary_frames = {round(n['timeSec']*24)+1 for a in base['actors'] for n in a.get('motionRoute',[])}
boundary_frames.update(round(e[k]*24)+1 for e in base['interactions'] for k in ('startSec','contactSec','endSec'))
boundary_steps = {f: max((Vector(poses[f][a][b][i])-Vector(poses[f-1][a][b][i])).length for a in poses[f] for b in poses[f][a] for i in (0,1)) for f in sorted(boundary_frames) if 1<f<=report['frames']}
result = {'frames': report['frames'], 'maxBoneStep': max_step, 'boundarySteps': boundary_steps,
          'swordBodyCollisionFrames': sum(bool(h['swordBody']) for h in hits),
          'bodyBodyCollisionFrames': sum(bool(h['bodyBody']) for h in hits),
          'contactErrors': [e['contactError'] for e in report['interactions']],
          'boundaryZh': '采样帧三角面检测；不证明帧间连续碰撞或实体完全包含。'}
(out/'acceptance-partial.json').write_text(json.dumps(result,ensure_ascii=False,indent=2))
assert not any(h['swordBody'] or h['bodyBody'] for h in hits), '真实剑体或人物身体存在穿插，已保存完整证据'
assert max_step < .35, '关节逐帧跳变超过35厘米，须检查交接与路线'
reversed_spec = copy.deepcopy(base)
reversed_spec['actors'].reverse()
reverse_folder = build(reversed_spec, 'reversed')
reverse_report, reverse_poses, reverse_roots, _ = read_scene(reverse_folder,reversed_spec,False)
reverse_error = max((Vector(poses[f][a][b][i])-Vector(reverse_poses[f][a][b][i])).length for f in poses for a in poses[f] for b in poses[f][a] for i in (0,1))
result['reversedActorMaxError'] = reverse_error
assert reverse_error < 1e-5
invalid = copy.deepcopy(base)
invalid['interactions'][1].update({k: invalid['interactions'][0][k] for k in ('startSec','contactSec','endSec')})
try:
    build(invalid,'overlapping-events')
except ValueError as error:
    result['overlapRejected'] = str(error)
else:
    raise AssertionError('同角色重叠接触事件未拒绝')
# 实际保存动画的半帧回读：跨±180不能绕长弧。
arc_spec = copy.deepcopy(base)
arc_spec['interactions'] = []
arc_actor = arc_spec['actors'][0]
arc_spec['actors'] = [arc_actor]
arc_actor['start'] = arc_actor['end'] = [0,0]
arc_actor['facingDeg'] = 170
arc_actor['motionRoute'] = [
    {'timeSec':0,'position':[0,0],'facingDeg':170},
    {'timeSec':2,'position':[0,0],'facingDeg':-170},
    {'timeSec':(base['durationSec']*24-1)/24,'position':[0,0],'facingDeg':-170}]
arc_folder = build(arc_spec,'short-arc')
bpy.ops.wm.open_mainfile(filepath=str(arc_folder/'scene.blend'))
scene = bpy.context.scene
rig = bpy.data.objects[arc_actor['id']]
arc_rows=[]
for half in range(97):
    exact_frame=1+half/2
    scene.frame_set(int(exact_frame),subframe=exact_frame-int(exact_frame))
    bpy.context.view_layer.update()
    matrix=rig.matrix_world
    actual=math.degrees(math.atan2(matrix[1][0],matrix[0][0]))
    expected=route_pose(arc_actor,half/48)[1]
    error=abs((actual-expected+180)%360-180)
    arc_rows.append({'frame':exact_frame,'actual':actual,'expected':expected,'error':error})
(arc_folder/'half-frame-yaw.json').write_text(json.dumps(arc_rows,indent=2))
result['shortArcMaxHalfFrameError']=max(r['error'] for r in arc_rows)
assert result['shortArcMaxHalfFrameError'] < .5, '短弧动画在半帧绕长弧'
(out/'acceptance.json').write_text(json.dumps(result,ensure_ascii=False,indent=2))
print('ROUTE_ACCEPTANCE_PASS',json.dumps(result,ensure_ascii=False))
