"""掩口锚点方向回归：转头时应跟随嘴部，而非固定世界轴。"""
import math
import unittest
from previs_human_contact import head_contact_target


class HeadContactTargetTest(unittest.TestCase):
    def test_turned_head_moves_contact_to_its_forward_side(self):
        for angle in (-math.pi/2, 0., math.pi/2):
            c, s = math.cos(angle), math.sin(angle)
            rotation = ((c, -s, 0), (s, c, 0), (0, 0, 1))
            target = head_contact_target((2, 3, 1.5), rotation, 1.)
            self.assertAlmostEqual((target[0]-2)*c+(target[1]-3)*s, .125)
            self.assertAlmostEqual(-(target[0]-2)*s+(target[1]-3)*c, -.025)
            self.assertAlmostEqual(target[2], 1.555)
            if angle:
                self.assertGreater(math.dist(target, (2.125, 2.975, 1.555)), .1)

    def test_tilt_and_body_scale_keep_same_head_relative_landmark(self):
        rotation = ((0, 0, 1), (0, 1, 0), (-1, 0, 0))
        for scale in (.7, 1., 1.5):
            result = head_contact_target((0, 0, 0), rotation, scale)
            self.assertAlmostEqual(result[0], .055*scale)
            self.assertAlmostEqual(result[1], -.025*scale)
            self.assertAlmostEqual(result[2], -.125*scale)

    def test_invalid_scale_mirror_and_non_rotation_rejected(self):
        identity = ((1, 0, 0), (0, 1, 0), (0, 0, 1))
        for scale in (0, -1, float('nan')):
            with self.assertRaises(ValueError): head_contact_target((0, 0, 0), identity, scale)
        for rotation in (((-1, 0, 0), (0, 1, 0), (0, 0, 1)), ((2, 0, 0), (0, 1, 0), (0, 0, 1))):
            with self.assertRaises(ValueError): head_contact_target((0, 0, 0), rotation, 1.)


if __name__ == '__main__':
    unittest.main()
