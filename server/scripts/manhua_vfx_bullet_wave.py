"""在真实原片像素上制作沿弹道移动的空气折射环，不用发光贴图代替折射。"""
import math
import numpy as np
from manhua_vfx_action_math import wave_rings


def bullet_wave_frame(frame, effect, time, strength):
    from manhua_vfx_liquid_ghost import sample_bilinear
    if strength <= 0:
        return frame.copy()
    h, w = frame.shape[:2]
    rings = wave_rings(effect, time, w / h)
    p = effect['wave']
    result = frame.copy()
    rgb = np.array([int(effect['color'][i:i+2], 16) for i in (1, 3, 5)], dtype=np.float32)
    # 从尾部到前部，读取每一圈处理前的当前帧；ROI外字节不变。
    for ring in reversed(rings):
        radius = ring['radius'] * h
        a, b = .24 * radius, radius
        ca, sa = math.cos(ring['angle']), math.sin(ring['angle'])
        cx, cy = ring['x'] * w - .5, ring['y'] * h - .5
        bx = 1.35 * math.hypot(a * ca, b * sa)
        by = 1.35 * math.hypot(a * sa, b * ca)
        x0, x1 = max(0, math.floor(cx - bx)), min(w, math.ceil(cx + bx) + 1)
        y0, y1 = max(0, math.floor(cy - by)), min(h, math.ceil(cy + by) + 1)
        if x0 >= x1 or y0 >= y1:
            continue
        yy, xx = np.mgrid[y0:y1, x0:x1].astype(np.float32)
        u = (xx - cx) * ca + (yy - cy) * sa
        v = -(xx - cx) * sa + (yy - cy) * ca
        distance = np.sqrt((u / a) ** 2 + (v / b) ** 2)
        band = np.exp(-((distance - 1) / .11) ** 2)
        band[(distance < .65) | (distance > 1.35)] = 0
        active = band > .001
        if not np.any(active):
            continue
        nx = u / (a * a) * ca - v / (b * b) * sa
        ny = u / (a * a) * sa + v / (b * b) * ca
        norm = np.maximum(np.hypot(nx, ny), 1e-6)
        displacement = p['refraction'] * h * effect['scale'] * strength * ring['alpha'] * band * np.sin((distance - 1) * math.pi / .22)
        warped = sample_bilinear(result, (xx + nx / norm * displacement)[active], (yy + ny / norm * displacement)[active])
        glow = (p['glow'] * band[active] * ring['alpha'] * strength * .3)[:, None]
        pixels = warped * (1 - glow) + rgb * glow
        region = result[y0:y1, x0:x1]
        region[active] = np.rint(pixels).clip(0, 255).astype(np.uint8)
    return result
