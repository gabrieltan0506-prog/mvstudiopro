"""直立屈臂的非媒体合同探针；不运行Blender，不生成网格或影像。"""
import copy
import unittest
from previs_human_pose import validate_human_arm_pose
from run_manhua_auto_rig import suggestions, orientation_verdict, request_digest


def fixture():
    result = {}
    for side in (-1, 1):
        chain = [(0, side*.2, 1.3), (.02, side*.26, 1.02), (.15, side*.08, 1.25), (.18, side*.06, 1.31)]
        for key, a, b in zip(('upper_arm', 'forearm', 'hand'), chain, chain[1:]):
            result[key+str(side)] = [a, b]
        result['upper_leg'+str(side)] = [(0, side*.12, .9), (0, side*.12, .5)]
        result['lower_leg'+str(side)] = [(0, side*.12, .5), (0, side*.12, .1)]
    return result


class BentArmContractTest(unittest.TestCase):
    def test_bent_arms_preserve_original_points_but_are_not_claimed_as_at(self):
        points = fixture()
        before = copy.deepcopy(points)
        validate_human_arm_pose(points, 'bent_arms')
        self.assertEqual(points, before)
        for pose in ('A', 'T'):
            with self.assertRaisesRegex(ValueError, 'A/T'):
                validate_human_arm_pose(points, pose)

    def test_disconnected_swapped_shoulders_nonfinite_and_bent_legs_are_rejected(self):
        for mode in ('gap', 'swap', 'nan', 'leg', 'short'):
            points = fixture()
            if mode == 'gap': points['forearm1'][0] = (.4, .4, 1.1)
            if mode == 'swap': points['upper_arm1'][0] = (0, -.2, 1.3)
            if mode == 'nan': points['hand1'][1] = (float('nan'), 0, 1.3)
            if mode == 'leg': points['upper_leg1'][1] = (0, .12, 1.1)
            if mode == 'short': points['hand1'][1] = points['hand1'][0]
            with self.assertRaises(ValueError): validate_human_arm_pose(points, 'bent_arms')

    def test_bent_outline_does_not_use_at_heuristic_and_back_facing_still_warns(self):
        self.assertTrue(orientation_verdict(.1, .6, .4, 1.7)['suspect'])
        bent = orientation_verdict(.1, .6, .4, 1.7, 'bent_arms')
        self.assertFalse(bent['suspect'])
        self.assertIn('侧面', bent['notes'][0])
        self.assertTrue(orientation_verdict(-.1, .6, .4, 1.7, 'bent_arms')['suspect'])

    def test_suggestions_are_bounded_and_pose_is_in_request_identity(self):
        bounds = [[-.3, -.4, 0], [.4, .4, 1.7]]
        points = suggestions(bounds, 'bent_arms')
        self.assertEqual(len(points), 21)
        for xyz in points.values():
            self.assertTrue(all(bounds[0][i] <= v <= bounds[1][i] for i, v in enumerate(xyz)))
        settings = {'pose': 'T', 'forwardAxis': '+X', 'targetHeight': 1.7}
        self.assertNotEqual(request_digest('a'*64, settings), request_digest('a'*64, {**settings, 'pose': 'bent_arms'}))


if __name__ == '__main__':
    unittest.main()
