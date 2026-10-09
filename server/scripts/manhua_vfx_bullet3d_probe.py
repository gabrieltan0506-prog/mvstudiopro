"""本机Blender真实内存场景探针：不load未知场景、不保存blend、不渲染媒体。"""
import json
import math
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parent))
import bpy
from manhua_vfx_bullet3d import prepare_frozen_scene,update_orbit,geometry_fingerprint,_reject_external_or_driven,validate_orbit_visibility
from manhua_vfx_bullet3d_math import BULLET_DEFAULTS


def main():
    for obj in list(bpy.data.objects):bpy.data.objects.remove(obj,do_unlink=True)
    scene=bpy.context.scene;scene.frame_start=1;scene.frame_end=48;scene.render.fps=24;scene.render.fps_base=1
    bpy.ops.mesh.primitive_cube_add(size=2,location=(0,0,1))
    actor=bpy.context.object;actor.name='真实测试几何'
    actor.location.x=0;actor.keyframe_insert('location',frame=1)
    actor.location.x=2;actor.keyframe_insert('location',frame=25)
    basis=actor.shape_key_add(name='Basis');shape=actor.shape_key_add(name='姿态变形')
    shape.data[0].co.z+=.5;shape.value=0;shape.keyframe_insert('value',frame=1)
    shape.value=1;shape.keyframe_insert('value',frame=25)
    material=bpy.data.materials.new('保留的真实材质');actor.data.materials.append(material)
    bpy.ops.mesh.primitive_cube_add(size=100,location=(0,0,0))
    bpy.context.object.hide_render=True
    hidden_collection=bpy.data.collections.new('渲染隐藏集合');scene.collection.children.link(hidden_collection)
    bpy.ops.mesh.primitive_cube_add(size=200)
    hidden=bpy.context.object
    for collection in list(hidden.users_collection):collection.objects.unlink(hidden)
    hidden_collection.objects.link(hidden);hidden_collection.hide_render=True
    bpy.ops.mesh.primitive_cube_add(size=1,location=(0,2,1))
    viewport_hidden=bpy.context.object;viewport_hidden.hide_viewport=True
    source_collection=bpy.data.collections.new('未直接链接的实例源')
    bpy.ops.mesh.primitive_cube_add(size=1)
    source_object=bpy.context.object
    for collection in list(source_object.users_collection):collection.objects.unlink(source_object)
    source_collection.objects.link(source_object)
    nested_collection=bpy.data.collections.new('嵌套实例源')
    nested=bpy.data.objects.new('嵌套实例',None);nested.instance_type='COLLECTION';nested.instance_collection=source_collection
    nested_collection.objects.link(nested);nested.location=(1,0,0)
    instancer=bpy.data.objects.new('可见实例',None);instancer.instance_type='COLLECTION';instancer.instance_collection=nested_collection
    scene.collection.objects.link(instancer);instancer.location=(3,0,1)
    hidden_instance=bpy.data.objects.new('隐藏实例',None);hidden_instance.instance_type='COLLECTION';hidden_instance.instance_collection=source_collection
    scene.collection.objects.link(hidden_instance);hidden_instance.hide_render=True
    bpy.ops.object.armature_add(location=(0,0,0));rig=bpy.context.object
    bone=rig.pose.bones[0];bone.rotation_mode='XYZ'
    bone.rotation_euler.z=0;bone.keyframe_insert('rotation_euler',frame=1)
    bone.rotation_euler.z=.5;bone.keyframe_insert('rotation_euler',frame=25)
    bpy.ops.object.light_add(type='AREA',location=(2,-2,5));light=bpy.context.object
    light.parent=rig;light.parent_type='BONE';light.parent_bone=bone.name
    light.data.energy=1200;light.data.keyframe_insert('energy',frame=1)
    light.data.energy=2400;light.data.keyframe_insert('energy',frame=25)
    scene.frame_set(13);bpy.context.view_layer.update()
    expected_light_matrix=light.matrix_world.copy();expected_light_energy=light.data.energy
    bpy.ops.object.camera_add(location=(6,-6,3))
    params={**BULLET_DEFAULTS,'target':[1,0,1],'freezeSec':.5,'sceneJobId':'prv_'+'a'*48,
            'sceneScopeId':'00000000-0000-4000-8000-000000000001','clipId':'test-shot'}
    spec={'width':960,'height':540,'fps':30}
    if '--debug-instances' in sys.argv:
        from manhua_vfx_bullet3d import _enable_render_visible_evaluation,_render_members,_render_instances
        _enable_render_visible_evaluation(scene,bpy.context.view_layer);bpy.context.view_layer.update()
        print('VISIBLE',_render_members(bpy.context.view_layer))
        for row in bpy.context.evaluated_depsgraph_get().object_instances:
            print('INSTANCE',row.object.original.name,row.parent.original.name if row.parent else None,row.is_instance,row.show_self,row.parent.original.hide_render if row.parent else None,row.object.original.hide_render,tuple(row.matrix_world.translation))
        print('FILTERED',[(o.name,tuple(m.translation)) for o,m in _render_instances(bpy.context.evaluated_depsgraph_get(),bpy.context.view_layer)])
        return
    handle=prepare_frozen_scene(scene,params,spec,active_frames=30)
    assert handle['sourceScene']['frozenFrame']==13
    assert handle['sourceGeometry']['meshes']==3, (handle['sourceGeometry'],[o.name for o in handle['meshes']])
    assert handle['sourceGeometry']['vertices']==24
    assert handle['sourceGeometry']['nonPlanarThickness']>0
    assert any(material.name in obj.data.materials for obj in handle['meshes'])
    assert light.hide_render
    assert len(handle['lights'])==1
    frozen_light=handle['lights'][0]
    assert frozen_light.parent is None and not frozen_light.constraints
    assert frozen_light.data.energy==expected_light_energy
    assert all(abs(frozen_light.matrix_world[r][c]-expected_light_matrix[r][c])<1e-6 for r in range(4) for c in range(4))
    assert max(handle['sourceGeometry']['maximum'])<10
    assert min(handle['sourceGeometry']['minimum'])>-10
    assert len([obj for obj in scene.objects if obj.type=='CAMERA'])==1
    assert len(handle['visibilitySamples'])==13 and all(s['visibleVertices']>0 for s in handle['visibilitySamples'])
    assert handle['camera'].data.type=='PERSP' and not scene.render.film_transparent
    original_sha=handle['frozenGeometrySHA'];positions=[]
    for progress in (0,.25,.5,.75,1):
        report=update_orbit(handle,params,progress)
        assert report['type']=='PERSP'
        positions.append(report['position'])
        assert report['frozenGeometrySHA']==original_sha
        assert scene.frame_current==13
        assert geometry_fingerprint(handle['meshes'])==original_sha
    assert len({tuple(round(x,8) for x in p) for p in positions})>=3
    assert math.dist(positions[0],positions[-1])<1e-8
    assert math.dist(positions[0],positions[2])>7.9
    try:
        validate_orbit_visibility(handle,{**params,'target':[100,100,100]},spec)
        raise AssertionError('空背景轨道未被拒绝')
    except ValueError as error:assert '视锥' in str(error)
    handle['meshes'][0].data.vertices[0].co.x+=.01
    try:
        update_orbit(handle,params,.5)
        raise AssertionError('变化的冻结几何未被拒绝')
    except ValueError as error:assert '变化' in str(error)
    actor.driver_add('location',1)
    try:
        _reject_external_or_driven(bpy)
        raise AssertionError('脚本驱动未被拒绝')
    except ValueError as error:assert '驱动' in str(error)
    actor.driver_remove('location',1)
    rig.data['guard_probe']=1.
    rig.data.driver_add('["guard_probe"]')
    try:
        _reject_external_or_driven(bpy)
        raise AssertionError('骨架数据driver未被拒绝')
    except ValueError as error:assert '驱动' in str(error)
    print(json.dumps({'complete':True,'mediaRendered':False,'blender':bpy.app.version_string,
                      'sourceGeometry':handle['sourceGeometry'],'frozenFrame':13,'poseSamples':5,
                      'cameraPositions':positions,'frozenGeometrySHA':original_sha,
                      'geometryMutationRejected':True,'materialsLightsPreserved':True,
                      'hiddenCollectionsAndInstancesExcluded':True,'nestedInstancesIncluded':True,
                      'viewportHiddenRenderVisibleIncluded':True,'boneParentedLightFrozen':True,'scriptDriversRejected':True,'visibilitySamples':len(handle['visibilitySamples']),'emptyOrbitRejected':True},ensure_ascii=False))


