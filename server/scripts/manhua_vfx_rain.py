"""共享点阵网格的数字雨层；最多36列×16字符，不生成字体或纹理文件。"""
import bpy

from manhua_vfx_rain_math import GLYPHS, glyph_geometry, rain_columns, rain_frame


def build_digital_rain(event, spec, scene, make_material, color):
    palettes, opacity = [], []
    for label, tint in (('tail', color), ('head', tuple(.72+.28*c for c in color))):
        mat, alpha = make_material(event['id']+'_rain_'+label, tint)
        info = mat.node_tree.nodes.new('ShaderNodeObjectInfo')
        mat.node_tree.links.new(info.outputs['Alpha'], alpha.node.inputs[0])
        palettes.append(mat)
        opacity.append(alpha)
    meshes = []
    for head, mat in enumerate(palettes):
        bank = []
        for index in range(len(GLYPHS)):
            mesh = bpy.data.meshes.new(event['id']+'_rain_%d_%d' % (head, index))
            vertices, faces = glyph_geometry(index)
            mesh.from_pydata(vertices, [], faces)
            mesh.materials.append(mat)
            mesh.update()
            bank.append(mesh)
        meshes.append(bank)
    columns = rain_columns(spec['seed'], event['id'], spec['width']/spec['height'], event.get('rain'))
    objects = []
    for index, char in enumerate(rain_frame(columns, 0)):
        obj = bpy.data.objects.new(event['id']+'_rain_char_%d' % index, meshes[int(char['head'])][char['glyph']])
        scene.collection.objects.link(obj)
        objects.append(obj)
    return {'columns': columns, 'meshes': meshes, 'opacity': opacity, 'objects': objects}


def update_digital_rain(rain, event, time, state):
    for alpha in rain['opacity']:
        alpha.default_value = min(1., state['opacity']*2)
    for obj, char in zip(rain['objects'], rain_frame(rain['columns'], time-event['startSec'])):
        obj.data = rain['meshes'][int(char['head'])][char['glyph']]
        obj.location = (char['x'], char['y'], 0)
        obj.color = (1, 1, 1, char['alpha'])
        obj.hide_render = not state['active'] or not char['visible'] or state['opacity'] == 0
