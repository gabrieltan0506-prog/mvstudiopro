"""验证实体分块、爆点传播与分段速度，不把计数当成实际画质验收。"""
import unittest
from manhua_vfx_prop_math import prop_fragments, fragment_pose, motion_clock, validate_prop
from manhua_vfx_city_math import city_angle, validate_city

PARAMS={'impactSec':.25,'spread':1.1,'slowMotion':.18,'gravity':.8,'staggerSec':.1,'holdStartSec':.8,'holdDurationSec':1.2}


class PropTest(unittest.TestCase):
    def test_cup_is_closed_curved_shell_handle_and_liquid(self):
        parts=prop_fragments({'id':'cup','kind':'cup_fracture'},1009)
        self.assertEqual(len(parts),116)
        self.assertEqual(sum(p['material']=='coffee' for p in parts),40)
        for part in parts:
            edges={}
            for face in part['faces']:
                for a,b in zip(face,face[1:]+face[:1]):
                    pair=tuple(sorted((a,b)));edges[pair]=edges.get(pair,0)+1
            self.assertTrue(all(count==2 for count in edges.values()),'每个杯体/把手/液滴块须闭合')
            self.assertGreater(max(v[2] for v in part['vertices'])-min(v[2] for v in part['vertices']),0)

    def test_fruit_has_four_groups_flesh_and_crates(self):
        parts=prop_fragments({'id':'fruit','kind':'fruit_stall_fracture'},1009)
        self.assertEqual({p['group'] for p in parts},set(range(4)))
        self.assertEqual(len(parts),216)
        self.assertTrue(any('flesh' in (p['faceMaterials'] or []) for p in parts))
        self.assertEqual({p['material'] for p in parts},{'wood','lemon','apple','juice','petal','paper'})
        self.assertTrue(all(not fragment_pose(p,.24,PARAMS)['exploded'] for p in parts))
        self.assertEqual({p['group'] for p in parts if fragment_pose(p,.36,PARAMS)['exploded']},{0,1})
        self.assertTrue(all(fragment_pose(p,.56,PARAMS)['exploded'] for p in parts))

    def test_seed_repeatability_and_motion_parameters(self):
        event={'id':'fruit','kind':'fruit_stall_fracture'}
        a=prop_fragments(event,1);self.assertEqual(a,prop_fragments(event,1));self.assertNotEqual(a,prop_fragments(event,2))
        part=a[0];self.assertEqual(fragment_pose(part,.1,PARAMS)['position'],part['center'])
        after=fragment_pose(part,1.,PARAMS)
        self.assertNotEqual(after['position'],part['center']);self.assertNotEqual(after['rotation'],[0,0,0])
        for key,value in [('spread',2),('slowMotion',.8),('gravity',4),('impactSec',.5)]:
            self.assertNotEqual(fragment_pose(part,1.,{**PARAMS,key:value})['position'],after['position'])
        self.assertAlmostEqual(motion_clock(.35,PARAMS,0),.1)
        self.assertAlmostEqual(motion_clock(.45,PARAMS,0),.118)

    def test_hold_freezes_positions_and_rotation_then_resumes(self):
        for kind in ['cup_fracture','fruit_stall_fracture']:
            params={**PARAMS,'staggerSec':0 if kind=='cup_fracture' else .1}
            parts=prop_fragments({'id':'held','kind':kind},9)
            poses=lambda t:[fragment_pose(p,t,params) for p in parts]
            self.assertEqual(poses(.8),poses(1.2));self.assertEqual(poses(1.2),poses(1.99))
            self.assertNotEqual(poses(1.99),poses(2.2))
        with self.assertRaises(ValueError):validate_prop('fruit_stall_fracture',{**PARAMS,'holdStartSec':.4},3)
        with self.assertRaises(ValueError):validate_prop('fruit_stall_fracture',{**PARAMS,'holdDurationSec':3},3)

    def test_invalid_budget_and_timing_fail(self):
        for key,value in [('spread',float('nan')),('slowMotion',0),('staggerSec',.6),('impactSec',3)]:
            with self.assertRaises(ValueError):validate_prop('fruit_stall_fracture',{**PARAMS,key:value},3)
        with self.assertRaises(ValueError):validate_prop('cup_fracture',PARAMS,3)

    def test_city_smooth_real_angle_and_bounds(self):
        params={'blocks':4,'foldDeg':90,'foldStartSec':.25,'foldEndSec':2.6,'streetWidth':6,'buildingHeight':10,'lensMm':28}
        validate_city(params,3)
        self.assertEqual(city_angle(0,params),0);self.assertEqual(city_angle(3,params),90)
        self.assertAlmostEqual(city_angle(1.425,params),45)
        for key,value in [('blocks',2.5),('blocks',7),('foldEndSec',.1),('lensMm',200)]:
            with self.assertRaises(ValueError):validate_city({**params,key:value},3)


if __name__=='__main__':unittest.main()