def budget_probe():
    from manhua_vfx_bullet3d_math import validate_geometry_budget
    bpy.ops.mesh.primitive_cube_add(size=2)
    actual=len(bpy.context.object.data.vertices)
    assert actual==8
    assert validate_geometry_budget(200_000,60)==12_000_000
    try:
        validate_geometry_budget(200_001,60)
        raise AssertionError('超预算未拒绝')
    except ValueError as error:assert '1200万' in str(error)
    assert validate_geometry_budget(actual,30)==240
    for obj in list(bpy.data.objects):bpy.data.objects.remove(obj,do_unlink=True)
    scene=bpy.context.scene;scene.frame_start=1;scene.frame_end=60;scene.render.fps=24;scene.render.fps_base=1
    mesh=bpy.data.meshes.new('仅预算测试数据')
    mesh.from_pydata([(0.,0.,0.)]*200_001,[],[(0,1,2)])
    obj=bpy.data.objects.new('预算边界实际网格',mesh);scene.collection.objects.link(obj)
    p={**BULLET_DEFAULTS,'sceneJobId':'prv_'+'a'*48,'sceneScopeId':'00000000-0000-4000-8000-000000000001','clipId':'budget'}
    try:
        prepare_frozen_scene(scene,p,{'width':96,'height':96,'fps':60},active_frames=60)
        raise AssertionError('实际冻结消费者未在渲染前拒绝超预算')
    except ValueError as error:assert '1200万' in str(error)
    assert not obj.hide_render
    print(json.dumps({'complete':True,'mediaRendered':False,'actualMeshVertices':actual,
                      'exactBudgetAccepted':12_000_000,'overBudgetRejected':True,'freezeConsumerRejectedBeforeRender':True},ensure_ascii=False))


if __name__=='__main__':
    budget_probe() if '--budget' in sys.argv else main()
