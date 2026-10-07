"""Fixed Blender renderer for manual screen-space VFX. No source media is loaded.

CLI: blender -b --factory-startup --disable-autoexec --python-exit-code 1
  --python server/scripts/manhua_vfx.py -- spec.json output_directory
The blend is an inspection snapshot, not a baked animation. Replay uses spec + script.
"""
import hashlib
import json
import math
import os
import random
import sys
from pathlib import Path

import bpy

sys.path.insert(0, str(Path(__file__).resolve().parent))
from manhua_vfx_math import BOUNDARY, VERSION, srgb, state_at, position_at, validate_spec
from manhua_vfx_extras import EXTRA_KINDS, build_extra, update_extra
from manhua_vfx_image import build_image_overlay

MAX_RENDER_BYTES = 2 * 1024**3


def material(name, color, opacity=1., glow=False, rim=False):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    nodes.clear()
    output = nodes.new('ShaderNodeOutputMaterial')
    mix = nodes.new('ShaderNodeMixShader')
    transparent = nodes.new('ShaderNodeBsdfTransparent')
    emission = nodes.new('ShaderNodeEmission')
    emission.inputs['Color'].default_value = (*color, 1)
    emission.inputs['Strength'].default_value = 1.7 if glow else 1.
    strength = nodes.new('ShaderNodeMath')
    strength.operation = 'MULTIPLY'
    strength.inputs[1].default_value = opacity
    strength.inputs[0].default_value = 1.
    if glow:
        coords = nodes.new('ShaderNodeTexCoord')
        distance = nodes.new('ShaderNodeVectorMath')
        distance.operation = 'DISTANCE'
        distance.inputs[1].default_value = (.5, .5, 0)
        links.new(coords.outputs['UV'], distance.inputs[0])
        falloff = nodes.new('ShaderNodeMapRange')
        falloff.clamp = True
        falloff.inputs['From Min'].default_value = .02
        falloff.inputs['From Max'].default_value = .5
        falloff.inputs['To Min'].default_value = 1.
        falloff.inputs['To Max'].default_value = 0.
        links.new(distance.outputs['Value'], falloff.inputs['Value'])
        power = nodes.new('ShaderNodeMath')
        power.operation = 'POWER'
        power.inputs[1].default_value = 2.
        links.new(falloff.outputs['Result'], power.inputs[0])
        links.new(power.outputs[0], strength.inputs[0])
    if rim:
        facing = nodes.new('ShaderNodeLayerWeight')
        power = nodes.new('ShaderNodeMath')
        power.operation = 'POWER'
        power.inputs[1].default_value = 2.5
        links.new(facing.outputs['Facing'], power.inputs[0])
        links.new(power.outputs[0], strength.inputs[0])
    links.new(strength.outputs[0], mix.inputs[0])
    links.new(transparent.outputs[0], mix.inputs[1])
    links.new(emission.outputs[0], mix.inputs[2])
    links.new(mix.outputs[0], output.inputs['Surface'])
    if hasattr(mat, 'surface_render_method'):
        mat.surface_render_method = 'BLENDED'
    elif hasattr(mat, 'blend_method'):
        mat.blend_method = 'BLEND'
    if hasattr(mat, 'use_transparency_overlap'):
        mat.use_transparency_overlap = False
    return mat, strength.inputs[1]


def mesh_object(name, scene, vertices, faces, mat):
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    scene.collection.objects.link(obj)
    obj.data.materials.append(mat)
    return obj


def ribbon(name, scene, mat, segments=48):
    verts = [(0, 0, 0)] * ((segments + 1) * 2)
    faces = [(i*2, i*2+1, i*2+3, i*2+2) for i in range(segments)]
    return mesh_object(name, scene, verts, faces, mat)


