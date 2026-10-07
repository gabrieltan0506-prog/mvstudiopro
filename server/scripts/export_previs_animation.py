"""Fixed server exporter: evaluated native previs scene -> GLB + exact frame camera/visibility.
No arbitrary scene input, scripts, frame sampling, or provider calls.
"""
import bpy
import json
import math
import sys
from pathlib import Path

out = Path(sys.argv[sys.argv.index('--') + 1])
scene = bpy.context.scene
objects = [obj for obj in scene.objects if obj.get('previs_animation_object')]
if not objects or not scene.camera:
    raise ValueError('Native animation objects or camera missing')
frames = []
for frame in range(scene.frame_start, scene.frame_end + 1):
    scene.frame_set(frame)
    bpy.context.view_layer.update()
    camera = scene.camera.evaluated_get(bpy.context.evaluated_depsgraph_get())
    projection = camera.calc_matrix_camera(bpy.context.evaluated_depsgraph_get(),
        x=scene.render.resolution_x, y=scene.render.resolution_y,
        scale_x=scene.render.pixel_aspect_x, scale_y=scene.render.pixel_aspect_y)
    position, quaternion, _ = camera.matrix_world.decompose()
    frames.append({'frame': frame, 'timeSec': (frame-scene.frame_start)/scene.render.fps,
        'camera': {'position': list(position), 'quaternionXYZW': [quaternion.x,quaternion.y,quaternion.z,quaternion.w],
            'vfovRad': 2*math.atan(1/projection[1][1])},
        'visibleObjectIds': [obj.name for obj in objects if obj.type=='MESH' and not obj.hide_render]})
# Raw evaluated observations are saved before exporter or validation, including failures.
raw = {'version':1, 'fps':scene.render.fps, 'frames':frames,
    'width':scene.render.resolution_x, 'height':scene.render.resolution_y,
    'coordinateSystem':'stage-z-up-meters',
    'boundaryZh':'沿用实际白模网格、骨骼与逐帧相机；未替换高清贴图，不包含高斯场景、声音或影视特效验收。'}
(out/'animation.raw.json').write_text(json.dumps(raw,ensure_ascii=False))
selected = set(objects)
for obj in list(selected):
    parent = obj.parent
    while parent:
        selected.add(parent)
        parent = parent.parent
    for modifier in obj.modifiers:
        if modifier.type=='ARMATURE' and modifier.object:
            selected.add(modifier.object)
for obj in scene.objects:
    obj.select_set(False)
for obj in selected:
    obj.hide_set(False)
    obj.hide_viewport=False
    obj.select_set(True)
    if obj.type=='MESH': obj['previsObjectId']=obj.name
scene.frame_set(scene.frame_start)
props=bpy.ops.export_scene.gltf.get_rna_type().properties
# 3.4 (Fly) lacks SCENE export. Bake evaluated object/bone transforms at every
# frame with Blender's visual-keying operator, then merge the selected active
# actions. This keeps native constraints/retarget motion; it is not a static fallback.
options = dict(filepath=str(out/'animation.glb'), export_format='GLB',
    use_selection=True, export_animations=True, export_force_sampling=True,
    export_frame_range=True, export_frame_step=1, export_skins=True,
    export_extras=True, export_cameras=False)
if 'export_animation_mode' in props and 'SCENE' in [e.identifier for e in props['export_animation_mode'].enum_items]:
    options['export_animation_mode']='SCENE'
else:
    bpy.context.view_layer.objects.active=next((obj for obj in selected if obj.type=='ARMATURE'),objects[0])
    bpy.ops.nla.bake(frame_start=scene.frame_start, frame_end=scene.frame_end,
        step=1, only_selected=False, visual_keying=True, clear_constraints=True,
        clear_parents=False, use_current_action=False, bake_types={'POSE','OBJECT'})
    options['export_nla_strips']=False
    if 'export_anim_single_armature' in props: options['export_anim_single_armature']=False
bpy.ops.export_scene.gltf(**options)
print('MANHUA_ANIMATION_EXPORTED')
