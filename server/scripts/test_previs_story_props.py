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

class GripBlendTest(unittest.TestCase):
    def test_bullet_short_window_returns_to_original(self):
        from previs_story_props import grip_blend_amount
        for kind in ('bullet', 'information_panel'):
            self.assertEqual([grip_blend_amount(kind, .5, 2.5, t) for t in (0, .5, .75, 1, 1.5, 2, 2.25, 2.5, 3)], [0, 0, .5, 1, 1, 1, .5, 0, 0])
        self.assertEqual(grip_blend_amount('bowl', .5, 2.5, .5), 1)
        self.assertEqual(grip_blend_amount('needle', .5, 2.5, 2.25), 1)

class WorldPropLookTest(unittest.TestCase):
    def test_same_interpolation_and_hidden_or_cyclic_targets_rejected(self):
        from previs_story_props import world_prop_look_target
        import copy
        prop = {'id': 'panel', 'keyframes': [
            {'timeSec': 0, 'visible': False, 'anchor': {'type': 'world', 'position': [1, 0, 1]}},
            {'timeSec': 1, 'visible': True, 'anchor': {'type': 'world', 'position': [1, 0, 1]}},
            {'timeSec': 3, 'visible': True, 'anchor': {'type': 'world', 'position': [1, 2, 1]}},
        ]}
        self.assertIsNone(world_prop_look_target([prop], 'prop:panel', .99))
        self.assertEqual(world_prop_look_target([prop], 'prop:panel', 2), (1, 1, 1))
        self.assertIsNone(world_prop_look_target([prop], 'prop:missing', 2))
        for anchor in ({'type': 'bone', 'actorId': 'host', 'bone': 'head'}, {'type': 'prop', 'propId': 'panel'}):
            bad = copy.deepcopy(prop)
            bad['keyframes'][1]['anchor'] = anchor
            self.assertIsNone(world_prop_look_target([bad], 'prop:panel', 2))
