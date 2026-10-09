"""三维环绕纯数据测试，不导入Blender、不生成图片或模型。"""
import copy
import hashlib
import math
from pathlib import Path
import tempfile
import unittest
from manhua_vfx_bullet3d_math import (
    BULLET_DEFAULTS,validate_bullet,orbit_pose,geometry_summary,
    source_frame,frame_span,validate_scene_path,validate_render_spec,validate_geometry_budget,
)


def params():
    return {**copy.deepcopy(BULLET_DEFAULTS),'sceneJobId':'prv_'+'a'*48,
            'sceneScopeId':'00000000-0000-4000-8000-000000000001','clipId':'shot-1'}


class Bullet3dTest(unittest.TestCase):
    def test_vertex_frame_budget_inclusive_and_overflow(self):
        self.assertEqual(validate_geometry_budget(200_000,60),12_000_000)
        with self.assertRaisesRegex(ValueError,'1200万'):validate_geometry_budget(200_001,60)
        with self.assertRaises(ValueError):validate_geometry_budget(True,60)
        with self.assertRaises(ValueError):validate_geometry_budget(200_000,0)

    def test_true_camera_orbits_constant_radius(self):
        p=params();p.update(startAngleDeg=0,sweepDeg=360,radius=4,height=1.6)
        positions=[orbit_pose(p,q)['position'] for q in (0,.25,.5,.75,1)]
        self.assertAlmostEqual(math.dist(positions[0],positions[-1]),0)
        self.assertNotEqual(positions[0],positions[2])
        for point in positions:
            self.assertAlmostEqual(math.hypot(point[0]-p['target'][0],point[1]-p['target'][1]),4)
            self.assertAlmostEqual(point[2]-p['target'][2],1.6)
        self.assertAlmostEqual(positions[1][1]-p['target'][1],4)

    def test_negative_sweep_reverses_direction(self):
        p=params();p['startAngleDeg']=0
        a=orbit_pose(p,.25)['position'];p['sweepDeg']=-360
        b=orbit_pose(p,.25)['position']
        self.assertAlmostEqual(a[1],-b[1])

    def test_plane_even_when_rotated_is_rejected(self):
        for points in ([(0,0,0),(1,0,0),(1,1,0),(0,1,0)],
                       [(0,0,0),(1,0,1),(1,1,2),(0,1,1)]):
            with self.assertRaisesRegex(ValueError,'共面'):geometry_summary(points,1)

    def test_real_volume_summary(self):
        report=geometry_summary([(x,y,z) for x in (-1,1) for y in (-1,1) for z in (-1,1)],1)
        self.assertEqual(report['minimum'],[-1,-1,-1])
        self.assertEqual(report['maximum'],[1,1,1])
        self.assertEqual(report['vertices'],8)
        self.assertGreater(report['nonPlanarThickness'],1)

    def test_empty_line_nan_rejected(self):
        for points in ([],[(i,0,0) for i in range(4)],[(0,0,0),(1,0,0),(0,1,0),(0,0,float('nan'))]):
            with self.assertRaises(ValueError):geometry_summary(points,1)

    def test_source_frame_uses_scene_start_and_source_fps(self):
        self.assertEqual(source_frame(.5,101,148,24),113)
        self.assertEqual(source_frame(1,1,120,30),31)
        with self.assertRaises(ValueError):source_frame(2,101,148,24)

    def test_half_open_frame_window_and_two_frame_minimum(self):
        self.assertEqual(frame_span({'startSec':.1,'durationSec':.1},24),(3,5))
        with self.assertRaises(ValueError):frame_span({'startSec':0,'durationSec':1/60},24)

    def test_frame_span_matches_absolute_timestamp_comparison(self):
        for fps in (12,24,29.97,60):
            for start in (.1,.100000000001,.3,1/3):
                event={'startSec':start,'durationSec':.5}
                first,stop=frame_span(event,fps)
                expected=[i for i in range(math.ceil(2*fps)) if start<=i/fps<start+.5]
                self.assertEqual(list(range(first,stop)),expected)

    def test_full_circle_two_identical_endpoint_frames_rejected(self):
        e={'id':'bullet','kind':'bullet_time','bullet':params(),'startSec':0,'durationSec':2/24,
           'color':'#ffffff','scenePath':'scenes/scene-bullet.blend','sceneSha256':'a'*64,'scale':1,'intensity':1,'anchor':{'space':'screen','position':[.5,.5]}}
        spec={'version':1,'seed':0,'width':512,'height':512,'durationSec':2,'fps':24,'effects':[e]}
        with self.assertRaisesRegex(ValueError,'至少13帧'):validate_render_spec(spec,'bullet','/tmp')

    def test_render_spec_rejects_alias_and_extra_fields(self):
        base={'version':1,'seed':0,'width':512,'height':512,'durationSec':2,'fps':24,'effects':[]}
        e={'id':'bullet','kind':'bullet_time','bullet':params(),'startSec':0,'durationSec':1,
           'color':'#ffffff','scenePath':'scenes/scene-bullet.blend','sceneSha256':'a'*64,
           'scale':1,'intensity':1,'anchor':{'space':'screen','position':[.5,.5]}}
        for key in ('framePath','modelPath','sceneUrl'):
            spec={**base,'effects':[{**e,key:'/untrusted'}]}
            with self.assertRaisesRegex(ValueError,'字段无效'):validate_render_spec(spec,'bullet','/tmp')
        with self.assertRaises(ValueError):validate_render_spec({**base,'effects':[e],'sourceVideo':'untrusted'},'bullet','/tmp')

    def test_old_fake_projection_contract_is_rejected(self):
        with self.assertRaises(ValueError):validate_bullet({'freezeSec':0,'yawDeg':8,'pushIn':.08})
        for key,value in [('radius',.1),('height',31),('lensMm',101),('sweepDeg',29),('freezeSec',31),('target',[0,0,101])]:
            p=params();p[key]=value
            with self.assertRaises(ValueError):validate_bullet(p)

    def test_only_server_scene_path_and_matching_sha_allowed(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);scenes=root/'scenes';scenes.mkdir()
            file=scenes/'scene-bullet.blend'
            # 仅路径校验的字节夹具，不是可加载场景，不生成或渲染媒体。
            file.write_bytes(b'BLENDER-v306'+b'test-only-not-a-real-scene')
            digest=hashlib.sha256(file.read_bytes()).hexdigest()
            self.assertEqual(validate_scene_path(str(file),digest,root,'bullet'),file.resolve())
            with self.assertRaises(ValueError):validate_scene_path(str(file),'0'*64,root,'bullet')
            with self.assertRaises(ValueError):validate_scene_path(str(file),digest,root,'other')
            external=root/'external.blend';external.write_bytes(file.read_bytes())
            file.unlink();file.symlink_to(external)
            with self.assertRaises(ValueError):validate_scene_path(str(file),digest,root,'bullet')

    def test_spec_rejects_overlapping_screen_effect(self):
        p=params()
        e={'id':'bullet','kind':'bullet_time','bullet':p,'startSec':0,'durationSec':1,
           'color':'#ffffff','scenePath':'scenes/scene-bullet.blend','sceneSha256':'a'*64,'scale':1,'intensity':1,'anchor':{'space':'screen','position':[.5,.5]}}
        spec={'version':1,'seed':0,'width':512,'height':512,'durationSec':2,'fps':24,'effects':[e,
              {'id':'wall','startSec':.5,'durationSec':1}]}
        with self.assertRaisesRegex(ValueError,'重叠'):validate_render_spec(spec,'bullet','/tmp')


if __name__=='__main__':unittest.main()
