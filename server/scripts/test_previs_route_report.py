"""不加载 Blender、不创建场景：验证回执选择真实模型根且拒绝替身身份。"""
import sys
import types
import unittest
from unittest.mock import patch

with patch.dict(sys.modules, {
    'bpy': types.SimpleNamespace(context=types.SimpleNamespace(view_layer=types.SimpleNamespace(update=lambda: None))),
    'mathutils': types.SimpleNamespace(Vector=None),
}):
    import previs_route


class Matrix:
    translation = (3., 4., 0.)

    def __getitem__(self, i):
        return ((0., -1.), (1., 0.))[i]


class RouteReportTest(unittest.TestCase):
    def setUp(self):
        self.scene = types.SimpleNamespace(frame_current=9, frame_end=2)
        self.scene.frame_set = lambda frame: setattr(self.scene, 'frame_current', frame)
        self.actor = {'id': 'a', 'motionRoute': [{}], 'riggedModel': {'sourceJobId': 'm3d_test'}}
        self.source = types.SimpleNamespace(matrix_world=None)
        self.target = types.SimpleNamespace(matrix_world=Matrix())
        self.model = {'actorId': 'a', 'rig': self.target,
                      'report': {'actorId': 'a', 'sourceJobId': 'm3d_test', 'sha256': 'a'*64}}

    def measure(self, models):
        return previs_route.measure_routes({}, [(self.actor, self.source)], self.scene, models)

    def test_real_root_and_identity(self):
        rows = self.measure([self.model])
        self.assertEqual(rows[0]['samples'][0], {'frame': 1, 'root': [3., 4., 0.], 'facingDeg': 90.})
        self.assertEqual(rows[0]['rootSource'], {'kind': 'riggedModel', 'sourceJobId': 'm3d_test', 'sha256': 'a'*64})
        self.assertEqual(self.scene.frame_current, 9)

    def test_missing_or_duplicate_model_rejected(self):
        for models in ([], [self.model, self.model]):
            with self.assertRaisesRegex(ValueError, '唯一真实模型'):
                self.measure(models)
            self.assertEqual(self.scene.frame_current, 9)

    def test_source_substitute_or_mismatched_identity_rejected(self):
        for field in ('rig', 'actorId', 'sourceJobId', 'sha256'):
            model = dict(self.model, report=dict(self.model['report']))
            if field == 'rig':
                model['rig'] = self.source
            else:
                model['report'][field] = ''
            with self.assertRaisesRegex(ValueError, '身份不一致'):
                self.measure([model])
            self.assertEqual(self.scene.frame_current, 9)

    def test_plain_rig_still_supported(self):
        self.actor.pop('riggedModel')
        self.source.matrix_world = Matrix()
        self.assertEqual(self.measure([])[0]['rootSource'], {'kind': 'sourceRig'})


if __name__ == '__main__':
    unittest.main()
