"""飞针光尾、骨锚针位黑气与真实头颈气色；有界程序效果，不提交任何外部任务。"""
import math
import bpy
from mathutils import Vector

KINDS=frozenset(('needle_trail','acupoint_smoke','complexion'))
FIELDS={
    'needle_trail':{'startSec','endSec','propId','color','radius','trailSec'},
    'acupoint_smoke':{'startSec','endSec','propId','color','radius','rise','density','offset'},
    'complexion':{'startSec','endSec','color','strength'},
}
BOUNDARIES={
    'needle_trail':'跟随本次真实针轨迹的有界连续短光尾；不是手指动画或针灸动作质量验收。',
    'acupoint_smoke':'从已绑定该角色的落针骨锚发出程序体积黑气，随针位移动并消散；不是医学效果或真实流体模拟。',
    'complexion':'使用当前带骨模型真实头颈权重局部混合暖色，保留基础纹理；不改变表情或角色身份，画面效果须实际审片。',
}

def _number(value,lo,hi):
    if isinstance(value,bool) or not isinstance(value,(int,float)) or not math.isfinite(value) or not lo<=value<=hi:
        raise ValueError('剧情特效参数越界')

def validate(e,scene,binding,props):
    fps=scene.render.fps/scene.render.fps_base
    _number(e['startSec'],0,30);_number(e['endSec'],1/fps,30)
    if e['startSec']>=e['endSec'] or e['endSec']>(scene.frame_end-1)/fps+1e-8 or any(abs(t*fps-round(t*fps))>1e-6 for t in (e['startSec'],e['endSec'])):
        raise ValueError('剧情特效时间窗须位于片内并对齐帧')
    if e['kind']=='acupoint_smoke' and e['endSec']-e['startSec']<.25-1e-8:raise ValueError('针位黑气时间过短')
    if e['kind']=='complexion':
        if e['endSec']-e['startSec']<.5-1e-8:raise ValueError('气色渐变时间过短')
        _number(e['strength'],.01,.35)
        if not binding.get('isRiggedModel') or binding.get('shape')!='human':raise ValueError('气色效果需要真实带骨人形模型')
        for semantic in ('head','neck'):
            if binding.get('boneMap',{}).get(semantic,semantic) not in binding['rig'].pose.bones:raise ValueError('气色效果缺少真实头颈骨')
        return
    handle=next((p for p in props if p['spec']['id']==e['propId']),None)
    if handle is None or handle['spec']['kind']!='needle' or len(handle['samples'])!=scene.frame_end:
        raise ValueError('剧情特效必须引用本次完整针道具轨迹')
    if not all(row['visible'] for row in handle['samples'] if e['startSec']<=(row['frame']-1)/fps<=e['endSec']):
        raise ValueError('特效窗口不能覆盖隐藏的针')
    if e['kind']=='needle_trail':
        _number(e['radius'],.001,.02);_number(e['trailSec'],1/24,.5)
    else:
        _number(e['radius'],.01,.12);_number(e['rise'],.05,.6);_number(e['density'],1,30)
        if not isinstance(e['offset'],list) or len(e['offset'])!=3:raise ValueError('针位偏移须三维向量')
        for value in e['offset']:_number(value,-.3,.3)
        frames=handle['spec']['keyframes']
        for a,b in zip(frames,frames[1:]):
            if a['timeSec']>e['endSec'] or b['timeSec']<=e['startSec']:continue
            if any(f['anchor']['type']!='bone' or f['anchor']['actorId']!=e['actorId'] for f in (a,b)):
                raise ValueError('黑气须在针落到对应角色骨锚之后')

def _linear(color):
    c=tuple(int(color[i:i+2],16)/255 for i in (1,3,5))
    return tuple(v/12.92 if v<=.04045 else ((v+.055)/1.055)**2.4 for v in c)

def _emission(name,color):
    m=bpy.data.materials.new(name);m.use_nodes=True;n=m.node_tree.nodes;n.clear()
    shader=n.new('ShaderNodeEmission');shader.inputs[0].default_value=(*_linear(color),1);shader.inputs[1].default_value=3
    output=n.new('ShaderNodeOutputMaterial');m.node_tree.links.new(shader.outputs[0],output.inputs['Surface']);return m

def _prop_positions(handle,scene):
    values=[]
    for f in range(1,scene.frame_end+1):
        scene.frame_set(f);bpy.context.view_layer.update();values.append(handle['objects'][0].matrix_world.translation.copy())
    return values

