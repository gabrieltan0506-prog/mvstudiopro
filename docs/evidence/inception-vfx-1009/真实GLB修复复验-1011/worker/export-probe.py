"""已授权技术夹具：真实生产GLB导出，不调用模型、不操作正式资产。"""
import sys,json,hashlib,struct
from pathlib import Path
import bpy
p=Path(__file__).resolve().parent
sys.path.insert(0,str(p))
source=(p/'test_vfx_stage_bake.py').read_text()
# 复用既有内存测试的相同几何/骨架/运动生产者；不重跑其末尾内存测试。
exec(compile(source.split('expected=[]')[0],str(p/'test_vfx_stage_bake.py'),'exec'))
from manhua_vfx_stage_export import export_world_animation
spec['width']=192;spec['height']=192
original_update=update
expected=[]
def update_with_proof(scene,*args):
    result=original_update(scene,*args)
    graph=bpy.context.evaluated_depsgraph_get();cam=scene.camera.evaluated_get(graph)
    projection=cam.calc_matrix_camera(graph,x=spec['width'],y=spec['height'],scale_x=1,scale_y=1)
    result.update(cameraMatrixWorld=[list(row) for row in cam.matrix_world],cameraVfovRad=2*__import__('math').atan(1/projection[1][1]),cameraClip=[cam.data.clip_start,cam.data.clip_end])
    return result
for index in range(48):
    update_with_proof(scene,None,None,None,None,index/24)
    meshes={}
    for obj in [body,fragment]:
        evaluated=obj.evaluated_get(bpy.context.evaluated_depsgraph_get());mesh=evaluated.to_mesh()
        meshes[obj.name]=[list(evaluated.matrix_world@v.co) for v in mesh.vertices]
        evaluated.to_mesh_clear()
    expected.append({'frame':index+1,'meshes':meshes})
(p/'expected-world-vertices.json').write_text(json.dumps(expected))
proofs=export_world_animation(scene,handle,{}, {},spec,p,update_with_proof)
(p/'proofs.json').write_text(json.dumps(proofs))
raw=(p/'world-animation.glb').read_bytes()
assert raw[:4]==b'glTF' and len(raw)>100
length,kind=struct.unpack_from('<II',raw,12)
gltf=json.loads(raw[20:20+length]);assert gltf.get('animations') and gltf.get('skins')
(p/'glb-structure.json').write_text(json.dumps({'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest(),'animations':len(gltf['animations']),'channels':len(gltf['animations'][0]['channels']),'skins':len(gltf['skins']),'meshes':len(gltf['meshes'])},indent=2))
# 保留每條實際 GLB 動畫通道時間，首鍵必須對齊正式播放器的0秒。
json_length=struct.unpack_from('<I',raw,12)[0]
bin_start=20+json_length+8
timing=[]
for animation in gltf['animations']:
    for channel in animation['channels']:
        accessor=gltf['accessors'][animation['samplers'][channel['sampler']]['input']]
        view=gltf['bufferViews'][accessor['bufferView']]
        assert accessor['componentType']==5126 and accessor['type']=='SCALAR'
        offset=bin_start+view.get('byteOffset',0)+accessor.get('byteOffset',0)
        values=list(struct.unpack_from('<'+'f'*accessor['count'],raw,offset))
        timing.append({'animation':animation.get('name'),'target':channel['target'],'times':values})
(p/'glb-timing.raw.json').write_text(json.dumps(timing,indent=2))
assert all(abs(row['times'][0])<1e-7 for row in timing), 'GLB首鍵未歸零'

# 仅消费者环境碰撞夹具，Blender XY平面经glTF Y-up后由生产环境变换转回Z-up。
for obj in scene.objects:obj.select_set(False)
bpy.ops.mesh.primitive_plane_add(size=6,location=(0,0,0));plane=bpy.context.object;plane.name='TEST_ONLY_collider'
bpy.ops.export_scene.gltf(filepath=str(p/'collider.glb'),export_format='GLB',use_selection=True,export_animations=False)
print('REAL_PRODUCTION_GLB_EXPORT_PASS '+json.dumps({'bytes':len(raw),'animations':len(gltf['animations']),'skins':len(gltf['skins']),'frames':48}),flush=True)
