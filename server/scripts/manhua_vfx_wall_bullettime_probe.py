"""Blender幕墙无媒体结构探针：只建内存网格，不渲染或保存模型。"""
import copy
import json
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
import bpy
from manhua_vfx import material
from manhua_vfx_wall_bullettime import build_wall_fracture,update_wall_fracture
from manhua_vfx_wall_bullettime_math import WALL_DEFAULTS


def main():
    scene=bpy.context.scene
    spec={'width':1920,'height':1080,'durationSec':3.,'seed':17}
    event={'id':'geometry_probe','kind':'wall_fracture','startSec':0.,'durationSec':3.,'wall':copy.deepcopy(WALL_DEFAULTS)}
    wall=build_wall_fracture(event,spec,scene,material,(.2,.5,.7))
    assert len(wall['objects'])==60
    for obj in wall['objects']:
        assert len(obj.data.vertices)==6 and len(obj.data.polygons)==5
        assert not obj.data.validate()
    state={'active':True,'progress':.5,'opacity':.5}
    update_wall_fracture(wall,event,1.5,state)
    coordinates=[tuple(v.co) for obj in wall['objects'] for v in obj.data.vertices]
    update_wall_fracture(wall,event,0,state)
    assert coordinates != [tuple(v.co) for obj in wall['objects'] for v in obj.data.vertices]
    print(json.dumps({'complete':True,'mediaRendered':False,'blender':bpy.app.version_string,
                      'wallObjects':60,'wallVertices':360},ensure_ascii=False))


if __name__=='__main__':main()
