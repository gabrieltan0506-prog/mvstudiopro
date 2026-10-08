"""身份颜色纯数值函数，前六色保持兼容，后续按金角 HSL 确定性扩展。"""
import math
BASE_COLORS = ['38bdf8', 'fb923c', 'c084fc', 'facc15', '34d399', 'f472b6']


def actor_color_hex(index):
    if type(index) is not int or index < 0:
        raise ValueError('角色颜色索引无效')
    if index < len(BASE_COLORS):
        return BASE_COLORS[index]
    h = ((index - 6) * 137.508) % 360
    c = (1 - abs(2 * .6 - 1)) * .68
    x = c * (1 - abs((h / 60) % 2 - 1))
    m = .6 - c / 2
    rgb = ((c,x,0) if h < 60 else (x,c,0) if h < 120 else (0,c,x) if h < 180
           else (0,x,c) if h < 240 else (x,0,c) if h < 300 else (c,0,x))
    return ''.join(format(math.floor((v+m)*255+.5), '02x') for v in rgb)
