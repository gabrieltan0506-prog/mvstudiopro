"""镜面纵深与纸页悬浮：有界、确定性的画面处理，不重建三维或改变原片人物。"""
import hashlib
import math
import random
import re

import numpy as np

from manhua_vfx_math import keys, number, position_at

DREAM_KINDS = frozenset(('mirror_corridor', 'floating_paper'))
MAX_DREAM_SAMPLES = 800_000_000


def validate_dream_effect(effect):
    mirror = effect.get('kind') == 'mirror_corridor'
    group = 'mirror' if mirror else 'paper'
    if effect.get('kind') not in DREAM_KINDS:
        raise ValueError('不支持的梦境画面效果')
    allowed = {'roi', 'mirror'} if mirror else {'paper'}
    if any(field in effect and field not in allowed for field in ('roi', 'mirror', 'paper', 'liquid', 'ghost', 'wave', 'blast', 'wall', 'rain', 'bullet', 'imageUri')):
        raise ValueError('本梦境图层不接受其他效果参数')
    fields = (('layers', 2, 8), ('shrink', .45, .85), ('drift', 0, .08)) if mirror else (
        ('count', 6, 64), ('size', .015, .12), ('drift', 0, .6), ('flutter', 0, 4), ('spread', .1, 1.5))
    value = effect.get(group)
    keys(value, tuple(field for field, _, _ in fields))
    for field, lo, hi in fields:
        number(value[field], lo, hi, group + '-' + field)
    count = value['layers' if mirror else 'count']
    if not isinstance(count, int) or isinstance(count, bool):
        raise ValueError('数量须为整数')
    if not mirror and (not isinstance(effect.get('color'), str) or not re.fullmatch(r'#[0-9a-fA-F]{6}', effect['color'])):
        raise ValueError('纸页颜色无效')


def dream_sample_budget(effect, width, height, fps):
    """与服务端TS预检相同的保守采样预算，CLI也单独限制。"""
    frames = math.ceil(effect['durationSec'] * fps) + 1
    if effect['kind'] == 'mirror_corridor':
        p, roi = effect['mirror'], effect['roi']
        return sum(min(width * height, (roi['width'] * effect['scale'] * width * p['shrink'] ** depth + 2) *
                       (roi['height'] * effect['scale'] * height * p['shrink'] ** depth + 2))
                   for depth in range(1, p['layers'] + 1)) * frames
    p = effect['paper']
    return min(width * height, (2 * p['size'] * height * effect['scale'] + 4) ** 2) * p['count'] * frames


def mirror_frame(frame, effect, time, strength):
    from manhua_vfx_liquid_ghost import roi_mask, sample_bilinear
    h, w = frame.shape[:2]
    cx, cy = position_at(effect, time)
    roi, p = effect['roi'], effect['mirror']
    rx, ry = roi['width'] * effect['scale'] * w / 2, roi['height'] * effect['scale'] * h / 2
    outer = roi_mask(effect, time, w, h)
    result = frame.copy()
    age = time - effect['startSec']
    for depth in range(1, p['layers'] + 1):
        factor = p['shrink'] ** depth
        # 漂移随深度收敛，最外遮罩始终限制实际写入区域。
        ox = p['drift'] * w * (1 - factor) * math.sin(age * .7)
        oy = p['drift'] * h * (1 - factor) * math.cos(age * .55)
        x0, x1 = max(0, math.floor(cx * w + ox - rx * factor)), min(w, math.ceil(cx * w + ox + rx * factor))
        y0, y1 = max(0, math.floor(cy * h + oy - ry * factor)), min(h, math.ceil(cy * h + oy + ry * factor))
        if x0 >= x1 or y0 >= y1:
            continue
        xx, yy = np.meshgrid(np.arange(x0, x1, dtype=np.float32), np.arange(y0, y1, dtype=np.float32))
        nx, ny = (xx + .5 - cx * w - ox) / (rx * factor), (yy + .5 - cy * h - oy) / (ry * factor)
        distance = np.sqrt(nx * nx + ny * ny) if roi['shape'] == 'ellipse' else np.maximum(np.abs(nx), np.abs(ny))
        edge = np.clip((1 - distance) / max(.008, roi['feather']), 0, 1)
        alpha = edge * edge * (3 - 2 * edge) * outer[y0:y1, x0:x1] * strength
        # 每层都来自同一输入帧，交替左右镜像；不会递归反馈前一帧。
        sx = cx * w - .5 + nx * rx * (-1 if depth % 2 else 1)
        sy = cy * h - .5 + ny * ry
        sampled = sample_bilinear(frame, sx, sy)
        patch = result[y0:y1, x0:x1]
        active = alpha > 0
        a = alpha[active, None]
        patch[active] = np.rint(patch[active] * (1 - a) + sampled[active] * a).clip(0, 255).astype(np.uint8)
    return result


