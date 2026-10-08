"""本集针、血滴、碗与袖光的确定性骨跟随轨迹；复用既有逐帧导出标记。"""
import math


def track_segment(keyframes, t):
    """显隐使用离散状态，位置线性插值，不允许贝塞尔超调穿过接触面。"""
    if t <= keyframes[0]['timeSec']:
        return keyframes[0], keyframes[0], 0.
    for left, right in zip(keyframes, keyframes[1:]):
        if t < right['timeSec'] - 1e-8:
            return left, right, (t-left['timeSec'])/(right['timeSec']-left['timeSec'])
    return keyframes[-1], keyframes[-1], 0.


def target_bone_name(shape, source_name, bone_map):
    if shape == 'horse':
        source_to_semantic={'body':'spine','neck':'neck','head':'head',
                            'lower_leg0':'lower_leg-1','lower_leg1':'forearm1',
                            'lower_leg2':'lower_leg1','lower_leg3':'forearm-1'}
        semantic=source_to_semantic.get(source_name)
        if semantic is None:
            raise ValueError('四足道具锚点没有实际骨骼映射: '+source_name)
    else:
        semantic=source_name
    if semantic not in bone_map:
        raise ValueError('道具锚点未映射到真实模型: '+semantic)
    return bone_map[semantic]


