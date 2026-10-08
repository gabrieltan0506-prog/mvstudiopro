"""坐卧数学合同：不导入Blender、不生成模型或媒体。"""
import copy
import math
import unittest
from previs_human_pose import apply_human_posture, human_posture_lean, validate_human_posture
from previs_contact_ik import solve_limb


def points():
    p={'pelvis':((0,0,.72),(0,0,.8)), 'spine':((0,0,.8),(0,0,1.23)),
       'neck':((0,0,1.23),(0,0,1.37)), 'head':((0,0,1.37),(0,0,1.65))}
    for side in (-1,1):
        hip=(0,side*.13,.8); ankle=(0,side*.13,.09)
        knee=solve_limb(hip,ankle,.43,.43,(1,0,0))['joint']
        p.update({'upper_leg'+str(side):(hip,knee),'lower_leg'+str(side):(knee,ankle),
                  'foot'+str(side):(ankle,(.17,side*.13,.09)),
                  'upper_arm'+str(side):((0,side*.21,1.23),(.1,side*.3,1.)),
                  'forearm'+str(side):((.1,side*.3,1.),(.2,side*.3,.8)),
                  'hand'+str(side):((.2,side*.3,.8),(.29,side*.3,.8))})
    return p


class HumanPostureTest(unittest.TestCase):
    def test_entire_transition_preserves_lengths_support_feet_and_holds(self):
        src=points(); before=copy.deepcopy(src)
        config={'mode':'rise_to_sit','startSec':.5,'endSec':2.,'supportHeight':.45,'reclineDeg':55}
        rows=[apply_human_posture(src,config,f/24) for f in range(96)]
        for row in rows:
            for name,pair in row.items(): self.assertAlmostEqual(math.dist(*pair), math.dist(*src[name]), places=6)
            self.assertAlmostEqual(row['pelvis'][0][2],.45)
            for side in ('-1','1'):
                self.assertAlmostEqual(row['foot'+side][0][2],.09)
                self.assertEqual(row['lower_leg'+side][1],row['foot'+side][0])
        self.assertLess(rows[0]['head'][1][0],-.5)
        self.assertAlmostEqual(rows[-1]['head'][1][0],0.)
        self.assertEqual(rows[48],rows[-1])
        self.assertEqual(src,before)
        self.assertLess(max(math.dist(a['head'][1],b['head'][1]) for a,b in zip(rows,rows[1:])),.05)

    def test_cross_shot_hold_matches_finished_and_initial_transition(self):
        src=points(); common={'supportHeight':.45,'reclineDeg':55}
        transition={**common,'mode':'rise_to_sit','startSec':.5,'endSec':2}
        for t,posture in [(0,'recline'),(3,'sit')]:
            hold={**common,'mode':'hold','posture':posture}
            self.assertEqual(apply_human_posture(src,transition,t),apply_human_posture(src,hold,0))
            self.assertEqual(apply_human_posture(src,hold,0),apply_human_posture(src,hold,10))

    def test_invalid_and_unverified_combinations_rejected(self):
        actor={'id':'mother','shape':'human','start':[0,0],'end':[0,0],'actions':[{'kind':'idle'}],
               'humanPosture':{'mode':'hold','posture':'recline','supportHeight':.45,'reclineDeg':55}}
        validate_human_posture(actor,{'durationSec':4})
        validate_human_posture({**actor,'riggedModel':{}},{'durationSec':4})
        for key,value in [('visibleRanges',[]),('motionRoute',{}),('shape','horse')]:
            with self.assertRaises(ValueError): validate_human_posture({**actor,key:value},{'durationSec':4})
        for extra in [{'piggyback':{'carrierId':'son','passengerId':'mother'}}, {'handContacts':[{'actorId':'mother'}]}, {'storyProps':[{'grip':{'actorId':'mother'}}]}]:
            with self.assertRaises(ValueError): validate_human_posture(actor,{'durationSec':4,**extra})




class HumanPostureReportTest(unittest.TestCase):
    def test_real_sample_shape_and_wrong_pose_support_missing_frames_rejected(self):
        from previs_human_posture_report import check_human_posture_samples
        cfg={'mode':'hold','posture':'recline','supportHeight':.45,'reclineDeg':55}
        src=points(); rows=[]
        for f in range(1,49):
            out=apply_human_posture(src,cfg,(f-1)/24)
            a,b=out['spine']; feet=[out['foot'+s][0][2] for s in ('-1','1')]
            rows.append({'frame':f,'supportGap':out['pelvis'][0][2]-.45,
                         'spineLeanRad':math.atan2(a[0]-b[0],b[2]-a[2]),
                         'maxBoneLengthError':max(abs(math.dist(*pair)-math.dist(*src[name])) for name,pair in out.items()),
                         'minFootZ':min(feet),'maxFootZ':max(feet)})
        self.assertEqual(check_human_posture_samples(cfg,rows,48)['frames'],48)
        for key,value in [('supportGap',.1),('spineLeanRad',0),('maxBoneLengthError',.2),('minFootZ',-.2)]:
            broken=copy.deepcopy(rows); broken[23][key]=value
            with self.assertRaises(ValueError): check_human_posture_samples(cfg,broken,48)
        with self.assertRaises(ValueError): check_human_posture_samples(cfg,rows[:-1],48)

if __name__=='__main__': unittest.main()
