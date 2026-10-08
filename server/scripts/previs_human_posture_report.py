"""从已求值基础人体骨骼读取坐卧回执；不把数学接触说成真实衣物审片。"""
import math
from previs_human_pose import human_posture_lean


def check_human_posture_samples(posture, rows, frame_count, fps=24):
    if len(rows)!=frame_count or [r.get('frame') for r in rows]!=list(range(1,frame_count+1)):
        raise ValueError('坐卧回执逐帧缺失或乱序')
    for row in rows:
        values=[row.get(key) for key in ('supportGap','spineLeanRad','maxBoneLengthError','minFootZ','maxFootZ')]
        if any(type(v) not in (int,float) or not math.isfinite(v) for v in values):
            raise ValueError('坐卧回执缺少实际测量')
        expected=human_posture_lean(posture,(row['frame']-1)/fps)
        if abs(row['supportGap'])>.005 or abs(row['spineLeanRad']-expected)>.01 or row['maxBoneLengthError']>.001 or row['minFootZ']<.064 or row['maxFootZ']>.13:
            raise ValueError('坐卧支撑、姿态、骨长或双脚测量不符')
    return {'frames':frame_count,'mode':posture['mode'],'samples':rows,
            'meshValidated':False,'normalSpeedValidated':False,
            'boundaryZh':'基础人体坐卧及持续状态数值检查；不含真实带骨衣物、他人扶坐接触或常速画面验收。'}


def measure_human_posture(actor, rig, scene, update, fps=24):
    posture=actor['humanPosture']
    rows=[]
    for frame in range(scene.frame_start,scene.frame_end+1):
        scene.frame_set(frame); update()
        pelvis=rig.pose.bones['pelvis']; spine=rig.pose.bones['spine']
        delta=spine.tail-spine.head
        feet=[rig.pose.bones['foot'+side].head.z for side in ('-1','1')]
        rows.append({'frame':frame,'supportGap':pelvis.head.z-posture['supportHeight'],
                     'spineLeanRad':math.atan2(-delta.x,delta.z),
                     'maxBoneLengthError':max(abs((b.tail-b.head).length-b.bone.length) for b in rig.pose.bones),
                     'minFootZ':min(feet),'maxFootZ':max(feet)})
    return {'actorId':actor['id'],**check_human_posture_samples(posture,rows,scene.frame_end,fps)}
