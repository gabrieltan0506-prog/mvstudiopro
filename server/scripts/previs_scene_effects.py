"""Bounded scene effects on already-authorized in-memory previs actors.

Never reads models/blend files, never executes supplied code, never cuts a mesh into fake parts.
Cloth is actually simulated and baked to embedded absolute shape keys before the usual save/render.
"""
import hashlib
import json
import math
import os
import re
import struct
from pathlib import Path

import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree
from bpy_extras.object_utils import world_to_camera_view

KINDS=frozenset(('cape','explode','hologram','attribute_color','label'))
BOUNDARIES={
    'cape':'程序披风真实布料仿真与骨骼挂点，已烘网格逐帧形变；碰撞质量只以本次真实测量为准，不是原服装自动改造。',
    'explode':'按现有独立网格中心径向展开；不切割连续网格，不推断机械语义或内部结构，不模拟刚体碰撞。',
    'hologram':'仅所选角色网格的透明发光扫描材质；不是实拍人物分割、隐身重建或场景追踪。',
    'attribute_color':'所选网格的真实顶点颜色属性与渐变材质；不改变拓扑或替换角色贴图资产。',
    'label':'可信骨骼挂点驱动的三维中文标注与引线，逐帧面向本场景相机；不提供实拍人物跟踪。',
}


def _number(value,lo,hi,label):
    if isinstance(value,bool) or not isinstance(value,(int,float)) or not math.isfinite(value) or not lo<=value<=hi:
        raise ValueError('Invalid scene effect '+label)
    return value


def _color(value):
    if not isinstance(value,str) or not re.fullmatch(r'#[0-9a-fA-F]{6}',value):
        raise ValueError('Invalid scene effect color')
    return tuple(int(value[i:i+2],16)/255 for i in (1,3,5))


def _linear(color):
    return tuple(c/12.92 if c<=.04045 else ((c+.055)/1.055)**2.4 for c in color)


def _write(path,value):
    pending=path.with_suffix('.writing')
    with pending.open('w',encoding='utf-8') as handle:
        json.dump(value,handle,ensure_ascii=False,separators=(',',':'),allow_nan=False)
        handle.flush();os.fsync(handle.fileno())
    os.replace(pending,path)


def _curves(action):
    if hasattr(action,'fcurves'):
        yield from action.fcurves
    elif hasattr(action,'layers'):
        for layer in action.layers:
            for strip in layer.strips:
                for bag in strip.channelbags:
                    yield from bag.fcurves


def _constant(block):
    if block.animation_data and block.animation_data.action:
        for curve in _curves(block.animation_data.action):
            for key in curve.keyframe_points:key.interpolation='CONSTANT'


def _world_vertices(obj,depsgraph):
    # FONT/CURVE evaluated geometry is absent while hidden in the viewport. Measurement
    # temporarily evaluates it without changing render visibility or its saved animation.
    hidden=obj.hide_viewport
    evaluated=None
    visibility_curves=[]
    scene=bpy.context.scene
    try:
        if hidden:
            # Blender 3.4 skips transform evaluation for viewport-disabled objects.
            # Unhiding alone leaves matrix_world at the last visible frame. Mute only
            # this visibility channel while evaluating the same animation frame;
            # restore it below, including its original mute state and visibility.
            action=obj.animation_data.action if obj.animation_data else None
            if action:
                for curve in _curves(action):
                    if curve.data_path=='hide_viewport':
                        visibility_curves.append((curve,curve.mute));curve.mute=True
            obj.hide_viewport=False
            scene.frame_set(scene.frame_current,subframe=scene.frame_subframe)
            bpy.context.view_layer.update()
            depsgraph=bpy.context.evaluated_depsgraph_get()
        evaluated=obj.evaluated_get(depsgraph)
        mesh=evaluated.to_mesh()
        if mesh is None:raise ValueError('Cannot evaluate scene effect geometry: '+obj.name+' ('+obj.type+')')
        return [evaluated.matrix_world @ v.co for v in mesh.vertices]
    finally:
        if evaluated is not None:evaluated.to_mesh_clear()
        if hidden:
            for curve,muted in visibility_curves:curve.mute=muted
            obj.hide_viewport=True
            scene.frame_set(scene.frame_current,subframe=scene.frame_subframe)
            bpy.context.view_layer.update()


def _bounds(points):
    finite=bool(points) and all(math.isfinite(v) for p in points for v in p)
    return {'finiteBounds':finite,'minimum':[min(p[k] for p in points) for k in range(3)] if finite else None,
            'maximum':[max(p[k] for p in points) for k in range(3)] if finite else None}


