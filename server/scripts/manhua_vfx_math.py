"""Bounded, deterministic screen-space effects; no user code or asset loading."""
import math
import re
import struct
from pathlib import Path

KINDS = frozenset(('sword_trail', 'impact_burst', 'particle_aura', 'shield', 'spirit',
                   'fire_burst', 'smoke_plume', 'lightning', 'shockwave', 'speed_lines', 'magic_circle', 'image_overlay', 'digital_rain'))
VERSION = 'manhua-vfx-screen-1'
BOUNDARY = '画面坐标特效层与手动轨迹；不包含自动跟踪、人物遮挡、场景受光或物理仿真。'


def number(value, lo, hi, label):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not lo <= value <= hi:
        raise ValueError('Invalid ' + label)
    return value


def keys(value, required, optional=()):
    if not isinstance(value, dict) or not set(required) <= value.keys() or value.keys() - set(required) - set(optional):
        raise ValueError('Unexpected or missing fields')


def validate_image_path(value, asset_root):
    """Only normalized PNGs inside this request's images/ directory; URLs and symlink escapes fail."""
    if asset_root is None or not isinstance(value,str) or not value or '\x00' in value or len(value)>4096:
        raise ValueError('Image overlay requires a server-prepared PNG path')
    root=Path(asset_root).resolve()
    images=(root/'images').resolve()
    if images.parent!=root:raise ValueError('Image asset directory escapes the request')
    given=Path(value)
    path=(given if given.is_absolute() else root/given).resolve()
    if not path.is_relative_to(images) or path.suffix.lower()!='.png' or not path.is_file():
        raise ValueError('Image must be a PNG within the request images directory')
    size=path.stat().st_size
    if not 32<=size<=32*1024*1024:raise ValueError('Image PNG exceeds size limits')
    with path.open('rb') as file:header=file.read(24)
    if header[:8]!=b'\x89PNG\r\n\x1a\n' or header[12:16]!=b'IHDR':raise ValueError('Image asset is not a normalized PNG')
    width,height=struct.unpack('>II',header[16:24])
    if not width or not height or width*height>4_000_000:raise ValueError('Image asset exceeds 4M pixels')
    return path,{'width':width,'height':height,'bytes':size,'path':path.relative_to(root).as_posix()}


