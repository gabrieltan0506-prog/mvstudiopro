"""Only the six newly added kinds; synthetic development evidence, not workflow acceptance."""
import hashlib
import json
import sys
from pathlib import Path

import bpy

sys.path.insert(0,str(Path(__file__).resolve().parent))
from manhua_vfx import build_vfx, configure_scene, render, update_vfx, write_json


def main(output):
    out=Path(output)
    out.mkdir(parents=True,exist_ok=True)
    kinds=('fire_burst','smoke_plume','lightning','shockwave','speed_lines','magic_circle')
    positions=((1/6,.25),(.5,.25),(5/6,.25),(1/6,.75),(.5,.75),(5/6,.75))
    colors=('#ff7022','#a0a7b8','#b9a3ff','#68deff','#badbff','#ffe086')
    spec={'version':1,'seed':777,'durationSec':1,'fps':12,'width':720,'height':480,
          'effects':[{'id':kind,'kind':kind,'startSec':1/12,'durationSec':.75,'color':color,'scale':.31,'intensity':1.8,
                      'anchor':{'space':'screen','position':list(pos)}} for kind,pos,color in zip(kinds,positions,colors)]}
    source=out/'spec.json'
    write_json(source,spec)
    manifest=render(source,out/'render')
    assert manifest['complete'] and len(manifest['files'])==len(manifest['frames'])==12
    assert all(len(row['effects'])==6 for row in manifest['frames'])
    receipts=[]
    for frame in (1,6,12):
        image=bpy.data.images.load(str(out/'render'/('frame-%06d.png'%frame)),check_existing=False)
        alphas=list(image.pixels)[3::4]
        visible=[]
        if frame==6:
            assert any(0<a<1 for a in alphas)
            for kind,pos in zip(kinds,positions):
                cx,cy=round(pos[0]*720),round((1-pos[1])*480)
                count=sum(alphas[y*720+x]>.001 for y in range(cy-95,cy+95) for x in range(cx-95,cx+95))
                assert count>40,(kind,count)
                visible.append({'kind':kind,'nonzeroAlphaPixels':count})
        else:
            assert max(alphas)==0,('inactive frame alpha leak',frame)
        receipts.append({'frame':frame,'visible':visible,'nonzeroAlpha':sum(a>0 for a in alphas)})
        bpy.data.images.remove(image)
    scene=configure_scene(spec)
    handles=build_vfx(spec,scene)
    def signature(time):
        update_vfx(handles,spec,time)
        values={}
        for handle in handles:
            points=[[o.name,list(o.location),list(o.scale),[list(v.co) for v in o.data.vertices]] for o in handle['objects']]
            values[handle['event']['kind']]=hashlib.sha256(json.dumps(points).encode()).hexdigest()
        return values
    first=signature(.25)
    second=signature(.5)
    assert all(first[k]!=second[k] for k in kinds), 'An effect does not animate'
    signature(.8)
    assert signature(.25)==first, 'Evaluation order changes seeded result'
    result={'syntheticDevelopmentOnly':True,'workflowAcceptance':False,'blender':bpy.app.version_string,
            'kinds':list(kinds),'frameCount':12,'effectFrameEntries':72,'pixelReceipts':receipts,
            'eachKindAnimates':True,'deterministicNonSequentialEvaluation':True}
    write_json(out/'result.json',result)
    print('MANHUA_VFX_EXTRAS_PASS '+json.dumps(result),flush=True)


if __name__=='__main__':
    main(sys.argv[sys.argv.index('--')+1])
