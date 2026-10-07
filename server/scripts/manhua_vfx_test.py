"""New-path development checks, never a substitute for production workflow acceptance."""
import copy
import math
import unittest

from manhua_vfx_math import position_at, state_at, validate_spec


def fixture():
    return {'version':1,'seed':123,'durationSec':2,'fps':29.97,'width':320,'height':180,
            'effects':[{'id':'test','kind':'sword_trail','startSec':.25,'durationSec':1,
                        'color':'#33aaff','scale':.5,'intensity':1.,
                        'anchor':{'space':'screen','position':[.5,.5],
                                  'trajectory':[{'timeSec':.25,'x':.1,'y':.9},{'timeSec':1.25,'x':.9,'y':.1}]}}]}


class MathContract(unittest.TestCase):
    def test_fractional_fps_preserved_and_half_open_window(self):
        spec = validate_spec(fixture())
        self.assertEqual(spec['fps'],29.97)
        self.assertEqual(math.ceil(spec['durationSec']*spec['fps']),60)
        e = spec['effects'][0]
        self.assertFalse(state_at(e,.249999)['active'])
        self.assertTrue(state_at(e,.25)['active'])
        self.assertFalse(state_at(e,1.25)['active'])
        self.assertTrue(state_at(e,1.249999)['active'])

    def test_absolute_trajectory_interpolation_and_clamp(self):
        e=fixture()['effects'][0]
        self.assertEqual(position_at(e,0),(.1,.9))
        self.assertEqual(position_at(e,2),(.9,.1))
        self.assertEqual(position_at(e,.75),(.5,.5))
        del e['anchor']['trajectory']
        self.assertEqual(position_at(e,1),(.5,.5))

    def test_no_user_code_unknown_fields_or_bad_numbers(self):
        mutations = [lambda s:s.update(code='print(1)'),lambda s:s.update(seed=True),
                     lambda s:s.update(fps=float('nan')),lambda s:s.update(width=321),
                     lambda s:s.update(durationSec=31),lambda s:s.update(width=1920,height=1080,durationSec=30,fps=60),
                     lambda s:s['effects'][0].update(kind='python'),lambda s:s['effects'][0].update(id='../bad'),
                     lambda s:s['effects'][0].update(scale=float('inf')),lambda s:s['effects'][0].update(durationSec=4),
                     lambda s:s['effects'][0]['anchor'].update(space='world'),
                     lambda s:s['effects'][0]['anchor']['trajectory'][1].update(timeSec=.25),
                     lambda s:s['effects'][0]['anchor']['trajectory'][1].update(timeSec=3),
                     lambda s:s['effects'].append(copy.deepcopy(s['effects'][0]))]
        for mutation in mutations:
            with self.subTest(mutation=mutation):
                s=fixture();mutation(s)
                with self.assertRaises(ValueError):validate_spec(s)

    def test_short_window_rejected_and_single_frame_visible(self):
        s=fixture()
        s['fps']=12
        e=s['effects'][0]
        e['startSec']=.01
        e['durationSec']=1/60
        with self.assertRaises(ValueError):validate_spec(s)
        e['startSec']=0
        validate_spec(s)
        self.assertGreater(state_at(e,0)['opacity'],0)
        self.assertFalse(state_at(e,1/60)['active'])

    def test_all_declared_kinds_and_limits(self):
        s=fixture()
        for kind in ('sword_trail','impact_burst','particle_aura','shield','spirit'):
            s['effects'][0]['kind']=kind
            self.assertIs(validate_spec(s),s)
        s['width'],s['height'],s['fps'],s['durationSec']=1920,1080,30,30
        self.assertIs(validate_spec(s),s)


if __name__ == '__main__':
    unittest.main()
