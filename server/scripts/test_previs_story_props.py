import unittest
from previs_story_props import track_segment

class StoryPropsTest(unittest.TestCase):
    def test_visibility_switch_is_discrete(self):
        frames=[{'timeSec':0,'visible':False},{'timeSec':1,'visible':True},{'timeSec':2,'visible':True}]
        self.assertFalse(track_segment(frames,.99)[0]['visible'])
        self.assertTrue(track_segment(frames,1)[0]['visible'])
    def test_retained_needle_does_not_return_to_hand(self):
        frames=[{'timeSec':0,'anchor':'hand'},{'timeSec':1,'anchor':'shoulder'},{'timeSec':2,'anchor':'shoulder'}]
        a,b,u=track_segment(frames,1.5)
        self.assertEqual((a['anchor'],b['anchor']),('shoulder','shoulder'))
        self.assertEqual(u,.5)
    def test_after_last_frame_holds_last_state(self):
        frames=[{'timeSec':0},{'timeSec':2}]
        a,b,u=track_segment(frames,3)
        self.assertEqual((a['timeSec'],b['timeSec'],u),(2,2,0))

if __name__=='__main__':unittest.main()

class BoneMapTest(unittest.TestCase):
    def test_real_horse_uses_front_and_hind_identity(self):
        from previs_story_props import target_bone_name
        mapping={'forearm1':'frontL','forearm-1':'frontR','lower_leg1':'hindL','lower_leg-1':'hindR','spine':'chest'}
        self.assertEqual([target_bone_name('horse','lower_leg'+str(i),mapping) for i in range(4)],['hindR','frontL','hindL','frontR'])
        self.assertEqual(target_bone_name('horse','body',mapping),'chest')
    def test_missing_real_mapping_fails(self):
        from previs_story_props import target_bone_name
        with self.assertRaises(ValueError):target_bone_name('human','hand1',{})