def validate_spec(spec, asset_root=None):
    keys(spec, ('version', 'seed', 'effects', 'durationSec', 'fps', 'width', 'height'))
    if spec['version'] != 1 or isinstance(spec['version'], bool):
        raise ValueError('Unsupported version')
    number(spec['seed'], 0, 2147483647, 'seed')
    if not isinstance(spec['seed'], int):
        raise ValueError('Seed must be integer')
    number(spec['durationSec'], 0, 30, 'duration')
    if spec['durationSec'] == 0:
        raise ValueError('Duration must be positive')
    number(spec['fps'], 12, 60, 'fps')
    for field in ('width', 'height'):
        number(spec[field], 16, 1920, field)
        if not isinstance(spec[field], int) or spec[field] % 2:
            raise ValueError('Dimensions must be even integers')
    if spec['width'] * spec['height'] > 1920 * 1080 or spec['width'] * spec['height'] * math.ceil(spec['durationSec'] * spec['fps']) > 1920 * 1080 * 900:
        raise ValueError('Resolution exceeds pixel budget')
    if not isinstance(spec['effects'], list) or not 1 <= len(spec['effects']) <= 12:
        raise ValueError('Expected 1..12 effects')
    seen = set()
    for effect in spec['effects']:
        fields=('id', 'kind', 'startSec', 'durationSec', 'color', 'scale', 'intensity', 'anchor')
        if isinstance(effect,dict) and effect.get('kind')=='image_overlay':fields+=('imageUri','imagePath')
        keys(effect, fields, ('rain',) if isinstance(effect,dict) and effect.get('kind')=='digital_rain' else ())
        if 'rain' in effect:
            rain=effect['rain']
            keys(rain, ('columns','speed','trail'))
            for field,lo,hi in (('columns',8,36),('speed',.05,1),('trail',4,16)):
                number(rain[field],lo,hi,'digital rain '+field)
                if field!='speed' and not isinstance(rain[field],int):
                    raise ValueError('Digital rain counts must be integers')
        if not isinstance(effect['id'], str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,80}', effect['id']) or effect['id'] in seen:
            raise ValueError('Invalid or duplicate effect id')
        seen.add(effect['id'])
        if effect['kind'] not in KINDS:
            raise ValueError('Unsupported effect kind')
        if effect['kind']=='image_overlay':
            if not isinstance(effect['imageUri'],str) or not 1<=len(effect['imageUri'])<=2048:
                raise ValueError('Image overlay source identity is missing')
            validate_image_path(effect['imagePath'],asset_root)
        number(effect['startSec'], 0, spec['durationSec'], 'effect start')
        number(effect['durationSec'], 1 / 60, 30, 'effect duration')
        if effect['startSec'] + effect['durationSec'] > spec['durationSec'] + 1e-9:
            raise ValueError('Effect exceeds source duration')
        if math.ceil(effect['startSec'] * spec['fps'] - 1e-9) >= math.ceil((effect['startSec'] + effect['durationSec']) * spec['fps'] - 1e-9):
            raise ValueError('Effect window must contain at least one source frame')
        number(effect['scale'], .02, 2, 'scale')
        number(effect['intensity'], 0, 2, 'intensity')
        if not isinstance(effect['color'], str) or not re.fullmatch(r'#[0-9a-fA-F]{6}', effect['color']):
            raise ValueError('Invalid color')
        anchor = effect['anchor']
        keys(anchor, ('space', 'position'), ('trajectory',))
        if anchor['space'] != 'screen' or not isinstance(anchor['position'], list) or len(anchor['position']) != 2:
            raise ValueError('Invalid screen anchor')
        for n in anchor['position']:
            number(n, 0, 1, 'anchor coordinate')
        if 'trajectory' in anchor:
            points = anchor['trajectory']
            if not isinstance(points, list) or not 2 <= len(points) <= 120:
                raise ValueError('Expected 2..120 trajectory points')
            previous = -1
            for point in points:
                keys(point, ('timeSec', 'x', 'y'))
                number(point['timeSec'], 0, spec['durationSec'] + 1e-9, 'trajectory time')
                number(point['x'], 0, 1, 'trajectory x')
                number(point['y'], 0, 1, 'trajectory y')
                if point['timeSec'] <= previous:
                    raise ValueError('Trajectory times must increase')
                previous = point['timeSec']
    return spec


def position_at(effect, time):
    points = effect['anchor'].get('trajectory')
    if not points:
        return tuple(effect['anchor']['position'])
    if time <= points[0]['timeSec']:
        return points[0]['x'], points[0]['y']
    for left, right in zip(points, points[1:]):
        if time <= right['timeSec']:
            q = (time - left['timeSec']) / (right['timeSec'] - left['timeSec'])
            return (left['x'] * (1-q) + right['x'] * q, left['y'] * (1-q) + right['y'] * q)
    return points[-1]['x'], points[-1]['y']


def state_at(effect, time):
    age = time - effect['startSec']
    # Half-open interval; compare absolute endpoint to avoid subtraction tail errors.
    active = effect['startSec'] <= time < effect['startSec'] + effect['durationSec']
    q = max(0., min(1., age / effect['durationSec']))
    envelope = max(.15, min(1., q * 12)) * min(1., (1-q) * 5) if active else 0.
    return {'active': active, 'progress': q, 'opacity': envelope * effect['intensity'] / 2,
            'position': position_at(effect, time)}


def srgb(hex_color):
    def linear(n):
        return n / 12.92 if n <= .04045 else ((n + .055) / 1.055) ** 2.4
    return tuple(linear(int(hex_color[k:k+2], 16) / 255) for k in (1, 3, 5))
