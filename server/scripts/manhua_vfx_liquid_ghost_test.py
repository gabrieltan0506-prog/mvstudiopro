"""仅数字数组和假进程验证，不创建图片、音轨或视频产物。"""
import io
import json
import signal
from pathlib import Path
import tempfile
import unittest
from unittest import mock

import numpy as np

from manhua_vfx_liquid_ghost import (PixelProcessor, ffmpeg_commands, liquid_frame, process_video,
                                    read_frame, roi_mask, sample_bilinear, validate_pixel_effect,
                                    validate_processing_spec)


def effect(kind='liquid_mirror'):
    e = {'id': 'test', 'kind': kind, 'startSec': .25, 'durationSec': .5, 'intensity': 2,
         'scale': 1, 'color': '#66ccff', 'anchor': {'space': 'screen', 'position': [.5, .5]},
         'roi': {'shape': 'ellipse', 'width': .5, 'height': .5, 'feather': .15}}
    if kind == 'liquid_mirror':
        e['liquid'] = {'amplitude': .06, 'frequency': 3, 'speed': 1.5, 'reflection': .35}
    else:
        e['ghost'] = {'copies': 3, 'spacingSec': 1 / 12, 'decay': .65, 'offsetX': -.15, 'offsetY': 0}
    return e


def spec(e=None):
    return {'version': 1, 'seed': 1, 'width': 32, 'height': 32, 'fps': 12, 'durationSec': 1,
            'effects': [e or effect()]}


def numeric_grid():
    values = np.arange(32 * 32 * 3, dtype=np.uint16).reshape(32, 32, 3)
    return (values % 256).astype(np.uint8)


