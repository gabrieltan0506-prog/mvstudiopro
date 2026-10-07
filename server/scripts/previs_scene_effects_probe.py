"""Synthetic scene-effect development probes; select only changed/uncovered modes."""
import hashlib
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector

sys.path.insert(0,str(Path(__file__).resolve().parent))
from previs_scene_effects import build_scene_effects,measure_scene_effects,validate_scene_effects,_world_vertices,_write


def setup(frames=48):
    for obj in list(bpy.context.scene.objects):bpy.data.objects.remove(obj,do_unlink=True)
    scene=bpy.context.scene;scene.frame_start=1;scene.frame_end=frames;scene.render.fps=24;scene.render.fps_base=1
    scene.render.engine='BLENDER_WORKBENCH'
    scene.render.resolution_x=720;scene.render.resolution_y=480;scene.render.resolution_percentage=100
    scene.render.image_settings.file_format='PNG';scene.render.image_settings.color_mode='RGBA'
    scene.world.color=(.035,.045,.07)
    scene.view_settings.view_transform='Standard'
    material=bpy.data.materials.new('Fixture_shared_material');material.diffuse_color=(.45,.51,.61,1)
    bindings=[]
    for index,y in enumerate((-1.4,0,1.4)):
        actor_id='fixture_actor_%d'%index
        armature=bpy.data.armatures.new(actor_id);rig=bpy.data.objects.new(actor_id,armature);scene.collection.objects.link(rig)
        bpy.context.view_layer.objects.active=rig;rig.select_set(True)
        bpy.ops.object.mode_set(mode='EDIT')
        bone=armature.edit_bones.new('spine');bone.head=(0,0,1.0);bone.tail=(0,0,1.55)
        bpy.ops.object.mode_set(mode='OBJECT')
        rig.location=(0,y,0)
        meshes=[]
        for part,location,scale in (('body',(0,0,1.05),(.17,.23,.5)),('head',(0,0,1.8),(.18,.18,.22)),('base',(0,0,.36),(.14,.2,.25))):
            bpy.ops.mesh.primitive_uv_sphere_add(segments=16,ring_count=8,location=location)
            obj=bpy.context.object;obj.name=actor_id+'_'+part;obj.scale=scale
            bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
            obj.parent=rig;obj.data.materials.append(material)
            group=obj.vertex_groups.new(name='spine');group.add(list(range(len(obj.data.vertices))),1,'REPLACE')
            modifier=obj.modifiers.new('Fixture_true_armature','ARMATURE');modifier.object=rig
            meshes.append(obj)
        for frame in range(1,frames+1):
            q=(frame-1)/max(1,frames-1)
            rig.location=(.12*math.sin(q*math.tau),y,0)
            rig.rotation_euler.z=.18*math.sin(q*math.tau)
            rig.keyframe_insert('location',frame=frame);rig.keyframe_insert('rotation_euler',frame=frame)
        bindings.append({'actorId':actor_id,'rig':rig,'meshes':meshes,'boneMap':{'spine':'spine'}})
    bpy.ops.mesh.primitive_cube_add(size=1,location=(0,0,-.06))
    ground=bpy.context.object;ground.name='地面';ground.scale=(10,10,.12)
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    floor=bpy.data.materials.new('Fixture_ground');floor.diffuse_color=(.085,.10,.14,1);ground.data.materials.append(floor)
    bpy.ops.object.camera_add(location=(-5,-6,3.5))
    camera=bpy.context.object;camera.rotation_euler=(Vector((0,0,1.0))-camera.location).to_track_quat('-Z','Y').to_euler()
    camera.data.type='ORTHO';camera.data.ortho_scale=5.5;scene.camera=camera
    scene.frame_set(1);bpy.context.view_layer.update()
    return scene,bindings,material


def cloth(output):
    out=Path(output);out.mkdir(parents=True,exist_ok=True)
    scene,bindings,original=setup()
    events=[{'id':'cape','kind':'cape','actorId':bindings[0]['actorId'],'width':.75,'length':1.05,'color':'#cf294d','wind':[-2,0,0]},
            {'id':'hologram','kind':'hologram','actorId':bindings[1]['actorId'],'color':'#55cfff','intensity':1.6},
            {'id':'gradient','kind':'attribute_color','actorId':bindings[2]['actorId'],'color':'#254fee','colorEnd':'#ffad45'}]
    _write(out/'events.raw.json',events)
    original_node_state=original.use_nodes
    original_meshes={obj.name:len(obj.data.vertices) for b in bindings for obj in b['meshes']}
    handles=build_scene_effects(events,scene,bindings,evidence_dir=out)
    report=measure_scene_effects(handles,scene);_write(out/'report.json',report)
    assert len(report)==3 and all(len(row['samples'])==48 for row in report)
    cape=handles[0]['cloth']
    assert cape.get('manhua_scene_effect_actor')==bindings[0]['actorId']
    assert all(row['finiteBounds'] and row['pinError']<.03 and row['bakedPlayback'] for row in report[0]['samples'])
    assert max(row['maxMotionFromRest'] for row in report[0]['samples'])>.025
    assert all(row['collisionMeshes']==10 for row in report[0]['samples'])
    assert original.use_nodes==original_node_state,'Unselected original material mutated'
    assert all(len(bpy.data.objects[name].data.vertices)==count for name,count in original_meshes.items())
    for index in (1,2):
        assert all(obj.data.materials[0]!=original for obj in bindings[index]['meshes'])
    attribute=bindings[2]['meshes'][0].data.color_attributes['scene_effect_gradient']
    assert len({tuple(round(c,3) for c in row.color) for row in attribute.data})>2
    # Real pixels for actual selected meshes and simulated cloth, then reopen the baked scene.
    for frame in (1,24,48):
        scene.frame_set(frame);scene.render.filepath=str(out/('frame-%04d.png'%frame));bpy.ops.render.render(write_still=True)
    before={}
    for frame in (1,12,24,36,48):
        scene.frame_set(frame);bpy.context.view_layer.update()
        before[frame]=[tuple(p) for p in _world_vertices(cape,bpy.context.evaluated_depsgraph_get())]
    cape_name=cape.name
    bpy.ops.wm.save_as_mainfile(filepath=str(out/'scene.blend'))
    bpy.ops.wm.open_mainfile(filepath=str(out/'scene.blend'))
    scene=bpy.context.scene;cape=bpy.data.objects[cape_name]
    assert not any(m.type=='CLOTH' for m in cape.modifiers)
    maximum=0
    for frame,points in before.items():
        scene.frame_set(frame);bpy.context.view_layer.update()
        actual=_world_vertices(cape,bpy.context.evaluated_depsgraph_get())
        maximum=max(maximum,max((p-Vector(q)).length for p,q in zip(actual,points)))
    assert maximum<1e-6,maximum
    result={'syntheticDevelopmentOnly':True,'workflowAcceptance':False,'blender':bpy.app.version_string,
            'trueClothSimulated':True,'clothVertices':len(cape.data.vertices),'frames':48,
            'maxPinError':max(r['pinError'] for r in report[0]['samples']),
            'maxMovement':max(r['maxMotionFromRest'] for r in report[0]['samples']),
            'maxEstimatedPenetration':max(r['estimatedPenetration'] for r in report[0]['samples']),
            'bakedReopenMaximumError':maximum,'materialsIsolated':True,'originalMeshTopologyPreserved':True,
            'fullReportEntries':144}
    _write(out/'result.json',result);print('SCENE_EFFECT_CLOTH_MATERIAL_PASS '+json.dumps(result),flush=True)


