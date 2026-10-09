"""真实Blender消费探针，仅构建内存场景和原片数组，不输出媒体。"""
import copy
import json
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
import bpy
import numpy as np
from manhua_vfx import build_vfx, configure_scene, update_vfx
from manhua_vfx_action_math import WAVE_DEFAULTS, BLAST_DEFAULTS
from manhua_vfx_liquid_ghost import PixelProcessor


def main():
    base = {'startSec': 0., 'durationSec': 2., 'scale': 1., 'intensity': 1., 'color': '#FFB35C', 'anchor': {'space': 'screen', 'position': [.15, .5]}}
    wave = {**copy.deepcopy(base), 'id': 'wave', 'kind': 'bullet_wave', 'wave': dict(WAVE_DEFAULTS)}
    blast = {**copy.deepcopy(base), 'id': 'blast', 'kind': 'directed_blast', 'blast': dict(BLAST_DEFAULTS)}
    spec = {'version': 1, 'seed': 42, 'effects': [wave, blast], 'width': 192, 'height': 128, 'fps': 24, 'durationSec': 2.}
    scene = configure_scene(spec); handles = build_vfx(spec, scene)
    h = handles[1]['blast']
    assert 72 < len(h['objects']) <= 169
    assert all(obj.type == 'MESH' and len(obj.data.vertices) > 0 and len(obj.data.polygons) > 0 for obj in h['objects'])
    update_vfx(handles, spec, .5)
    before = [(tuple(o.location), tuple(o.scale), tuple(o.color), o.hide_render) for o in h['objects']]
    states = update_vfx(handles, spec, .5)
    assert all(count > 0 for count in states[1]['visibleParticles'].values()), states
    assert states[0]['mode'] == 'source-pixels-before-overlay'
    update_vfx(handles, spec, 1.5); update_vfx(handles, spec, .5)
    assert before == [(tuple(o.location), tuple(o.scale), tuple(o.color), o.hide_render) for o in h['objects']]
    for kind in ('fire', 'smoke'):
        obj = next(o for o, p in zip(h['objects'], h['particles']) if p['kind'] == kind)
        nodes = obj.data.materials[0].node_tree.nodes
        assert any(n.type == 'TEX_NOISE' and n.noise_dimensions == '4D' for n in nodes)
        assert any(n.type == 'OBJECT_INFO' and n.outputs['Alpha'].is_linked for n in nodes)
    update_vfx(handles, spec, 2.)
    assert all(o.hide_render for o in h['objects'])
    y, x = np.mgrid[:128, :192]
    frame = np.stack(((x*7+y*3)%256, ((x//4+y//4)%2)*255, (y*9)%256), axis=2).astype(np.uint8)
    processor = PixelProcessor(spec); changed = 0
    for _ in range(48): changed += int(not np.array_equal(processor.process(frame), frame))
    assert changed > 40
    print('ACTION_GEOMETRY_PASS ' + json.dumps({'blender': bpy.app.version_string, 'objects': len(h['objects']), 'meshes': len({o.data.name for o in h['objects']}), 'visibleParticles': states[1]['visibleParticles'], 'waveChangedFrames': changed, 'rendered': False}))


if __name__ == '__main__': main()
