"""只运行端点数值；不导入 Blender，不构建或渲染场景。"""
import math
import unittest
from previs_quadruped_fall import fold_points, fall_roll, validate_fall, fall_movement_progress

class FallTests(unittest.TestCase):
    def setUp(self):
        self.points={'body':((-.7,0,1.2),(.65,0,1.2)), 'neck':((.6,0,1.15),(.85,0,1.9)), 'head':((.7,0,1.96),(1.3,0,1.96))}
        for key,(x,y) in enumerate([(-.6,-.25),(.6,.25),(-.6,.25),(.6,-.25)]):
            self.points['upper_leg'+str(key)]=((x,y,1.02),(x+.15,y,.51))
            self.points['lower_leg'+str(key)]=((x+.15,y,.51),(x,y,0))
            self.points['foot'+str(key)]=((x,y,0),(x+.17,y,0))
        self.fall={'mode':'collapse','side':'right','startSec':0,'foldSec':1,'groundSec':2}

    def test_all_bones_keep_lengths_and_no_autorecovery(self):
        def length(pair):return math.dist(*pair)
        for f in range(97):
            pose=fold_points(self.points,self.fall,f/24)
            for name,pair in pose.items():self.assertAlmostEqual(length(pair),length(self.points[name]),places=8)
        self.assertEqual(fold_points(self.points,self.fall,2),fold_points(self.points,self.fall,4))
        self.assertEqual(fold_points(self.points,self.fall,4),fold_points(self.points,{'mode':'hold','side':'right'},0))
        self.assertAlmostEqual(fall_roll(self.fall,2),math.pi/2)

    def test_frame_continuity_and_real_knee_folding(self):
        last=None
        for f in range(97):
            pose=fold_points(self.points,self.fall,f/24)
            if last:self.assertLess(max(math.dist(pose[n][j],last[n][j]) for n in pose for j in (0,1)),.13)
            last=pose
        for key in '0123':
            upper=last['upper_leg'+key];lower=last['lower_leg'+key]
            a=[upper[1][i]-upper[0][i] for i in range(3)];b=[lower[1][i]-lower[0][i] for i in range(3)]
            angle=math.degrees(math.acos(sum(a[i]*b[i] for i in range(3))/math.sqrt(sum(x*x for x in a)*sum(x*x for x in b))))
            self.assertGreater(angle,150)

class FallContractTests(unittest.TestCase):
    def test_moving_collapse_decelerates_and_stays_at_endpoint(self):
        actor={'id':'horse','shape':'horse','actions':[], 'start':[0,0], 'end':[.8,0],
               'moveStartSec':0,'moveEndSec':2.5,
               'quadrupedFall':{'mode':'collapse','side':'left','startSec':1,'foldSec':2,'groundSec':3}}
        validate_fall(actor,{'durationSec':4})
        positions=[fall_movement_progress(actor,f/24) for f in range(96)]
        velocity=[(b-a)*24*.8 for a,b in zip(positions,positions[1:])]
        self.assertEqual(positions[0],0)
        self.assertTrue(all(p==1 for p in positions[60:]))
        self.assertLess(max(velocity),1.2)
        self.assertTrue(all(v>=0 for v in velocity))
        self.assertTrue(all(b<=a+1e-8 for a,b in zip(velocity[24:],velocity[25:])))
        self.assertLess(velocity[59],.002)
        for patch in ({'moveEndSec':3.5},{'moveStartSec':1},{'moveEndSec':1},{'moveStartSec':1/25},{'end':[4,0]},
                      {'quadrupedFall':{'mode':'hold','side':'left'}}):
            with self.assertRaisesRegex(ValueError,'倒地'):
                validate_fall({**actor,**patch},{'durationSec':4})

    def test_renderer_rejects_invalid_times_and_blended_actions(self):
        actor={'id':'horse','shape':'horse','actions':[], 'start':[0,0], 'end':[0,0],
               'quadrupedFall':{'mode':'collapse','side':'left','startSec':0,'foldSec':1,'groundSec':2}}
        spec={'durationSec':4}
        validate_fall(actor,spec)
        for patch in ({'groundSec':4},{'foldSec':.1},{'startSec':1/25},{'side':'up'},{'extra':True}):
            with self.assertRaisesRegex(ValueError,'倒地'):
                validate_fall({**actor,'quadrupedFall':{**actor['quadrupedFall'],**patch}},spec)
        for patch in ({'shape':'human'},{'end':[1,0]},{'actions':[{'kind':'limp_front_left'}]}):
            with self.assertRaisesRegex(ValueError,'倒地'):
                validate_fall({**actor,**patch},spec)

if __name__=='__main__':unittest.main()
