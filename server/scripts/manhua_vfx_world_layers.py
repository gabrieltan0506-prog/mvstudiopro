"""同相机、同资产分层；相互受光由消费者保存差值，不能移用至新模型画面。"""
from contextlib import contextmanager
import hashlib
from pathlib import Path


@contextmanager
def restore_render_state(scene):
    import bpy
    render = scene.render
    settings = render.image_settings
    saved = (render.engine, render.film_transparent, render.use_compositing,
             settings.color_mode, settings.color_depth, scene.use_nodes,
             scene.view_settings.view_transform, scene.view_settings.exposure,
             scene.view_settings.gamma, render.dither_intensity)
    filepath = render.filepath
    shading = scene.display.shading
    shading_keys = ('light', 'color_type', 'show_shadows', 'show_cavity',
                    'show_specular_highlight', 'show_object_outline', 'background_type')
    shading_state = {key: getattr(shading, key) for key in shading_keys}
    aa = getattr(scene.display, 'render_aa', None)
    z_pass = scene.view_layers[0].use_pass_z
    eevee_samples = getattr(getattr(scene, 'eevee', None), 'taa_render_samples', None)
    compositor = getattr(scene, 'compositing_node_group', None)
    node_groups = set(bpy.data.node_groups)
    objects = [(obj, obj.hide_render, obj.is_holdout, tuple(obj.color)) for obj in scene.objects]
    world_color = tuple(scene.world.color) if scene.world else None
    try:
        yield
    finally:
        (render.engine, render.film_transparent, render.use_compositing,
         settings.color_mode, settings.color_depth, scene.use_nodes,
         scene.view_settings.view_transform, scene.view_settings.exposure,
         scene.view_settings.gamma, render.dither_intensity) = saved
        render.filepath = filepath
        for key, value in shading_state.items():setattr(shading, key, value)
        if aa is not None:scene.display.render_aa = aa
        scene.view_layers[0].use_pass_z = z_pass
        if eevee_samples is not None:scene.eevee.taa_render_samples = eevee_samples
        if hasattr(scene, 'compositing_node_group'):
            temporary_tree = scene.compositing_node_group
            scene.compositing_node_group = compositor
            if temporary_tree and temporary_tree not in node_groups and temporary_tree.users == 0:
                bpy.data.node_groups.remove(temporary_tree)
        for obj, hidden, holdout, color in objects:
            obj.hide_render, obj.is_holdout, obj.color = hidden, holdout, color
        if world_color is not None:scene.world.color = world_color
        bpy.context.view_layer.update()


def render_world_layers(scene, handle, output, frame, active):
    import bpy
    from manhua_vfx_bullet3d import _transparent_png
    from render_previs_layers import depth_setup
    root = Path(output) / 'separated'
    width, height = scene.render.resolution_x, scene.render.resolution_y
    fragments = set(handle['prop']['objects'])
    actors = set(handle['actors'])
    files = []
    near, far = scene.camera.data.clip_start, scene.camera.data.clip_end
    if not 0 < near < far:raise ValueError('分层相机裁剪范围无效')
    for layer in ('plate', 'fragments', 'actors', 'depth'):
        folder = root / layer;folder.mkdir(parents=True, exist_ok=True)
        target = folder / ('frame-%06d.png' % frame)
        if target.exists():raise ValueError('分层目标已存在，禁止覆盖')
        if not active:
            # 非活动帧不被消费者读取，仅保留明确的透明占位及inactive标记。
            target.write_bytes(_transparent_png(width, height))
        else:
            with restore_render_state(scene):
                if layer == 'plate':
                    for obj in fragments:obj.hide_render = True
                elif layer == 'fragments':
                    if scene.render.engine != 'CYCLES':raise ValueError('透明碎片分层须使用精细受光')
                    scene.render.film_transparent = True
                    for obj in scene.objects:
                        if obj.type in ('MESH', 'CURVE', 'FONT', 'SURFACE', 'META') and obj not in fragments:
                            obj.is_holdout = True
                else:
                    scene.view_settings.view_transform = 'Raw'
                    scene.view_settings.exposure, scene.view_settings.gamma = 0, 1
                    scene.render.dither_intensity = 0
                    if layer == 'actors':
                        scene.render.engine = 'BLENDER_WORKBENCH'
                        scene.render.use_compositing = False;scene.use_nodes = False
                        shading = scene.display.shading
                        shading.light, shading.color_type = 'FLAT', 'OBJECT'
                        shading.show_shadows = shading.show_cavity = shading.show_specular_highlight = False
                        shading.show_object_outline = False;shading.background_type = 'WORLD'
                        scene.world.color = (0, 0, 0)
                        scene.render.film_transparent = False
                        if hasattr(scene.display, 'render_aa'):scene.display.render_aa = 'OFF'
                        for obj in scene.objects:
                            value = float(obj in actors);obj.color = (value, value, value, 1)
                        scene.render.image_settings.color_mode = 'BW'
                    else:
                        subtract, divide = depth_setup(scene)
                        subtract.inputs[1].default_value = near
                        divide.inputs[1].default_value = far - near
                scene.render.filepath = str(target)
                bpy.context.view_layer.update()
                bpy.ops.render.render(write_still=True)
        data = target.read_bytes()
        if not 0 < len(data) <= 32 * 1024 ** 2:raise ValueError('分层图像为空或超限')
        files.append({'layer': layer, 'frame': frame, 'active': active,
                      'path': target.relative_to(Path(output)).as_posix(), 'bytes': len(data),
                      'sha256': hashlib.sha256(data).hexdigest()})
        print('MANHUA_VFX_PROGRESS layer=%s frame=%d' % (layer, frame), flush=True)
    return {'frame': frame, 'active': active, 'clipStart': near, 'clipEnd': far,
            'cameraMatrixWorld': [list(row) for row in scene.camera.matrix_world], 'files': files}
