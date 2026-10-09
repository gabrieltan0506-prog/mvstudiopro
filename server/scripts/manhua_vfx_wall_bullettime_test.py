"""无媒体测试：碎片拓扑、面积、弹道及确定性。"""
import copy
import math
import unittest
from manhua_vfx_wall_bullettime_math import (
    WALL_DEFAULTS,PRISM_FACES,wall_fragments,
    fragment_vertices,validate_wall,
)


class WallBulletTest(unittest.TestCase):
    def setUp(self):
        self.event={'id':'wall_test','durationSec':3.,'wall':copy.deepcopy(WALL_DEFAULTS)}

    def test_wall_covers_full_area_without_overlapping_grid(self):
        fragments=wall_fragments(self.event,123)
        area=0
        for f in fragments:
            a,b,c=f['triangle']
            area+=abs((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]))/2
        self.assertAlmostEqual(area,1.6,places=10)
        self.assertEqual(len(fragments),60)

    def test_closed_prism_has_two_faces_per_edge(self):
        edges={}
        for face in PRISM_FACES:
            for a,b in zip(face,face[1:]+face[:1]):
                edge=tuple(sorted((a,b)));edges[edge]=edges.get(edge,0)+1
        self.assertEqual(set(edges.values()),{2})

    def test_seed_determinism_and_fragment_budget(self):
        self.assertEqual(wall_fragments(self.event,3),wall_fragments(self.event,3))
        self.assertNotEqual(wall_fragments(self.event,3),wall_fragments(self.event,4))
        self.event['wall'].update(columns=10,rows=10)
        self.assertEqual(len(wall_fragments(self.event,3)),200)

    def test_impact_is_stationary_before_contact_then_scatter(self):
        f=wall_fragments(self.event,3)[0];p=self.event['wall']
        self.assertEqual(fragment_vertices(f,p,0),fragment_vertices(f,p,.24))
        self.assertNotEqual(fragment_vertices(f,p,.24),fragment_vertices(f,p,1))
        self.assertEqual(fragment_vertices(f,p,1),fragment_vertices(f,p,1))

    def test_gravity_lowers_each_fragment_without_affecting_x(self):
        p=self.event['wall'];f=wall_fragments(self.event,3)[0]
        zero={**p,'gravity':0}
        a,b=fragment_vertices(f,p,1),fragment_vertices(f,zero,1)
        for v,w in zip(a,b):
            self.assertEqual(v[0],w[0]);self.assertLess(v[1],w[1])

    def test_contact_changes_radial_scatter_direction(self):
        a=wall_fragments(self.event,3)
        self.event['wall']['contact']={'x':0.,'y':1.}
        b=wall_fragments(self.event,3)
        self.assertNotEqual(a[0]['velocity'],b[0]['velocity'])
        self.assertTrue(all(f['velocity'][0]>0 and f['velocity'][1]>0 for f in b))

    def test_extreme_projection_is_finite(self):
        self.event['wall'].update(depth=.2,spread=3,gravity=6)
        for f in wall_fragments(self.event,0):
            self.assertTrue(all(math.isfinite(c) for v in fragment_vertices(f,self.event['wall'],30) for c in v))

    def test_wall_invalid_and_end_impact_rejected(self):
        for field,value in [('columns',True),('rows',2.5),('depth',float('nan')),('impactSec',3.)]:
            p=copy.deepcopy(WALL_DEFAULTS);p[field]=value
            with self.assertRaises(ValueError):validate_wall(p,3)


if __name__=='__main__':unittest.main()
