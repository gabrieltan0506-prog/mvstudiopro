"""背负离线诊断：实际48帧骨架接触，不代表网格或常速验收。"""
import bpy,sys,json,runpy
from pathlib import Path
from mathutils import Matrix
repo=Path(__file__).resolve().parent
sys.path.insert(0,str(repo))
from previs_piggyback import solve_piggyback
out=Path(sys.argv[sys.argv.index('--')+1]);out.mkdir(parents=True,exist_ok=True)
spec={'version':1,'durationSec':2,'aspect':'16:9','actors':[{'id':n,'nameZh':n,'shape':'human','start':[0,0],'end':[.35,0],'moveStartSec':0,'moveEndSec':2,'facingDeg':0,'actions':[{'kind':'walk','startSec':0,'endSec':2}]} for n in ['carrier','passenger']], 'cameras':[{'startSec':0,'endSec':2,'position':[3,-5,2.5],'target':[0,0,1.2],'lens':48}]}
source=out/'spec.json';source.write_text(json.dumps(spec));script=repo/'render-manhua-previs.py'
sys.argv=[str(script),'--',str(source),str(out)];env=runpy.run_path(str(script),run_name='__main__')
a,b=spec['actors']
rows=[]
for f in range(1,49):
 bpy.context.scene.frame_set(f)
 bpy.context.view_layer.update()
 poses=[{bone.name:(bone.head.copy(),bone.tail.copy()) for bone in bpy.data.objects[actor['id']].pose.bones} for actor in (a,b)]
 carrier_matrix=bpy.data.objects[a['id']].matrix_world.copy()
 pa,pb,contacts=solve_piggyback(*poses)
 for actor,pose in [(a,pa),(b,pb)]:
  rig=bpy.data.objects[actor['id']];rig.matrix_world=carrier_matrix
  for prop in ('location','rotation_euler'):rig.keyframe_insert(prop,frame=f)
  for name,(start,end) in pose.items():
   bone=rig.pose.bones[name];d=end-start;bone.rotation_mode='QUATERNION'
   bone.matrix=Matrix.Translation(start)@d.to_track_quat('Y','Z').to_matrix().to_4x4()@Matrix.Diagonal((1,d.length/bone.bone.length,1,1))
   for prop in ('location','rotation_quaternion','scale'):bone.keyframe_insert(prop,frame=f)
 rows.append({'frame':f,'contacts':contacts})
actual=[]
for f in range(1,49):
 bpy.context.scene.frame_set(f);bpy.context.view_layer.update()
 ra,rb=[bpy.data.objects[actor['id']] for actor in (a,b)]
 gaps=[]
 for side in (-1,1):
  k=str(side);wrist=ra.matrix_world@ra.pose.bones['forearm'+k].tail
  knee=rb.matrix_world@rb.pose.bones['lower_leg'+k].head
  gaps.append((wrist-(knee+__import__('mathutils').Vector((0,0,-.035)))).length)
 actual.append({'frame':f,'maxSupportGap':max(gaps),'passengerFootHeight':min((rb.matrix_world@rb.pose.bones['lower_leg'+str(k)].tail).z for k in (-1,1))})
assert max(r['maxSupportGap'] for r in actual)<.005, actual
(out/'actual-report.json').write_text(json.dumps(actual,indent=2))
(out/'contact-report.json').write_text(json.dumps({'frames':rows,'accepted':False,'productionEnabled':False},indent=2))
bpy.ops.wm.save_as_mainfile(filepath=str(out/'diagnostic.blend'))
bpy.context.scene.frame_set(18);bpy.context.scene.render.filepath=str(out/'side-18.png');bpy.ops.render.render(write_still=True)
print('PIGGYBACK_DIAGNOSTIC',len(rows))
