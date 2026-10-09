"""原片像素处理：手动 ROI 液态镜像和历史帧残影，不做自动分割或跟踪。

生产入口在 Blender 的 Python/NumPy 环境执行；没有调用 bpy 渲染。
参数：-- spec.json source.mp4 processed.mkv。输出不带音轨，由原合成服务保留原音轨。
"""
import collections
import hashlib
import json
import math
from pathlib import Path
import signal
import subprocess
import sys
import tempfile

sys.path.insert(0, str(Path(__file__).resolve().parent))
import numpy as np

from manhua_vfx_math import keys, number, position_at

PIXEL_KINDS = frozenset(('liquid_mirror', 'motion_ghost', 'bullet_wave', 'mirror_corridor', 'floating_paper'))
VERSION = 'manhua-vfx-source-pixels-1'
MAX_HISTORY_BYTES = 512 * 1024 * 1024
MAX_OUTPUT_BYTES = 8 * 1024 * 1024 * 1024
BOUNDARY = '手动区域及轨迹；液态/残影/镜面纵深处理原片像素，不是人物分割或三维反射；纸页为程序画面叠加，不改变原片角色重力或遮挡。'


def validate_pixel_effect(effect):
    """供主渲染校验器复用；公共字段仍由共享校验器验证。"""
    if effect.get('kind') not in PIXEL_KINDS:
        raise ValueError('不支持的原片像素效果')
    if effect['kind'] == 'bullet_wave':
        from manhua_vfx_action_math import validate_wave
        validate_wave(effect.get('wave'))
        return
    if effect['kind'] in ('mirror_corridor', 'floating_paper'):
        from manhua_vfx_dream_pixels import validate_dream_effect
        validate_dream_effect(effect)
        if effect['kind'] == 'floating_paper': return
    roi = effect.get('roi')
    keys(roi, ('shape', 'width', 'height', 'feather'))
    if roi['shape'] not in ('ellipse', 'rectangle'):
        raise ValueError('ROI形状无效')
    for field, lo, hi in (('width', .01, 1), ('height', .01, 1), ('feather', 0, .5)):
        number(roi[field], lo, hi, 'ROI ' + field)
    kind = effect['kind']
    if kind == 'liquid_mirror':
        value = effect.get('liquid')
        keys(value, ('amplitude', 'frequency', 'speed', 'reflection'))
        for field, lo, hi in (('amplitude', 0, .08), ('frequency', .5, 12), ('speed', 0, 8), ('reflection', 0, 1)):
            number(value[field], lo, hi, '液态 ' + field)
        if 'ghost' in effect:
            raise ValueError('液态图层不能含残影参数')
    elif kind == 'motion_ghost':
        value = effect.get('ghost')
        keys(value, ('copies', 'spacingSec', 'decay', 'offsetX', 'offsetY'))
        for field, lo, hi in (('copies', 1, 6), ('spacingSec', 1 / 60, .2), ('decay', .1, .95), ('offsetX', -.25, .25), ('offsetY', -.25, .25)):
            number(value[field], lo, hi, '残影 ' + field)
        if not isinstance(value['copies'], int):
            raise ValueError('残影数量必须为整数')
        if 'liquid' in effect:
            raise ValueError('残影图层不能含液态参数')


