"""仅检查Blender内存中的分层配置/恢复，不渲染、不导出、不生成媒体。"""
import sys
from pathlib import Path
import bpy
sys.path.insert(0, str(Path(__file__).resolve().parent))
from manhua_vfx_world_layers import restore_render_state
from render_previs_layers import depth_setup
from manhua_vfx_world_quality import configure_world_lighting,physical_material

scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.render.film_transparent = False
scene.render.use_compositing = False
scene.render.image_settings.color_mode = 'RGBA'
scene.render.image_settings.color_depth = '8'
scene.view_settings.exposure = .75
original = [(obj, obj.hide_render, obj.is_holdout, tuple(obj.color)) for obj in scene.objects]
group_count = len(bpy.data.node_groups)
original_samples = scene.eevee.taa_render_samples
original_z = scene.view_layers[0].use_pass_z
original_path = scene.render.filepath
for fail in (False, True, False, True):
    try:
        with restore_render_state(scene):
            scene.render.film_transparent = True
            for obj in scene.objects:
                obj.is_holdout = True; obj.color = (0, 0, 0, 1)
            subtract, divide = depth_setup(scene)
            subtract.inputs[1].default_value = .1
            divide.inputs[1].default_value = 100
            scene.view_settings.exposure = 0
            scene.render.filepath = 'TEST_ONLY'
            scene.display.shading.color_type = 'OBJECT'
            assert scene.render.image_settings.color_depth == '16'
            if fail:raise RuntimeError('TEST_ONLY 中断')
    except RuntimeError as error:
        if not fail:raise
        assert str(error) == 'TEST_ONLY 中断'
    assert len(bpy.data.node_groups) == group_count
    assert scene.eevee.taa_render_samples == original_samples
    assert scene.view_layers[0].use_pass_z == original_z
    assert scene.render.filepath == original_path
    assert scene.render.engine == 'CYCLES'
    assert scene.render.film_transparent is False
    assert scene.render.use_compositing is False
    assert scene.render.image_settings.color_mode == 'RGBA'
    assert scene.render.image_settings.color_depth == '8'
    assert abs(scene.view_settings.exposure - .75) < 1e-6
    for obj, hidden, holdout, color in original:
        assert (obj.hide_render, obj.is_holdout, tuple(obj.color)) == (hidden, holdout, color)
config={'quality':'preview','samples':16,'keyEnergy':1000,'fillRatio':.35,'exposure':.5}
engines={item.identifier for item in scene.render.bl_rna.properties['engine'].enum_items}
scene.render.engine='BLENDER_EEVEE_NEXT' if 'BLENDER_EEVEE_NEXT' in engines else 'BLENDER_EEVEE'
proof=configure_world_lighting(scene,config,[obj for obj in scene.objects if obj.type=='MESH'])
assert proof['samples']==scene.eevee.taa_render_samples==16
config.update(quality='beauty',samples=32)
proof=configure_world_lighting(scene,config,[obj for obj in scene.objects if obj.type=='MESH'])
assert proof['samples']==scene.cycles.samples==32 and scene.render.engine=='CYCLES'
mat,alpha=physical_material('TEST_ONLY',(1,0,0))
assert mat.use_nodes and alpha.default_value==1
print('VFX_LAYER_STATE_TEST_ONLY_PASS: 深度配置/状态恢复/实际采样/物理材质，无渲染')