def paper_frame(frame, effect, time, strength, seed):
    h, w = frame.shape[:2]
    p = effect['paper']
    rng = random.Random(seed ^ int(hashlib.sha256(effect['id'].encode()).hexdigest()[:8], 16))
    color = np.array([int(effect['color'][i:i + 2], 16) for i in (1, 3, 5)], dtype=np.float32)
    cx, cy = position_at(effect, time)
    age = time - effect['startSec']
    result = frame.copy()
    for _ in range(p['count']):
        ux, uy, phase, size, turn, depth = [rng.random() for _ in range(6)]
        angle = phase * math.tau + age * p['flutter'] * (turn - .5) * 1.8
        tilt = .14 + .86 * abs(math.cos(phase * math.tau + age * p['flutter']))
        a = p['size'] * h * effect['scale'] * (.55 + .6 * size) / 2
        b = a * .72
        x = cx * w + (ux - .5) * p['spread'] * h * effect['scale'] + math.sin(age * .8 + phase * math.tau) * age * p['drift'] * h * .1
        y = cy * h + (uy - .5) * p['spread'] * h * effect['scale'] + math.cos(age * .6 + phase * math.tau) * age * p['drift'] * h * .1
        radius = math.hypot(a, b) + 2
        x0, x1 = max(0, math.floor(x - radius)), min(w, math.ceil(x + radius))
        y0, y1 = max(0, math.floor(y - radius)), min(h, math.ceil(y + radius))
        if x0 >= x1 or y0 >= y1:
            continue
        xx, yy = np.meshgrid(np.arange(x0, x1, dtype=np.float32) + .5 - x, np.arange(y0, y1, dtype=np.float32) + .5 - y)
        u = (xx * math.cos(angle) + yy * math.sin(angle)) / (a * tilt)
        v = (-xx * math.sin(angle) + yy * math.cos(angle)) / b
        # 弯曲边缘与折痕随翻面变化，边缘亚像素渐隐，不用固定不动的方块代替纸页。
        curved = u + .09 * np.sin(v * math.pi + phase * math.tau)
        edge = np.clip((1 - np.maximum(np.abs(curved), np.abs(v))) * max(1., min(a * tilt, b)), 0, 1)
        alpha = edge * min(1., strength * (1.3 + .5 * depth))
        shade = np.clip(.7 + .2 * tilt + .06 * np.cos(v * math.pi) - .12 * np.exp(-np.abs(curved) * 18), .45, 1)
        # 细淡纤维与折痕，不添加可读文字，也不调用外部图片。
        shade -= .025 * ((np.sin(v * 65 + phase * 10) > .93) & (np.abs(curved) < .8))
        paper = color[None, None, :] * shade[..., None]
        patch = result[y0:y1, x0:x1]
        active = alpha > 0
        aa = alpha[active, None]
        patch[active] = np.rint(patch[active] * (1 - aa) + paper[active] * aa).clip(0, 255).astype(np.uint8)
    return result


def dream_frame(frame, effect, time, strength, seed):
    if strength <= 0 or time < effect['startSec'] or time >= effect['startSec'] + effect['durationSec']:
        return frame.copy()
    return mirror_frame(frame, effect, time, strength) if effect['kind'] == 'mirror_corridor' else paper_frame(frame, effect, time, strength, seed)
