"""Isolated quadruped heat-weight/export/reimport probe; never modifies user assets.

Run on the existing idle worker with a private output directory. JSON audits
must be archived before cleanup. This synthetic mesh is development evidence.
"""
import hashlib
import json
import os
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).parent))
import bpy
from mathutils import Vector
import previs_auto_rig as core
import previs_rigged_model as contract
from previs_quadruped import SOURCE_BONE_MAP, validate_landmarks

out = Path(sys.argv[sys.argv.index("--")+1])
out.mkdir(parents=True, exist_ok=True)
bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)
points = {"pelvis": ((-.6,0,1.2),(0,0,1.2)), "spine": ((0,0,1.2),(.6,0,1.2)),
          "neck": ((.6,0,1.2),(.85,0,1.75)), "head": ((.85,0,1.75),(1.3,0,1.75))}
for sign in (-1,1):
    s=str(sign)
    for names,x in ((("upper_arm","forearm","hand"),.6),(("upper_leg","lower_leg","foot"),-.6)):
        y=sign*.25
        points[names[0]+s]=((x,y,1.2),(x+.04,y,.7))
        points[names[1]+s]=((x+.04,y,.7),(x,y,.12))
        points[names[2]+s]=((x,y,.12),(x+.18,y,.12))
vectors={name:tuple(Vector(p) for p in pair) for name,pair in points.items()}
validate_landmarks(vectors)
for broken in ("side","front","continuity"):
    wrong={name:tuple(p.copy() for p in pair) for name,pair in vectors.items()}
    if broken=="side": wrong["upper_arm1"][0].y=-.25
    elif broken=="front": wrong["upper_arm1"][0].x=-.8
    else: wrong["forearm1"][0].z+=.1
    try: validate_landmarks(wrong)
    except ValueError: pass
    else: raise AssertionError("Invalid quadruped landmarks accepted: "+broken)

pieces=[]
for name,(head,tail) in vectors.items():
    radius=.26 if name in ("pelvis","spine") else .17 if name in ("neck","head") else .1
    direction=tail-head
    bpy.ops.mesh.primitive_cylinder_add(vertices=16,radius=radius,depth=direction.length+radius,location=(head+tail)/2)
    obj=bpy.context.object
    obj.rotation_mode="QUATERNION"
    obj.rotation_quaternion=direction.to_track_quat("Z","Y")
    pieces.append(obj)
bpy.ops.object.select_all(action="DESELECT")
for obj in pieces:obj.select_set(True)
bpy.context.view_layer.objects.active=pieces[0]
bpy.ops.object.join()
source=bpy.context.object
bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
source.data.remesh_voxel_size=.035
bpy.ops.object.voxel_remesh()
source.name="TEST_ONLY_quadruped"
source["TEST_ONLY"]=True
before=core.source_digest(source)
core._write_json(out/"intent.json",{"kind":"synthetic-quadruped-rig-probe","sourceDigest":before,"vertices":len(source.data.vertices),"productionReady":False,"qualityAccepted":False,"landmarks":points})
def checkpoint(phase):
    name="checkpoint-%02d.json"%len(list(out.glob("checkpoint-*.json")))
    core._write_json(out/name,{"phase":phase,"sourceDigest":before,"sourceUnchanged":core.source_digest(source)==before})
receipt=core.rig_confirmed_mesh(source,points,{"singleHuman":False,"singleQuadruped":True,"pose":"quadruped","landmarksManuallyConfirmed":True,"sourceDigest":before},out/"horse-rigged.glb",checkpoint=checkpoint,compact_proxy=True)
assert core.source_digest(source)==before
assert receipt["stage4Reimport"]["mappedBones"]==16
assert set(receipt["influencedVertices"])==set(contract.SEMANTIC_BONES)
assert all(receipt["influencedVertices"].values())
assert len(receipt["reimportBendMaxDeltaMeters"])==4
assert min(receipt["reimportBendMaxDeltaMeters"].values())>=.01
assert set(SOURCE_BONE_MAP)==set(contract.SEMANTIC_BONES)
assert SOURCE_BONE_MAP["forearm1"]=="lower_leg1"
assert SOURCE_BONE_MAP["lower_leg1"]=="lower_leg2"
core._write_json(out/"result.json",{"status":"passed","fixture":"synthetic quadruped, not actual Tripo horse","productionReady":False,"qualityAccepted":False,"receipt":receipt,"sourceUnchanged":True,"sourceBoneMap":SOURCE_BONE_MAP,"outputSha256":hashlib.sha256((out/"horse-rigged.glb").read_bytes()).hexdigest()})
print(json.dumps({"status":"passed","vertices":receipt["vertices"],"mappedBones":16,"reimportBends":receipt["reimportBendMaxDeltaMeters"],"outputSha256":receipt["outputSha256"]}))
