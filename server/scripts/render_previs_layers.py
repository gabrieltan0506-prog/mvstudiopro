"""受控场景的可见几何遮罩和真实Z通道；不宣称独立效果缓存或半透明合成。"""
import hashlib
import json
import sys
from pathlib import Path
import bpy

BOUNDARY = '可见几何二值遮罩与相机Z通道；保留场景遮挡，不含半透明分离、独立特效缓存或重做合成。'


def object_layer(obj, actor_ids):
    if obj.type != 'MESH':
        return None
    actor_rigs = set(actor_ids) | {a+'_角色骨架' for a in actor_ids}
    ancestor = obj.parent
    while ancestor:
        if ancestor.type == 'ARMATURE' and ancestor.name in actor_rigs:
            return 'actors'
        if ancestor.name in {a+'_练习剑' for a in actor_ids}:
            return 'actors'
        ancestor = ancestor.parent
    if '_独立冲击浪' in obj.name or obj.name.startswith('特效_'):
        return 'effects'
    if any(obj.name.startswith(a+'_') for a in actor_ids):
        return 'actors'
    return None


def mask_setup(scene, layer, actor_ids):
    scene.render.engine = 'BLENDER_WORKBENCH'
    scene.use_nodes = False
    scene.render.use_compositing = False
    shading = scene.display.shading
    shading.light, shading.color_type = 'FLAT', 'OBJECT'
    shading.show_shadows = shading.show_cavity = shading.show_specular_highlight = False
    shading.show_object_outline = False
    shading.background_type = 'WORLD'
    scene.world.color = (0,0,0)
    scene.render.film_transparent = False
    if hasattr(scene.display, 'render_aa'):
        scene.display.render_aa = 'OFF'
    for obj in scene.objects:
        # 所有遮挡几何仍参与深度测试，只有目标类别为白。
        value = 1. if object_layer(obj,actor_ids) == layer else 0.
        obj.color = (value,value,value,1)
    scene.render.image_settings.color_mode = 'BW'
    scene.render.image_settings.color_depth = '8'


def depth_setup(scene):
    try:
        scene.render.engine = 'BLENDER_EEVEE_NEXT'
    except TypeError:
        scene.render.engine = 'BLENDER_EEVEE'
    if hasattr(scene, 'eevee') and hasattr(scene.eevee, 'taa_render_samples'):
        scene.eevee.taa_render_samples = 1
    scene.view_layers[0].use_pass_z = True
    scene.use_nodes = True
    scene.render.use_compositing = True
    if hasattr(scene, 'node_tree'):
        tree = scene.node_tree
        modern = False
    else:
        tree = bpy.data.node_groups.new('预演深度输出', 'CompositorNodeTree')
        tree.interface.new_socket(name='Image', in_out='OUTPUT', socket_type='NodeSocketColor')
        scene.compositing_node_group = tree
        modern = True
    nodes = tree.nodes
    nodes.clear()
    source = nodes.new('CompositorNodeRLayers')
    subtract = nodes.new('ShaderNodeMath' if modern else 'CompositorNodeMath')
    subtract.operation = 'SUBTRACT'
    divide = nodes.new('ShaderNodeMath' if modern else 'CompositorNodeMath')
    divide.operation, divide.use_clamp = 'DIVIDE', True
    output = nodes.new('NodeGroupOutput' if modern else 'CompositorNodeComposite')
    links = tree.links
    links.new(source.outputs['Depth'], subtract.inputs[0])
    links.new(subtract.outputs[0], divide.inputs[0])
    links.new(divide.outputs[0], output.inputs['Image'])
    scene.render.image_settings.color_mode = 'BW'
    scene.render.image_settings.color_depth = '16'
    return subtract, divide


def render_layers(scene_path, out, frames=None, spec_path=None):
    scene_path, out = Path(scene_path), Path(out)
    spec_path = Path(spec_path) if spec_path else scene_path.with_name('spec.json')
    spec = json.loads(spec_path.read_text())
    if len(spec['actors']) > 3 or spec['durationSec'] > 8:
        raise ValueError('分层导出当前最多3人8秒')
    bpy.ops.wm.open_mainfile(filepath=str(scene_path))
    scene = bpy.context.scene
    expected = spec['durationSec']*24
    if scene.frame_start != 1 or scene.frame_end != expected or scene.render.fps != 24:
        raise ValueError('分层场景时间轴与配置不一致')
    width = scene.render.resolution_x*scene.render.resolution_percentage//100
    height = scene.render.resolution_y*scene.render.resolution_percentage//100
    if (width,height) not in ((960,540),(540,960)):
        raise ValueError('分层场景画幅不符合预演规范')
    selected = list(range(1,expected+1)) if frames is None else list(frames)
    if not selected or len(set(selected)) != len(selected) or any(f<1 or f>expected for f in selected):
        raise ValueError('分层帧选择无效')
    layers = out/'layers'
    layers.mkdir(parents=True,exist_ok=True)
    actor_ids = [a['id'] for a in spec['actors']]
    manifest = {'version':1,'kind':'geometry_masks_depth_v1','complete':False,
                'fps':24,'frameCount':expected,'selectedFrames':selected,
                'width':width,'height':height,
                'sceneSha256':hashlib.sha256(scene_path.read_bytes()).hexdigest(),
                'depth':{'encoding':'linear_z_pass_clip_normalized_u16','nearValue':0,'farValue':1,'backgroundValue':1},
                'cameras':[],'files':[],'boundaryZh':BOUNDARY}
    meta = layers/'meta.json'
    def save():
        meta.write_text(json.dumps(manifest,ensure_ascii=False,indent=2))
    save()
    scene.render.image_settings.file_format = 'PNG'
    scene.view_settings.view_transform = 'Raw'
    scene.view_settings.exposure, scene.view_settings.gamma = 0, 1
    scene.render.dither_intensity = 0
    for layer in ('actors','effects','depth'):
        folder = layers/layer
        folder.mkdir(exist_ok=True)
        if layer == 'depth':
            subtract, divide = depth_setup(scene)
        else:
            mask_setup(scene,layer,actor_ids)
        for frame in selected:
            scene.frame_set(frame)
            bpy.context.view_layer.update()
            if layer == 'depth':
                near, far = scene.camera.data.clip_start, scene.camera.data.clip_end
                if not 0 < near < far:
                    raise ValueError('相机裁剪深度无效')
                subtract.inputs[1].default_value = near
                divide.inputs[1].default_value = far-near
                manifest['cameras'].append({'frame':frame,'clipStart':near,'clipEnd':far})
            path = folder/('frame-%04d.png'%frame)
            scene.render.filepath = str(path)
            bpy.ops.render.render(write_still=True)
            raw = path.read_bytes()
            if not raw:
                raise ValueError('分层渲染为空')
            manifest['files'].append({'layer':layer,'frame':frame,'path':path.relative_to(layers).as_posix(),
                                      'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest()})
            save()
    manifest['complete'] = frames is None and len(manifest['files']) == expected*3
    save()
    return manifest


if __name__ == '__main__':
    args = sys.argv[sys.argv.index('--')+1:]
    manifest = render_layers(args[0],args[2],spec_path=args[1]) if len(args)==3 else render_layers(args[0],args[1])
    print('PREVIS_LAYERS_COMPLETE',len(manifest['files']))
