"""真实BMesh接缝回归；可附Linux/Mac导入快照，不求解或渲染。"""
import importlib.util
import json
import sys
from pathlib import Path
import bmesh

entry = importlib.util.spec_from_file_location('auto_rig_entry', Path(__file__).with_name('run_manhua_auto_rig.py'))
module = importlib.util.module_from_spec(entry)
entry.loader.exec_module(module)
args = sys.argv[sys.argv.index('--') + 1:]
out = Path(args[0]); out.mkdir(parents=True, exist_ok=False)
checks = []

def check(value, label):
    if not value: raise AssertionError(label)
    checks.append(label)


def signature(bm, uv=None):
    result = []
    for face in bm.faces:
        points = [tuple(loop.vert.co) + (tuple(loop[uv].uv) if uv else ()) for loop in face.loops]
        result.append(min(tuple(points[i:] + points[:i]) for i in range(len(points))))
    return sorted(result)


vertices = [(0,0,0),(1,0,0),(1,1,0),(0,1,0),(0,0,1),(1,0,1),(1,1,1),(0,1,1)]
faces = [(0,2,1),(0,3,2),(4,5,6),(4,6,7),(0,1,5),(0,5,4),(1,2,6),(1,6,5),(2,3,7),(2,7,6),(3,0,4),(3,4,7)]

def cube(omit=False, gap=False):
    bm = bmesh.new(); uv = bm.loops.layers.uv.new('测试接缝UV')
    for i, indices in enumerate(faces[1:] if omit else faces):
        face = bm.faces.new([bm.verts.new(vertices[index]) for index in indices])
        for j, loop in enumerate(face.loops): loop[uv].uv = (i / 16, j / 4)
    if gap:
        next(vertex for vertex in bm.verts if tuple(vertex.co) == (0,0,0)).co.x = 1e-9
    return bm, uv


bm, uv = cube()
try:
    original = signature(bm, uv)
    check(len(bm.verts) == 36, '实际拆分36个接缝顶点')
    module.weld_identical_vertices(bm)
    check(len(bm.verts) == 8 and len(bm.faces) == 12, '完全重合接缝合并为8点且12面不丢')
    check(all(edge.is_manifold for edge in bm.edges), '封闭立方体重合接缝闭合')
    check(signature(bm, uv) == original, '每个面绕序与逐角UV原样保持')
    module.weld_identical_vertices(bm)
    check(len(bm.verts) == 8 and signature(bm, uv) == original, '重复处理不改变几何或UV')
finally: bm.free()

for omit, gap, label in [(True,False,'缺面开口'), (False,True,'十亿分之一米的真实非重合缝')]:
    bm, uv = cube(omit, gap)
    try:
        coordinates = set(tuple(v.co) for v in bm.verts)
        module.weld_identical_vertices(bm)
        check(any(not edge.is_manifold for edge in bm.edges), label + '仍被流形门禁拒绝')
        check(set(tuple(v.co) for v in bm.verts) == coordinates, label + '没有移动顶点填补')
    finally: bm.free()

bm = bmesh.new()
try:
    a, b = bm.verts.new((0,0,0)), bm.verts.new((1,0,0))
    for point in [(0,1,0),(0,0,1),(0,-1,0)]: bm.faces.new([a,b,bm.verts.new(point)])
    module.weld_identical_vertices(bm)
    check(any(len(e.link_faces) == 3 for e in bm.edges), '三面共边仍为非流形，不删除面伪造闭合')
finally: bm.free()

if len(args) >= 3:
    linux, mac = [json.loads(Path(p).read_text()) for p in args[1:3]]
    bm = bmesh.new()
    try:
        refs = [bm.verts.new(p) for p in linux['mesh']['vertices']]
        for face in linux['mesh']['polygons']: bm.faces.new([refs[i] for i in face])
        before = signature(bm)
        module.weld_identical_vertices(bm)
        check(len(bm.verts) == 5640 and len(bm.faces) == 11276, '实际Linux14140点导入副本精确合并为5640点11276面')
        check(all(edge.is_manifold for edge in bm.edges), '实际Linux接缝不再留下6864条开口边')
        check(set(tuple(v.co) for v in bm.verts) == set(map(tuple,mac['mesh']['vertices'])), '与Mac已通过模型坐标集合逐点完全相同')
        check(signature(bm) == before, '实际Linux全部面的坐标和绕序保持')
        reference = []
        for face in mac['mesh']['polygons']:
            points = [tuple(mac['mesh']['vertices'][i]) for i in face]
            reference.append(min(tuple(points[i:] + points[:i]) for i in range(len(points))))
        check(signature(bm) == sorted(reference), 'Linux修正后全部面与Mac模型逐面一致')
    finally: bm.free()

if len(args) == 5:
    import hashlib
    source_path, request_path = map(Path, args[3:5])
    raw = source_path.read_bytes()
    request = json.loads(request_path.read_text())
    mesh, metadata, merged = module.load_source(source_path, request['sourceSha256'], request['request']['settings'])
    digest = module.core.source_digest(mesh)
    (out/'source-digest.json').write_text(json.dumps({'sourceSha256':hashlib.sha256(raw).hexdigest(),'digest':digest},indent=2))
    check(len(mesh.data.vertices) == 5640, '正式load_source导入保持5640顶点')
    check(source_path.read_bytes() == raw, '正式导入原GLB逐字节不变')

(out/'receipt.json').write_text(json.dumps({'checksPassed':len(checks),'checks':checks,'linuxSnapshots':len(args)>=3,'linuxRuntimeVerified':False,'qualityAccepted':False},ensure_ascii=False,indent=2))
print('AUTO_RIG_SEAMS_PASS', len(checks))
