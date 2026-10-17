"""球头圆柱人体与服装换色的帧级材质轨迹。"""

def proxy_color_at(keys,t):
    if t<=keys[0]['timeSec']:return keys[0]['color']
    for a,b in zip(keys,keys[1:]):
        if t<b['timeSec']:
            u=(t-a['timeSec'])/(b['timeSec']-a['timeSec'])
            return [x*(1-u)+y*u for x,y in zip(a['color'],b['color'])]
    return keys[-1]['color']


def bake_proxy_appearance(actor,material,meshes,scene):
    keys=actor['proxyAppearance']['colors']
    for frame in range(1,scene.frame_end+1):
        color=proxy_color_at(keys,(frame-1)/24)
        material.diffuse_color=(*color,1)
        material.keyframe_insert('diffuse_color',frame=frame)
    scene.frame_set(1)


def measure_proxy_appearances(spec,rigs,scene):
    rows=[]
    for actor,rig,*_ in rigs:
        if not actor.get('proxyAppearance'):continue
        meshes=[obj for obj in rig.children if obj.type=='MESH']
        head=[obj for obj in meshes if obj.name.endswith('_head')]
        cylinders=[obj for obj in meshes if not obj.name.endswith('_head')]
        if len(head)!=1 or not cylinders or head[0].get('previs_proxy_shape')!='sphere' or any(obj.get('previs_proxy_shape')!='cylinder' for obj in cylinders):
            raise ValueError('球头圆柱几何形态没有实际构建')
        garment=[obj for obj in cylinders if not obj.name.endswith('_neck')]
        samples=[]
        for frame in range(1,scene.frame_end+1):
            scene.frame_set(frame)
            samples.append({'frame':frame,'color':list(garment[0].data.materials[0].diffuse_color[:3]),
                            'meshCount':len(meshes),'sphereHeads':len(head),'cylinderBodies':len(cylinders)})
        rows.append({'actorId':actor['id'],'style':'ball-cylinder','samples':samples})
    scene.frame_set(1)
    return rows
