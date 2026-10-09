"""现有Blender服务端API调用的三维道具碎裂生产者。"""
from manhua_vfx_prop_math import prop_fragments, fragment_pose


def build_prop_fracture(event, spec, scene, make_material, color):
    import bpy
    fragments=prop_fragments(event,spec['seed'])
    palette={'ceramic':color,'coffee':(.07,.025,.008),'wood':(.24,.105,.035),
             'lemon':(.85,.61,.012),'apple':(.55,.018,.013),'flesh':(.93,.73,.32),
             'juice':(.76,.35,.02),'petal':(.60,.018,.045),'paper':color}
    materials={};opacities=[]
    # 基于真实几何法线的受光明暗，每个碎片旋转时更新；无灯光仿真/重照原片的声称。
    for key,rgb in palette.items():
        mat,alpha=make_material(event['id']+'_'+key,rgb)
        nodes,links=mat.node_tree.nodes,mat.node_tree.links
        geometry=nodes.new('ShaderNodeNewGeometry')
        dot=nodes.new('ShaderNodeVectorMath');dot.operation='DOT_PRODUCT'
        dot.inputs[1].default_value=(-.35,.55,.75)
        links.new(geometry.outputs['Normal'],dot.inputs[0])
        shade=nodes.new('ShaderNodeMapRange');shade.clamp=True
        shade.inputs['From Min'].default_value=-1;shade.inputs['From Max'].default_value=1
        shade.inputs['To Min'].default_value=.34;shade.inputs['To Max'].default_value=1
        links.new(dot.outputs['Value'],shade.inputs['Value'])
        emission=next(node for node in nodes if node.type=='EMISSION')
        links.new(shade.outputs['Result'],emission.inputs['Strength'])
        materials[key]=mat;opacities.append(alpha)
    objects=[]
    for index,fragment in enumerate(fragments):
        mesh=bpy.data.meshes.new(event['id']+'_part_'+str(index))
        mesh.from_pydata(fragment['vertices'],[],fragment['faces']);mesh.update()
        names=list(dict.fromkeys(fragment['faceMaterials'] or [fragment['material']]))
        for name in names:mesh.materials.append(materials[name])
        if fragment['faceMaterials']:
            for polygon,name in zip(mesh.polygons,fragment['faceMaterials']):polygon.material_index=names.index(name)
        obj=bpy.data.objects.new(mesh.name,mesh);scene.collection.objects.link(obj)
        obj.location=fragment['center'];objects.append(obj)
    return {'objects':objects,'fragments':fragments,'opacity':opacities}


def update_prop_fracture(handle,event,time,state):
    import hashlib
    import json
    poses=[]
    for obj,fragment in zip(handle['objects'],handle['fragments']):
        pose=fragment_pose(fragment,time-event['startSec'],event['prop'])
        obj.location=pose['position'];obj.rotation_euler=pose['rotation']
        obj.hide_render=not state['active'] or not pose['visible'] or event['intensity']==0
        poses.append(pose)
    for alpha in handle['opacity']:
        alpha.default_value=min(1.,state['opacity']*2)
    return {'geometry':'closed-ceramic-and-handle' if event['kind']=='cup_fracture' else 'fruit-wedges-crates-petals-paper',
            'fragmentCount':len(poses),'explodedFragments':sum(p['exploded'] for p in poses),
            'visibleFragments':sum(p['visible'] and state['active'] and event['intensity']>0 for p in poses),
            'poseSha256':hashlib.sha256(json.dumps(poses,sort_keys=True).encode()).hexdigest(),
            'held':event['prop']['holdStartSec']<=time-event['startSec']<event['prop']['holdStartSec']+event['prop']['holdDurationSec'],
            'impactSec':event['startSec']+event['prop']['impactSec'],
            'boundaryZh':'真实三维程序道具叠加；不抠除原片物体、不计算人物遮挡；原片原声不变速。'}
