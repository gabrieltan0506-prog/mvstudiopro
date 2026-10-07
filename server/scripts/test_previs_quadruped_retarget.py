"""Directed runtime check: reuse an already audited GLB; do not regenerate skinning.
Executes the production scene/horse-driver and model-retarget prefix without renders.
Only for isolated development evidence, never a production media acceptance.
"""
import hashlib,json,sys
from pathlib import Path
import bpy
from mathutils import Vector
root=Path(__file__).parent
sys.path.insert(0,str(root))
args=sys.argv[sys.argv.index("--")+1:]
source=Path(args[0]); out=Path(args[1]); out.mkdir(parents=True,exist_ok=True)
expected="abfb7f0a22fedbedb5e42e9d6be95fa783584fafac60559cf6791be5d0bb5c05"
raw=source.read_bytes();assert hashlib.sha256(raw).hexdigest()==expected
(out/"fixture.glb").write_bytes(raw)
spec={"version":1,"durationSec":2,"aspect":"9:16","actors":[{"id":"fixture-horse","nameZh":"TEST_ONLY","shape":"horse","assetRef":"fixture-ref","start":[-.3,0],"end":[.3,0],"moveStartSec":0,"moveEndSec":2,"facingDeg":0,"actions":[],"riggedModel":{"sourceJobId":"fixture-job","rigKind":"quadruped","forwardAxis":"+X","targetHeight":1.7}}],"cameras":[{"startSec":0,"endSec":2,"position":[0,-8,3],"target":[0,0,1],"lens":35}]}
(out/"spec.json").write_text(json.dumps(spec))
manifest=[{"actorId":"fixture-horse","sourceJobId":"fixture-job","localPath":str((out/"fixture.glb").resolve()),"sha256":expected,"bytes":len(raw)}]
(out/"manifest.json").write_text(json.dumps(manifest))
renderer=root/"render-manhua-previs.py"
text=renderer.read_text().split("\ndef model_vertices(model):",1)[0]
assert "retarget_from_source(source_rig,model" in text
sys.argv=[str(renderer),"--",str(out/"spec.json"),str(out),str(out/"manifest.json")]
ns={"__file__":str(renderer),"__name__":"__main__"}
exec(compile(text,str(renderer),"exec"),ns)
model=ns["models"][0]; rig=model["rig"]
from previs_quadruped import SOURCE_BONE_MAP
assert model["report"]["sourceBoneMap"]==SOURCE_BONE_MAP
assert model["report"]["retargetFrames"]==48
semantics=["forearm1","forearm-1","lower_leg1","lower_leg-1"]
indices={k:[] for k in semantics}
for oi,obj in enumerate(model["meshes"]):
 for k in semantics:
  group=obj.vertex_groups[model["boneMap"][k]].index
  indices[k].extend((oi,v.index) for v in obj.data.vertices if any(g.group==group and g.weight>.25 for g in v.groups))
assert all(indices.values())
def vertices():
 dg=bpy.context.evaluated_depsgraph_get(); result={}
 for oi,obj in enumerate(model["meshes"]):
  evaluated=obj.evaluated_get(dg); mesh=evaluated.to_mesh()
  matrix=rig.matrix_world.inverted() @ obj.matrix_world
  for v in mesh.vertices:result[(oi,v.index)]=matrix @ v.co
  evaluated.to_mesh_clear()
 return result
bpy.context.scene.frame_set(1); baseline=vertices(); frames=[]; maximum={k:0. for k in semantics}
for frame in range(1,49):
 bpy.context.scene.frame_set(frame); current=vertices()
 deltas={k:max((current[i]-baseline[i]).length for i in indices[k]) for k in semantics}
 for k in semantics:maximum[k]=max(maximum[k],deltas[k])
 frames.append({"frame":frame,"rootLocalMeshDeltaMeters":deltas})
result={"kind":"synthetic-quadruped-production-driver-retarget","sourceSha256":expected,"frames":frames,"maxDeltaMeters":maximum,"modelReport":model["report"],"sourceUnchanged":hashlib.sha256(source.read_bytes()).hexdigest()==expected,"productionReady":False,"qualityAccepted":False}
(out/"result.json").write_text(json.dumps(result,indent=2))
assert min(maximum.values())>.005
assert result["sourceUnchanged"]
print(json.dumps({"status":"passed","frames":48,"maxDeltaMeters":maximum,"qualityAccepted":False}))
