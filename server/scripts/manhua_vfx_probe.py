"""Synthetic Blender development probe for the four effects after the initial sword sample.

Run once for changed/uncovered paths. Outputs are not production workflow acceptance.
"""
import hashlib
import json
import math
import sys
from pathlib import Path

import bpy
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
from manhua_vfx import build_vfx, configure_scene, render, update_vfx, write_json


def sword_history(output):
    """Targeted new historical-path and fractional-FPS snapshot, without replaying prior probes."""
    output=Path(output)
    output.mkdir(parents=True,exist_ok=True)
    spec={'version':1,'seed':123,'durationSec':1,'fps':29.97,'width':480,'height':270,
          'effects':[{'id':'sword','kind':'sword_trail','startSec':0,'durationSec':1,
                      'color':'#44cfff','scale':.5,'intensity':1.8,'anchor':{'space':'screen','position':[.5,.5],
                       'trajectory':[{'timeSec':0,'x':.2,'y':.65},{'timeSec':1,'x':.8,'y':.35}]}}]}
    write_json(output/'spec.json',spec)
    scene=configure_scene(spec)
    handles=build_vfx(spec,scene)
    update_vfx(handles,spec,.5)
    strip=handles[0]['strips'][2]
    first=(strip.data.vertices[0].co+strip.data.vertices[1].co)/2
    last=(strip.data.vertices[-2].co+strip.data.vertices[-1].co)/2
    # .22 seconds of real input trajectory history, converted to the root's local coordinates.
    assert abs(first.x-(-.132*(480/270)/.5))<1e-6
    assert abs(first.y-(-.066/.5))<1e-6
    assert abs(last.x)<1e-7 and abs(last.y)<1e-7
    assert scene.frame_end==30 and abs(scene.render.fps/scene.render.fps_base-29.97)<1e-5
    image_path=output/'sword-history.png'
    scene.render.filepath=str(image_path)
    bpy.context.view_layer.update()
    bpy.ops.render.render(write_still=True)
    image=bpy.data.images.load(str(image_path),check_existing=False)
    alpha=list(image.pixels)[3::4]
    assert sum(a>0 for a in alpha)>100
    bpy.data.images.remove(image)
    write_json(output/'result.json',{'syntheticDevelopmentOnly':True,'workflowAcceptance':False,
                                     'actualHistoricalPath':True,'lookbackSec':.22,'fractionalFps':29.97,
                                     'frameCount':30,'renderedFrames':1,
                                     'pngSha256':hashlib.sha256(image_path.read_bytes()).hexdigest()})
    print('MANHUA_VFX_SWORD_HISTORY_PASS')


def main(output):
    output=Path(output)
    output.mkdir(parents=True,exist_ok=True)
    kinds=('impact_burst','particle_aura','shield','spirit')
    positions=((.25,.25),(.75,.25),(.25,.75),(.75,.75))
    spec={'version':1,'seed':917,'durationSec':1,'fps':12,'width':480,'height':480,
          'effects':[{'id':kind,'kind':kind,'startSec':.25,'durationSec':.5,
                      'color':color,'scale':.34,'intensity':1.8,
                      'anchor':{'space':'screen','position':list(pos)}}
                     for kind,pos,color in zip(kinds,positions,('#ffc355','#46f4cc','#66aaff','#c084fc'))]}
    input_path=output/'four-kinds-input.json'
    input_path.write_text(json.dumps(spec),encoding='utf-8')
    manifest=render(input_path,output/'render')
    assert manifest['complete'] and len(manifest['files'])==12
    assert len(manifest['frames'])==12 and all(len(f['effects'])==4 for f in manifest['frames'])
    assert all(f['sha256']==hashlib.sha256((output/'render'/f['path']).read_bytes()).hexdigest() for f in manifest['files'])
    pixel_receipts=[]
    for frame in (1,6,10):
        image=bpy.data.images.load(str(output/'render'/('frame-%06d.png'%frame)),check_existing=False)
        pixels=list(image.pixels)
        assert image.channels==4
        alphas=pixels[3::4]
        if frame in (1,10):
            assert max(alphas)==0, ('inactive frame leaks alpha',frame,max(alphas))
        else:
            assert any(0<a<1 for a in alphas), 'Missing partial alpha'
            for kind,pos in zip(kinds,positions):
                cx,cy=round(pos[0]*480),round((1-pos[1])*480)
                region=[alphas[y*480+x] for y in range(cy-85,cy+85) for x in range(cx-85,cx+85)]
                assert sum(a>0 for a in region)>40, ('Effect produced no visible pixels',kind)
        pixel_receipts.append({'frame':frame,'channels':image.channels,'nonzeroAlpha':sum(a>0 for a in alphas),
                               'partialAlpha':sum(0<a<1 for a in alphas)})
        bpy.data.images.remove(image)
    # Independently verify geometry remains deterministic under nonsequential frame access.
    scene=configure_scene(spec)
    handles=build_vfx(spec,scene)
    def signature(time):
        states=update_vfx(handles,spec,time)
        values=[]
        for h in handles:
            values.append([h['event']['id'],list(h['root'].location),
                           [[o.name,list(o.location),list(o.scale),o.hide_render,
                             [list(v.co) for v in o.data.vertices]] for o in h['objects']]])
        return hashlib.sha256(json.dumps(values,sort_keys=True).encode()).hexdigest(),states
    first=signature(.5)
    signature(.1)
    signature(.8)
    assert signature(.5)==first
    for handle,pos in zip(handles,positions):
        bpy.context.view_layer.update()
        ndc=world_to_camera_view(scene,scene.camera,handle['root'].matrix_world.translation)
        assert abs(ndc.x-pos[0])<1e-5 and abs(1-ndc.y-pos[1])<1e-5
    # Portrait and landscape share normalized coordinates; no media is resized.
    for width,height in ((540,960),(960,540)):
        spec['width'],spec['height']=width,height
        scene=configure_scene(spec)
        handles=build_vfx(spec,scene)
        update_vfx(handles,spec,.5)
        bpy.context.view_layer.update()
        for handle,pos in zip(handles,positions):
            ndc=world_to_camera_view(scene,scene.camera,handle['root'].matrix_world.translation)
            assert abs(ndc.x-pos[0])<1e-5 and abs(1-ndc.y-pos[1])<1e-5, (width,height,tuple(ndc),pos)
    result={'syntheticDevelopmentOnly':True,'workflowAcceptance':False,'blender':bpy.app.version_string,
            'fourKindsRendered':list(kinds),'frameCount':12,'hashesChecked':12,'pixelReceipts':pixel_receipts,
            'deterministicNonSequentialEvaluation':True,'squarePortraitLandscapeProjection':True}
    write_json(output/'probe-result.json',result)
    print('MANHUA_VFX_PROBE_PASS '+json.dumps(result),flush=True)


if __name__=='__main__':
    args=sys.argv[sys.argv.index('--')+1:]
    if len(args)==2 and args[1]=='--sword-history':
        sword_history(args[0])
    else:
        main(args[0])
