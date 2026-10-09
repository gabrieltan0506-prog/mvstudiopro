"""弹道波纹和定向爆破的确定性参数、轨迹与颗粒状态。"""
import hashlib
import math
import random

from manhua_vfx_math import keys, number, position_at

WAVE_DEFAULTS = {'angleDeg': 0, 'reach': .8, 'radius': .085, 'rings': 6,
                 'trailSec': .28, 'refraction': .014, 'glow': .3}
BLAST_DEFAULTS = {'angleDeg': -25, 'spreadDeg': 55, 'reach': .8, 'particles': 72,
                  'gravity': 1.2, 'smoke': .65, 'ignitionSec': .1}


def validate_wave(value):
    keys(value, WAVE_DEFAULTS)
    for field, lo, hi in (('angleDeg', -360, 360), ('reach', .05, 1.8),
                          ('radius', .02, .22), ('rings', 2, 10),
                          ('trailSec', .03, .6), ('refraction', .001, .04), ('glow', 0, 1)):
        number(value[field], lo, hi, '弹道波纹 ' + field)
    if not isinstance(value['rings'], int):
        raise ValueError('波纹圈数必须为整数')
    return value


def validate_blast(value, duration):
    keys(value, BLAST_DEFAULTS)
    for field, lo, hi in (('angleDeg', -360, 360), ('spreadDeg', 5, 160),
                          ('reach', .05, 2), ('particles', 16, 144),
                          ('gravity', 0, 6), ('smoke', 0, 1), ('ignitionSec', 0, 30)):
        number(value[field], lo, hi, '定向爆破 ' + field)
    if not isinstance(value['particles'], int):
        raise ValueError('爆破颗粒数必须为整数')
    if value['ignitionSec'] >= duration:
        raise ValueError('起爆秒位须在图层时间窗内')
    return value


def wave_rings(effect, time, aspect):
    """挂点是起点，0度向右、90度向下；手动轨迹平移整条弹道。"""
    p = effect['wave']
    if not effect['startSec'] <= time < effect['startSec'] + effect['durationSec']:
        return []
    angle = math.radians(p['angleDeg'])
    dx, dy = math.cos(angle), math.sin(angle)
    rows = []
    age = time - effect['startSec']
    for i in range(p['rings']):
        lag = p['trailSec'] * i / (p['rings'] - 1)
        if lag > age:
            continue
        emitted = time - lag
        x, y = position_at(effect, emitted)
        progress = (emitted - effect['startSec']) / effect['durationSec']
        travel = p['reach'] * progress * effect['scale']
        rows.append({'x': x + dx * travel / aspect, 'y': y + dy * travel,
                     'radius': p['radius'] * effect['scale'] * (.65 + .7 * i / (p['rings'] - 1)),
                     'alpha': (1 - .72 * i / (p['rings'] - 1)), 'angle': angle})
    return rows


def blast_particles(effect, seed):
    p = effect['blast']
    rng = random.Random(seed ^ int(hashlib.sha256(effect['id'].encode()).hexdigest()[:16], 16))
    rows = []
    for i in range(p['particles']):
        kind = ('fire', 'spark', 'debris')[i % 3]
        angle = math.radians(p['angleDeg'] + rng.uniform(-.5, .5) * p['spreadDeg'])
        rows.append({'kind': kind, 'angle': angle, 'speed': rng.uniform(.45, 1.25),
                     'lift': rng.uniform(-.12, .12), 'delay': rng.uniform(0, .075),
                     'life': rng.uniform(.25, .48) if kind == 'fire' else rng.uniform(.65, 1.2),
                     'size': rng.uniform(.018, .05) if kind == 'fire' else rng.uniform(.004, .012),
                     'spin': rng.uniform(-8, 8), 'phase': rng.random(), 'depth': rng.uniform(-.012, .012)})
    for i in range(max(0, round(p['smoke'] * min(24, p['particles'] // 3)))):
        angle = math.radians(p['angleDeg'] + rng.uniform(-.6, .6) * p['spreadDeg'])
        rows.append({'kind': 'smoke', 'angle': angle, 'speed': rng.uniform(.15, .45),
                     'lift': rng.uniform(.05, .18), 'delay': rng.uniform(.06, .22),
                     'life': rng.uniform(.7, 1.15), 'size': rng.uniform(.04, .075),
                     'spin': rng.uniform(-1, 1), 'phase': rng.random(), 'depth': rng.uniform(-.025, -.015)})
    return rows


def blast_state(particle, params, age, available):
    """解析运动，无逐帧累积；跳帧和重跑取到同一位置。"""
    local = age - params['ignitionSec'] - particle['delay'] * min(1., available)
    lifetime = max(1 / 120, available * particle['life'])
    q = local / lifetime
    if local < 0 or q >= 1:
        return {'visible': False, 'alpha': 0., 'position': (0., 0., 0.), 'scale': (0., 0., 0.), 'rotation': 0.}
    kind = particle['kind']
    flight = local / max(.1, available)
    travel = params['reach'] * particle['speed'] * (1 - math.exp(-2.4 * flight))
    # Blender Y向上；界面角度按屏幕顺时针。重力与烟尘浮升使用秒。
    x = math.cos(particle['angle']) * travel
    y = -math.sin(particle['angle']) * travel
    if kind in ('debris', 'spark'):
        y -= .5 * params['gravity'] * local * local
    else:
        y += particle['lift'] * local
    size = particle['size']
    fade = max(0., 1 - q) ** (1.5 if kind == 'fire' else .7)
    attack = min(1., .2 + q * 12)
    if kind == 'fire':
        size *= .6 + 2 * math.sin(math.pi * min(1., q))
        scale = (size * 1.7, size, size * .65)
    elif kind == 'smoke':
        size *= .5 + 3 * q
        scale = (size, size * 1.15, size * .7)
        fade *= params['smoke'] * .55
    elif kind == 'spark':
        scale = (size * (5 - 3 * q), size * .3, size * .3)
    else:
        scale = (size, size * .75, size * .6)
    return {'visible': True, 'alpha': attack * fade,
            'position': (x, y, particle['depth']), 'scale': scale,
            'rotation': -particle['angle'] + particle['spin'] * local}
