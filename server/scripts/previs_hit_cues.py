"""基础白模的掌击路径与伤处标记，均由实际骨架位置驱动。"""
import bpy
from mathutils import Vector

def build_hit_cues(spec, rigs, scene, actor_visible):
    by_id={actor['id']:rig for actor,rig,*_ in rigs}
    result={}
    for actor in spec['actors']:
        hit=actor.get('hitReaction')
        if not hit:continue
        source,target=by_id[hit['sourceActorId']],by_id[actor['id']]
        mat=bpy.data.materials.new(actor['id']+'_掌击红色');mat.diffuse_color=(1.,.06,.015,1.)
        objects=[]
        for label,radius in [('掌力',.14),('伤处',.17)]:
            bpy.ops.mesh.primitive_uv_sphere_add(segments=12,ring_count=8,radius=radius)
            obj=bpy.context.object;obj.name=actor['id']+'_'+label;obj.data.materials.append(mat);objects.append(obj)
        pulse,wound=objects
        samples=[]
        for frame in range(1,scene.frame_end+1):
            scene.frame_set(frame);bpy.context.view_layer.update();t=(frame-1)/24
            hand=source.matrix_world@source.pose.bones['hand-1'].tail
            body=target.pose.bones['body']
            # 标在朝向出掌者的一侧，避免埋入马身内部。
            center=target.matrix_world@body.tail
            direction=hand-center
            surface=center+direction.normalized()*.34
            start=max(0.,hit['contactSec']-.25)
            u=max(0.,min(1.,(t-start)/max(1/24,hit['contactSec']-start)))
            pulse.location=hand.lerp(surface,u);pulse.scale=(1.,1.,1.)
            pulse.hide_render=not(start<=t<=hit['contactSec']+2/24 and actor_visible(actor,frame))
            wound.location=surface;wound.hide_render=t<hit['contactSec'] or not actor_visible(actor,frame)
            for obj in objects:
                obj.keyframe_insert('location',frame=frame);obj.keyframe_insert('hide_render',frame=frame)
            samples.append({'frame':frame,'palmCenter':list(pulse.location),'impactPoint':list(surface),
                'palmVisible':not pulse.hide_render,'injuryVisible':not wound.hide_render})
        result[actor['id']]={'pulse':pulse,'wound':wound,'samples':samples}
    return result
