import unittest
from previs_hand_contacts import hand_contact_amount
class HandContactTest(unittest.TestCase):
 def test_envelope_and_cross_clip_hold(self):
  c={'startSec':0,'contactSec':.5,'releaseSec':1.5,'endSec':2}
  self.assertEqual([hand_contact_amount(c,t) for t in [0,.5,1,1.5,2]],[0,1,1,1,0])
  self.assertEqual(hand_contact_amount(c,.25),.5)
  self.assertEqual(hand_contact_amount({**c,'contactSec':0,'releaseSec':2},0),1)
  self.assertEqual(hand_contact_amount({**c,'contactSec':0,'releaseSec':2},2),1)
if __name__=='__main__':unittest.main()
