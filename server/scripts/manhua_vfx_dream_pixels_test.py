"""真实RGB数组验证，不生成媒体文件或调用模型。"""
import copy
import unittest

import numpy as np

from manhua_vfx_dream_pixels import dream_frame
from manhua_vfx_liquid_ghost import PixelProcessor, roi_mask, validate_processing_spec
from manhua_vfx_math import validate_spec


def effect(kind):
    value = dict(id='dream', kind=kind, startSec=.25, durationSec=1.5, color='#FFF5DF', scale=1,
                 intensity=1.5, anchor=dict(space='screen', position=[.5, .5]))
    if kind == 'mirror_corridor':
        value.update(mirror=dict(layers=5, shrink=.72, drift=.025), roi=dict(shape='rectangle', width=.8, height=.85, feather=.025))
    else:
        value['paper'] = dict(count=24, size=.055, drift=.18, flutter=1.4, spread=.8)
    return value


def spec(e):
    return dict(version=1, seed=42, width=160, height=120, fps=24, durationSec=2, effects=[e])


class DreamPixelsTest(unittest.TestCase):
    def setUp(self):
        y, x = np.indices((120, 160))
        self.frame = np.stack([x * 1.5, y * 2, (x + y) % 230], axis=-1).astype(np.uint8)

    def test_new_kinds_have_real_processor_output_and_exact_time_window(self):
        for kind in ('mirror_corridor', 'floating_paper'):
            with self.subTest(kind=kind):
                e = effect(kind)
                validate_spec(spec(e))
                processor = PixelProcessor(spec(e))
                changed = []
                for index in range(48):
                    result = processor.process(self.frame)
                    is_changed = not np.array_equal(result, self.frame)
                    changed.append(is_changed)
                    if index / 24 < e['startSec'] or index / 24 >= e['startSec'] + e['durationSec']:
                        self.assertFalse(is_changed)
                self.assertGreater(sum(changed), 25)
                self.assertEqual(processor.index, 48)

    def test_mirror_preserves_every_pixel_outside_roi_and_does_not_mutate_source(self):
        e = effect('mirror_corridor')
        before = self.frame.copy()
        result = dream_frame(self.frame, e, 1., .85, 42)
        outside = roi_mask(e, 1., 160, 120) == 0
        self.assertTrue(np.array_equal(result[outside], before[outside]))
        self.assertTrue(np.array_equal(self.frame, before))
        for field, value in [('layers', 2), ('shrink', .5), ('drift', .07)]:
            changed = copy.deepcopy(e)
            changed['mirror'][field] = value
            self.assertFalse(np.array_equal(result, dream_frame(self.frame, changed, 1., .85, 42)), field)

    def test_paper_parameters_seed_and_animation_change_actual_pixels_deterministically(self):
        e = effect('floating_paper')
        result = dream_frame(self.frame, e, 1., .8, 42)
        self.assertTrue(np.array_equal(result, dream_frame(self.frame, e, 1., .8, 42)))
        self.assertFalse(np.array_equal(result, dream_frame(self.frame, e, 1., .8, 43)))
        self.assertFalse(np.array_equal(result, dream_frame(self.frame, e, 1.1, .8, 42)))
        for field, value in [('count', 8), ('size', .1), ('drift', .5), ('flutter', 3.), ('spread', .3)]:
            changed = copy.deepcopy(e)
            changed['paper'][field] = value
            self.assertFalse(np.array_equal(result, dream_frame(self.frame, changed, 1., .8, 42)), field)
        for field, value in [('color', '#4499AA'), ('scale', .7), ('intensity', 0)]:
            changed = copy.deepcopy(e)
            changed[field] = value
            strength = 0 if field == 'intensity' else .8
            self.assertFalse(np.array_equal(result, dream_frame(self.frame, changed, 1., strength, 42)), field)
        self.assertTrue(np.array_equal(self.frame, dream_frame(self.frame, e, 1., 0, 42)))

    def test_rejects_wrong_fields_counts_seed_and_work_budget_before_processing(self):
        for kind, field in [('mirror_corridor', 'layers'), ('floating_paper', 'count')]:
            e = effect(kind)
            group = 'mirror' if kind == 'mirror_corridor' else 'paper'
            for value in (True, 2.5, 100):
                bad = copy.deepcopy(e)
                bad[group][field] = value
                with self.assertRaises(ValueError):
                    validate_spec(spec(bad))
            bad = copy.deepcopy(e)
            bad['liquid'] = dict(amplitude=0)
            with self.assertRaises(ValueError):
                validate_processing_spec(spec(bad))
        bad = spec(effect('floating_paper'))
        bad['seed'] = True
        with self.assertRaises(ValueError):
            validate_processing_spec(bad)
        for kind in ('mirror_corridor', 'floating_paper'):
            bad = spec(effect(kind))
            bad.update(width=1920, height=1080, durationSec=30, fps=30)
            bad['effects'][0].update(startSec=0, durationSec=30, scale=2)
            if kind == 'floating_paper':
                bad['effects'][0]['paper'].update(count=64, size=.12)
            with self.assertRaisesRegex(ValueError, '预算超限'):
                validate_processing_spec(bad)

    def test_pixel_layer_order_and_manual_trajectory_are_consumed(self):
        for kind in ('mirror_corridor', 'floating_paper'):
            e = effect(kind)
            moved = copy.deepcopy(e)
            moved['anchor']['trajectory'] = [dict(timeSec=0, x=.25, y=.5), dict(timeSec=2, x=.7, y=.5)]
            self.assertFalse(np.array_equal(dream_frame(self.frame, e, .75, .8, 42), dream_frame(self.frame, moved, .75, .8, 42)))
            invalid = spec(e)
            overlay = dict(id='shield', kind='shield', startSec=0, durationSec=2, color='#FFFFFF', scale=.3,
                           intensity=1, anchor=dict(space='screen', position=[.5, .5]))
            invalid['effects'] = [overlay, e]
            with self.assertRaisesRegex(ValueError, '排在'):
                validate_spec(invalid)


if __name__ == '__main__':
    unittest.main()