def validate_processing_spec(spec):
    """CLI也独立拒绝超预算或无效输入，不能只信任前端。"""
    number(spec.get('width'), 16, 1920, 'width')
    number(spec.get('height'), 16, 1920, 'height')
    w, h = spec['width'], spec['height']
    if any(not isinstance(n, int) or n % 2 for n in (w, h)):
        raise ValueError('画幅必须为偶数整数')
    number(spec.get('durationSec'), 1 / 60, 30, 'durationSec')
    number(spec.get('fps'), 12, 60, 'fps')
    count = math.ceil(spec['durationSec'] * spec['fps'])
    if w * h > 1920 * 1080 or w * h * count > 1920 * 1080 * 900:
        raise ValueError('超过原片像素预算')
    effects = spec.get('effects')
    if not isinstance(effects, list) or not 1 <= len(effects) <= 12:
        raise ValueError('图层数超出预算')
    pixels = [e for e in effects if isinstance(e, dict) and e.get('kind') in PIXEL_KINDS]
    if not pixels:
        raise ValueError('没有原片像素效果')
    for e in pixels:
        validate_pixel_effect(e)
        number(e.get('startSec'), 0, spec['durationSec'], 'startSec')
        number(e.get('durationSec'), 1 / 60, 30, 'effect durationSec')
        number(e.get('intensity'), 0, 2, 'intensity')
        number(e.get('scale'), .02, 2, 'scale')
        if e['startSec'] + e['durationSec'] > spec['durationSec'] + 1e-9:
            raise ValueError('效果超出原片时长')
        if math.ceil(e['startSec'] * spec['fps'] - 1e-9) >= math.ceil((e['startSec'] + e['durationSec']) * spec['fps'] - 1e-9):
            raise ValueError('效果时间窗没有视频帧')
        if e['kind'] == 'motion_ghost':
            active_frames = math.ceil((e['startSec'] + e['durationSec']) * spec['fps'] - 1e-9) - math.ceil(e['startSec'] * spec['fps'] - 1e-9)
            if active_frames <= max(1, round(e['ghost']['spacingSec'] * spec['fps'])):
                raise ValueError('残影时间窗不足以包含历史帧，请延长效果')
        anchor = e.get('anchor')
        keys(anchor, ('space', 'position'), ('trajectory',))
        if anchor['space'] != 'screen' or not isinstance(anchor['position'], list) or len(anchor['position']) != 2:
            raise ValueError('ROI位置无效')
        for n in anchor['position']:
            number(n, 0, 1, 'position')
        if 'trajectory' in anchor:
            points = anchor['trajectory']
            if not isinstance(points, list) or not 2 <= len(points) <= 120:
                raise ValueError('手动轨迹点数量无效')
            previous = -1
            for p in points:
                keys(p, ('timeSec', 'x', 'y'))
                number(p['timeSec'], 0, spec['durationSec'], 'trajectory time')
                number(p['x'], 0, 1, 'trajectory x')
                number(p['y'], 0, 1, 'trajectory y')
                if p['timeSec'] <= previous:
                    raise ValueError('手动轨迹时间必须递增')
                previous = p['timeSec']
    from manhua_vfx_dream_pixels import DREAM_KINDS, MAX_DREAM_SAMPLES, dream_sample_budget
    dreams = [e for e in pixels if e['kind'] in DREAM_KINDS]
    if dreams:
        number(spec.get('seed'), 0, 2147483647, 'seed')
        if not isinstance(spec['seed'], int) or isinstance(spec['seed'], bool):
            raise ValueError('种子须为整数')
        if sum(dream_sample_budget(e, w, h, spec['fps']) for e in dreams) > MAX_DREAM_SAMPLES:
            raise ValueError('镜面或纸页处理预算超限，请缩短时窗、缩小范围或减少数量')
    samples = 0
    for e in pixels:
        if e['kind'] != 'bullet_wave': continue
        p = e['wave']; angle = math.radians(p['angleDeg'])
        radius = p['radius'] * e['scale'] * 1.35 * h
        bx = 1.35 * math.hypot(.24 * radius * math.cos(angle), radius * math.sin(angle))
        by = 1.35 * math.hypot(.24 * radius * math.sin(angle), radius * math.cos(angle))
        samples += min(w * h, (2 * bx + 2) * (2 * by + 2)) * p['rings'] * math.ceil(e['durationSec'] * spec['fps'])
    if samples > 1_200_000_000:
        raise ValueError('弹道折射采样预算超限，请缩短时窗、减小波纹或减少圈数')
    history = max((math.ceil(e['ghost']['copies'] * e['ghost']['spacingSec'] * spec['fps']) for e in pixels if e['kind'] == 'motion_ghost'), default=0)
    if (history + 1) * w * h * 3 > MAX_HISTORY_BYTES:
        raise ValueError('历史帧缓存超出512MiB预算')
    return pixels, count, history


