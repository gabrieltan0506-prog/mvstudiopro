"""为基础人体坐卧创建明确座面/靠面；由正式renderer调用，不独立渲染。"""
import math
from previs_human_pose import human_posture_lean


def build_human_support(actor, rig, scene, material):
    import bpy
    from mathutils import Vector
    p=actor['humanPosture']
    objects=[]
    for name,scale in [('座面',(.55,.38,.04)),('靠面',(.04,.34,.4))]:
        bpy.ops.mesh.primitive_cube_add(size=2)
        obj=bpy.context.object
        obj.name=actor['id']+'_坐卧支撑_'+name
        obj.parent=rig
        obj.scale=scale
        obj.data.materials.append(material)
        obj['previs_animation_object']=True
        objects.append(obj)
    seat,back=objects
    seat.location=(-.12,0,p['supportHeight']-.04)
    for f in range(scene.frame_start,scene.frame_end+1):
        angle=human_posture_lean(p,(f-1)/24)
        # 与躯干后侧保持.15米边缘距离；靠面随坐起展开，不能留在半躺位置穿身。
        back.location=(-.19*math.cos(angle)-.4*math.sin(angle),0,
                       p['supportHeight']+.08-.19*math.sin(angle)+.4*math.cos(angle))
        back.rotation_euler=(0,-angle,0)
        back.keyframe_insert('location',frame=f)
        back.keyframe_insert('rotation_euler',frame=f)
    return objects
