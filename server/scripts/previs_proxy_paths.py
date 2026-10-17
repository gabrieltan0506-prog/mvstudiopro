"""球柱动作白模的画内俯视轨迹；取实际烘焙矩阵，不从说明文字推测运动。"""
import math


def map_bounds(points):
    if not points:
        raise ValueError('轨迹图缺少实际采样')
    lo = [min(p[i] for p in points) for i in (0, 1)]
    hi = [max(p[i] for p in points) for i in (0, 1)]
    span = max(hi[0]-lo[0], hi[1]-lo[1], 1.) * 1.12
    return ((lo[0]+hi[0])/2, (lo[1]+hi[1])/2, span)


def map_point(point, bounds):
    x, y, span = bounds
    return (.04+.34*(.5+(point[0]-x)/span), .04+.18*(.5+(point[1]-y)/span), 0.)


def build_proxy_paths(spec, rigs, camera, scene):
    import bpy
    from mathutils import Vector
    if not any(a.get('proxyAppearance', {}).get('style') == 'ball-cylinder' for a in spec['actors']):
        return
    original = scene.frame_current
    actors = [(a, rig) for a, rig, *_ in rigs]
    samples = []
    for frame in range(1, scene.frame_end+1):
        scene.frame_set(frame)
        bpy.context.view_layer.update()
        samples.append((list(camera.matrix_world.translation),
                        [list(rig.matrix_world.translation) for _, rig in actors]))
    bounds = map_bounds([p for c, aa in samples for p in [c, *aa]])
    root = bpy.data.objects.new('白模轨迹图_实际烘焙采样', None)
    scene.collection.objects.link(root)
    root.parent = camera
    root['previs_diagnostic_overlay'] = True
    def mat(name, color):
        m = bpy.data.materials.new(name); m.diffuse_color = (*color, 1)
        return m
    actor_mat = mat('轨迹图_人物青色', (.1,.9,.7))
    camera_mat = mat('轨迹图_摄影机橙色', (1.,.5,.08))
    panel_mat = mat('轨迹图_底板', (.025,.035,.045))
    def line(name, points, material, radius=.002):
        curve = bpy.data.curves.new(name, 'CURVE');curve.dimensions='3D'
        curve.bevel_depth=radius;curve.bevel_resolution=0
        poly=curve.splines.new('POLY');poly.points.add(len(points)-1)
        for v,p in zip(poly.points, points):v.co=(*p,1)
        obj=bpy.data.objects.new(name,curve);scene.collection.objects.link(obj)
        obj.parent=root;obj.data.materials.append(material)
        return obj
    mesh=bpy.data.meshes.new('轨迹图底板')
    mesh.from_pydata([(.025,.025,-.003),(.395,.025,-.003),(.395,.245,-.003),(.025,.245,-.003)],[],[(0,1,2,3)])
    obj=bpy.data.objects.new('轨迹图底板',mesh);scene.collection.objects.link(obj)
    obj.parent=root;obj.data.materials.append(panel_mat)
    for i,(actor,_) in enumerate(actors):
        line('人物路线_'+actor['id'], [map_point(aa[i],bounds) for _,aa in samples], actor_mat)
    # 镜间硬切不连线，避免把剪辑跳位伪画成摄影机运动。
    for i,shot in enumerate(spec['cameras']):
        start=math.floor(shot['startSec']*24+.5);end=math.floor(shot['endSec']*24+.5)
        line('摄影机路线_'+str(i),[map_point(c,bounds) for c,_ in samples[start:end]],camera_mat)
    markers=[]
    for name,material in [('摄影机当前位置',camera_mat),*[(a['id']+'_当前位置',actor_mat) for a,_ in actors]]:
        marker=line(name,[(-.004,-.003,.002),(.004,-.003,.002),(.004,.003,.002),(-.004,.003,.002),(-.004,-.003,.002)],material,.003)
        markers.append(marker)
    for label,x,material in [('ACTOR',.04,actor_mat),('CAM',.24,camera_mat)]:
        curve=bpy.data.curves.new(label,'FONT');curve.body=label;curve.size=.018
        obj=bpy.data.objects.new(label,curve);scene.collection.objects.link(obj)
        obj.parent=root;obj.location=(x,.223,.002);obj.data.materials.append(material)
    for frame,(cam,aa) in enumerate(samples,1):
        scene.frame_set(frame)
        corners=camera.data.view_frame(scene=scene)
        # 相机局部坐标中的屏幕平面，同步真实sensor_fit和逐帧焦距。
        projected=[v*(.5/-v.z) for v in corners]
        left=min(v.x for v in projected);bottom=min(v.y for v in projected)
        width=max(v.x for v in projected)-left;height=max(v.y for v in projected)-bottom
        root.location=(left,bottom,-.5);root.scale=(width,height,1)
        root.keyframe_insert('location',frame=frame);root.keyframe_insert('scale',frame=frame)
        for i,(marker,p) in enumerate(zip(markers,[cam,*aa])):
            marker.location=map_point(p,bounds);marker.keyframe_insert('location',frame=frame)
            if i:
                ranges=actors[i-1][0].get('visibleRanges')
                marker.hide_render=ranges is not None and not any(round(r['startSec']*24)<frame<=round(r['endSec']*24) for r in ranges)
                marker.keyframe_insert('hide_render',frame=frame)
    scene.frame_set(original)
    bpy.context.view_layer.update()