def set_strip(obj, points, widths, z=0.):
    for i, (point, width) in enumerate(zip(points, widths)):
        before, after = points[max(0, i-1)], points[min(len(points)-1, i+1)]
        dx, dy = after[0]-before[0], after[1]-before[1]
        norm = math.hypot(dx, dy) or 1
        nx, ny = -dy/norm*width, dx/norm*width
        obj.data.vertices[2*i].co = (point[0]+nx, point[1]+ny, z)
        obj.data.vertices[2*i+1].co = (point[0]-nx, point[1]-ny, z)
    obj.data.update()


def glow_quad(name, scene, mat):
    obj = mesh_object(name, scene, [(-1,-1,0),(1,-1,0),(1,1,0),(-1,1,0)], [(0,1,2,3)], mat)
    uv = obj.data.uv_layers.new()
    for loop, coord in zip(uv.data, ((0,0),(1,0),(1,1),(0,1))):
        loop.uv = coord
    return obj


def build_vfx(spec, scene, asset_root=None):
    """Build only new effects. Caller must provide a matching orthographic screen camera."""
    validate_spec(spec,asset_root)
    handles = []
    for index, event in enumerate(spec['effects']):
        color = srgb(event['color'])
        core_color = tuple(.65 + .35*c for c in color)
        mat, opacity = material(event['id'] + '_color', color)
        core, core_opacity = material(event['id'] + '_core', core_color)
        glow, glow_opacity = material(event['id'] + '_glow', color, glow=True)
        root = bpy.data.objects.new('VFX_' + event['id'], None)
        scene.collection.objects.link(root)
        objects, rings, strips, particles = [], [], [], []
        rng = random.Random(spec['seed'] ^ int(hashlib.sha256(event['id'].encode()).hexdigest()[:8], 16))
        kind = event['kind']
        extra = None
        image_opacity = None
        image_receipt = None
        if kind == 'sword_trail':
            for j, m in enumerate((mat, core)):
                strips.append(ribbon(event['id'] + '_blade_%d' % j, scene, m))
            if event['anchor'].get('trajectory'):
                strips.append(ribbon(event['id'] + '_motion_history', scene, mat))
            for j in range(18):
                particles.append((glow_quad(event['id'] + '_ember_%d' % j, scene, glow), [rng.random() for _ in range(5)]))
        elif kind == 'impact_burst':
            for j in range(3):
                rings.append(ribbon(event['id'] + '_shock_%d' % j, scene, core if j == 0 else mat, 64))
            for j in range(28):
                strips.append(ribbon(event['id'] + '_spark_%d' % j, scene, core if j % 3 == 0 else mat, 1))
            particles.append((glow_quad(event['id'] + '_flash', scene, glow), [0]*5))
        elif kind in ('particle_aura', 'spirit'):
            for j in range(64 if kind == 'particle_aura' else 38):
                particles.append((glow_quad(event['id'] + '_particle_%d' % j, scene, glow), [rng.random() for _ in range(5)]))
            for j in range(3):
                rings.append(ribbon(event['id'] + '_flow_%d' % j, scene, mat))
        elif kind == 'shield':
            rim_mat, rim_opacity = material(event['id'] + '_fresnel', color, rim=True)
            bpy.ops.mesh.primitive_uv_sphere_add(segments=48, ring_count=24, radius=.5)
            shell = bpy.context.object
            shell.name = event['id'] + '_shell'
            shell.data.materials.append(rim_mat)
            for polygon in shell.data.polygons:
                polygon.use_smooth = True
            objects.append(shell)
            for j in range(5):
                rings.append(ribbon(event['id'] + '_lattice_%d' % j, scene, core if j == 0 else mat, 64))
        elif kind == 'image_overlay':
            image_obj,image_opacity,image_receipt=build_image_overlay(event,spec,scene,asset_root)
            objects.append(image_obj)
        elif kind in EXTRA_KINDS:
            extra=build_extra(event,scene,(mat,core,glow),rng,(ribbon,glow_quad,material,color))
            objects += extra['objects']
        objects += rings + strips + [p[0] for p in particles]
        for obj in objects:
            obj.parent = root
        handles.append({'event': event, 'root': root, 'objects': objects, 'rings': rings, 'strips': strips,
                        'particles': particles, 'opacity': opacity, 'coreOpacity': core_opacity,
                        'glowOpacity': glow_opacity, 'extra':extra, 'imageOpacity':image_opacity, 'imageAsset':image_receipt, 'rimOpacity': rim_opacity if kind == 'shield' else None})
    return handles


