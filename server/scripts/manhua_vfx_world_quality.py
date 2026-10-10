"""角色身份、实际网格净空和物理受光；不将结构证据当作自然表演通过。"""
import hashlib
import math
import struct


def physical_material(name,color):
    import bpy
    mat=bpy.data.materials.new(name);mat.use_nodes=True
    shader=mat.node_tree.nodes.get('Principled BSDF')
    shader.inputs['Base Color'].default_value=(*color,1)
    shader.inputs['Roughness'].default_value=.4
    return mat,shader.inputs['Alpha']


def resolve_actor_rig(row,rigs):
    import bpy
    tagged=[rig for rig in rigs if rig.get('manhua_actor_id')==row.get('actorId') and rig.get('manhua_actor_binding')==row.get('binding')]
    if len(tagged)>1:raise ValueError('场景角色身份标记重复')
    return tagged[0] if tagged else bpy.data.objects.get(row.get('rigName',''))


def bind_scene_actors(bindings,actors,rigs):
    """身份来自服务端原预演spec；只按确切骨架与修改器绑定，不按外观或模糊名称猜。"""
    import bpy
    if not isinstance(bindings,list) or not bindings or len(bindings)>58:
        raise ValueError('缺少服务端已保存场景的角色身份清单')
    groups=[];seen=set();mesh_ids=set()
    for row in bindings:
        actor_id=row.get('actorId')
        rig=resolve_actor_rig(row,rigs)
        if not isinstance(actor_id,str) or actor_id in seen or not rig or rig.type!='ARMATURE':
            raise ValueError('场景角色身份或实际骨架不唯一')
        if row.get('shape') not in ('human','horse') or (row['shape']=='horse')!=(row.get('rigKind')=='quadruped'):
            raise ValueError('角色体型与人形/四足骨架合同不一致')
        meshes=[obj for obj in actors if any(mod.type=='ARMATURE' and mod.object==rig and mod.show_render for mod in obj.modifiers)]
        if not meshes:raise ValueError('角色%s缺少实际可渲染网格'%actor_id)
        if any(obj.name in mesh_ids for obj in meshes):raise ValueError('同一网格不能冒充两个角色')
        seen.add(actor_id);mesh_ids.update(obj.name for obj in meshes)
        groups.append({'identity':row,'rig':rig,'meshes':meshes})
    if mesh_ids!={obj.name for obj in actors}:raise ValueError('场景含未归属角色的活动网格')
    return groups


def prop_world_fingerprint(handle):
    """包含父变换、实际世界顶点、可见性和透明度，不能只证明局部参数未变。"""
    import bpy
    graph=bpy.context.evaluated_depsgraph_get();digest=hashlib.sha256()
    for obj in sorted(handle['objects'],key=lambda item:item.name):
        digest.update(obj.name.encode());digest.update(bytes([obj.hide_render]))
        digest.update(_mesh_state(obj,graph)[1].encode())
    for alpha in handle['opacity']:digest.update(struct.pack('<d',alpha.default_value))
    return digest.hexdigest()


def configure_world_lighting(scene,render,meshes):
    import bpy
    from mathutils import Vector
    from previs_animation_materials import restore_animation_materials
    restore_animation_materials(meshes)
    if render['quality']=='beauty':
        scene.render.engine='CYCLES';scene.cycles.device='CPU'
        scene.cycles.samples=render['samples'];scene.cycles.use_denoising=True
        scene.cycles.max_bounces=6;scene.cycles.diffuse_bounces=3;scene.cycles.glossy_bounces=3
        actual_samples=scene.cycles.samples
    else:
        if not hasattr(scene,'eevee') or not hasattr(scene.eevee,'taa_render_samples'):
            raise ValueError('当前Blender缺少受光预览采样配置')
        scene.eevee.taa_render_samples=render['samples']
        actual_samples=scene.eevee.taa_render_samples
    scene.view_settings.exposure=render['exposure']
    if 'AgX' in {item.identifier for item in scene.view_settings.bl_rna.properties['view_transform'].enum_items}:
        scene.view_settings.view_transform='AgX'
    bounds=[obj.matrix_world@Vector(corner) for obj in meshes for corner in obj.bound_box]
    center=sum(bounds,Vector())/max(1,len(bounds))
    for label,offset,energy,size in [('主光',(-3,-4,5),render['keyEnergy'],5),('辅光',(3,2,3),render['keyEnergy']*render['fillRatio'],4)]:
        data=bpy.data.lights.new('VFX_'+label,'AREA');data.energy=energy;data.shape='DISK';data.size=size
        obj=bpy.data.objects.new('VFX_'+label,data);scene.collection.objects.link(obj)
        obj.location=center+Vector(offset);obj.rotation_euler=(center-obj.location).to_track_quat('-Z','Y').to_euler()
    scene.world=scene.world.copy() if scene.world else bpy.data.worlds.new('VFX环境')
    scene.world.use_nodes=True
    background=scene.world.node_tree.nodes.get('Background')
    if background:background.inputs['Strength'].default_value=.15
    return {'engine':scene.render.engine,'quality':render['quality'],'samples':actual_samples,
            'materialMode':'source-pbr-and-physical-fragments','keyEnergy':render['keyEnergy'],
            'fillRatio':render['fillRatio'],'exposure':render['exposure']}