def _binding_map(bindings,scene):
    result={}
    for binding in bindings:
        actor_id=binding['actorId']
        rig=binding['rig'];meshes=binding['meshes']
        if actor_id in result or rig.type!='ARMATURE' or rig.name not in scene.objects or not meshes:
            raise ValueError('Invalid trusted scene binding')
        if len(set(o.name for o in meshes))!=len(meshes) or any(o.type!='MESH' or o.name not in scene.objects for o in meshes):
            raise ValueError('Invalid trusted actor meshes')
        result[actor_id]=binding
    return result


def validate_scene_effects(events,scene,bindings):
    if not isinstance(events,list) or len(events)>4:
        raise ValueError('Expected at most four scene effects')
    by_actor=_binding_map(bindings,scene)
    fps=scene.render.fps/scene.render.fps_base
    if scene.frame_start!=1 or scene.frame_end/fps>8+1e-8 or len(bindings)>3:
        raise ValueError('Scene effects support at most 8 seconds and 3 actors')
    ids=set();cape_count=0;actor_modes={}
    fields={'cape':{'width','length','color','wind'},'explode':{'distance','startSec','durationSec'},
            'hologram':{'color','intensity'},'attribute_color':{'color','colorEnd'},
            'label':{'bone','text','color','offset','fontSize'}}
    for e in events:
        if not isinstance(e,dict) or e.get('kind') not in KINDS or set(e)!={'id','kind','actorId'}|fields[e['kind']]:
            raise ValueError('Unexpected scene effect fields')
        if not isinstance(e['id'],str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,80}',e['id']) or e['id'] in ids:
            raise ValueError('Invalid or duplicate scene effect identity')
        if e['actorId'] not in by_actor:
            raise ValueError('Scene effect actor is not bound to this scene')
        ids.add(e['id']);kind=e['kind'];binding=by_actor[e['actorId']]
        modes=actor_modes.setdefault(e['actorId'],set())
        # Competing material overrides and duplicate decomposition cannot silently replace each other.
        if kind in modes or (kind in ('hologram','attribute_color') and modes & {'hologram','attribute_color'}):
            raise ValueError('Conflicting effects on one actor')
        modes.add(kind)
        if kind=='cape':
            cape_count+=1
            _number(e['width'],.2,2,'cape width');_number(e['length'],.2,3,'cape length');_color(e['color'])
            if not isinstance(e['wind'],list) or len(e['wind'])!=3:raise ValueError('Invalid cape wind')
            for value in e['wind']:_number(value,-3,3,'cape wind')
            name=binding.get('boneMap',{}).get('spine','spine')
            if name not in binding['rig'].pose.bones:raise ValueError('Cape requires a mapped spine bone')
        elif kind=='explode':
            _number(e['distance'],.05,2,'decomposition distance')
            _number(e['startSec'],0,8,'decomposition start')
            _number(e['durationSec'],1/24,8,'decomposition duration')
            if e['startSec']+e['durationSec']>scene.frame_end/fps+1e-8:raise ValueError('Decomposition exceeds scene duration')
            if not 2<=len(binding['meshes'])<=64:raise ValueError('Decomposition requires 2..64 existing independent meshes')
        elif kind=='hologram':
            _color(e['color']);_number(e['intensity'],.1,2,'hologram intensity')
        elif kind=='attribute_color':
            _color(e['color']);_color(e['colorEnd'])
        elif kind=='label':
            _color(e['color']);_number(e['fontSize'],.06,.4,'label font size')
            if e['bone'] not in ('head','spine','pelvis','hand-1','hand1'):raise ValueError('Invalid semantic label bone')
            name=binding.get('boneMap',{}).get(e['bone'],e['bone'])
            if name not in binding['rig'].pose.bones:raise ValueError('Label bone is not mapped on the selected actor')
            if not isinstance(e['text'],str) or not 1<=len(e['text'])<=32 or any(ord(c)<32 or 127<=ord(c)<160 for c in e['text']) or not e['text'].strip():
                raise ValueError('Label text must be 1..32 visible single-line characters')
            if not isinstance(e['offset'],list) or len(e['offset'])!=3:raise ValueError('Invalid label offset')
            for value in e['offset']:_number(value,-2,2,'label offset')
            if scene.camera is None:raise ValueError('Label requires the existing scene camera')
    if cape_count>1:raise ValueError('At most one simulated cape')
    # Decomposition moves collision geometry; rejecting this unsupported interaction is explicit.
    if cape_count and any(e['kind']=='explode' for e in events):
        raise ValueError('Cape simulation and mesh decomposition must be rendered separately')
    return by_actor


