"""可控几何火团/烟团与真实点光源；不是体积烟火、物理爆炸或破坏模拟。"""
import math
import bpy
from mathutils import Vector

BOUNDARY = '几何火团/烟团预演与局部点光源；未实现体积烟火、碎片、物理破坏及人物受力。'


def configure_effects_render(scene):
    """只由非空effects调用；旧无特效场景不改变渲染器。"""
    # 4.2使用NEXT，5.2实际枚举已恢复EEVEE；以运行时能力为准。
    try:
        scene.render.engine = 'BLENDER_EEVEE_NEXT'
    except TypeError:
        scene.render.engine = 'BLENDER_EEVEE'
    if hasattr(scene, 'eevee') and hasattr(scene.eevee, 'taa_render_samples'):
        scene.eevee.taa_render_samples = 32
    scene.world.use_nodes = True
    background = scene.world.node_tree.nodes.get('Background')
    background.inputs['Color'].default_value = (.13, .16, .21, 1)
    background.inputs['Strength'].default_value = .35
    # 工作台材质转为真实可受光材质，保留原漫反射颜色。
    for obj in scene.objects:
        if obj.type != 'MESH':
            continue
        for mat in obj.data.materials:
            if not mat or mat.use_nodes:
                continue
            color = tuple(mat.diffuse_color)
            mat.use_nodes = True
            bsdf = mat.node_tree.nodes.get('Principled BSDF')
            bsdf.inputs['Base Color'].default_value = color
            bsdf.inputs['Roughness'].default_value = .7
    data = bpy.data.lights.new('特效预演环境主光', 'AREA')
    data.energy, data.shape, data.size = 600, 'DISK', 8
    obj = bpy.data.objects.new('特效预演环境主光', data)
    scene.collection.objects.link(obj)
    obj.location = (0, -3, 7)
    obj.rotation_euler = (Vector((0, 0, 0)) - obj.location).to_track_quat('-Z', 'Y').to_euler()


def _material(name, color, emission=0):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*color, 1)
    mat.use_nodes = True
    node = mat.node_tree.nodes.get('Principled BSDF')
    node.inputs['Base Color'].default_value = (*color, 1)
    node.inputs['Roughness'].default_value = .9
    emission_input = node.inputs.get('Emission Color') or node.inputs.get('Emission')
    emission_input.default_value = (*color, 1)
    if node.inputs.get('Emission Strength'):
        node.inputs['Emission Strength'].default_value = emission
    return mat


def build_effects(spec, scene):
    events = spec.get('effects') or []
    if not events:
        return []
    configure_effects_render(scene)
    handles = []
    for index, event in enumerate(events):
        prefix = '特效_%d_%s' % (index, event['kind'])
        root = bpy.data.objects.new(prefix, None)
        scene.collection.objects.link(root)
        smoke = _material(prefix + '_烟团', (.12, .14, .17))
        fire = _material(prefix + '_火团', (1., .19, .012), 4)
        parts = []
        for k in range(9):
            angle = k * math.tau / 9
            bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2, radius=1)
            obj = bpy.context.object
            obj.name = prefix + '_团_%d' % k
            obj.parent = root
            obj.location = (.45 * math.cos(angle), .45 * math.sin(angle), .65 + (k % 3) * .25)
            obj.scale = (.5, .5, .36)
            obj.data.materials.append(smoke)
            parts.append(obj)
        flame = None
        if event['kind'] == 'explosion':
            bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2, radius=1)
            flame = bpy.context.object
            flame.name = prefix + '_闪火'
            flame.parent = root
            flame.location = (0, 0, .9)
            flame.data.materials.append(fire)
        light_data = bpy.data.lights.new(prefix + '_爆点光', 'POINT')
        light_data.color = (1., .25, .035)
        light_data.shadow_soft_size = .2
        light = bpy.data.objects.new(prefix + '_爆点光', light_data)
        scene.collection.objects.link(light)
        light.parent = root
        # 烟团上升，点光位置抵消root位移，始终留在原始爆点。
        for frame in range(1, scene.frame_end + 1):
            # 已对齐24帧的事件按整数帧判边界，避免1/24浮点尾差残留一帧。
            age = frame - 1 - round(event['startSec'] * 24)
            duration_frames = round(event['durationSec'] * 24)
            u = age / duration_frames
            active = 0 <= age < duration_frames
            q = max(0., min(1., u))
            root.location = (event['origin'][0] + event['wind'][0] * q, event['origin'][1] + event['wind'][1] * q, event['origin'][2] + event['height'] * .55 * q)
            size = (.15 + .85 * math.sin(math.pi * q / 2)) * (min(1., (1-q)*8)) if active else 0
            root.scale = (event['radius'] * size, event['radius'] * size, event['height'] * size)
            for prop in ('location', 'scale'):
                root.keyframe_insert(prop, frame=frame)
            for obj in parts + ([flame] if flame else []):
                obj.hide_render = not active
                obj.hide_viewport = not active
                obj.keyframe_insert('hide_render', frame=frame)
                obj.keyframe_insert('hide_viewport', frame=frame)
            if flame:
                f = max(0., 1 - q * 4)
                flame.scale = (.55*f, .55*f, .65*f)
                flame.keyframe_insert('scale', frame=frame)
            light_data.energy = 1400 * max(0., 1-q*5)**2 if active and flame else 0
            light_data.keyframe_insert('energy', frame=frame)
            light.location = tuple((event['origin'][j] - root.location[j]) / root.scale[j] if root.scale[j] else 0 for j in range(3))
            light.keyframe_insert('location', frame=frame)
        handles.append({'event': event, 'root': root, 'light': light, 'parts': parts, 'flame': flame})
    scene.frame_set(1)
    return handles


def measure_effects(handles, scene):
    original = scene.frame_current
    rows = [{'id': h['event']['id'], 'kind': h['event']['kind'], 'samples': [], 'boundaryZh': BOUNDARY} for h in handles]
    try:
        for frame in range(1, scene.frame_end + 1):
            scene.frame_set(frame)
            bpy.context.view_layer.update()
            depsgraph = bpy.context.evaluated_depsgraph_get()
            for h, row in zip(handles, rows):
                obj = h['root'].evaluated_get(depsgraph)
                light = h['light'].evaluated_get(depsgraph)
                row['samples'].append({'frame': frame, 'visible': not h['parts'][0].hide_render and max(obj.matrix_world.to_scale()) > 1e-8, 'center': list(obj.matrix_world.translation), 'scale': list(obj.matrix_world.to_scale()), 'lightEnergy': float(light.data.energy), 'lightPosition': list(light.matrix_world.translation)})
    finally:
        scene.frame_set(original)
    return rows