def roi_mask(effect, time, width, height, offset=(0., 0.)):
    """左上角归一化坐标，像素中心采样；移动的是形状遮罩，不猜测主体。"""
    cx, cy = position_at(effect, time)
    cx, cy = (cx + offset[0]) * width, (cy + offset[1]) * height
    rx = effect['roi']['width'] * effect['scale'] * width / 2
    ry = effect['roi']['height'] * effect['scale'] * height / 2
    x = (np.arange(width, dtype=np.float32)[None, :] + .5 - cx) / rx
    y = (np.arange(height, dtype=np.float32)[:, None] + .5 - cy) / ry
    distance = np.sqrt(x * x + y * y) if effect['roi']['shape'] == 'ellipse' else np.maximum(np.abs(x), np.abs(y))
    feather = effect['roi']['feather']
    if feather == 0:
        return (distance < 1).astype(np.float32)
    edge = np.clip((1 - distance) / feather, 0, 1)
    return edge * edge * (3 - 2 * edge)


def sample_bilinear(frame, x, y):
    """边界钳制，使用原片像素；不创建虚构图案。"""
    h, w = frame.shape[:2]
    x, y = np.clip(x, 0, w - 1), np.clip(y, 0, h - 1)
    x0, y0 = np.floor(x).astype(np.int32), np.floor(y).astype(np.int32)
    x1, y1 = np.minimum(x0 + 1, w - 1), np.minimum(y0 + 1, h - 1)
    fx, fy = (x - x0)[..., None], (y - y0)[..., None]
    return ((frame[y0, x0] * (1 - fx) + frame[y0, x1] * fx) * (1 - fy)
            + (frame[y1, x0] * (1 - fx) + frame[y1, x1] * fx) * fy)


def blend(base, overlay, alpha):
    """只写非零遮罩像素，保证ROI外逐字节不变。"""
    result = base.copy()
    active = alpha > 0
    a = alpha[active, None]
    result[active] = np.rint(base[active] * (1 - a) + overlay[active] * a).clip(0, 255).astype(np.uint8)
    return result


def envelope(effect, time):
    age = time - effect['startSec']
    if age < 0 or time >= effect['startSec'] + effect['durationSec']:
        return 0.
    ramp = min(.12, effect['durationSec'] / 4)
    # 一帧时间窗也必须有真实作用；结束仍严格遵守半开区间。
    return min(1., max(.15, age / ramp), (effect['durationSec'] - age) / ramp) * effect['intensity'] / 2


def liquid_frame(frame, effect, time):
    strength = envelope(effect, time)
    if strength == 0:
        return frame.copy()
    h, w = frame.shape[:2]
    mask = roi_mask(effect, time, w, h)
    rows, cols = np.nonzero(mask > 0)
    if not len(rows):
        return frame.copy()
    cx, cy = position_at(effect, time)
    liquid = effect['liquid']
    x = cols.astype(np.float32)
    y = rows.astype(np.float32)
    nx = (x + .5 - cx * w) / (effect['roi']['width'] * effect['scale'] * w / 2)
    ny = (y + .5 - cy * h) / (effect['roi']['height'] * effect['scale'] * h / 2)
    phase = (time - effect['startSec']) * liquid['speed'] * math.tau
    wave = math.tau * liquid['frequency']
    amplitude = liquid['amplitude'] * min(w, h) * strength
    # 两个非同向波分量驱动实际采样坐标，反射是ROI中心局部镜像。
    dx = amplitude * (np.sin(ny * wave + phase) + .35 * np.sin(nx * wave * .7 - phase))
    dy = amplitude * .7 * np.sin(nx * wave + phase * .8)
    warped = sample_bilinear(frame, x + dx, y + dy)
    reflected = sample_bilinear(frame, 2 * cx * w - 1 - x + dx, y + dy)
    reflection = liquid['reflection']
    pixels = warped * (1 - reflection) + reflected * reflection
    result = frame.copy()
    alpha = (mask[rows, cols] * strength)[:, None]
    result[rows, cols] = np.rint(frame[rows, cols] * (1 - alpha) + pixels * alpha).clip(0, 255).astype(np.uint8)
    return result


