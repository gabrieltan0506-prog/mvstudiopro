"""纯数据测试：不生成图片/视频；检查真实采样变化、方向、可恢复性与预算。"""
import copy
import math
import unittest
import numpy as np
from manhua_vfx_action_math import WAVE_DEFAULTS, BLAST_DEFAULTS, validate_wave, validate_blast, wave_rings, blast_particles, blast_state
from manhua_vfx_bullet_wave import bullet_wave_frame
from manhua_vfx_liquid_ghost import PixelProcessor, validate_processing_spec
from manhua_vfx_math import validate_spec


def effect(kind):
    value = {'id': kind, 'kind': kind, 'startSec': 0., 'durationSec': 2., 'scale': 1., 'intensity': 1.,
             'color': '#FFB35C', 'anchor': {'space': 'screen', 'position': [.15, .5]}}
    value['wave' if kind == 'bullet_wave' else 'blast'] = copy.deepcopy(WAVE_DEFAULTS if kind == 'bullet_wave' else BLAST_DEFAULTS)
    return value


def spec(effects):
    return {'version': 1, 'seed': 42, 'durationSec': 2., 'fps': 24., 'width': 192, 'height': 128, 'effects': effects}


class ActionTests(unittest.TestCase):
    def setUp(self):
        y, x = np.mgrid[:128, :192]
        self.frame = np.stack(((x * 7 + y * 3) % 256, ((x // 4 + y // 4) % 2) * 255, (y * 9) % 256), axis=2).astype(np.uint8)

    def test_wave_is_actual_refraction_with_glow_disabled_and_outside_unchanged(self):
        e = effect('bullet_wave'); e['wave']['glow'] = 0
        original = self.frame.copy()
        result = bullet_wave_frame(self.frame, e, 1., 1.)
        self.assertGreater(np.count_nonzero(result != self.frame), 300)
        self.assertTrue(np.array_equal(result[:20], self.frame[:20]))
        self.assertTrue(np.array_equal(result[-20:], self.frame[-20:]))
        self.assertTrue(np.array_equal(self.frame, original))
        self.assertEqual(result.dtype, np.uint8)

    def test_wave_half_open_window_zero_intensity_and_reordered_evaluation(self):
        e = effect('bullet_wave')
        expected = bullet_wave_frame(self.frame, e, .7, .8)
        for time in (1.5, .1, 1.99): bullet_wave_frame(self.frame, e, time, .8)
        self.assertTrue(np.array_equal(expected, bullet_wave_frame(self.frame, e, .7, .8)))
        for time in (-.1, 2., 3.): self.assertTrue(np.array_equal(self.frame, bullet_wave_frame(self.frame, e, time, 1)))
        self.assertTrue(np.array_equal(self.frame, bullet_wave_frame(self.frame, e, 1, 0)))

    def test_wave_direction_tracks_past_emission_and_manual_anchor(self):
        e = effect('bullet_wave')
        rows = wave_rings(e, 1., 1.5)
        self.assertEqual(len(rows), 6)
        self.assertGreater(rows[0]['x'], rows[-1]['x'])
        self.assertTrue(all(abs(r['y'] - .5) < 1e-9 for r in rows))
        e['wave']['angleDeg'] = 90
        down = wave_rings(e, 1., 1.5)
        self.assertGreater(down[0]['y'], down[-1]['y'])
        self.assertTrue(all(abs(r['x'] - .15) < 1e-9 for r in down))
        e['anchor']['trajectory'] = [{'timeSec': 0, 'x': .2, 'y': .1}, {'timeSec': 2, 'x': .4, 'y': .1}]
        moved = wave_rings(e, 1., 1.5)
        self.assertAlmostEqual(moved[0]['x'], .3)
        self.assertEqual(len(wave_rings(e, 0, 1.5)), 1)

    def test_wave_real_processor_consumes_pixels_and_finishes_exact_count(self):
        e = effect('bullet_wave'); processor = PixelProcessor(spec([e])); changed = 0
        for _ in range(48): changed += int(not np.array_equal(processor.process(self.frame), self.frame))
        self.assertGreater(changed, 40)
        self.assertEqual(processor.index, 48)
        self.assertEqual(processor.max_history, 0)
        with self.assertRaises(ValueError): processor.process(self.frame)

    def test_wave_budget_rejects_extreme_multilayer_work(self):
        e = effect('bullet_wave'); e['durationSec'] = 30; e['scale'] = 2
        e['wave'].update(radius=.22, rings=10, angleDeg=45)
        s = spec([{**e, 'id': 'w'+str(i)} for i in range(12)])
        s.update(width=1920, height=1080, durationSec=30, fps=30)
        with self.assertRaisesRegex(ValueError, '采样预算'): validate_processing_spec(s)

    def test_blast_seed_different_identity_and_maximum_budget(self):
        e = effect('directed_blast')
        a = blast_particles(e, 42)
        self.assertEqual(a, blast_particles(e, 42))
        self.assertNotEqual(a, blast_particles(e, 43))
        self.assertNotEqual(a, blast_particles({**e, 'id': 'different'}, 42))
        e['blast'].update(particles=144, smoke=1)
        self.assertLessEqual(len(blast_particles(e, 42)), 168)
        self.assertEqual({p['kind'] for p in a}, {'fire', 'spark', 'debris', 'smoke'})

    def test_blast_direction_and_gravity_are_real_motion(self):
        e = effect('directed_blast'); e['blast'].update(angleDeg=0, spreadDeg=5, gravity=0)
        particles = blast_particles(e, 42)
        for p in particles:
            s = blast_state(p, e['blast'], .3, 1.9)
            if s['visible']: self.assertGreater(s['position'][0], 0)
        p = next(p for p in particles if p['kind'] == 'debris')
        no_gravity = blast_state(p, e['blast'], .6, 1.9)
        with_gravity = blast_state(p, {**e['blast'], 'gravity': 3}, .6, 1.9)
        self.assertLess(with_gravity['position'][1], no_gravity['position'][1])
        self.assertEqual(with_gravity['position'][0], no_gravity['position'][0])

    def test_blast_all_states_finite_bounded_and_reversible(self):
        e = effect('directed_blast')
        for p in blast_particles(e, 42):
            expected = blast_state(p, e['blast'], .5, 1.9)
            for age in (-1, 0, .09, .1, .5, 1., 1.99, 2.5, 30):
                s = blast_state(p, e['blast'], age, 1.9)
                self.assertTrue(all(math.isfinite(v) for v in (*s['position'], *s['scale'], s['alpha'], s['rotation'])))
                self.assertTrue(0 <= s['alpha'] <= 1)
                self.assertTrue(all(v >= 0 for v in s['scale']))
                if age < .1 or age >= 3: self.assertFalse(s['visible'])
            self.assertEqual(expected, blast_state(p, e['blast'], .5, 1.9))

    def test_blast_rejects_ignition_after_last_visible_frame(self):
        e = effect('directed_blast'); e['blast']['ignitionSec'] = 1.99
        with self.assertRaisesRegex(ValueError, '起爆后'): validate_spec(spec([e]))

    def test_strict_contract_and_layer_order(self):
        wave, blast = effect('bullet_wave'), effect('directed_blast')
        self.assertEqual(validate_spec(spec([wave, blast])), spec([wave, blast]))
        with self.assertRaisesRegex(ValueError, '须排在'): validate_spec(spec([blast, wave]))
        for key, value in [('rings', 2.5), ('radius', 0), ('refraction', 0), ('angleDeg', float('nan'))]:
            p = {**WAVE_DEFAULTS, key: value}
            with self.assertRaises(ValueError): validate_wave(p)
        with self.assertRaises(ValueError): validate_blast({**BLAST_DEFAULTS, 'ignitionSec': 2}, 2)
        with self.assertRaises(ValueError): validate_blast({**BLAST_DEFAULTS, 'particles': True}, 2)
        wave['blast'] = copy.deepcopy(BLAST_DEFAULTS)
        with self.assertRaises(ValueError): validate_spec(spec([wave]))


if __name__ == '__main__': unittest.main()