def _legacy_color_needed(mat):
    if not mat:return False
    if not mat.use_nodes:return True
    # Blender 5 creates default nodes even for the existing Workbench diffuse-only helper.
    tree=mat.node_tree
    bsdf=tree.nodes.get('Principled BSDF') if tree else None
    return bool(bsdf and len(tree.nodes)==2 and len(tree.links)==1
                and all(abs(float(a)-b)<1e-5 for a,b in zip(bsdf.inputs['Base Color'].default_value,(.8,.8,.8,1)))
                and any(abs(float(a)-float(b))>1e-5 for a,b in zip(mat.diffuse_color,bsdf.inputs['Base Color'].default_value)))


def _real_material_render(scene):
    # EEVEE does not use legacy Workbench colors. Preserve them in independent compatibility copies.
    copies={}
    for obj in scene.objects:
        if obj.type!='MESH':continue
        if any(_legacy_color_needed(mat) for mat in obj.data.materials) and obj.data.users>1:
            obj.data=obj.data.copy()
        for index,mat in enumerate(obj.data.materials):
            if not _legacy_color_needed(mat):continue
            if mat.name not in copies:
                converted=mat.copy();converted.name=mat.name+'_render_compatible';converted.use_nodes=True
                bsdf=converted.node_tree.nodes.get('Principled BSDF')
                bsdf.inputs['Base Color'].default_value=tuple(mat.diffuse_color)
                bsdf.inputs['Roughness'].default_value=.7
                copies[mat.name]=converted
            obj.data.materials[index]=copies[mat.name]
    if scene.render.engine not in ('BLENDER_EEVEE','BLENDER_EEVEE_NEXT','CYCLES'):
        try:scene.render.engine='BLENDER_EEVEE_NEXT'
        except TypeError:scene.render.engine='BLENDER_EEVEE'
        if scene.world:scene.world=scene.world.copy()
        else:scene.world=bpy.data.worlds.new('Scene_effect_world')
        scene.world.use_nodes=True
        background=scene.world.node_tree.nodes.get('Background')
        background.inputs['Color'].default_value=(.13,.16,.21,1)
        background.inputs['Strength'].default_value=.35
        light=bpy.data.lights.new('Scene_effect_key','AREA');light.energy=600;light.shape='DISK';light.size=8
        obj=bpy.data.objects.new('Scene_effect_key',light);scene.collection.objects.link(obj)
        obj.location=(0,-3,7)
        obj.rotation_euler=(Vector((0,0,1))-obj.location).to_track_quat('-Z','Y').to_euler()


def _replace_material(obj,e,attribute=None):
    old=[m.name if m else None for m in obj.data.materials]
    # Make the selected mesh data independent before assigning slots or point attributes.
    if obj.data.users>1:obj.data=obj.data.copy()
    originals=list(obj.data.materials)
    material=(next((m for m in originals if m),None).copy() if any(originals) else bpy.data.materials.new(e['id']))
    material.name=e['id']+'_'+obj.name+'_material'
    material.use_nodes=True
    nodes,links=material.node_tree.nodes,material.node_tree.links
    nodes.clear();output=nodes.new('ShaderNodeOutputMaterial')
    if e['kind']=='hologram':
        transparent=nodes.new('ShaderNodeBsdfTransparent')
        emission=nodes.new('ShaderNodeEmission')
        emission.inputs['Color'].default_value=(*_linear(_color(e['color'])),1)
        emission.inputs['Strength'].default_value=1.5
        facing=nodes.new('ShaderNodeLayerWeight')
        coords=nodes.new('ShaderNodeTexCoord')
        separate=nodes.new('ShaderNodeSeparateXYZ');links.new(coords.outputs['Generated'],separate.inputs[0])
        scale=nodes.new('ShaderNodeMath');scale.operation='MULTIPLY';scale.inputs[1].default_value=100
        links.new(separate.outputs['Z'],scale.inputs[0])
        sine=nodes.new('ShaderNodeMath');sine.operation='SINE';links.new(scale.outputs[0],sine.inputs[0])
        stripe=nodes.new('ShaderNodeMath');stripe.operation='GREATER_THAN';stripe.inputs[1].default_value=.85
        links.new(sine.outputs[0],stripe.inputs[0])
        strength=nodes.new('ShaderNodeMath');strength.operation='MULTIPLY';strength.inputs[1].default_value=.12
        links.new(stripe.outputs[0],strength.inputs[0])
        combined=nodes.new('ShaderNodeMath');combined.operation='MAXIMUM'
        links.new(facing.outputs['Facing'],combined.inputs[0]);links.new(strength.outputs[0],combined.inputs[1])
        alpha=nodes.new('ShaderNodeMath');alpha.operation='MULTIPLY';alpha.inputs[1].default_value=e['intensity']*.4
        links.new(combined.outputs[0],alpha.inputs[0])
        mix=nodes.new('ShaderNodeMixShader');links.new(alpha.outputs[0],mix.inputs[0])
        links.new(transparent.outputs[0],mix.inputs[1]);links.new(emission.outputs[0],mix.inputs[2])
        links.new(mix.outputs[0],output.inputs['Surface'])
        if hasattr(material,'surface_render_method'):material.surface_render_method='BLENDED'
        else:material.blend_method='BLEND'
    else:
        bsdf=nodes.new('ShaderNodeBsdfPrincipled');bsdf.inputs['Roughness'].default_value=.6
        color=nodes.new('ShaderNodeVertexColor');color.layer_name=attribute
        links.new(color.outputs['Color'],bsdf.inputs['Base Color']);links.new(bsdf.outputs[0],output.inputs['Surface'])
    count=max(1,len(originals))
    obj.data.materials.clear()
    for _ in range(count):obj.data.materials.append(material)
    return {'mesh':obj.name,'originalMaterials':old,'material':material.name,'nodes':[n.bl_idname for n in nodes]}


