"""本机真实场景验收：保存后回读骨架、剑体、完整逐帧报告和旧路径。"""
import copy
import json
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


folder = build(base, 'valid')
report = json.loads((folder/'report.json').read_text())
assert len(report['weapons']) == 2
assert all(len(w['samples']) == 96 for w in report['weapons'])
assert report['interactions'][0]['contactFrame'] == 49
assert report['interactions'][0]['contactError'] < .00001
assert all(a['stanceDrift'] < .00001 for a in report['actors'])
bpy.ops.wm.open_mainfile(filepath=str(folder/'scene.blend'))
scene = bpy.context.scene
poses = {}
for frame in range(1, 97):
    scene.frame_set(frame)
    bpy.context.view_layer.update()
    poses[frame] = {}
    for actor in base['actors']:
        rig = bpy.data.objects[actor['id']]
        sword = bpy.data.objects[actor['id']+'_练习剑']
        actual = sword.matrix_world @ Vector((-.025, .09+.75/2, 0))
        sample = next(w for w in report['weapons'] if w['actorId'] == actor['id'])['samples'][frame-1]
        assert (actual-Vector(sample['contactPoint'])).length < .00001
        poses[frame][actor['id']] = {b.name: [list(rig.matrix_world @ b.head), list(rig.matrix_world @ b.tail)] for b in rig.pose.bones}
        assert (sword.matrix_world.translation-rig.matrix_world @ rig.pose.bones['hand-1'].head).length < .00001
# 起止同一准备姿态，切镜不重置动作；逐骨点完整存证。
max_return = max((Vector(poses[1][a][b][i])-Vector(poses[96][a][b][i])).length
                 for a in poses[1] for b in poses[1][a] for i in (0, 1))
assert max_return < .00001
max_cut_step = max((Vector(poses[60][a][b][i])-Vector(poses[61][a][b][i])).length
                   for a in poses[60] for b in poses[60][a] for i in (0, 1))
assert max_cut_step < .08
# 受方在接触之前不先后仰，接触后有实际受力位移。
a = base['actors'][1]['id']
assert (Vector(poses[1][a]['spine'][1])-Vector(poses[48][a]['spine'][1])).length < .00001
reaction = (Vector(poses[1][a]['spine'][1])-Vector(poses[67][a]['spine'][1])).length
assert reaction > .04
# 逐帧检查实体剑刃与白模三角面相交，握剑手本体是有意接触，前臂不能排除。
def body_tree(obj):
    evaluated = obj.evaluated_get(bpy.context.evaluated_depsgraph_get())
    mesh = evaluated.to_mesh()
    tree = BVHTree.FromPolygons([evaluated.matrix_world @ v.co for v in mesh.vertices],
                               [list(p.vertices) for p in mesh.polygons])
    evaluated.to_mesh_clear()
    return tree
collision_rows = []
for frame in range(1, 97):
    scene.frame_set(frame)
    bpy.context.view_layer.update()
    bodies = [o for o in scene.objects if o.type == 'MESH'
              and any(o.name.startswith(a['id']+'_') for a in base['actors'])
              and not any(o.name.endswith('_'+n) for n in ('剑刃', '护手', '握柄'))]
    trees = {o.name: body_tree(o) for o in bodies}
    hits = []
    for actor in base['actors']:
        blade = body_tree(bpy.data.objects[actor['id']+'_剑刃'])
        for name, tree in trees.items():
            if name != actor['id']+'_hand-1' and blade.overlap(tree):
                hits.append([actor['id'], name])
    collision_rows.append({'frame': frame, 'bodyIntersections': hits})
(out/'body-collision.json').write_text(json.dumps(collision_rows, ensure_ascii=False, indent=2))
assert not any(row['bodyIntersections'] for row in collision_rows), '剑刃与身体三角面相交'
(out/'poses.json').write_text(json.dumps(poses, ensure_ascii=False))
results = {'frames':96,'contactError': report['interactions'][0]['contactError'], 'maxReturnError':max_return,
           'maxCutStep':max_cut_step,'reactionDistance':reaction, 'restoredScene':True, 'bodyIntersectionFrames':0}
# 错误站位不能伪造成成功；原合法场景和报告保持原路径。
for mode in ('too_far', 'wrong_facing', 'missing_weapon'):
    invalid = copy.deepcopy(base)
    if mode == 'too_far': invalid['actors'][1]['start'] = invalid['actors'][1]['end'] = [4, 0]
    if mode == 'wrong_facing': invalid['actors'][1]['facingDeg'] = 0
    if mode == 'missing_weapon': del invalid['actors'][1]['weapon']
    try:
        build(invalid, mode)
    except ValueError as error:
        results[mode] = str(error)
    else:
        raise AssertionError('错误配置没有被拒绝: '+mode)
# 仅在测试中注入超限读回值，验证失败时先留完整证据，不用于质量结论。
import previs_sword
original_measure = previs_sword.measure_swords
def injected_measure(*args):
    rows, contacts = original_measure(*args)
    rows[0]['samples'][0]['gripError'] = 1.0
    return rows, contacts
previs_sword.measure_swords = injected_measure
try:
    try:
        build(base, 'injected_grip_error')
    except ValueError:
        failed_report = json.loads((out/'injected_grip_error'/'report.json').read_text())
        assert len(failed_report['weapons'][0]['samples']) == 96
        assert failed_report['weapons'][0]['samples'][0]['gripError'] == 1.0
        results['injectedFailureEvidencePreserved'] = True
    else:
        raise AssertionError('注入的持握超限未被拒绝')
finally:
    previs_sword.measure_swords = original_measure
(out/'acceptance.json').write_text(json.dumps(results, ensure_ascii=False, indent=2))
print('SWORD_ACCEPTANCE_PASS', json.dumps(results, ensure_ascii=False))
