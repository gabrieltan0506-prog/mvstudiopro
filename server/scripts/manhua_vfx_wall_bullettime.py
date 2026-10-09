"""程序幕墙几何；由现有VFX渲染器调用，不另建媒体入口。"""
from manhua_vfx_wall_bullettime_math import (
    WALL_DEFAULTS, PRISM_FACES, wall_fragments,
    fragment_vertices,
)


def build_wall_fracture(event, spec, scene, make_material, color):
    import bpy
    fragments=wall_fragments(event,spec['seed'])
    params=event.get('wall',WALL_DEFAULTS)
    objects=[]; opacity=[]
    # 共享8级明暗材质；最多200个六顶点闭合棱柱，不使用烟尘替代几何。
    palette=[]
    for index in range(8):
        shade=.65+.35*index/7
        mat,alpha=make_material(event['id']+'_wall_shade_'+str(index),tuple(c*shade for c in color))
        palette.append(mat);opacity.append(alpha)
    for index,fragment in enumerate(fragments):
        mesh=bpy.data.meshes.new(event['id']+'_shard_'+str(index))
        mesh.from_pydata(fragment_vertices(fragment,params,0),[],PRISM_FACES)
        mesh.update()
        mesh.materials.append(palette[min(7,int((fragment['shade']-.65)/.35*8))])
        obj=bpy.data.objects.new(mesh.name,mesh)
        scene.collection.objects.link(obj);objects.append(obj)
    return {'objects':objects,'fragments':fragments,'opacity':opacity,'params':params}


def update_wall_fracture(handle,event,time,state):
    age=time-event['startSec']
    for obj,fragment in zip(handle['objects'],handle['fragments']):
        for vertex,coordinate in zip(obj.data.vertices,fragment_vertices(fragment,handle['params'],age)):
            vertex.co=coordinate
        obj.data.update()
    for opacity in handle['opacity']:
        opacity.default_value=min(1.,state['opacity']*2)
    return {'geometry':'triangular-prisms','fragmentCount':len(handle['fragments']),
            'impactSec':event['startSec']+handle['params']['impactSec'],
            'boundaryZh':'新增程序幕墙；不会自动识别或移除原片墙体，无人物遮挡。'}