def _tail(e,binding,scene,prop):
    fps=scene.render.fps/scene.render.fps_base;positions=_prop_positions(prop,scene);objects=[]
    count=max(1,math.ceil(e['trailSec']*fps));material=_emission(e['id']+'_针芒',e['color'])
    first=round(e['startSec']*fps)
    for i in range(count):
        bpy.ops.mesh.primitive_cylinder_add(vertices=8,radius=1,depth=2)
        o=bpy.context.object;o.name=e['id']+'_光尾_'+str(i);o.data.materials.append(material);o['previs_animation_object']=True;objects.append(o)
        for f in range(1,scene.frame_end+1):
            t=(f-1)/fps;a=positions[max(first,min(scene.frame_end-1,f-1-i))];b=positions[max(first,min(scene.frame_end-1,f-2-i))];delta=b-a
            active=e['startSec']<=t<=e['endSec'] and delta.length>1e-6
            radius=e['radius']*(1-i/(count+1)) if active else 1e-6
            o.location=(a+b)/2;o.rotation_euler=(delta if delta.length>1e-6 else Vector((0,0,1))).to_track_quat('Z','Y').to_euler();o.scale=(radius,radius,delta.length/2 if active else 1e-6)
            for key in ('location','rotation_euler','scale'):o.keyframe_insert(key,frame=f)
    return {'event':e,'binding':binding,'objects':objects,'prop':prop,'positions':positions,'segmentCount':count}

def _smoke(e,binding,scene,prop):
    fps=scene.render.fps/scene.render.fps_base;positions=_prop_positions(prop,scene);objects=[];densities=[];origins=[]
    duration=e['endSec']-e['startSec'];lifetime=min(.7,duration*.75)
    for i in range(5):
        birth=e['startSec']+i*(duration-lifetime)/4
        bpy.ops.mesh.primitive_uv_sphere_add(segments=12,ring_count=8,radius=1)
        o=bpy.context.object;o.name=e['id']+'_黑气_'+str(i);o['previs_animation_object']=True;objects.append(o)
        m=bpy.data.materials.new(o.name);m.use_nodes=True;n=m.node_tree.nodes;n.clear();links=m.node_tree.links
        v=n.new('ShaderNodeVolumePrincipled');v.inputs['Color'].default_value=(*_linear(e['color']),1);v.inputs['Anisotropy'].default_value=.1
        noise=n.new('ShaderNodeTexNoise');noise.inputs['Scale'].default_value=3;noise.inputs['Detail'].default_value=3
        ramp=n.new('ShaderNodeValToRGB');ramp.color_ramp.elements[0].position=.35;ramp.color_ramp.elements[1].position=.7
        mult=n.new('ShaderNodeMath');mult.operation='MULTIPLY';output=n.new('ShaderNodeOutputMaterial')
        links.new(noise.outputs['Fac'],ramp.inputs[0]);links.new(ramp.outputs[0],mult.inputs[0]);links.new(mult.outputs[0],v.inputs['Density']);links.new(v.outputs[0],output.inputs['Volume']);o.data.materials.append(m);densities.append(mult.inputs[1])
        origin=bpy.data.objects.new(o.name+'_针位',None);scene.collection.objects.link(origin);origins.append(origin)
        for f in range(1,scene.frame_end+1):
            t=(f-1)/fps;u=max(0.,min(1.,(t-birth)/lifetime));active=birth<=t<=birth+lifetime
            anchor=positions[f-1]+Vector(e['offset']);origin.location=anchor;origin.keyframe_insert('location',frame=f)
            o.location=anchor+Vector((e['radius']*.6*math.sin(i+u*3),e['radius']*.4*math.cos(i+u*2),e['rise']*u))
            radius=e['radius']*(.35+.65*u) if active else 1e-6;o.scale=(radius,radius,radius*1.5)
            mult.inputs[1].default_value=e['density']*math.sin(math.pi*u)**.5 if active else 0
            o.keyframe_insert('location',frame=f);o.keyframe_insert('scale',frame=f);mult.inputs[1].keyframe_insert('default_value',frame=f)
    return {'event':e,'binding':binding,'objects':objects,'prop':prop,'positions':positions,'densities':densities,'origins':origins}