class PixelProcessor:
    """有界原始帧环；残影不把前一张已合成结果再次反馈。"""
    def __init__(self, spec):
        self.effects, self.frame_count, self.max_history = validate_processing_spec(spec)
        self.spec = spec
        self.width, self.height, self.fps = spec['width'], spec['height'], spec['fps']
        self.frames = collections.deque(maxlen=self.max_history + 1)
        self.index = 0

    def process(self, frame):
        if self.index >= self.frame_count:
            raise ValueError('输入超过预期帧数')
        if frame.dtype != np.uint8 or frame.shape != (self.height, self.width, 3):
            raise ValueError('输入必须是匹配画幅的RGB8数组')
        original = np.array(frame, copy=True)
        self.frames.append((self.index, original))
        history = dict(self.frames)
        time = self.index / self.fps
        result = original
        for effect in self.effects:
            result = self.dispatch_effect(result, effect, time, history)
        self.index += 1
        return result


    def dispatch_effect(self, result, effect, time, history):
        """按composition顺序分派；新增原片效果在此扩展，历史仍是原始帧。"""
        strength = envelope(effect, time)
        if strength == 0:
            return result
        if effect['kind'] == 'liquid_mirror':
            return liquid_frame(result, effect, time)
        if effect['kind'] in ('mirror_corridor', 'floating_paper'):
            from manhua_vfx_dream_pixels import dream_frame
            return dream_frame(result, effect, time, strength, self.spec['seed'])
        if effect['kind'] == 'bullet_wave':
            from manhua_vfx_bullet_wave import bullet_wave_frame
            return bullet_wave_frame(result, effect, time, strength)
        ghost = effect['ghost']
        current = roi_mask(effect, time, self.width, self.height)
        # 从最老副本画起，保留当前主体区域；历史ROI可能包含背景，明确展示此限制。
        for copy in range(ghost['copies'], 0, -1):
            delay = max(1, round(copy * ghost['spacingSec'] * self.fps))
            index = self.index - delay
            historical = history.get(index)
            past = index / self.fps
            if historical is None or past < effect['startSec']:
                continue
            ox, oy = ghost['offsetX'] * copy, ghost['offsetY'] * copy
            mask = roi_mask(effect, past, self.width, self.height, (ox, oy))
            alpha = mask * (1 - current) * strength * ghost['decay'] ** copy
            if not np.any(alpha):
                continue
            if ox or oy:
                rows, cols = np.nonzero(alpha > 0)
                shifted = result.copy()
                sx, sy = cols - ox * self.width, rows - oy * self.height
                # 移到画外的像素丢弃，不能用边界延伸制造条带。
                valid = (sx >= 0) & (sx <= self.width - 1) & (sy >= 0) & (sy <= self.height - 1)
                alpha[rows[~valid], cols[~valid]] = 0
                shifted[rows[valid], cols[valid]] = np.rint(sample_bilinear(historical, sx[valid], sy[valid])).astype(np.uint8)
                historical = shifted
            result = blend(result, historical, alpha)
        return result


def read_frame(stream, size):
    data = bytearray()
    while len(data) < size:
        chunk = stream.read(size - len(data))
        if not chunk:
            if data:
                raise ValueError('原片解码得到不完整帧')
            return None
        data.extend(chunk)
    return bytes(data)


def stop_process(process):
    if process is None:
        return
    if process.poll() is None:
        process.terminate()
        try:
            process.wait(timeout=3)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=3)
    for stream in (process.stdin, process.stdout):
        if stream:
            try:
                stream.close()
            except (BrokenPipeError, OSError):
                pass


def ffmpeg_commands(source, partial, spec):
    fps = str(spec['fps'])
    decode = ['ffmpeg', '-nostdin', '-hide_banner', '-loglevel', 'error', '-threads', '2', '-i', str(source), '-map', '0:v:0', '-an', '-sn', '-dn',
              '-vf', 'fps=' + fps, '-pix_fmt', 'rgb24', '-f', 'rawvideo', 'pipe:1']
    encode = ['ffmpeg', '-nostdin', '-hide_banner', '-loglevel', 'error', '-n', '-f', 'rawvideo', '-pix_fmt', 'rgb24',
              '-video_size', f"{spec['width']}x{spec['height']}", '-framerate', fps, '-i', 'pipe:0', '-an', '-c:v', 'ffv1',
              '-level', '3', '-threads', '2', '-pix_fmt', 'bgr0', '-f', 'matroska', str(partial)]
    return decode, encode