def aabb_distance(a,b):
    return math.sqrt(sum(max(a[0][axis]-b[1][axis],b[0][axis]-a[1][axis],0)**2 for axis in range(3)))


def closed_component_bounds(points, polygons):
    """闭合连通实体分别取保守盒；异常/开口网格仍用整体盒，防止漏掉包含关系。"""
    if not points:raise ValueError('网格顶点为空')
    def bounds(indices):
        return ([min(points[j][i] for j in indices) for i in range(3)],
                [max(points[j][i] for j in indices) for i in range(3)])
    whole = bounds(range(len(points)))
    # glTF的法线/UV缝会重复顶点；仅将同位置顶点连通，不改动真实坐标。
    weld, representative = {}, []
    for index, point in enumerate(points):
        key = tuple(round(float(value), 6) for value in point)
        representative.append(weld.setdefault(key, index))
    parents = list(range(len(points)))
    def find(index):
        while parents[index] != index:
            parents[index] = parents[parents[index]]
            index = parents[index]
        return index
    edges, used = {}, set()
    for polygon in polygons:
        if len(polygon) < 3:return [whole]
        vertices = [representative[index] for index in polygon]
        if len(set(vertices)) != len(vertices):return [whole]
        used.update(polygon)
        for a, b in zip(vertices, vertices[1:] + vertices[:1]):
            key = tuple(sorted((a, b)))
            edges[key] = edges.get(key, 0) + 1
            parents[find(a)] = find(b)
    if len(used) != len(points) or not edges or any(count != 2 for count in edges.values()):return [whole]
    components = {}
    for index, welded in enumerate(representative):components.setdefault(find(welded), []).append(index)
    return [bounds(indices) for indices in components.values()]


def _mesh_state(obj,graph):
    evaluated=obj.evaluated_get(graph);mesh=evaluated.to_mesh()
    try:
        if not mesh or not mesh.vertices:raise ValueError('角色/碎片求值网格为空')
        points=[evaluated.matrix_world@vertex.co for vertex in mesh.vertices]
        digest=hashlib.sha256()
        for point in points:digest.update(struct.pack('<3d',*point))
        bounds=([min(point[i] for point in points) for i in range(3)],
                [max(point[i] for point in points) for i in range(3)])
        return bounds,digest.hexdigest(),len(points),closed_component_bounds(points,[list(face.vertices) for face in mesh.polygons])
    finally:evaluated.to_mesh_clear()


def measure_world_clearance(groups,props,clearance,visible,moving_ids=()):
    """实际变形闭合部件AABB保守净空；开口/异常拓扑回退整体盒，不以表面抽样放过包含。"""
    import bpy
    graph=bpy.context.evaluated_depsgraph_get()
    fragments=[(obj.name,_mesh_state(obj,graph)[3]) for obj in props if not obj.hide_render]
    rows=[];issues=[];actor_bounds={}
    for group in groups:
        identity=group['identity'];digest=hashlib.sha256();minimum=None;count=0
        for obj in group['meshes']:
            if obj.name not in visible:continue
            bounds,pose,vertices,components=_mesh_state(obj,graph);digest.update(pose.encode());count+=vertices
            actor_bounds.setdefault(identity['actorId'],[]).extend(components)
            for name,fragment_bounds in fragments:
                distance=min(aabb_distance(a,b) for a in components for b in fragment_bounds)
                if minimum is None or distance<minimum:minimum=distance
                if distance+1e-7<clearance and len(issues)<32:
                    issues.append({'actorId':identity['actorId'],'mesh':obj.name,'fragment':name,'gapMeters':distance})
        rows.append({'actorId':identity['actorId'],'shape':identity['shape'],'rigKind':identity['rigKind'],
                     'visible':count>0,'vertices':count,'poseSha256':digest.hexdigest() if count else None,
                     'minimumGapMeters':minimum})
    pairs=[];moving_ids=set(moving_ids)
    for index,first in enumerate(rows):
        for second in rows[index+1:]:
            a,b=first['actorId'],second['actorId']
            if not first['visible'] or not second['visible'] or not ({a,b}&moving_ids):continue
            gap=min(aabb_distance(x,y) for x in actor_bounds[a] for y in actor_bounds[b])
            pairs.append({'actorId':a,'otherActorId':b,'gapMeters':gap})
            if gap+1e-7<clearance and len(issues)<32:issues.append({'actorId':a,'otherActorId':b,'gapMeters':gap})
    return {'method':'evaluated-closed-component-aabb-conservative','requiredMeters':clearance,'actors':rows,'actorPairs':pairs,'issues':issues}
