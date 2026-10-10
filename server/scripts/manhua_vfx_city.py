"""服务端Blender的真实透视街区翻折；程序楼群，不声称重建原片。"""
import math
import random

from manhua_vfx_city_math import city_angle


def configure_city_scene(scene, spec, event):
    import bpy
    from mathutils import Vector
    params=event['city'];camera=scene.camera
    camera.data.type='PERSP';camera.data.lens=params['lensMm'];camera.data.clip_end=250
    camera.location=(0,-9,3.2)
    target=Vector((0,18,9))
    camera.rotation_euler=(target-camera.location).to_track_quat('-Z','Y').to_euler()
    scene.world.use_nodes=True
    background=scene.world.node_tree.nodes.get('Background')
    background.inputs['Color'].default_value=(.48,.65,.82,1)
    background.inputs['Strength'].default_value=.65
    sun=bpy.data.lights.new('街区日光','SUN');sun.energy=2.5;sun.angle=.12
    obj=bpy.data.objects.new('街区日光',sun);scene.collection.objects.link(obj)
    obj.rotation_euler=(.40,-.55,-.30)
    fill=bpy.data.lights.new('街区天空补光','AREA');fill.energy=1800;fill.shape='DISK';fill.size=20
    obj=bpy.data.objects.new('街区天空补光',fill);scene.collection.objects.link(obj)
    obj.location=(0,6,20)


def build_city(event,spec,scene,color):
    import bpy
    rng=random.Random(spec['seed'])
    materials=[]
    for name,rgb in [('石材',color),('窗户',(.035,.065,.09)),('屋顶',(.08,.105,.13)),
                     ('路面',(.10,.11,.12)),('路沿',(.29,.29,.27)),('线条',(.70,.68,.55))]:
        mat=bpy.data.materials.new(event['id']+name);mat.use_nodes=True
        shader=mat.node_tree.nodes.get('Principled BSDF')
        shader.inputs['Base Color'].default_value=(*rgb,1);shader.inputs['Roughness'].default_value=.70
        materials.append(mat)
    objects=[];moving=[];vertices=[];faces=[];indices=[]

    def box(center,size,material):
        x,y,z=center;a,b,c=(v/2 for v in size);base=len(vertices)
        vertices.extend([(x-a,y-b,z-c),(x+a,y-b,z-c),(x+a,y+b,z-c),(x-a,y+b,z-c),
                         (x-a,y-b,z+c),(x+a,y-b,z+c),(x+a,y+b,z+c),(x-a,y+b,z+c)])
        faces.extend([tuple(base+k for k in f) for f in [(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)]])
        indices.extend([material]*6)

    def finish(name,folding):
        mesh=bpy.data.meshes.new(name);mesh.from_pydata(vertices,[],faces);mesh.update()
        for mat in materials:mesh.materials.append(mat)
        for polygon,index in zip(mesh.polygons,indices):polygon.material_index=index
        obj=bpy.data.objects.new(name,mesh);scene.collection.objects.link(obj);objects.append(obj)
        if folding:moving.append(obj)
        vertices.clear();faces.clear();indices.clear()
        return obj

    width=event['city']['streetWidth'];hinge_y=18.;length=event['city']['blocks']*6+4
    for folding,y0,y1 in [(False,-12,hinge_y),(True,hinge_y,hinge_y+length)]:
        box((0,(y0+y1)/2,-.2),(width+12,y1-y0,.4),3)
        for side in (-1,1):
            box((side*(width/2+.65),(y0+y1)/2,.12),(1.3,y1-y0,.24),4)
        for y in range(math.ceil(y0),int(y1),3):box((0,y,.012),(.10,1.2,.024),5)
        finish(event['id']+('_远街' if folding else '_近街'),folding)
    # 每栋楼合并为一个多材质网格；窗框、分层檐口和屋顶均为三维几何。
    for folding,centers in [(False,[5.,11.]),(True,[hinge_y+3+i*6 for i in range(event['city']['blocks'])])]:
        for y in centers:
            for side in (-1,1):
                height=event['city']['buildingHeight']*rng.uniform(.8,1.2)
                x=side*(width/2+4.2);depth=5.4
                box((x,y,height/2),(5.4,depth,height),0)
                floors=max(2,round(height/2.7));inward=x-side*2.72
                for level in range(floors):
                    z=1.5+level*(height-2)/floors
                    for offset in (-1.65,0,1.65):
                        box((inward,y+offset,z),(.045,1.03,1.45),1)
                        box((inward-side*.045,y+offset,z-.78),(.18,1.25,.14),0)
                        box((inward-side*.03,y+offset,z),(.09,.07,1.47),0)
                    box((x,y,z+1.03),(5.65,depth+.12,.12),0)
                box((x,y,height+.08),(5.85,depth+.4,.25),0)
                box((x,y,height+.53),(5.35,depth,.7),2)
                for chimney in (-1,1):box((x+chimney*1.3,y,height+1.25),(.45,.6,1.0),0)
                finish(event['id']+'_楼群_'+str(len(objects)),folding)
    hinge=bpy.data.objects.new(event['id']+'_真实街区铰链',None);scene.collection.objects.link(hinge)
    hinge.location=(0,hinge_y,0)
    # 从世界顶点减去铰链原点，保持未折叠时完全原位。
    for obj in moving:
        for vertex in obj.data.vertices:vertex.co.y-=hinge_y
        obj.parent=hinge
    vertex_count=sum(len(obj.data.vertices) for obj in objects)
    if vertex_count>60_000:raise ValueError('街区网格超过预算')
    return {'objects':objects,'moving':moving,'hinge':hinge,'vertices':vertex_count,'scene':scene}


def update_city(handle,event,time,state):
    import hashlib
    import struct
    scene=handle['scene'];angle=city_angle(time-event['startSec'],event['city'])
    handle['hinge'].rotation_euler.x=math.radians(angle)
    # 活动窗内交付独立三维街景；窗外透明，恢复原视频。
    scene.render.film_transparent=not state['active']
    scene.view_layers[0].update()
    digest=hashlib.sha256()
    for obj in handle['moving']:
        for row in obj.matrix_world: digest.update(struct.pack('<4d',*row))
    camera=scene.camera
    return {'geometry':'procedural-street-hinged-world3d','meshCount':len(handle['objects']),
            'vertexCount':handle['vertices'],'foldDeg':math.degrees(handle['hinge'].rotation_euler.x),
            'hingeMatrix':[list(row) for row in handle['hinge'].matrix_world],
            'movingMatrixSha256':digest.hexdigest(),
            'camera':{'type':camera.data.type,'lensMm':camera.data.lens,'position':list(camera.location)},
            'boundaryZh':'真实三维程序街区整体翻折；原声保留，不重建原视频建筑或人物。'}