class PixelEffectsTests(unittest.TestCase):
    def test_liquid_really_displaces_source_pixels_and_preserves_outside_roi(self):
        e, frame = effect(), numeric_grid()
        output = liquid_frame(frame, e, .5)
        outside = roi_mask(e, .5, 32, 32) == 0
        np.testing.assert_array_equal(output[outside], frame[outside])
        self.assertGreater(np.count_nonzero(output != frame), 100)
        np.testing.assert_array_equal(frame, numeric_grid())

    def test_zero_displacement_and_reflection_are_identity(self):
        e, frame = effect(), numeric_grid()
        e['liquid'].update(amplitude=0, reflection=0)
        np.testing.assert_array_equal(liquid_frame(frame, e, .5), frame)

    def test_one_frame_liquid_window_is_not_a_silent_noop(self):
        e = effect()
        e['durationSec'] = 1 / 60
        p = PixelProcessor(spec(e))
        frame = numeric_grid()
        for _ in range(3):
            np.testing.assert_array_equal(p.process(frame), frame)
        self.assertTrue(np.any(p.process(frame) != frame))
        np.testing.assert_array_equal(p.process(frame), frame)

    def test_ghost_window_without_history_is_rejected(self):
        e = effect('motion_ghost')
        e['durationSec'] = 1 / 60
        with self.assertRaisesRegex(ValueError, '不足以包含历史帧'):
            PixelProcessor(spec(e))

    def test_reflection_uses_actual_opposite_pixels(self):
        e, frame = effect(), numeric_grid()
        e['liquid'].update(amplitude=0, reflection=1)
        e['roi'].update(shape='rectangle', feather=0)
        output = liquid_frame(frame, e, .5)
        np.testing.assert_array_equal(output[12:20, 12:20], frame[12:20, 12:20][:, ::-1])

    def test_liquid_trajectory_moves_mask(self):
        e = effect()
        e['anchor']['trajectory'] = [{'timeSec': 0, 'x': .2, 'y': .5}, {'timeSec': 1, 'x': .8, 'y': .5}]
        first, last = roi_mask(e, 0, 32, 32), roi_mask(e, 1, 32, 32)
        self.assertLess(np.nonzero(first)[1].mean(), np.nonzero(last)[1].mean())

    def test_temporal_windows_and_zero_intensity_are_exact_identity(self):
        for kind in ('liquid_mirror', 'motion_ghost'):
            processor = PixelProcessor(spec(effect(kind)))
            for i in range(12):
                frame = np.full((32, 32, 3), i * 15, np.uint8)
                output = processor.process(frame)
                if i < 3 or i >= 9:
                    np.testing.assert_array_equal(output, frame)
            e = effect(kind)
            e['intensity'] = 0
            processor = PixelProcessor(spec(e))
            for _ in range(12):
                np.testing.assert_array_equal(processor.process(numeric_grid()), numeric_grid())

    def test_ghost_samples_past_frame_and_protects_current_roi(self):
        e = effect('motion_ghost')
        processor = PixelProcessor(spec(e))
        for i in range(7):
            frame = np.full((32, 32, 3), i * 30, np.uint8)
            output = processor.process(frame)
        current = roi_mask(e, .5, 32, 32)
        np.testing.assert_array_equal(output[current == 1], frame[current == 1])
        self.assertTrue(np.any(output < frame))
        self.assertTrue(np.all(output <= frame))
        np.testing.assert_array_equal(output[0], frame[0])

    def test_ghost_uses_historical_manual_position(self):
        e = effect('motion_ghost')
        e['roi'].update(width=.12, height=.3, feather=0)
        e['ghost'].update(offsetX=0, copies=1)
        e['anchor']['trajectory'] = [{'timeSec': 0, 'x': .1, 'y': .5}, {'timeSec': 1, 'x': .9, 'y': .5}]
        processor = PixelProcessor(spec(e))
        for i in range(7):
            frame = np.zeros((32, 32, 3), np.uint8)
            frame[roi_mask(e, i / 12, 32, 32) > 0] = 240
            output = processor.process(frame)
        past = roi_mask(e, 5 / 12, 32, 32) > 0
        current = roi_mask(e, .5, 32, 32) > 0
        self.assertTrue(np.any(output[past & ~current] > 0))
        np.testing.assert_array_equal(output[~(past | current)], frame[~(past | current)])

    def test_history_stays_bounded_and_is_not_composited_feedback(self):
        processor = PixelProcessor(spec(effect('motion_ghost')))
        for i in range(12):
            frame = np.full((32, 32, 3), i * 10, np.uint8)
            processor.process(frame)
            np.testing.assert_array_equal(processor.frames[-1][1], frame)
            self.assertLessEqual(len(processor.frames), processor.max_history + 1)
            frame[:] = 0
            self.assertTrue(np.all(processor.frames[-1][1] == i * 10))

    def test_bilinear_interpolation_and_boundary_clamping(self):
        frame = np.array([[[0] * 3, [100] * 3], [[100] * 3, [200] * 3]], dtype=np.uint8)
        np.testing.assert_array_equal(sample_bilinear(frame, np.array([.5, -2, 8]), np.array([.5, -2, 8])), [[100]*3, [0]*3, [200]*3])

    def test_rejects_invalid_roi_and_counts_and_cross_kind_parameters(self):
        for field, value in [('width', 0), ('height', 1.1), ('feather', float('nan')), ('shape', 'automatic-person')]:
            e = effect()
            e['roi'][field] = value
            with self.assertRaises(ValueError):
                validate_pixel_effect(e)
        e = effect('motion_ghost')
        e['ghost']['copies'] = 1.5
        with self.assertRaises(ValueError):
            validate_pixel_effect(e)
        e = effect()
        e['ghost'] = effect('motion_ghost')['ghost']
        with self.assertRaises(ValueError):
            validate_pixel_effect(e)

    def test_resolution_duration_and_history_budget(self):
        for field, value in [('width', 1922), ('durationSec', 31), ('fps', 61), ('height', 33)]:
            s = spec()
            s[field] = value
            with self.assertRaises(ValueError):
                validate_processing_spec(s)
        with mock.patch('manhua_vfx_liquid_ghost.MAX_HISTORY_BYTES', 1):
            with self.assertRaises(ValueError):
                PixelProcessor(spec(effect('motion_ghost')))

    def test_frame_shape_and_frame_count_validation(self):
        p = PixelProcessor(spec())
        with self.assertRaises(ValueError):
            p.process(np.zeros((32, 32, 4), np.uint8))
        for _ in range(12):
            p.process(numeric_grid())
        with self.assertRaises(ValueError):
            p.process(numeric_grid())

    def test_raw_reader_handles_partial_chunks_and_rejects_truncation(self):
        class ShortReads(io.BytesIO):
            def read(self, n=-1):
                return super().read(min(n, 2))
        self.assertEqual(read_frame(ShortReads(b'123456'), 6), b'123456')
        self.assertIsNone(read_frame(io.BytesIO(), 6))
        with self.assertRaises(ValueError):
            read_frame(ShortReads(b'12345'), 6)

    def test_ffmpeg_command_keeps_timing_and_has_no_audio_or_shell(self):
        decode, encode = ffmpeg_commands('/tmp/source.mp4', '/tmp/out.partial', spec())
        self.assertIn('fps=12', decode)
        self.assertIn('ffv1', encode)
        self.assertIn('bgr0', encode)
        self.assertIn('-n', encode)
        self.assertNotIn('-t', decode)
        self.assertNotIn('-t', encode)
        self.assertIn('-an', decode)
        self.assertIn('-an', encode)

    def test_process_failure_cleans_partial_and_stops_both_children(self):
        class FakeProcess:
            def __init__(self, decoder):
                self.stdin = None if decoder else io.BytesIO()
                self.stdout = io.BytesIO(b'truncated') if decoder else None
                self.terminated = False
            def poll(self):
                return 0 if self.terminated else None
            def terminate(self):
                self.terminated = True
            def wait(self, timeout=None):
                return 0
        processes = [FakeProcess(True), FakeProcess(False)]
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'spec.json').write_text(json.dumps(spec()))
            (root / 'source.mp4').write_text('fake source, never decoded')
            def fake_popen(*args, **kwargs):
                if not fake_popen.called:
                    fake_popen.called = True
                    return processes[0]
                (root / 'out.mkv.partial').write_text('fake partial')
                return processes[1]
            fake_popen.called = False
            with mock.patch('manhua_vfx_liquid_ghost.subprocess.Popen', side_effect=fake_popen):
                with self.assertRaisesRegex(ValueError, '不完整帧'):
                    process_video(root / 'spec.json', root / 'source.mp4', root / 'out.mkv')
            self.assertTrue(all(p.terminated for p in processes))
            self.assertFalse((root / 'out.mkv.partial').exists())
            self.assertFalse((root / 'out.mkv').exists())

    def test_existing_output_is_never_overwritten(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'spec.json').write_text(json.dumps(spec()))
            (root / 'source.mp4').write_text('fake source')
            (root / 'out.mkv').write_text('existing receipt')
            with self.assertRaisesRegex(ValueError, '不自动覆盖'):
                process_video(root / 'spec.json', root / 'source.mp4', root / 'out.mkv')
            self.assertEqual((root / 'out.mkv').read_text(), 'existing receipt')

    def test_success_receipt_and_cancel_cleanup_with_fake_processes_only(self):
        class FakeProcess:
            def __init__(self, decoder):
                self.stdin = None if decoder else io.BytesIO()
                self.stdout = io.BytesIO(numeric_grid().tobytes() * 12) if decoder else None
                self.terminated = False
            def poll(self):
                return 0 if self.terminated else None
            def terminate(self):
                self.terminated = True
            def wait(self, timeout=None):
                self.terminated = True
                return 0
        for cancellation in (False, True):
            with self.subTest(cancellation=cancellation), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                (root / 'spec.json').write_text(json.dumps(spec()))
                (root / 'source.mp4').write_text('fake source, never decoded')
                processes = [FakeProcess(True), FakeProcess(False)]
                def fake_popen(*args, **kwargs):
                    if not fake_popen.called:
                        fake_popen.called = True
                        return processes[0]
                    (root / 'out.mkv.partial').write_text('fake encoded container, not media')
                    if cancellation:
                        # 直接调用本入口注册的处理器，不向测试runner发送真实信号。
                        signal.getsignal(signal.SIGTERM)(signal.SIGTERM, None)
                    return processes[1]
                fake_popen.called = False
                original_handler = signal.getsignal(signal.SIGTERM)
                with mock.patch('manhua_vfx_liquid_ghost.subprocess.Popen', side_effect=fake_popen):
                    if cancellation:
                        with self.assertRaisesRegex(InterruptedError, '已取消'):
                            process_video(root / 'spec.json', root / 'source.mp4', root / 'out.mkv')
                        self.assertFalse((root / 'out.mkv.partial').exists())
                        self.assertFalse((root / 'out.mkv.json').exists())
                    else:
                        with mock.patch('builtins.print'):
                            receipt = process_video(root / 'spec.json', root / 'source.mp4', root / 'out.mkv')
                        self.assertEqual(receipt['frames'], 12)
                        self.assertEqual(receipt['audio'], 'original-source-only')
                        self.assertEqual(len(receipt['decodedOutputSha256']), 64)
                        self.assertEqual(json.loads((root / 'out.mkv.json').read_text()), receipt)
                        self.assertEqual((root / 'out.mkv').read_text(), 'fake encoded container, not media')
                    self.assertTrue(processes[0].terminated)
                    self.assertEqual(signal.getsignal(signal.SIGTERM), original_handler)

    def test_composition_order_changes_result_without_feedback(self):
        liquid, ghost = effect(), effect('motion_ghost')
        ghost['id'] = 'ghost'
        first, second = spec(), spec()
        first['effects'] = [liquid, ghost]
        second['effects'] = [ghost, liquid]
        a, b = PixelProcessor(first), PixelProcessor(second)
        for i in range(7):
            frame = np.roll(numeric_grid(), i * 2, axis=1)
            out_a, out_b = a.process(frame), b.process(frame)
        self.assertFalse(np.array_equal(out_a, out_b))
        np.testing.assert_array_equal(a.frames[-1][1], b.frames[-1][1])


if __name__ == '__main__':
    unittest.main()
