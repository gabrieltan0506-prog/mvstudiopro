"""Blender纯数学回归；不生成模型、图片、动画或视频。"""
import math
import unittest
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from mathutils import Vector
from previs_bone_basis import rotation_from_rest


class StableBoneBasisTests(unittest.TestCase):
    def test_upright_spine_does_not_roll_at_small_lean(self):
        vertical = Vector((0, 0, 1))
        rest = vertical.to_track_quat('Y', 'Z').to_matrix().to_4x4()
        neutral = rest.to_quaternion()
        for x in (-.001, -.00001, 0, .00001, .001):
            direction = Vector((x, 0, 1))
            actual = rotation_from_rest(rest, vertical, direction)
            self.assertLess(neutral.rotation_difference(actual).angle, .002)
            self.assertLess(((actual @ Vector((0, 1, 0)))-direction.normalized()).length, 1e-5)
        # 反证：旧的全局上轴跟踪在非零微倾处出现大幅roll，确实咬住旧根因。
        old = Vector((.001, 0, 1)).to_track_quat('Y', 'Z')
        self.assertGreater(neutral.rotation_difference(old).angle, math.pi/4)

    def test_rest_roll_and_real_bend_are_both_preserved(self):
        for direction in (Vector((0, 0, 1)), Vector((0, -1, 0)), Vector((1, 0, .2))):
            rest = direction.to_track_quat('Y', 'Z').to_matrix().to_4x4()
            identity = rotation_from_rest(rest, direction, direction)
            self.assertLess(identity.rotation_difference(rest.to_quaternion()).angle, 1e-4)
            bent = Vector((.3, -.5, .7)).normalized()
            actual = rotation_from_rest(rest, direction, bent)
            self.assertLess(((actual @ Vector((0, 1, 0)))-bent).length, 1e-5)

    def test_degenerate_bone_is_rejected(self):
        direction = Vector((0, 0, 1))
        with self.assertRaisesRegex(ValueError, '端点重合'):
            rotation_from_rest(direction.to_track_quat('Y', 'Z').to_matrix().to_4x4(), direction, Vector((0, 0, 0)))


if __name__ == '__main__':
    unittest.main(argv=['test_previs_bone_basis'])