def _complexion(e,binding,scene):
    from previs_animation_materials import restore_animation_materials
    meshes=binding['meshes'];restore_animation_materials(meshes)
    head=binding['boneMap']['head'];neck=binding['boneMap']['neck'];records=[];sockets=[];masked=0
    for obj in meshes:
        if obj.data.users>1:obj.data=obj.data.copy()
        groups={g.index:(1 if g.name==head else .3) for g in obj.vertex_groups if g.name in (head,neck)}
        weights=[min(1.,sum(g.weight*groups.get(g.group,0) for g in v.groups)) for v in obj.data.vertices]
        count=sum(w>.05 for w in weights)
        if not count:continue
        masked+=count;name=e['id']+'_头颈权重';attribute=obj.data.attributes.new(name=name,type='FLOAT',domain='POINT')
        for item,weight in zip(attribute.data,weights):item.value=weight
        for index,mat in enumerate(list(obj.data.materials)):
            if not mat or not mat.use_nodes:raise ValueError('气色渐变缺少原始纹理材质')
            mat=mat.copy();obj.data.materials[index]=mat;nodes=mat.node_tree.nodes;links=mat.node_tree.links
            p=next((n for n in nodes if n.type=='BSDF_PRINCIPLED'),None)
            if p is None or not p.inputs['Base Color'].is_linked:raise ValueError('气色渐变需要可追溯的原始基础色贴图')
            source=p.inputs['Base Color'].links[0].from_socket
            if not any(n.type=='TEX_IMAGE' and n.image and n.image.packed_file for n in nodes):raise ValueError('气色渐变缺少已内嵌原贴图')
            mask=nodes.new('ShaderNodeAttribute');mask.attribute_name=name
            mix=nodes.new('ShaderNodeMixRGB');mix.name=e['id']+'_气色混合';mix.blend_type='MIX';mix.inputs[2].default_value=(*_linear(e['color']),1);links.new(source,mix.inputs[1])
            # 深色头发与眼部保留：头颈权重乘以原纹理亮度，再受有界强度驱动。
            luma=nodes.new('ShaderNodeRGBToBW');links.new(source,luma.inputs[0]);skin=nodes.new('ShaderNodeMapRange');skin.clamp=True;skin.inputs['From Min'].default_value=.025;skin.inputs['From Max'].default_value=.2;skin.inputs['To Min'].default_value=0;skin.inputs['To Max'].default_value=1;links.new(luma.outputs[0],skin.inputs['Value']);weight=nodes.new('ShaderNodeMath');weight.operation='MULTIPLY';links.new(mask.outputs['Fac'],weight.inputs[0]);links.new(skin.outputs['Result'],weight.inputs[1])
            fac=nodes.new('ShaderNodeMath');fac.name=e['id']+'_时间强度';fac.operation='MULTIPLY';links.new(weight.outputs[0],fac.inputs[0]);links.new(fac.outputs[0],mix.inputs[0]);links.new(mix.outputs[0],p.inputs['Base Color']);sockets.append(fac.inputs[1])
            fps=scene.render.fps/scene.render.fps_base
            for f in range(1,scene.frame_end+1):
                u=max(0.,min(1.,((f-1)/fps-e['startSec'])/(e['endSec']-e['startSec'])))
                fac.inputs[1].default_value=e['strength']*u*u*(3-2*u);fac.inputs[1].keyframe_insert('default_value',frame=f)
            records.append({'mesh':obj.name,'material':mat.name,'maskAttribute':name,'maskedVertices':count,'sourceNode':source.node.name})
    if not records or masked==0:raise ValueError('气色渐变没有真实头颈加权顶点，拒绝整个人染色')
    return {'event':e,'binding':binding,'objects':meshes,'materials':records,'strengthSockets':sockets,'maskedVertices':masked}

def build(e,binding,scene,props):
    from previs_animation_materials import restore_animation_materials
    from previs_scene_effects import _real_material_render
    # 原WorkBench纹理副本没有表面shader，转引擎前必须恢复原PBR与UV。
    restore_animation_materials(list(scene.objects));_real_material_render(scene)
    if e['kind']=='complexion':return _complexion(e,binding,scene)
    prop=next(p for p in props if p['spec']['id']==e['propId'])
    return _tail(e,binding,scene,prop) if e['kind']=='needle_trail' else _smoke(e,binding,scene,prop)

def measure(handle,scene,frame):
    e=handle['event'];fps=scene.render.fps/scene.render.fps_base;t=(frame-1)/fps
    if e['kind']=='complexion':
        values=[socket.default_value for socket in handle['strengthSockets']]
        connected=True;masked=0;seen=set()
        for record in handle['materials']:
            obj=bpy.data.objects[record['mesh']];attribute=obj.data.attributes.get(record['maskAttribute']);mat=bpy.data.materials[record['material']]
            nodes=mat.node_tree.nodes;mix=nodes.get(e['id']+'_气色混合');p=next((n for n in nodes if n.type=='BSDF_PRINCIPLED'),None)
            connected=connected and bool(attribute and mix and p and mix.inputs[1].is_linked and mix.inputs[1].links[0].from_node.name==record['sourceNode']
                and p.inputs['Base Color'].is_linked and p.inputs['Base Color'].links[0].from_node==mix
                and any(n.type=='ATTRIBUTE' and n.attribute_name==record['maskAttribute'] and n.outputs['Fac'].is_linked for n in nodes))
            if attribute and obj.name not in seen:masked+=sum(v.value>.05 for v in attribute.data);seen.add(obj.name)
        return {'strength':max(values),'strengthMinimum':min(values),'maskedVertices':masked,'maskConnected':bool(connected),'materials':handle['materials'],'texturePreserved':all(
            any(n.type=='TEX_IMAGE' and n.image and n.image.packed_file for n in bpy.data.materials[r['material']].node_tree.nodes) for r in handle['materials'])}
    anchor=handle['prop']['objects'][0].matrix_world.translation
    result={'propId':e['propId'],'active':e['startSec']<=t<=e['endSec'],'anchor':list(anchor)}
    if e['kind']=='needle_trail':
        o=handle['objects'][0];tip=o.matrix_world@Vector((0,0,-1))
        result.update(trailLength=sum(2*o.scale.z for o in handle['objects']) if result['active'] else 0.,segmentCount=handle['segmentCount'],attachmentError=(tip-anchor).length if result['active'] else 0.,tip=list(tip))
    else:
        expected=anchor+Vector(e['offset'])
        result.update(attachmentError=max((o.matrix_world.translation-expected).length for o in handle['origins']),
                      density=max(socket.default_value for socket in handle['densities']),particleCount=len(handle['objects']))
    return result
