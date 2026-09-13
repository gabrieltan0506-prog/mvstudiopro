"""真实Blender相机对照；保留全部数值测试和有界微基准，非生产负载承诺。"""
import json
from pathlib import Path
import random
import sys
import time
import bpy
from mathutils import Vector
from bpy_extras.object_utils import world_to_camera_view

sys.path.insert(0, str(Path(__file__).resolve().parent))
from previs_projection import make_projector, validate_projection_work

out = Path(sys.argv[sys.argv.index('--') + 1])
out.mkdir(parents=True, exist_ok=True)
random.seed(913)
scene = bpy.context.scene
bpy.ops.object.camera_add(location=(3, -6, 2.5))
camera = bpy.context.object
camera.rotation_euler = (Vector((0, 0, 1)) - camera.location).to_track_quat('-Z', 'Y').to_euler()
scene.camera = camera
bpy.context.view_layer.update()
checks, maximum = 0, 0.
for width, height in ((960, 540), (540, 960)):
    scene.render.resolution_x, scene.render.resolution_y = width, height
    for camera_type in ('PERSP', 'ORTHO'):
        camera.data.type = camera_type
        for fit in ('AUTO', 'VERTICAL', 'HORIZONTAL'):
            camera.data.sensor_fit = fit
            for lens in (18, 35, 65):
                camera.data.lens = lens
                for shift in (0, .13):
                    camera.data.shift_x, camera.data.shift_y = shift, -shift
                    project = make_projector(scene, camera)
                    for _ in range(80):
                        point = camera.matrix_world @ Vector((random.uniform(-4, 4), random.uniform(-4, 4), random.choice((-1, 1)) * random.uniform(.1, 12)))
                        expected = world_to_camera_view(scene, camera, point)
                        actual = project(point)
                        error = max(abs(actual[i] - expected[i]) for i in range(3))
                        maximum = max(maximum, error)
                        assert error <= 1e-5 * max(1., *[abs(n) for n in expected]), (actual, expected)
                        checks += 1
for vertices, frames, portrait in ((250000, 48, False), (10000, 120, True), (0, 48, False)):
    assert validate_projection_work(vertices, frames, portrait) <= 12000000
    checks += 1
for vertices, frames, portrait in ((250001, 48, False), (250000, 720, False), (250000, 48, True), (-1, 48, False), (1, 0, False)):
    try:
        validate_projection_work(vertices, frames, portrait)
        raise AssertionError('未拒绝超预算或无效参数')
    except ValueError:
        checks += 1
camera.data.type = 'PERSP'
camera.data.shift_x = camera.data.shift_y = 0
project = make_projector(scene, camera)
point = Vector((0, 0, 1))
timing = {}
for name, fn in (('reference', lambda p: world_to_camera_view(scene, camera, p)), ('precomputed', project)):
    started = time.perf_counter()
    for _ in range(50000): fn(point)
    timing[name] = time.perf_counter() - started
receipt = {'blenderVersion': bpy.app.version_string, 'checks': checks, 'maximumNdcError': maximum,
           'projectionCountEach': 50000, 'elapsedSec': timing,
           'boundaryZh': '仅数值等价和单点微基准；未包含蒙皮/渲染/云端，不是Linux压力验收'}
(out / 'projection-receipt.json').write_text(json.dumps(receipt, ensure_ascii=False, indent=2))
print(json.dumps(receipt, ensure_ascii=False))