def _material_effect(e,binding,scene):
    _real_material_render(scene)
    records=[]
    all_points=[p for o in binding['meshes'] for p in _world_vertices(o,bpy.context.evaluated_depsgraph_get())]
    low,high=min(p.z for p in all_points),max(p.z for p in all_points)
    for obj in binding['meshes']:
        attribute=None
        if e['kind']=='attribute_color':
            obj.data=obj.data.copy()
            attribute='scene_effect_'+e['id']
            layer=obj.data.color_attributes.new(name=attribute,type='FLOAT_COLOR',domain='POINT')
            a,b=_linear(_color(e['color'])),_linear(_color(e['colorEnd']))
            for vertex,datum in zip(obj.data.vertices,layer.data):
                z=(obj.matrix_world @ vertex.co).z
                q=max(0.,min(1.,(z-low)/max(1e-6,high-low)))
                datum.color=tuple(a[k]*(1-q)+b[k]*q for k in range(3))+(1.,)
        records.append(_replace_material(obj,e,attribute))
    return {'event':e,'binding':binding,'objects':binding['meshes'],'materials':records}


def _font_supports(raw,text):
    """Inspect the fixed installed font's Unicode cmap before rendering, rejecting missing glyphs."""
    def u16(offset):return struct.unpack_from('>H',raw,offset)[0]
    def u32(offset):return struct.unpack_from('>I',raw,offset)[0]
    base=u32(12) if raw[:4]==b'ttcf' else 0
    cmap=None
    for i in range(u16(base+4)):
        entry=base+12+i*16
        if raw[entry:entry+4]==b'cmap':cmap=u32(entry+8);break
    if cmap is None:return False
    tables=[]
    for i in range(u16(cmap+2)):
        entry=cmap+4+i*8
        platform,encoding=u16(entry),u16(entry+2)
        if platform==0 or (platform==3 and encoding in (1,10)):
            tables.append(cmap+u32(entry+4))
    def supported(code):
        for table in tables:
            format=u16(table)
            if format in (12,13):
                for i in range(u32(table+12)):
                    p=table+16+i*12;start,end,glyph=u32(p),u32(p+4),u32(p+8)
                    if start<=code<=end and glyph+(code-start if format==12 else 0)>0:return True
            elif format==4 and code<65536:
                count=u16(table+6)//2;ends=table+14;starts=ends+2*count+2;deltas=starts+2*count;ranges=deltas+2*count
                for i in range(count):
                    if u16(starts+2*i)<=code<=u16(ends+2*i):
                        offset=u16(ranges+2*i);delta=u16(deltas+2*i)
                        glyph=(code+delta)&65535 if offset==0 else u16(ranges+2*i+offset+2*(code-u16(starts+2*i)))
                        if glyph:return True
                        break
        return False
    return all(supported(ord(char)) for char in text)


