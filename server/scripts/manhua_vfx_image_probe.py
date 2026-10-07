"""Synthetic PNG overlay + path-boundary checks, isolated from the other eleven effects."""
import json
import struct
import sys
import zlib
from pathlib import Path

import bpy
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Vector

sys.path.insert(0,str(Path(__file__).resolve().parent))
from manhua_vfx import build_vfx,configure_scene,render,update_vfx,write_json
from manhua_vfx_math import validate_image_path,validate_spec


def png(width,height):
    def chunk(tag,data):return struct.pack('>I',len(data))+tag+data+struct.pack('>I',zlib.crc32(tag+data)&0xffffffff)
    rows=[]
    for y in range(height):
        row=bytearray([0])
        for x in range(width):row.extend((255,0,0,128 if y>3 else 0) if x<width//2 else (0,255,0,255 if y>3 else 0))
        rows.append(bytes(row))
    return b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',width,height,8,6,0,0,0))+chunk(b'IDAT',zlib.compress(b''.join(rows)))+chunk(b'IEND',b'')


def main(output):
    out=Path(output);out.mkdir(parents=True,exist_ok=True);images=out/'images';images.mkdir(exist_ok=True)
    asset=images/'synthetic-rgba.png';asset.write_bytes(png(80,40))
    outside=out/'outside.png';outside.write_bytes(asset.read_bytes())
    escape=images/'escape.png';escape.symlink_to(outside)
    fake=images/'not-png.png';fake.write_bytes(b'TEST ONLY NOT PNG'+bytes(32))
    huge=images/'over-pixel-limit.png';raw=bytearray(asset.read_bytes());raw[16:24]=struct.pack('>II',4001,1000);huge.write_bytes(raw)
    rejected=[]
    for name,value in (('outside',str(outside)),('symlink',str(escape)),('url','https://example.invalid/image.png'),('not_png',str(fake)),('over_pixels',str(huge))):
        try:validate_image_path(value,out);raise AssertionError('Path guard accepted '+name)
        except ValueError:rejected.append(name)
    spec={'version':1,'seed':1,'durationSec':.5,'fps':12,'width':320,'height':180,'effects':[
        {'id':'image','kind':'image_overlay','startSec':1/12,'durationSec':1/3,'color':'#ffffff','scale':.5,'intensity':1.,
         'imageUri':'gs://TEST_ONLY_SYNTHETIC/image.png','imagePath':str(asset),
         'anchor':{'space':'screen','position':[.5,.5],'trajectory':[{'timeSec':0,'x':.3,'y':.4},{'timeSec':.5,'x':.7,'y':.6}]}}]}
    try:validate_spec(spec);raise AssertionError('Missing trusted directory accepted')
    except ValueError:rejected.append('missing_asset_root')
    source=out/'spec.json';write_json(source,spec)
    manifest=render(source,out/'render')
    assert manifest['complete'] and len(manifest['files'])==6 and len(manifest['imageAssets'])==1
    assert manifest['imageAssets'][0]['width']==80 and manifest['imageAssets'][0]['height']==40
    receipts=[]
    for frame in (1,4,6):
        image=bpy.data.images.load(str(out/'render'/('frame-%06d.png'%frame)),check_existing=False)
        values=list(image.pixels);alphas=values[3::4]
        if frame==4:
            left,right=(90*320+120)*4,(90*320+200)*4
            assert .47<values[left+3]<.53 and values[left]>.95 and values[left+1]<.05,values[left:left+4]
            assert values[right+3]>.97 and values[right+1]>.95 and values[right]<.05,values[right:right+4]
            assert alphas[10*320+10]==0
        else:assert max(alphas)==0
        receipts.append({'frame':frame,'nonzeroAlpha':sum(a>0 for a in alphas)})
        bpy.data.images.remove(image)
    scene=configure_scene(spec);handles=build_vfx(spec,scene,out);update_vfx(handles,spec,.25);bpy.context.view_layer.update()
    obj=handles[0]['objects'][0]
    points=[world_to_camera_view(scene,scene.camera,obj.matrix_world@Vector(point)) for point in obj.bound_box]
    width=(max(p.x for p in points)-min(p.x for p in points))*320
    height=(max(p.y for p in points)-min(p.y for p in points))*180
    assert abs(width-180)<1e-4 and abs(height-90)<1e-4,(width,height)
    result={'syntheticDevelopmentOnly':True,'workflowAcceptance':False,'frames':6,'guardRejections':rejected,
            'heightFractionScale':.5,'measuredWidthPixels':width,'measuredHeightPixels':height,
            'inputAlphaAndColorsPreserved':True,'pixelReceipts':receipts,'noUrlFetched':True}
    write_json(out/'result.json',result);print('VFX_IMAGE_OVERLAY_PASS '+json.dumps(result),flush=True)


def scale_only(output):
    out=Path(output);out.mkdir(parents=True,exist_ok=True);images=out/'images';images.mkdir(exist_ok=True)
    asset=images/'synthetic-rgba.png';asset.write_bytes(png(80,40));receipts=[]
    for width,height in ((320,180),(180,320)):
        spec={'version':1,'seed':1,'durationSec':.5,'fps':12,'width':width,'height':height,'effects':[
            {'id':'image','kind':'image_overlay','startSec':0,'durationSec':.5,'color':'#ffffff','scale':.25,'intensity':1.,
             'imageUri':'gs://TEST_ONLY_SYNTHETIC/image.png','imagePath':str(asset),
             'anchor':{'space':'screen','position':[.3,.6]}}]}
        validate_spec(spec,out)
        scene=configure_scene(spec);handles=build_vfx(spec,scene,out);update_vfx(handles,spec,.25);bpy.context.view_layer.update()
        obj=handles[0]['objects'][0]
        points=[world_to_camera_view(scene,scene.camera,obj.matrix_world@Vector(point)) for point in obj.bound_box]
        left,right=min(p.x for p in points),max(p.x for p in points)
        bottom,top=min(p.y for p in points),max(p.y for p in points)
        actual_width,actual_height=(right-left)*width,(top-bottom)*height
        assert abs(actual_width-height*.5)<1e-4 and abs(actual_height-height*.25)<1e-4,(actual_width,actual_height)
        assert abs((left+right)/2-.3)<1e-6 and abs(1-(bottom+top)/2-.6)<1e-6
        receipts.append({'width':width,'height':height,'scale':.25,'measuredWidthPixels':actual_width,
                         'measuredHeightPixels':actual_height,'anchor':[.3,.6],'aspectRatioPreserved':True})
    result={'syntheticDevelopmentOnly':True,'workflowAcceptance':False,'heightFractionScale':True,'projections':receipts,
            'reusedEvidence':'image-overlay/result.json: path guards, pixels/alpha, timing unchanged; only plane dimensions changed'}
    write_json(out/'result.json',result);print('VFX_IMAGE_HEIGHT_SCALE_PASS '+json.dumps(result),flush=True)


if __name__=='__main__':
    args=sys.argv[sys.argv.index('--')+1:]
    if '--scale-only' in args:scale_only(args[0])
    else:main(args[0])
