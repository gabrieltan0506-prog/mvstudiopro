"""接触解算数值合同；不把骨长正确当作人物网格接触通过。"""
import math
import unittest
from previs_contact_ik import solve_limb


class ContactIKTest(unittest.TestCase):
    def test_different_body_sizes_preserve_both_lengths(self):
        for scale in (.7, 1., 1.5):
            root = (0., 0., 1.3*scale)
            result = solve_limb(root, (.2*scale, -.04*scale, 1.5*scale), .29*scale, .25*scale, (0, -1, -1))
            self.assertAlmostEqual(math.dist(root, result['joint']), .29*scale)
            self.assertAlmostEqual(math.dist(result['joint'], result['end']), .25*scale)
            self.assertAlmostEqual(result['unreachableDistance'], 0.)

    def test_unreachable_target_is_reported_not_hidden(self):
        result = solve_limb((0, 0, 0), (2, 0, 0), .3, .2, (0, 0, -1))
        self.assertAlmostEqual(result['unreachableDistance'], 1.5)
        self.assertAlmostEqual(math.dist(result['joint'], result['end']), .2)

    def test_degenerate_and_nonfinite_inputs_rejected(self):
        for target, hint in [((0, 0, 0), (0, 0, -1)), ((1, 0, 0), (1, 0, 0)), ((float('nan'), 0, 0), (0, 0, -1))]:
            with self.assertRaises(ValueError):
                solve_limb((0, 0, 0), target, .3, .2, hint)


if __name__ == '__main__':
    unittest.main()
