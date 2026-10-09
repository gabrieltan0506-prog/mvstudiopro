"""坐下实际腿骨层级与蒙皮内存检查；无渲染、场景保存或模型导出。"""
import math
import sys
from pathlib import Path
import bpy
from mathutils import Matrix
sys.path.insert(0,str(Path(__file__).resolve().parent))
from previs_rigged_model import apply_grounded_sit_contact
from previs_rigged_contact_mesh import measure_contact_mesh
cases=[]
for upper_len,lower_len in ((.38,.4),(.52,.47)):
 for obj in list(bpy.data.objects):bpy.data.objects.remove(obj,do_unlink=True)
 data=bpy.data.armatures.new('sit_actual');rig=bpy.data.objects.new('sit_actual',data)
 bpy.context.scene.collection.objects.link(rig);bpy.context.view_layer.objects.active=rig;rig.select_set(True)
 hip_z=upper_len+lower_len+.06
 bpy.ops.object.mode_set(mode='EDIT')
 pelvis=data.edit_bones.new('pelvis');pelvis.head=(0,0,hip_z);pelvis.tail=(0,0,hip_z+.1)
 for side in (-1,1):
  names=['upper_leg'+str(side),'lower_leg'+str(side),'foot'+str(side)]
  pts=[(0,side*.15,hip_z),(0,side*.15,lower_len+.06),(0,side*.15,.06),(.15,side*.15,.06)]
  for index,name in enumerate(names):
   b=data.edit_bones.new(name);b.head=pts[index];b.tail=pts[index+1];b.parent=data.edit_bones['pelvis' if index==0 else names[index-1]];b.use_connect=index>0
 bpy.ops.object.mode_set(mode='OBJECT')
 vertices=[];faces=[];groups={}
 for side in (-1,1):
  n=len(vertices);vertices.extend([(0,side*.15,0),(.15,side*.15,0),(.05,side*.15+.04,0)])
  faces.append((n,n+1,n+2));groups['foot'+str(side)]=[n,n+1,n+2]
 mesh=bpy.data.meshes.new('sit_skin');mesh.from_pydata(vertices,[],faces);obj=bpy.data.objects.new('sit_skin',mesh);bpy.context.scene.collection.objects.link(obj)
 for name,ids in groups.items():obj.vertex_groups.new(name=name).add(ids,1,'REPLACE')
 obj.modifiers.new('actual_skin','ARMATURE').object=rig
 # 非零世界位置和朝向：网格与骨架使用同一世界变换。
 world=Matrix.Translation((2,-3,0)) @ Matrix.Rotation(.7,4,'Z');rig.matrix_world=world;obj.matrix_world=world
 rest={b.name:b.matrix_local.copy() for b in data.bones}
 for frame in range(1,49):
  bpy.context.scene.frame_set(frame)
  for bone in rig.pose.bones:bone.matrix_basis.identity()
  # 真实层级骨盆下降后双脚必穿地；校正必须把两条腿解回地面。
  rig.pose.bones['pelvis'].location.y=-.24*math.sin(math.pi*(frame-1)/47)**2
  for bone in rig.pose.bones:
   bone.rotation_mode='QUATERNION'
   for prop in ('location','rotation_quaternion','scale'):bone.keyframe_insert(prop,frame=frame)
 model={'rig':rig,'meshes':[obj],'boneMap':{n:n for n in groups}|{b.name:b.name for b in data.bones},'restMatrices':rest,'report':{'targetHeight':1.7}}
 try:measure_contact_mesh(model,list(range(1,49)))
 except ValueError as error:assert '穿地' in str(error)
 else:raise AssertionError('未校正的真实蒙皮穿地未被检出')
 rows=apply_grounded_sit_contact(model,[{'kind':'sit','startSec':0,'endSec':1},{'kind':'sit','startSec':1,'endSec':2}],1,48)
 assert len(rows)==96 and max(r['ankleResidual'] for r in rows)<.005
 for frame in range(1,49):
  bpy.context.scene.frame_set(frame);bpy.context.view_layer.update()
  for b in rig.pose.bones:assert abs((b.tail-b.head).length-b.bone.length)<1e-5
 cases.append({'upperLength':upper_len,'lowerLength':lower_len,'frames':48,'maxAnkleResidual':max(r['ankleResidual'] for r in rows)})
print({'status':'PASS','cases':cases,'mediaProduced':False,'projectCharacterValidated':False})