def update_vfx(handles, spec, time):
    aspect = spec['width'] / spec['height']
    states = []
    for order, h in enumerate(handles):
        e = h['event']
        state = state_at(e, time)
        q, fade = state['progress'], state['opacity']
        x, y = state['position']
        h['root'].location = ((x-.5)*aspect, .5-y, order*.015)
        h['root'].scale = (e['scale'],) * 3
        for obj in h['objects']:
            obj.hide_render = not state['active'] or fade == 0
        h['opacity'].default_value = min(1., fade * 1.4)
        h['coreOpacity'].default_value = min(1., fade * 2)
        h['glowOpacity'].default_value = min(1., fade * 1.3)
        if h['rimOpacity'] is not None:
            h['rimOpacity'].default_value = min(.8, fade)
        kind = e['kind']
        if kind == 'sword_trail':
            # Sweeping crescent plus a bright tapered leading edge.
            head = -.9 + q*3.9
            points = [(.5*math.cos(head-1.95+i/48*1.95), .36*math.sin(head-1.95+i/48*1.95)) for i in range(49)]
            for j, obj in enumerate(h['strips'][:2]):
                widths = [(math.sin(math.pi*i/48)**.65) * (.075 if j == 0 else .012) for i in range(49)]
                set_strip(obj, points, widths, .003*j)
            if len(h['strips']) == 3:
                history=[]
                lookback=min(.22,e['durationSec']*.35)
                for i in range(49):
                    past=max(e['startSec'],time-lookback*(1-i/48))
                    hx,hy=position_at(e,past)
                    history.append(((hx-x)*aspect/e['scale'],(y-hy)/e['scale']))
                set_strip(h['strips'][2],history,[.035*(i/48)**.8 for i in range(49)],-.002)
            for obj, r in h['particles']:
                a = head-r[0]*2.2
                rad = .5+r[1]*.16*q
                obj.location = (rad*math.cos(a), rad*.72*math.sin(a), .008)
                s = .012+r[2]*.019
                obj.scale = (s,s,s)
        elif kind == 'impact_burst':
            for j, obj in enumerate(h['rings']):
                radius = max(.001, (q-j*.1)*.78)
                points = [(radius*math.cos(i/64*math.tau), radius*.7*math.sin(i/64*math.tau)) for i in range(65)]
                set_strip(obj, points, [.008*(1-q)]*65, j*.002)
            for j, obj in enumerate(h['strips']):
                a = j*2.399963 + (spec['seed'] % 97)*.03
                radius = (.2+.65*((j*17 % 29)/29))*math.sqrt(q)
                length = (.025+.14*(j % 4)/3)*(1-q)
                points = [(radius*math.cos(a), radius*math.sin(a)), ((radius+length)*math.cos(a), (radius+length)*math.sin(a))]
                set_strip(obj, points, [.008*(1-q), .001], .008)
            flash = h['particles'][0][0]
            s = .32*max(0., 1-q*4)
            flash.scale = (s,s,s)
        elif kind in ('particle_aura', 'spirit'):
            for obj, r in h['particles']:
                a = r[0]*math.tau + q*(2+r[3]*3)
                if kind == 'particle_aura':
                    radius = (.22+r[1]*.22) + abs(2*q-1)**2*(.15+r[2]*.45)
                    px, py = radius*math.cos(a), radius*math.sin(a)
                else:
                    py = ((r[1]+q*.65) % 1.0 - .5)*1.3
                    radius = (.08+r[2]*.22)*(1.-max(0.,py)*.6)
                    px = radius*math.sin(a+py*5)
                obj.location = (px,py,.005+r[4]*.008)
                s = (.008+r[3]*.022)*(1+.2*math.sin(q*20+r[4]*6))
                obj.scale = (s,s*(1.8 if kind == 'spirit' else 1),s)
            for j, obj in enumerate(h['rings']):
                points = []
                for i in range(49):
                    a = i/48*math.tau+q*2+j*2.09
                    if kind == 'particle_aura':
                        radius = .27+.045*math.sin(a*3+q*8+j)
                        points.append((radius*math.cos(a), radius*math.sin(a)))
                    else:
                        py = (i/48-.5)*1.1
                        points.append((.16*math.sin(py*7+q*5+j*2),py))
                set_strip(obj, points, [.0035*math.sin(math.pi*i/48)**.5 for i in range(49)], .01+j*.002)
        elif kind == 'shield':
            for j, obj in enumerate(h['rings']):
                points=[]
                for i in range(65):
                    a=i/64*math.tau
                    if j == 0:
                        points.append((.502*math.cos(a),.502*math.sin(a)))
                    else:
                        turn=q*.45+j*math.pi/4
                        xx, yy=.49*math.cos(a)*math.cos(turn), .49*math.sin(a)
                        points.append((xx,yy))
                set_strip(obj, points, [.003 if j else .008]*65, .52+j*.001)
        elif kind == 'image_overlay':
            h['imageOpacity'].default_value=min(1.,fade*2)
        elif h.get('extra'):
            update_extra(h,spec,time,state,set_strip)
        states.append({'id':e['id'],'kind':kind,**state})
    return states


