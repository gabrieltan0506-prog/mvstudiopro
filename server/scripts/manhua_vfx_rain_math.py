"""数字雨的确定性字符与运动数据；不加载字体、媒体或Blender。"""
import hashlib
import math
import random

# 自绘3×5点阵。共享16种几何，字符切换不新增网格或外部字体资源。
GLYPHS = (
    ('111', '101', '101', '101', '111'),
    ('010', '110', '010', '010', '111'),
    ('111', '001', '111', '100', '111'),
    ('111', '001', '111', '001', '111'),
    ('101', '101', '111', '001', '001'),
    ('111', '100', '111', '001', '111'),
    ('111', '100', '111', '101', '111'),
    ('111', '001', '010', '010', '010'),
    ('111', '101', '111', '101', '111'),
    ('111', '101', '111', '001', '111'),
    ('010', '101', '111', '101', '101'),
    ('110', '101', '110', '101', '110'),
    ('111', '100', '100', '100', '111'),
    ('110', '101', '101', '101', '110'),
    ('111', '100', '110', '100', '111'),
    ('111', '100', '110', '100', '100'),
)
DEFAULTS = {'columns': 24, 'speed': .28, 'trail': 12}
ROW_STEP = .055
STYLE_DEFAULTS = {'glyphSet':'hex','layout':'rain','direction':'down','glyphRate':5}
RITUAL_CHARACTERS = '天地玄黄宇宙洪荒阴阳乾坤'

def glyph_characters(settings):
    mode=settings.get('glyphSet','hex')
    return list(dict.fromkeys(settings.get('characters','') if mode=='custom' else RITUAL_CHARACTERS if mode=='ritual' else '0123456789ABCDEF'))


def glyph_geometry(index):
    vertices, faces = [], []
    pixel = ROW_STEP * .135
    for row, bits in enumerate(GLYPHS[index]):
        for col, bit in enumerate(bits):
            if bit != '1':
                continue
            x, y = (col - 1) * pixel, (2 - row) * pixel
            half = pixel * .43
            start = len(vertices)
            vertices.extend(((x-half, y-half, 0), (x+half, y-half, 0),
                             (x+half, y+half, 0), (x-half, y+half, 0)))
            faces.append(tuple(start+i for i in range(4)))
    return vertices, faces


def rain_columns(seed, effect_id, aspect, settings=None):
    settings = {**DEFAULTS, **(settings or {})}
    rng = random.Random(seed ^ int(hashlib.sha256(effect_id.encode()).hexdigest()[:8], 16))
    count, trail = settings['columns'], settings['trail']
    # 完整拖尾离开下边界后才重入，避免头部回卷时拖尾瞬间消失。
    period = 1 if settings.get('layout')=='wall' else 1 + trail * ROW_STEP + .12
    return [{'x': ((i+.5)/count-.5)*aspect, 'speed': settings['speed']*(.7+rng.random()*.6),
             'phase': rng.random()*period, 'period': period, 'trail': trail,
             'codeSeed': rng.randrange(1, 2**31), 'aspect':aspect, 'layout':settings.get('layout','rain'), 'direction':settings.get('direction','down'), 'glyphRate':settings.get('glyphRate',5), 'glyphCount':len(glyph_characters(settings))} for i in range(count)]


def rain_frame(columns, age):
    result = []
    for column in columns:
        distance = (column['phase'] + age*column['speed']) % column['period']
        for tail in range(column['trail']):
            wall=column['layout']=='wall'
            y=.5-((distance-tail/column['trail'])%1) if wall else .5-distance+tail*ROW_STEP
            x=column['x']
            if column['direction']=='up':y=-y
            elif column['direction'] in ('left','right'):
                x,y=y*column['aspect'],column['x']/column['aspect']
                if column['direction']=='right':x=-x
            tick = math.floor(age*column['glyphRate'] + column['phase']*7 + tail*.37)
            code = (column['codeSeed'] ^ (tail*104729) ^ (tick*2654435761)) & 0xffffffff
            code ^= code >> 16
            result.append({'x': x, 'y': y, 'glyph': code % column['glyphCount'],
                           'head': tail == 0, 'alpha': .7+.3*(1-tail/column['trail']) if wall else (1-tail/column['trail'])**1.65,
                           'visible': -.5 <= y <= .5 and -column['aspect']/2 <= x <= column['aspect']/2})
    return result