def explode(output):
    out=Path(output);out.mkdir(parents=True,exist_ok=True)
    scene,bindings,original=setup(frames=24)
    event={'id':'parts','kind':'explode','actorId':bindings[0]['actorId'],'distance':.6,'startSec':0,'durationSec':.75}
    _write(out/'events.raw.json',[event])
    handles=build_scene_effects([event],scene,bindings,evidence_dir=out)
    report=measure_scene_effects(handles,scene);_write(out/'report.json',report)
    assert len(report)==1 and len(report[0]['samples'])==24
    assert all(part['maxVertexOffsetError']<1e-5 for row in report[0]['samples'] for part in row['parts'])
    assert all(abs(Vector(part['actualOffset']).length-.6)<1e-5 for part in report[0]['samples'][-1]['parts'])
    for frame in (1,24):
        scene.frame_set(frame);scene.render.filepath=str(out/('frame-%04d.png'%frame));bpy.ops.render.render(write_still=True)
    bad={**bindings[0],'meshes':bindings[0]['meshes'][:1]}
    try:validate_scene_effects([event],scene,[bad]);raise AssertionError('Single mesh falsely accepted')
    except ValueError as error:assert 'independent meshes' in str(error)
    result={'syntheticDevelopmentOnly':True,'workflowAcceptance':False,'independentParts':3,'frames':24,
            'maximumMeasuredOffsetError':max(p['maxVertexOffsetError'] for r in report[0]['samples'] for p in r['parts']),
            'singleMeshRejected':True,'actualArmatureMeshesUsed':True}
    _write(out/'result.json',result);print('SCENE_EFFECT_EXPLODE_PASS '+json.dumps(result),flush=True)


def label(output):
    out=Path(output);out.mkdir(parents=True,exist_ok=True)
    scene,bindings,_=setup(48)
    for frame in range(1,49):
        scene.frame_set(frame)
        scene.camera.location.x=-5+(frame-1)/47;scene.camera.keyframe_insert('location',frame=frame)
        for obj in bindings[0]['meshes']:
            obj.hide_render=frame>36;obj.keyframe_insert('hide_render',frame=frame)
    events=[{'id':'label','kind':'label','actorId':bindings[0]['actorId'],'bone':'spine','text':'骨骼挂点',
             'color':'#ffffff','offset':[0,-.4,.3],'fontSize':.16}]
    _write(out/'events.raw.json',events)
    handles=build_scene_effects(events,scene,bindings,evidence_dir=out)
    for frame in range(1,49):
        scene.frame_set(frame)
        for obj in handles[0]['objects']:
            obj.hide_viewport=frame>36;obj.keyframe_insert('hide_viewport',frame=frame)
    report=measure_scene_effects(handles,scene);_write(out/'report.json',report)
    assert len(report[0]['samples'])==48
    assert max(s['attachmentError'] for s in report[0]['samples'])<1e-5
    assert all(s['font']['packed'] and s['font']['glyphCoverageVerified'] for s in report[0]['samples'])
    scene.frame_set(48)
    assert all(o.hide_viewport and o.hide_render for o in handles[0]['objects'])
    scene.frame_set(24);scene.render.filepath=str(out/'label-visible.png');bpy.ops.render.render(write_still=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(out/'scene.blend'))
    _write(out/'result.json',{'syntheticDevelopmentOnly':True,'workflowAcceptance':False,'frames':48,
                             'hiddenMeasurementDoesNotChangeVisibility':True,'font':handles[0]['font'],
                             'maxAttachmentError':max(s['attachmentError'] for s in report[0]['samples'])})
    print('LABEL_HIDDEN_PROBE_PASS')


if __name__=='__main__':
    args=sys.argv[sys.argv.index('--')+1:]
    if len(args)!=2 or args[0] not in ('cloth','explode','label'):raise SystemExit('Expected cloth|explode|label output')
    {'cloth':cloth,'explode':explode,'label':label}[args[0]](args[1])