def _installed_font(text):
    candidates=(
        '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
        '/usr/share/fonts/opentype/noto/NotoSansCJKsc-Regular.otf',
        '/usr/share/fonts/truetype/noto/NotoSansSC-Regular.ttf',
        '/System/Library/Fonts/Hiragino Sans GB.ttc',
        '/System/Library/Fonts/STHeiti Light.ttc',
    )
    for candidate in candidates:
        path=Path(candidate)
        if not path.is_file():continue
        raw=path.read_bytes()
        if len(raw)>64*1024*1024:continue
        try:supported=_font_supports(raw,text)
        except (IndexError,struct.error):supported=False
        if not supported:continue
        font=bpy.data.fonts.load(str(path),check_existing=True)
        if not font.packed_file:font.pack()
        return font,{'name':path.name,'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest(),'packed':bool(font.packed_file),'glyphCoverageVerified':True}
    raise ValueError('Installed Chinese font does not cover label text; refusing missing-glyph boxes')


def _label(e,binding,scene):
    _real_material_render(scene)
    font,font_receipt=_installed_font(e['text'])
    curve=bpy.data.curves.new(e['id']+'_label_text','FONT');curve.body=e['text'];curve.font=font
    curve.size=e['fontSize'];curve.align_x='LEFT';curve.align_y='CENTER';curve.resolution_u=6
    label=bpy.data.objects.new('SceneLabel_'+e['id'],curve);scene.collection.objects.link(label)
    line_data=bpy.data.curves.new(e['id']+'_leader','CURVE');line_data.dimensions='3D';line_data.resolution_u=1
    line_data.bevel_depth=e['fontSize']*.025;line_data.bevel_resolution=1
    spline=line_data.splines.new('POLY');spline.points.add(1)
    line=bpy.data.objects.new('SceneLeader_'+e['id'],line_data);scene.collection.objects.link(line)
    mat=bpy.data.materials.new(e['id']+'_label_ink');mat.diffuse_color=(*_color(e['color']),1);mat.use_nodes=True
    nodes,links=mat.node_tree.nodes,mat.node_tree.links;nodes.clear()
    emission=nodes.new('ShaderNodeEmission');emission.inputs['Color'].default_value=(*_linear(_color(e['color'])),1)
    output=nodes.new('ShaderNodeOutputMaterial');links.new(emission.outputs[0],output.inputs['Surface'])
    for obj in (label,line):obj.data.materials.append(mat);obj['manhua_scene_effect_actor']=e['actorId']
    rig=binding['rig'];name=binding.get('boneMap',{}).get(e['bone'],e['bone'])
    for frame in range(1,scene.frame_end+1):
        scene.frame_set(frame);bpy.context.view_layer.update()
        anchor=rig.matrix_world @ rig.pose.bones[name].tail
        position=anchor+rig.matrix_world.to_3x3() @ Vector(e['offset'])
        label.location=position;label.rotation_euler=scene.camera.matrix_world.to_quaternion().to_euler()
        for prop in ('location','rotation_euler'):label.keyframe_insert(prop,frame=frame)
        for point,location in zip(spline.points,(anchor,position)):
            point.co=(*location,1);point.keyframe_insert('co',frame=frame)
        for obj in (label,line):
            obj.hide_render=all(mesh.hide_render for mesh in binding['meshes']);obj.keyframe_insert('hide_render',frame=frame)
    _constant(label);_constant(line);_constant(line_data)
    return {'event':e,'binding':binding,'objects':[label,line],'label':label,'line':line,'font':font_receipt,'boneName':name}


def _explode(e,binding,scene):
    scene.frame_set(1);bpy.context.view_layer.update()
    graph=bpy.context.evaluated_depsgraph_get()
    centers=[]
    for obj in binding['meshes']:
        vertices=_world_vertices(obj,graph)
        centers.append(sum(vertices,Vector())/len(vertices))
    center=sum(centers,Vector())/len(centers)
    inv=binding['rig'].matrix_world.inverted().to_3x3()
    parts=[]
    for index,(obj,part_center) in enumerate(zip(binding['meshes'],centers)):
        direction=part_center-center
        if direction.length<1e-6:
            angle=index*2.399963
            direction=Vector((math.cos(angle),math.sin(angle),.25*(index%3-1)))
        direction=(inv @ direction).normalized()
        mods=[]
        for axis in ('X','Y','Z'):
            modifier=obj.modifiers.new(e['id']+'_'+axis,'DISPLACE')
            modifier.direction=axis;modifier.space='LOCAL';modifier.mid_level=0
            mods.append(modifier)
        parts.append({'object':obj,'direction':direction,'modifiers':mods})
    fps=scene.render.fps/scene.render.fps_base
    for frame in range(1,scene.frame_end+1):
        scene.frame_set(frame);bpy.context.view_layer.update()
        q=max(0.,min(1.,((frame-1)/fps-e['startSec'])/e['durationSec']))
        q=q*q*(3-2*q)
        for part in parts:
            offset=binding['rig'].matrix_world.to_3x3() @ (part['direction']*e['distance']*q)
            local=part['object'].matrix_world.inverted().to_3x3() @ offset
            for k,modifier in enumerate(part['modifiers']):
                modifier.strength=local[k];modifier.keyframe_insert('strength',frame=frame)
    for part in parts:_constant(part['object'])
    return {'event':e,'binding':binding,'objects':binding['meshes'],'parts':parts}


def _collider_trees(objects,graph):
    trees=[]
    for obj in objects:
        evaluated=obj.evaluated_get(graph);mesh=evaluated.to_mesh()
        try:
            vertices=[evaluated.matrix_world @ v.co for v in mesh.vertices]
            polys=[list(p.vertices) for p in mesh.polygons]
            edges={}
            for polygon in polys:
                for a,b in zip(polygon,polygon[1:]+polygon[:1]):
                    key=tuple(sorted((a,b)));edges[key]=edges.get(key,0)+1
            closed=bool(edges) and all(n==2 for n in edges.values())
            trees.append((obj.name,BVHTree.FromPolygons(vertices,polys,all_triangles=False),closed))
        finally:evaluated.to_mesh_clear()
    return trees


def _cape(e,binding,scene,bindings,evidence_dir):
    scene.frame_set(1);bpy.context.view_layer.update()
    rig=binding['rig'];bone=rig.pose.bones[binding.get('boneMap',{}).get('spine','spine')]
    bone_world=rig.matrix_world @ bone.matrix
    anchor=(rig.matrix_world @ bone.tail)+rig.matrix_world.to_3x3() @ Vector((-.19,0,0))
    orientation=rig.matrix_world.to_3x3().normalized()
    nx,ny=16,24
    vertices=[anchor+orientation @ Vector((-.045*(j/ny)**2,(i/nx-.5)*e['width'],-j/ny*e['length'])) for j in range(ny+1) for i in range(nx+1)]
    faces=[(j*(nx+1)+i,j*(nx+1)+i+1,(j+1)*(nx+1)+i+1,(j+1)*(nx+1)+i) for j in range(ny) for i in range(nx)]
    mesh=bpy.data.meshes.new(e['id']+'_cloth_mesh');mesh.from_pydata(vertices,[],faces);mesh.update()
    cloth=bpy.data.objects.new('SceneEffect_'+e['id'],mesh);scene.collection.objects.link(cloth)
    cloth['manhua_scene_effect_actor']=e['actorId']
    material=bpy.data.materials.new(e['id']+'_fabric');material.diffuse_color=(*_color(e['color']),1)
    material.use_nodes=True
    material.node_tree.nodes.get('Principled BSDF').inputs['Base Color'].default_value=(*_linear(_color(e['color'])),1)
    material.node_tree.nodes.get('Principled BSDF').inputs['Roughness'].default_value=.85
    cloth.data.materials.append(material)
    pin=cloth.vertex_groups.new(name='cape_pinned_top');pin.add(list(range(nx+1)),1,'REPLACE')
    target=bpy.data.objects.new(e['id']+'_spine_attachment',None);scene.collection.objects.link(target)
    target.matrix_world=bone_world.copy()
    inverse=target.matrix_world.inverted()
    target_points={}
    for frame in range(1,scene.frame_end+1):
        scene.frame_set(frame);bpy.context.view_layer.update()
        target.matrix_world=rig.matrix_world @ bone.matrix
        for prop in ('location','rotation_euler','scale'):target.keyframe_insert(prop,frame=frame)
        transform=target.matrix_world @ inverse
        target_points[frame]=[transform @ point for point in vertices[:nx+1]]
    _constant(target)
    scene.frame_set(1);bpy.context.view_layer.update()
    hook=cloth.modifiers.new('Pinned_spine_motion','HOOK');hook.object=target;hook.vertex_group=pin.name;hook.matrix_inverse=inverse
    simulator=cloth.modifiers.new('True_cloth_simulation','CLOTH')
    settings=simulator.settings
    settings.quality=8;settings.mass=.3;settings.vertex_group_mass=pin.name;settings.pin_stiffness=1
    settings.tension_stiffness=25;settings.compression_stiffness=25;settings.shear_stiffness=12;settings.bending_stiffness=.6
    settings.air_damping=3
    simulator.collision_settings.use_collision=True;simulator.collision_settings.distance_min=.012
    simulator.collision_settings.use_self_collision=True;simulator.collision_settings.self_distance_min=.01
    simulator.point_cache.frame_start=1;simulator.point_cache.frame_end=scene.frame_end
    colliders=[obj for b in bindings for obj in b['meshes']]
    ground=scene.objects.get('地面')
    if ground is not None and ground.type=='MESH':colliders.append(ground)
    added=[];existing_collision=[]
    for obj in colliders:
        if not any(m.type=='COLLISION' for m in obj.modifiers):
            added.append((obj,obj.modifiers.new(e['id']+'_collision','COLLISION')))
        else:existing_collision.append((obj,obj.collision.thickness_outer))
        obj.collision.thickness_outer=.01
    wind=None
    vector=Vector(e['wind'])
    if vector.length>0:
        bpy.ops.object.effector_add(type='WIND')
        wind=bpy.context.object;wind.name=e['id']+'_controlled_wind'
        wind.rotation_euler=vector.to_track_quat('Z','Y').to_euler();wind.field.strength=vector.length
        wind.field.noise=0
    samples=[];cache=[];original=[v.copy() for v in vertices]
    raw_path=Path(evidence_dir)/'scene-effects-simulation.json' if evidence_dir else None
    if raw_path:_write(raw_path,{'version':1,'id':e['id'],'complete':False,'samples':samples})
    try:
        for frame in range(1,scene.frame_end+1):
            scene.frame_set(frame);bpy.context.view_layer.update()
            graph=bpy.context.evaluated_depsgraph_get()
            points=_world_vertices(cloth,graph)
            bounds=_bounds(points)
            if not bounds['finiteBounds'] or len(points)!=len(vertices):raise ValueError('Cloth simulation produced invalid topology or coordinates')
            pin_error=max((point-wanted).length for point,wanted in zip(points[:nx+1],target_points[frame]))
            trees=_collider_trees(colliders,graph)
            nearest=math.inf;penetration=0.;inside=0
            for point in points[nx+1:]:
                for _,tree,closed in trees:
                    hit,normal,index,distance=tree.find_nearest(point)
                    if hit is None:continue
                    nearest=min(nearest,distance)
                    signed=(point-hit).dot(normal)
                    if closed and signed<-.02:
                        inside+=1;penetration=max(penetration,-signed)
            row={'frame':frame,'pinError':pin_error,'meshVertices':len(points),**bounds,
                 'maxMotionFromRest':max((p-r).length for p,r in zip(points,original)),
                 'maxNonRigidDisplacement':max((p-(target.matrix_world @ inverse @ r)).length for p,r in zip(points,original)),
                 'collisionMeshes':len(trees),'closedCollisionMeshes':sum(closed for _,_,closed in trees),
                 'nearestSurfaceDistance':nearest if math.isfinite(nearest) else None,
                 'estimatedInsideVertices':inside,'estimatedPenetration':penetration}
            samples.append(row);cache.append([tuple(p) for p in points])
            if raw_path:_write(raw_path,{'version':1,'id':e['id'],'complete':False,'samples':samples})
            print('PREVIS_CLOTH_PROGRESS '+json.dumps({'id':e['id'],'frame':frame,'frameCount':scene.frame_end}),flush=True)
            if pin_error>.03:raise ValueError('Cloth pin drift exceeds 3cm')
            if max(abs(v) for p in points for v in p)>1000:raise ValueError('Cloth simulation escaped world bounds')
        # Embedded per-frame geometry survives scene.blend transfer and reopening, with no external cache.
        cloth.modifiers.remove(simulator);cloth.modifiers.remove(hook)
        basis=cloth.shape_key_add(name='Basis',from_mix=False)
        for frame,points in enumerate(cache,1):
            key=cloth.shape_key_add(name='BakedFrame_%04d'%frame,from_mix=False)
            key.interpolation='KEY_LINEAR'
            for datum,point in zip(key.data,points):datum.co=point
        keys=cloth.data.shape_keys;keys.use_relative=False
        for frame in range(1,scene.frame_end+1):
            keys.eval_time=frame*10;keys.keyframe_insert('eval_time',frame=frame)
        _constant(keys)
        for frame in range(1,scene.frame_end+1):
            scene.frame_set(frame)
            cloth.hide_render=all(obj.hide_render for obj in binding['meshes'])
            cloth.keyframe_insert('hide_render',frame=frame)
        _constant(cloth)
        if raw_path:_write(raw_path,{'version':1,'id':e['id'],'complete':True,'bakedAs':'absolute_shape_keys','samples':samples})
    finally:
        for obj,modifier in added:
            if modifier.name in obj.modifiers:obj.modifiers.remove(modifier)
        for obj,thickness in existing_collision:obj.collision.thickness_outer=thickness
        if wind is not None:bpy.data.objects.remove(wind,do_unlink=True)
    return {'event':e,'binding':binding,'objects':[cloth],'cloth':cloth,'simulationSamples':samples,'targetPoints':target_points,
            'attachment':target,'bakedVertexFrames':len(cache)*len(vertices)}


def build_scene_effects(events,scene,bindings,evidence_dir=None):
    if not events:return []
    by_actor=validate_scene_effects(events,scene,bindings)
    if evidence_dir is not None:
        evidence_dir=Path(evidence_dir);evidence_dir.mkdir(parents=True,exist_ok=True)
    handles=[];original=scene.frame_current
    try:
        for event in events:
            scene.frame_set(1);bpy.context.view_layer.update()
            binding=by_actor[event['actorId']]
            if event['kind']=='cape':handle=_cape(event,binding,scene,bindings,evidence_dir)
            elif event['kind']=='explode':handle=_explode(event,binding,scene)
            elif event['kind']=='label':handle=_label(event,binding,scene)
            else:handle=_material_effect(event,binding,scene)
            handles.append(handle)
    finally:scene.frame_set(original)
    return handles


def measure_scene_effects(handles,scene):
    rows=[{'id':h['event']['id'],'kind':h['event']['kind'],'actorId':h['event']['actorId'],
           'boundaryZh':BOUNDARIES[h['event']['kind']],'samples':[],'offscreenFrames':[]} for h in handles]
    original=scene.frame_current;fps=scene.render.fps/scene.render.fps_base
    try:
        for frame in range(1,scene.frame_end+1):
            scene.frame_set(frame);bpy.context.view_layer.update();graph=bpy.context.evaluated_depsgraph_get()
            for h,row in zip(handles,rows):
                e=h['event'];points=[p for obj in h['objects'] for p in _world_vertices(obj,graph)]
                sample={'frame':frame,'meshVertices':len(points),'targetMeshes':[obj.name for obj in h['objects']],**_bounds(points)}
                if scene.camera and any(not obj.hide_render for obj in h['binding']['meshes']):
                    projected=[world_to_camera_view(scene,scene.camera,point) for point in points]
                    if any(not (scene.camera.data.clip_start<p.z<scene.camera.data.clip_end and 0<=p.x<=1 and 0<=p.y<=1) for p in projected):
                        row['offscreenFrames'].append(frame)
                if e['kind']=='cape':
                    sample.update(h['simulationSamples'][frame-1])
                    actual=_world_vertices(h['cloth'],graph)
                    sample['pinError']=max((a-b).length for a,b in zip(actual[:len(h['targetPoints'][frame])],h['targetPoints'][frame]))
                    sample['bakedShapeKeyCount']=len(h['cloth'].data.shape_keys.key_blocks)
                    sample['bakedPlayback']=not any(m.type=='CLOTH' for m in h['cloth'].modifiers)
                elif e['kind']=='explode':
                    q=max(0.,min(1.,((frame-1)/fps-e['startSec'])/e['durationSec']));q=q*q*(3-2*q)
                    parts=[]
                    for part in h['parts']:
                        obj=part['object'];actual=_world_vertices(obj,graph)
                        for modifier in part['modifiers']:modifier.show_viewport=False
                        bpy.context.view_layer.update();base=_world_vertices(obj,bpy.context.evaluated_depsgraph_get())
                        for modifier in part['modifiers']:modifier.show_viewport=True
                        bpy.context.view_layer.update()
                        expected=h['binding']['rig'].matrix_world.to_3x3() @ (part['direction']*e['distance']*q)
                        measured=sum((a-b for a,b in zip(actual,base)),Vector())/len(actual)
                        parts.append({'mesh':obj.name,'requestedOffset':list(expected),'actualOffset':list(measured),
                                      'maxVertexOffsetError':max(((a-b)-expected).length for a,b in zip(actual,base))})
                    sample['parts']=parts
                elif e['kind']=='label':
                    rig=h['binding']['rig']
                    anchor=rig.matrix_world @ rig.pose.bones[h['boneName']].tail
                    expected=anchor+rig.matrix_world.to_3x3() @ Vector(e['offset'])
                    line=[Vector(point.co[:3]) for point in h['line'].data.splines[0].points]
                    actual=h['label'].matrix_world.translation
                    sample.update(anchor=list(anchor),labelPosition=list(actual),lineEndpoints=[list(p) for p in line],
                                  attachmentError=max((line[0]-anchor).length,(line[1]-actual).length,(actual-expected).length),
                                  cameraFacingDot=(h['label'].matrix_world.to_3x3() @ Vector((0,0,1))).normalized().dot((scene.camera.matrix_world.to_3x3() @ Vector((0,0,1))).normalized()),
                                  font=h['font'],text=e['text'],bone=e['bone'],mappedBone=h['boneName'])
                else:
                    sample['materials']=[{'mesh':obj.name,'materials':[m.name if m else None for m in obj.data.materials],
                                         'nodeTypes':[[n.bl_idname for n in m.node_tree.nodes] if m and m.use_nodes else [] for m in obj.data.materials],
                                         'attributes':list(obj.data.color_attributes.keys())} for obj in h['objects']]
                row['samples'].append(sample)
    finally:scene.frame_set(original)
    return rows
