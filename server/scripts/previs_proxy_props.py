"""球柱任务化身、金属弹头、光球、信息板与代码幕；只读取有界几何配置，不加载外部资源。"""
import math


def build_proxy_prop(prop, scene):
    import bpy
    from mathutils import Vector
    from previs_effects import _material
    config = prop['proxy']
    width, depth, height = config['size']
    color = tuple(config['color'])
    name = '几何故事_' + prop['id']
    mat = _material(name, color, 0)
    objects = []

    def part(label, primitive, size, offset=(0, 0, 0), material=None):
        if primitive == 'sphere':
            bpy.ops.mesh.primitive_uv_sphere_add(segments=12, ring_count=8, radius=1)
        elif primitive == 'cylinder':
            bpy.ops.mesh.primitive_cylinder_add(vertices=12, radius=1, depth=2)
        else:
            bpy.ops.mesh.primitive_cube_add(size=2)
        obj = bpy.context.object
        obj.name = name + '_' + label
        # 将基础尺寸写入网格，root的scale完整保留给既有时间轨迹。
        for v in obj.data.vertices:
            v.co = Vector((v.co.x * size[0], v.co.y * size[1], v.co.z * size[2]))
        obj.location = offset
        obj.data.materials.append(material or mat)
        obj['previs_animation_object'] = True
        obj['previs_proxy_shape'] = primitive
        if objects:
            obj.parent = objects[0]
        objects.append(obj)
        return obj

    kind = prop['kind']
    if kind == 'task_avatar':
        body = part('body', 'cylinder', (width*.32, depth*.32, height*.23))
        # root原点是双脚落点，身体网格移高，所有子件相对同一点。
        for v in body.data.vertices:
            v.co.z += height*.53
        part('head', 'sphere', (width*.28, depth*.28, height*.105), (0, 0, height*.87))
        for side in (-1, 1):
            part('leg'+str(side), 'cylinder', (width*.11, depth*.11, height*.17), (side*width*.18, 0, height*.17))
            part('arm'+str(side), 'cylinder', (width*.09, depth*.09, height*.2), (side*width*.47, 0, height*.53))
    elif kind == 'bullet':
        # X轴为前进方向；实际车旋轮廓含平底、直弹身和渐收尖弹头，不借球体代替。
        if width < max(depth, height)*3:
            raise ValueError('金属弹头长度至少为横径3倍，不能使用球体比例')
        rings = [(-.5, 1.), (.08, 1.), (.25, .88), (.39, .56), (.47, .23)]
        sides = 16
        vertices = [(x*width, math.cos(math.tau*i/sides)*depth*.5*r,
                     math.sin(math.tau*i/sides)*height*.5*r)
                    for x, r in rings for i in range(sides)]
        vertices.extend([(-width*.5, 0, 0), (width*.5, 0, 0)])
        back, tip = len(vertices)-2, len(vertices)-1
        faces = []
        for row in range(len(rings)-1):
            for i in range(sides):
                j=(i+1)%sides
                faces.append((row*sides+i,row*sides+j,(row+1)*sides+j,(row+1)*sides+i))
        for i in range(sides):
            j=(i+1)%sides
            faces.extend([(back,j,i),((len(rings)-1)*sides+i,(len(rings)-1)*sides+j,tip)])
        mesh=bpy.data.meshes.new(name+'_bullet_mesh');mesh.from_pydata(vertices,[],faces);mesh.update()
        obj=bpy.data.objects.new(name+'_bullet',mesh);scene.collection.objects.link(obj)
        obj.data.materials.append(mat);obj['previs_animation_object']=True;obj['previs_proxy_shape']='bullet'
        for node in mat.node_tree.nodes if mat.use_nodes else []:
            if node.type=='BSDF_PRINCIPLED':
                node.inputs['Metallic'].default_value=.8;node.inputs['Roughness'].default_value=.25
        objects.append(obj)
    elif kind in ('folding_wall', 'office_chair', 'chair_burst_text'):
        from previs_workflow_props import build_workflow_prop
        objects = build_workflow_prop(prop, scene, mat)
        bpy.context.view_layer.objects.active = objects[0]
        return objects
    elif kind == 'light_orb':
        part('orb', 'sphere', (width/2, depth/2, height/2))
    else:
        part('panel', 'box', (width/2, depth/2, height/2))
        if kind in ('information_panel', 'code_screen'):
            ink = _material(name+'_ink', (.85,.91,.96), 0)
            lines = 9 if kind == 'code_screen' else 3
            for row in range(lines):
                count = 4 if kind == 'code_screen' else 1
                for col in range(count):
                    length = width*(.045+.035*((row+col)%3)) if count>1 else width*(.28+.035*(row%2))
                    x = -width*.36+col*width*.23 if count>1 else -width*.08
                    z = height*.33-row*height*(.075 if count>1 else .17)
                    part('line_'+str(row)+'_'+str(col), 'box', (length/2,.008,height*.012), (x,-depth/2-.012,z), ink)
        label = config.get('label')
        if label:
            curve=bpy.data.curves.new(name+'_label','FONT')
            curve.body=label
            if any(ord(c)>127 for c in label):
                from previs_scene_effects import _installed_font
                curve.font,_font_receipt=_installed_font(label)
            curve.size=min(width/max(len(label),1)*1.35,height*.15)
            curve.align_x='CENTER';curve.align_y='CENTER';curve.resolution_u=2
            obj=bpy.data.objects.new(name+'_label',curve);scene.collection.objects.link(obj)
            obj.parent=objects[0];obj.location=(0,-depth/2-.024,height*.37)
            obj.rotation_euler=(math.pi/2,0,0)
            obj.data.materials.append(_material(name+'_label_mat',(.95,.97,1),0))
            # 把内置拉丁字转换为真实网格，便于逐帧测量与动画导出。
            bpy.ops.object.select_all(action='DESELECT');obj.select_set(True);bpy.context.view_layer.objects.active=obj
            bpy.ops.object.convert(target='MESH')
            obj['previs_animation_object']=True;obj['previs_proxy_shape']='label';objects.append(obj)
    bpy.context.view_layer.objects.active=objects[0]
    return objects


def measure_proxy_prop(objects, scene):
    """测量真实网格而非仅回传输入尺寸；包括隐藏时的已构建几何。"""
    import bpy
    from mathutils import Vector
    bpy.context.view_layer.update()
    vertices=[obj.matrix_world @ v.co for obj in objects for v in obj.data.vertices]
    if not vertices:
        raise ValueError('几何剧情对象没有真实网格')
    return {
        'meshVertices': len(vertices),
        'meshes': [obj.name for obj in objects],
        'minimum': [min(v[i] for v in vertices) for i in range(3)],
        'maximum': [max(v[i] for v in vertices) for i in range(3)],
        'color': list(objects[0].data.materials[0].diffuse_color[:3]),
    }
