"""四足屈腿后侧卧并保持；纯端点计算不依赖 Blender，不创建媒体。"""
import math


def fall_progress(fall, t):
    def smooth(value):
        u = max(0., min(1., value))
        return u*u*(3-2*u)
    if fall['mode'] == 'hold':
        return 1., 1., True
    return (smooth((t-fall['startSec'])/(fall['foldSec']-fall['startSec'])),
            smooth((t-fall['foldSec'])/(fall['groundSec']-fall['foldSec'])),
            t >= fall['groundSec'])


def fall_roll(fall, t):
    return fall_progress(fall, t)[1] * math.pi/2 * (-1 if fall['side'] == 'left' else 1)


def fold_points(points, fall, t):
    """先保持骨长折叠四肢，再绕躯干轴侧滚；roll另须写入骨矩阵以保留躯干扭转。"""
    fold, roll, _ = fall_progress(fall, t)
    if fold == 0 and roll == 0:
        return {name: tuple(tuple(v) for v in pair) for name, pair in points.items()}
    result = {name: [tuple(v) for v in pair] for name, pair in points.items()}
    def length(a, b):
        return math.sqrt(sum((b[i]-a[i])**2 for i in range(3)))
    def add(a, b):
        return tuple(a[i]+b[i] for i in range(3))
    for key in ('0', '1', '2', '3'):
        hip, knee = result['upper_leg'+key]
        _, ankle = result['lower_leg'+key]
        _, toe = result['foot'+key]
        upper_len, lower_len, foot_len = length(hip, knee), length(knee, ankle), length(ankle, toe)
        # 各段绕同一侧向轴折叠，保留原骨长；从实际起始方向平滑转到收腿角。
        upper0 = math.atan2(knee[0]-hip[0], -(knee[2]-hip[2]))
        lower0 = math.atan2(ankle[0]-knee[0], -(ankle[2]-knee[2]))
        upper = upper0 + (.9-upper0)*fold
        lower = lower0 + (-1.8-lower0)*fold
        knee = add(hip, (upper_len*math.sin(upper), 0., -upper_len*math.cos(upper)))
        ankle = add(knee, (lower_len*math.sin(lower), 0., -lower_len*math.cos(lower)))
        toe = add(ankle, (foot_len, 0., 0.))
        result['upper_leg'+key]=(hip,knee)
        result['lower_leg'+key]=(knee,ankle)
        result['foot'+key]=(ankle,toe)
    angle = fall_roll(fall, t)
    c, s = math.cos(angle), math.sin(angle)
    # 侧滚围绕躯干中轴；最终支撑由实际网格接地阶段测量与校正，不伪称该高度适配所有模型。
    center_z = 1.2 - .32*fold - .55*roll
    def transform(v):
        y,z=v[1],v[2]-1.2
        return (v[0], c*y-s*z, center_z+s*y+c*z)
    return {name: tuple(transform(v) for v in pair) for name,pair in result.items()}


def validate_fall(actor, spec):
    """渲染端重复校验，拒绝旧草稿绕过服务端schema。"""
    fall = actor.get('quadrupedFall')
    if fall is None:
        return
    if not isinstance(fall, dict) or fall.get('mode') not in ('collapse', 'hold') or fall.get('side') not in ('left', 'right'):
        raise ValueError('倒地模式或侧向无效')
    expected = {'mode', 'side'} | ({'startSec', 'foldSec', 'groundSec'} if fall['mode'] == 'collapse' else set())
    if set(fall) != expected:
        raise ValueError('倒地字段不完整或含未知字段')
    if (actor['shape'] != 'horse' or any(actor.get(key) is not None for key in ('creature', 'hitReaction', 'motionRoute', 'visibleRanges'))
            or any(a['kind'] != 'idle' for a in actor['actions'])
            or any(abs(a-b) > 1e-6 for a,b in zip(actor['start'],actor['end']))
            or spec.get('waterEmergence')
            or any(actor['id'] in (e['actorId'],e['targetActorId']) for e in spec.get('interactions', []))):
        raise ValueError('倒地须为原地四足、整段在场，不得叠加其他动作、出水或交互')
    if fall['mode'] == 'collapse':
        times = [fall[key] for key in ('startSec', 'foldSec', 'groundSec')]
        if (any(type(t) not in (int, float) or not math.isfinite(t) or t < 0 or abs(t*24-round(t*24)) > 1e-6 for t in times)
                or times[1]-times[0] < .25 or times[2]-times[1] < .5
                or times[2] > (spec['durationSec']*24-1)/24):
            raise ValueError('倒地秒窗须按24帧对齐并在片尾前完成屈腿、侧落与保持')