def process_video(spec_path, source_path, output_path):
    spec = json.loads(Path(spec_path).read_text())
    processor = PixelProcessor(spec)
    source, output = Path(source_path).resolve(), Path(output_path).resolve()
    root = Path(spec_path).resolve().parent
    if source.parent != root or output.parent != root or not source.is_file() or source == output:
        raise ValueError('原片与输出必须属于当前请求目录')
    partial = output.with_suffix(output.suffix + '.partial')
    receipt = output.with_suffix(output.suffix + '.json')
    if any(p.exists() for p in (output, partial, receipt)):
        raise ValueError('保留已有像素处理产物，不自动覆盖或重做')
    decoder = encoder = None
    previous_signals = {}
    completed = False
    digest = hashlib.sha256()
    def cancel(signum, _frame):
        raise InterruptedError('原片像素处理已取消：' + str(signum))
    try:
        for name in (signal.SIGTERM, signal.SIGINT):
            previous = signal.signal(name, cancel)
            # Blender 的 C 层处理器在 Python 中可能显示为 None；恢复时须用合法默认值。
            previous_signals[name] = signal.SIG_DFL if previous is None else previous
        # 子进程沿用launcher进程组；日志落临时文件，不让stderr管道堵塞。
        with tempfile.TemporaryFile() as decode_log, tempfile.TemporaryFile() as encode_log:
            decode_args, encode_args = ffmpeg_commands(source, partial, spec)
            decoder = subprocess.Popen(decode_args, stdout=subprocess.PIPE, stderr=decode_log, stdin=subprocess.DEVNULL)
            encoder = subprocess.Popen(encode_args, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=encode_log)
            size = processor.width * processor.height * 3
            for index in range(processor.frame_count):
                raw = read_frame(decoder.stdout, size)
                if raw is None:
                    # 容器时长可比末帧时间多不到一帧，不静默补空帧。
                    raise ValueError('原片帧数少于声明时长')
                result = processor.process(np.frombuffer(raw, dtype=np.uint8).reshape(processor.height, processor.width, 3))
                encoded = result.tobytes()
                encoder.stdin.write(encoded)
                digest.update(encoded)
                if index % max(1, round(processor.fps)) == 0:
                    print(json.dumps({'phase': 'source_pixels', 'frame': index + 1, 'total': processor.frame_count}), flush=True)
                    if partial.exists() and partial.stat().st_size > MAX_OUTPUT_BYTES:
                        raise ValueError('像素中间文件超过8GiB预算')
            # 只接受时长预算中的帧；不等未消费的stdout导致解码进程堵塞。
            extra = read_frame(decoder.stdout, size)
            if extra is not None:
                raise ValueError('原片帧数超过声明时长')
            encoder.stdin.close()
            encoder.stdin = None
            if decoder.wait(timeout=30) != 0 or encoder.wait(timeout=30) != 0:
                raise ValueError('FFmpeg像素处理失败')
            if not partial.exists() or not 1 <= partial.stat().st_size <= MAX_OUTPUT_BYTES:
                raise ValueError('像素处理产物为空或超过预算')
            info = {'version': 1, 'renderer': VERSION, 'frames': processor.index, 'width': processor.width, 'height': processor.height,
                    'fps': processor.fps, 'historyFrames': processor.max_history, 'maxHistoryBytes': MAX_HISTORY_BYTES,
                    'decodedOutputSha256': digest.hexdigest(), 'audio': 'original-source-only', 'boundaryZh': BOUNDARY,
                    'effects': [e['id'] for e in processor.effects], 'bytes': partial.stat().st_size}
            partial.replace(output)
            receipt.write_text(json.dumps(info, ensure_ascii=False, indent=2))
            completed = True
            return info
    finally:
        try:
            for name, handler in previous_signals.items():
                signal.signal(name, handler)
        finally:
            stop_process(decoder)
            stop_process(encoder)
            if not completed:
                partial.unlink(missing_ok=True)
                output.unlink(missing_ok=True)
                receipt.unlink(missing_ok=True)


if __name__ == '__main__':
    args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
    if len(args) != 3:
        raise SystemExit('需要 spec.json source.mp4 processed.mkv')
    process_video(*args)
