"""只验证数字雨数据与几何，不渲染媒体、不访问上游。"""
import copy
import math
import unittest

from manhua_vfx_math import validate_spec, state_at
from manhua_vfx_rain_math import DEFAULTS, GLYPHS, glyph_geometry, rain_columns, rain_frame


def fixture():
    return {'version': 1, 'seed': 42, 'durationSec': 3, 'fps': 24, 'width': 640, 'height': 360,
            'effects': [{'id': 'rain', 'kind': 'digital_rain', 'startSec': 0, 'durationSec': 3,
                         'color': '#35FF82', 'scale': 1, 'intensity': 1,
                         'anchor': {'space': 'screen', 'position': [.5, .5]}, 'rain': dict(DEFAULTS)}]}


class DigitalRainContract(unittest.TestCase):
    def test_shared_geometry_is_nonempty_finite_and_bounded(self):
        self.assertEqual(len(GLYPHS), 16)
        geometry = [glyph_geometry(i) for i in range(16)]
        self.assertEqual(len({str(g) for g in geometry}), 16)
        for vertices, faces in geometry:
            self.assertGreater(len(faces), 0)
            self.assertLessEqual(len(vertices), 60)
            for face in faces:
                self.assertEqual(len(set(face)), 4)
                a, b, c, _ = [vertices[i] for i in face]
                self.assertGreater((b[0]-a[0])*(c[1]-a[1]), 0)
            self.assertTrue(all(math.isfinite(n) and abs(n) < .03 for p in vertices for n in p))

    def test_time_evaluation_is_stateless_with_distinct_seeds(self):
        columns = rain_columns(42, 'rain', 16/9)
        expected = rain_frame(columns, 1.25)
        rain_frame(columns, 9)
        rain_frame(columns, 0)
        self.assertEqual(rain_frame(columns, 1.25), expected)
        self.assertNotEqual(rain_frame(rain_columns(43, 'rain', 16/9), 1.25), expected)
        self.assertNotEqual(rain_frame(rain_columns(42, 'other', 16/9), 1.25), expected)

    def test_falls_down_and_wraps_only_outside_visible_window(self):
        columns = rain_columns(42, 'rain', 16/9)
        checked = 0
        for frame in range(240):
            before, after = rain_frame(columns, frame/24), rain_frame(columns, (frame+1)/24)
            for a, b in zip(before, after):
                if a['visible'] and b['visible']:
                    self.assertLess(b['y'], a['y'])
                    self.assertLess(a['y']-b['y'], .02)
                    checked += 1
        self.assertGreater(checked, 1000)

    def test_head_tail_opacity_and_object_budget(self):
        frame = rain_frame(rain_columns(42, 'rain', 16/9, {'columns': 36, 'speed': 1, 'trail': 16}), .5)
        self.assertEqual(len(frame), 576)
        self.assertEqual(sum(c['head'] for c in frame), 36)
        self.assertTrue(all(0 < c['alpha'] <= 1 for c in frame))
        self.assertTrue(all(frame[i]['alpha'] > frame[i+1]['alpha'] for i in range(15)))
        self.assertGreater(sum(c['visible'] for c in frame), 0)

    def test_schema_rejects_over_budget_and_cross_kind_settings(self):
        good = fixture()
        self.assertIs(validate_spec(good), good)
        for field, value in [('columns', 37), ('columns', 8.5), ('columns', True),
                             ('speed', float('nan')), ('speed', 1.01), ('trail', 17), ('trail', 3)]:
            with self.subTest(field=field, value=value):
                bad = copy.deepcopy(good)
                bad['effects'][0]['rain'][field] = value
                with self.assertRaises(ValueError):
                    validate_spec(bad)
        bad = copy.deepcopy(good)
        bad['effects'][0]['kind'] = 'shield'
        with self.assertRaises(ValueError):
            validate_spec(bad)
        good['effects'][0].pop('rain')
        validate_spec(good)
        self.assertFalse(state_at(good['effects'][0], 3)['active'])
        self.assertEqual(state_at({**good['effects'][0], 'intensity': 0}, 1)['opacity'], 0)


if __name__ == '__main__':
    unittest.main()