def build_story_props(spec, rigs, scene, actor_visible, models=None):
    import bpy
    from mathutils import Vector, Euler, Matrix
    from previs_effects import _material
    actors = {a['id']:(a, rig) for a, rig, *_ in rigs}
    real_models = {model['actorId']:model for model in models or []}
    handles = []
    by_id = {}

    def anchor_transform(anchor, frame):
        if anchor['type']=='world':return Vector(anchor['position']),Matrix.Identity(4).to_quaternion(),True
        offset = Vector(anchor.get('offset', [0, 0, 0]))
        if anchor['type'] == 'prop':
            parent = by_id[anchor['propId']]
            matrix = parent['objects'][0].matrix_world.copy()
            return matrix.translation + matrix.to_quaternion() @ offset, matrix.to_quaternion(), parent['samples'][frame-1]['visible']
        actor, rig = actors[anchor['actorId']]
        name=anchor['bone']
        model=real_models.get(anchor['actorId'])
        if model:
            rig=model['rig']
            name=target_bone_name(actor['shape'],name,model['boneMap'])
        elif actor.get('riggedModel'):
            raise ValueError('带骨演员的剧情道具必须绑定真实模型，不得使用隐藏源白模')
        bone = rig.pose.bones.get(name)
        if bone is None:
            raise ValueError('剧情道具绑定的骨骼不存在: '+anchor['actorId']+'/'+anchor['bone'])
        matrix = rig.matrix_world @ bone.matrix
        # 偏移单位为米，仅随骨方向旋转；GLB厘米单位/归一化缩放不能再次缩放偏移。
        point = rig.matrix_world @ bone.head.lerp(bone.tail, anchor.get('along', 1))
        return point + matrix.to_quaternion() @ offset, matrix.to_quaternion(), actor_visible(actor, frame)

    def grip_to_bowl(grip, obj, frame):
        from previs_hand_contacts import solve_hand_to_world
        actor,rig=actors[grip['actorId']]
        model=real_models.get(grip['actorId'])
        mapping=model['boneMap'] if model else None
        if model:rig=model['rig']
        elif actor.get('riggedModel'):raise ValueError('端碗必须约束真实人物骨骼')
        target_world=obj.location+obj.rotation_quaternion @ Vector(grip.get('offset',[0,0,-.02]))
        return solve_hand_to_world(rig,mapping,grip['hand'],target_world,frame)

    for prop in spec.get('storyProps') or []:
        kind, name = prop['kind'], '剧情道具_'+prop['id']
        if kind == 'needle':
            bpy.ops.mesh.primitive_cylinder_add(vertices=8, radius=.009, depth=.18)
            color, emission = (.95, .78, .24), .7
        elif kind == 'blood_drop':
            bpy.ops.mesh.primitive_uv_sphere_add(segments=12, ring_count=8, radius=.025)
            color, emission = (.42, .012, .018), 0
        elif kind in ('bowl','jar'):
            # 碗为低开口器皿，坛为高身窄口；各自内壁与液面独立。
            profile = ([(0,0),(.065,0),(.13,.075),(.14,.10),(.125,.10),(.115,.075),(.055,.018),(0,.018)] if kind=='bowl' else
                       [(0,0),(.07,0),(.105,.04),(.105,.21),(.06,.27),(.06,.30),(.045,.30),(.045,.27),(.09,.205),(.09,.045),(.055,.018),(0,.018)])
            vertices, faces = [], []
            for radius, z in profile:
                for i in range(24):
                    theta=math.tau*i/24
                    vertices.append((radius*math.cos(theta),radius*math.sin(theta),z))
            for row in range(len(profile)-1):
                for i in range(24):
                    j=(i+1)%24
                    faces.append((row*24+i,row*24+j,(row+1)*24+j,(row+1)*24+i))
            mesh=bpy.data.meshes.new(name);mesh.from_pydata(vertices,[],faces);mesh.update()
            obj=bpy.data.objects.new(name,mesh);scene.collection.objects.link(obj)
            bpy.context.view_layer.objects.active=obj
            color, emission = (.25,.12,.045), 0
        elif kind=='knife':
            bpy.ops.mesh.primitive_cube_add(size=1)
            for v in bpy.context.object.data.vertices:
                v.co.x*=.04;v.co.y*=.008;v.co.z*=.22
            color,emission=(.72,.75,.78),0
        else:
            bpy.ops.mesh.primitive_uv_sphere_add(segments=12, ring_count=8, radius=.035)
            color, emission = (.7,.015,.018), 2
        obj=bpy.context.view_layer.objects.active
        obj.name=name;obj.data.materials.append(_material(name,color,emission))
        obj['previs_animation_object']=True
        objects=[obj]
        liquid=None
        if kind=='knife':
            bpy.ops.mesh.primitive_cube_add(size=1)
            handle_obj=bpy.context.object;handle_obj.name=name+'_刀柄';handle_obj.parent=obj
            for v in handle_obj.data.vertices:
                v.co.x*=.035;v.co.y*=.025;v.co.z*=.12
            handle_obj.location=(0,0,-.16)
            handle_obj.data.materials.append(_material(name+'_木柄',(.13,.065,.025),0))
            handle_obj['previs_animation_object']=True;objects.append(handle_obj)
        if kind in ('bowl','jar'):
            # 液面是可见的量感预演，不作流体模拟；0为空碗、0.5为半碗。
            bpy.ops.mesh.primitive_circle_add(vertices=24,radius=1,fill_type='NGON')
            liquid=bpy.context.object;liquid.name=name+'_血液面';liquid.parent=obj
            liquid.data.materials.append(_material(name+'_血液',(.42,.012,.018),0))
            liquid['previs_animation_object']=True;objects.append(liquid)
        samples=[]
        handle={'spec':prop,'objects':objects,'samples':samples}
        # 道具按声明顺序烘焙，被依赖的碗已具备整段轨迹。
        for frame in range(1,scene.frame_end+1):
            scene.frame_set(frame);bpy.context.view_layer.update()
            t=(frame-1)/24
            left,right,u=track_segment(prop['keyframes'],t)
            p0,q0,v0=anchor_transform(left['anchor'],frame)
            p1,q1,v1=anchor_transform(right['anchor'],frame)
            rotation0=q0 @ Euler(left.get('rotation',[0,0,0]),'XYZ').to_quaternion()
            rotation1=q1 @ Euler(right.get('rotation',[0,0,0]),'XYZ').to_quaternion()
            obj.location=p0.lerp(p1,u)
            obj.rotation_mode='QUATERNION';obj.rotation_quaternion=rotation0.slerp(rotation1,u)
            visible=bool(left.get('visible',True) and (v0 if u==0 else v0 and v1))
            size=(left.get('scale',1)*(1-u)+right.get('scale',1)*u) if visible else 0.
            obj.scale=(size,size,size)
            obj.hide_render=not visible;obj.hide_viewport=not visible
            fill=left.get('fill',0)*(1-u)+right.get('fill',0)*u
            if liquid is not None:
                height=.02+(.075 if kind=='bowl' else .27)*fill
                liquid.location=(0,0,height)
                inner_radius=(.055+.07*fill if kind=='bowl' else (.088 if height<=.205 else max(.041,.088-(height-.205)*.72)))
                radius=inner_radius if fill>0 and visible else 0.
                liquid.scale=(radius,radius,1)
                liquid.hide_render=not(visible and fill>0);liquid.hide_viewport=liquid.hide_render
                for key in ('location','scale','hide_render','hide_viewport'):
                    liquid.keyframe_insert(key,frame=frame)
            grip=prop.get('grip')
            gripping=grip and grip.get('startSec',0)<=t<grip.get('endSec',scene.frame_end/24)
            grip_residual=grip_to_bowl(grip,obj,frame) if gripping and visible else None
            for child in objects[1:]:
                if child==liquid:continue
                child.hide_render=not visible;child.hide_viewport=not visible
                for key in ('hide_render','hide_viewport'):child.keyframe_insert(key,frame=frame)
            for key in ('location','rotation_quaternion','scale','hide_render','hide_viewport'):
                obj.keyframe_insert(key,frame=frame)
            samples.append({'frame':frame,'position':list(obj.location),'visible':visible,
                            'fromAnchor':left['anchor'],'toAnchor':right['anchor'],'progress':u,
                            **({'fillLevel':fill} if kind in ('bowl','jar') else {}),
                            **({'gripResidual':grip_residual} if grip_residual is not None else {})})
        by_id[prop['id']]=handle;handles.append(handle)
    scene.frame_set(1)
    return handles