def configure_scene(spec):
    scene = bpy.context.scene
    for obj in list(scene.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    try:
        scene.render.engine = 'BLENDER_EEVEE_NEXT'
    except TypeError:
        scene.render.engine = 'BLENDER_EEVEE'
    if hasattr(scene, 'eevee') and hasattr(scene.eevee, 'taa_render_samples'):
        scene.eevee.taa_render_samples = 32
    scene.render.resolution_x, scene.render.resolution_y = spec['width'], spec['height']
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGBA'
    scene.render.image_settings.color_depth = '8'
    scene.render.image_settings.compression = 35
    scene.render.fps = round(spec['fps'])
    scene.render.fps_base = round(spec['fps']) / spec['fps']
    scene.render.use_compositing = False
    scene.render.use_sequencer = False
    scene.view_settings.view_transform = 'Standard'
    scene.view_settings.look = 'None'
    scene.view_settings.exposure, scene.view_settings.gamma = 0., 1.
    scene.world.color = (0,0,0)
    camera = bpy.data.cameras.new('VFX_screen_camera')
    camera.type = 'ORTHO'
    camera.ortho_scale = max(1., spec['width']/spec['height'])
    camera.clip_start, camera.clip_end = .01, 100
    obj = bpy.data.objects.new('VFX_screen_camera', camera)
    scene.collection.objects.link(obj)
    obj.location = (0,0,10)
    scene.camera = obj
    scene.frame_start, scene.frame_end = 1, math.ceil(spec['durationSec']*spec['fps'])
    return scene


def write_json(path, value):
    # Atomic receipt updates; never overwrite raw spec with normalized data.
    temporary = path.with_suffix(path.suffix + '.writing')
    with temporary.open('w', encoding='utf-8') as handle:
        json.dump(value, handle, ensure_ascii=False, separators=(',',':'), allow_nan=False)
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(temporary, path)


def artifact(path, root):
    raw = path.read_bytes()
    return {'path':path.relative_to(root).as_posix(),'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest()}


def render(spec_path, output):
    output = Path(output)
    output.mkdir(parents=True, exist_ok=True)
    if (output/'manifest.json').exists() or any(output.glob('frame-*.png')):
        raise ValueError('Output already contains a render; use original receipt, do not overwrite')
    raw = Path(spec_path).read_bytes()
    # Preserve exact original before parsing or validation, including failed requests.
    with (output/'input.raw.json').open('xb') as handle:
        handle.write(raw)
        handle.flush()
        os.fsync(handle.fileno())
    asset_root=Path(spec_path).resolve().parent
    spec = validate_spec(json.loads(raw),asset_root)
    write_json(output/'spec.normalized.json', spec)
    scene = configure_scene(spec)
    handles = build_vfx(spec, scene,asset_root)
    manifest = {'version':1,'renderer':VERSION,'blenderVersion':bpy.app.version_string,
                'implementationSha256':{name:hashlib.sha256(Path(__file__).with_name(name).read_bytes()).hexdigest() for name in ('manhua_vfx.py','manhua_vfx_math.py','manhua_vfx_extras.py','manhua_vfx_image.py')},
                'complete':False,'width':spec['width'],'height':spec['height'],'fps':spec['fps'],
                'frameCount':scene.frame_end,'durationSec':spec['durationSec'],
                'coordinateSpace':'screen_top_left_normalized','alpha':'straight','colorSpace':'sRGB',
                'boundaryZh':BOUNDARY,'files':[],'frames':[],'renderedBytes':0,
                'input':artifact(output/'input.raw.json',output),
                'normalized':artifact(output/'spec.normalized.json',output),
                'imageAssets':[h['imageAsset'] for h in handles if h['imageAsset']],
                'sceneSnapshot':{'animated':False,'replay':'fixed renderer + normalized spec'}}
    write_json(output/'manifest.json',manifest)
    try:
        for frame in range(1, scene.frame_end+1):
            scene.frame_set(frame)
            time = (frame-1)/spec['fps']
            states = update_vfx(handles,spec,time)
            bpy.context.view_layer.update()
            frame_path = output/('frame-%06d.png'%frame)
            scene.render.filepath = str(frame_path)
            bpy.ops.render.render(write_still=True)
            record = artifact(frame_path,output)
            if record['bytes'] == 0:
                raise ValueError('Empty rendered frame')
            manifest['files'].append({'frame':frame,**record})
            manifest['frames'].append({'frame':frame,'timeSec':time,'effects':states})
            manifest['renderedBytes'] += record['bytes']
            if manifest['renderedBytes'] > MAX_RENDER_BYTES:
                raise ValueError('Rendered PNG sequence exceeds 2 GiB budget; incomplete output must not be composed')
            write_json(output/'manifest.json',manifest)
            print('MANHUA_VFX_PROGRESS '+json.dumps({'frame':frame,'frameCount':scene.frame_end}),flush=True)
        snapshot_frame = min(scene.frame_end, max(1, int((spec['effects'][0]['startSec']+spec['effects'][0]['durationSec']*.4)*spec['fps'])+1))
        scene.frame_set(snapshot_frame)
        update_vfx(handles,spec,(snapshot_frame-1)/spec['fps'])
        scene['manhua_vfx_snapshot_only'] = True
        scene['manhua_vfx_renderer'] = VERSION
        embedded = bpy.data.texts.new('VFX_SPEC_REPLAY.json')
        embedded.write(json.dumps(spec,ensure_ascii=False))
        bpy.ops.wm.save_as_mainfile(filepath=str(output/'scene.blend'))
        manifest['sceneSnapshot'].update({'frame':snapshot_frame,**artifact(output/'scene.blend',output)})
        manifest['complete'] = True
        write_json(output/'manifest.json',manifest)
    except BaseException as error:
        manifest['error'] = {'type':type(error).__name__,'message':str(error)[:1000]}
        write_json(output/'manifest.json',manifest)
        raise
    print('MANHUA_VFX_COMPLETE '+str(scene.frame_end),flush=True)
    return manifest


if __name__ == '__main__':
    arguments = sys.argv[sys.argv.index('--')+1:]
    if len(arguments) != 2:
        raise SystemExit('Expected spec.json and output directory')
    render(arguments[0],arguments[1])
