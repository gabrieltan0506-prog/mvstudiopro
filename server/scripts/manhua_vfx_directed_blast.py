"""程序定向爆破：分时火团、火花、实体碎片、烟尘及冲击环；不宣称流体模拟。"""
import math
from manhua_vfx_action_math import blast_particles, blast_state


def _material(name, kind, color):
    import bpy
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    nodes.clear()
    out = nodes.new('ShaderNodeOutputMaterial')
    transparent = nodes.new('ShaderNodeBsdfTransparent')
    emit = nodes.new('ShaderNodeEmission')
    mix = nodes.new('ShaderNodeMixShader')
    info = nodes.new('ShaderNodeObjectInfo')
    emit.inputs['Color'].default_value = (*color, 1)
    emit.inputs['Strength'].default_value = {'fire': 2.3, 'spark': 3., 'debris': 1., 'smoke': .7, 'shock': 1.5}[kind]
    alpha = nodes.new('ShaderNodeMath'); alpha.operation = 'MULTIPLY'
    links.new(info.outputs['Alpha'], alpha.inputs[0])
    alpha.inputs[1].default_value = 1
    clock = None
    if kind in ('fire', 'smoke'):
        coords = nodes.new('ShaderNodeTexCoord')
        noise = nodes.new('ShaderNodeTexNoise'); noise.noise_dimensions = '4D'
        noise.inputs['Scale'].default_value = 4.5 if kind == 'fire' else 3
        noise.inputs['Detail'].default_value = 2
        clock = noise.inputs['W']
        links.new(coords.outputs['Generated'], noise.inputs['Vector'])
        density = nodes.new('ShaderNodeMapRange'); density.clamp = True
        density.inputs['From Min'].default_value = .3
        density.inputs['From Max'].default_value = .7
        density.inputs['To Min'].default_value = .03
        density.inputs['To Max'].default_value = 1
        links.new(noise.outputs['Fac'], density.inputs['Value'])
        links.new(density.outputs['Result'], alpha.inputs[1])
        palette = nodes.new('ShaderNodeValToRGB')
        lo, hi = palette.color_ramp.elements
        lo.position = .25; hi.position = .8
        if kind == 'fire':
            lo.color = (*(c * .22 for c in color), 1)
            hi.color = (*(min(1., .65 + c * .35) for c in color), 1)
            palette.color_ramp.elements.new(.52).color = (*color, 1)
        else:
            lo.color = (.035, .04, .045, 1)
            hi.color = (.3, .31, .32, 1)
        links.new(noise.outputs['Fac'], palette.inputs['Fac'])
        links.new(palette.outputs['Color'], emit.inputs['Color'])
    links.new(alpha.outputs[0], mix.inputs[0])
    links.new(transparent.outputs[0], mix.inputs[1])
    links.new(emit.outputs[0], mix.inputs[2])
    links.new(mix.outputs[0], out.inputs['Surface'])
    if hasattr(mat, 'surface_render_method'): mat.surface_render_method = 'BLENDED'
    elif hasattr(mat, 'blend_method'): mat.blend_method = 'BLEND'
    if hasattr(mat, 'use_transparency_overlap'): mat.use_transparency_overlap = False
    return mat, clock


def build_directed_blast(event, spec, scene, color):
    import bpy
    import bmesh
    particles = blast_particles(event, spec['seed'])
    meshes = {}; clocks = []
    for kind in ('fire', 'smoke', 'spark', 'debris'):
        mesh = bpy.data.meshes.new(event['id'] + '_' + kind)
        if kind in ('fire', 'smoke'):
            bm = bmesh.new(); bmesh.ops.create_icosphere(bm, subdivisions=2, radius=1)
            bm.to_mesh(mesh); bm.free()
            for polygon in mesh.polygons: polygon.use_smooth = True
        elif kind == 'spark':
            mesh.from_pydata([(-1,-1,0),(1,-1,0),(1,1,0),(-1,1,0)], [], [(0,1,2,3)])
        else:
            mesh.from_pydata([(1,0,0),(-.5,.85,0),(-.5,-.85,0),(0,0,1.2)], [], [(0,2,1),(0,1,3),(1,2,3),(2,0,3)])
        mat, clock = _material(mesh.name, kind, tuple(.13 + c * .16 for c in color) if kind == 'debris' else color)
        mesh.materials.append(mat); meshes[kind] = mesh
        if clock is not None: clocks.append(clock)
    objects = []
    for i, particle in enumerate(particles):
        obj = bpy.data.objects.new(event['id'] + '_' + particle['kind'] + '_' + str(i), meshes[particle['kind']])
        scene.collection.objects.link(obj); objects.append(obj)
    mesh = bpy.data.meshes.new(event['id'] + '_shock')
    vertices = [(math.cos(i / 64 * math.tau) * radius, math.sin(i / 64 * math.tau) * radius, 0) for i in range(64) for radius in (.96, 1.04)]
    faces = [(i*2, i*2+1, ((i+1)%64)*2+1, ((i+1)%64)*2) for i in range(64)]
    mesh.from_pydata(vertices, [], faces)
    mat, _ = _material(mesh.name, 'shock', color); mesh.materials.append(mat)
    shock = bpy.data.objects.new(mesh.name, mesh); scene.collection.objects.link(shock)
    objects.append(shock)
    return {'objects': objects, 'particles': particles, 'shock': shock, 'clocks': clocks}


def update_directed_blast(handle, event, time, state):
    params = event['blast']
    age = time - event['startSec']
    available = event['durationSec'] - params['ignitionSec']
    strength = min(1., state['opacity'] * 2)
    counts = {'fire': 0, 'spark': 0, 'debris': 0, 'smoke': 0}
    for obj, particle in zip(handle['objects'], handle['particles']):
        value = blast_state(particle, params, age, available)
        obj.location = value['position']; obj.scale = value['scale']
        obj.rotation_euler = (value['rotation'] * .3 if particle['kind'] == 'debris' else 0, 0, value['rotation'])
        obj.color = (1, 1, 1, value['alpha'] * strength)
        obj.hide_render = not state['active'] or not value['visible'] or strength == 0
        if not obj.hide_render: counts[particle['kind']] += 1
    for clock in handle['clocks']: clock.default_value = max(0, age) * 3
    q = (age - params['ignitionSec']) / max(.1, available)
    shock = handle['shock']
    radius = max(0., q) ** .65 * params['reach'] * .55
    shock.scale = (radius, radius, radius)
    shock.color = (1, 1, 1, max(0., 1 - q * 3) * strength * .4)
    shock.hide_render = not state['active'] or not 0 < q < 1 / 3 or strength == 0
    return {'geometry': 'directional-fire-sparks-solid-debris-smoke', 'visibleParticles': counts,
            'particleCount': len(handle['particles']), 'ignitionSec': event['startSec'] + params['ignitionSec'],
            'boundaryZh': '程序定向爆破叠加；不自动破坏原片物体，不包含环境受光或人物遮挡。'}
