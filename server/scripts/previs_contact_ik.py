"""完整人物接触解算：保留骨长，显式返回不可达距离，不替代网格审片。"""
import math


def solve_limb(root, target, upper_length, lower_length, bend_hint):
    """在同一坐标系内求两节肢体；退化方向拒绝，不随机选择肘部方向。"""
    vectors = [tuple(float(v) for v in row) for row in (root, target, bend_hint)]
    if any(len(row) != 3 or not all(math.isfinite(v) for v in row) for row in vectors):
        raise ValueError("接触坐标必须是有限三维向量")
    if not all(math.isfinite(v) and v > 0 for v in (upper_length, lower_length)):
        raise ValueError("两节骨骼长度必须为正数")
    root, target, hint = vectors
    delta = tuple(b-a for a, b in zip(root, target))
    distance = math.sqrt(sum(v*v for v in delta))
    if distance < 1e-9:
        raise ValueError("接触目标与关节根重合，无法确定朝向")
    direction = tuple(v/distance for v in delta)
    projection = sum(a*b for a, b in zip(hint, direction))
    bend = tuple(a-projection*b for a, b in zip(hint, direction))
    bend_length = math.sqrt(sum(v*v for v in bend))
    if bend_length < 1e-9:
        raise ValueError("弯曲方向与目标轴平行，必须明确关节朝向")
    bend = tuple(v/bend_length for v in bend)
    reach = min(max(distance, abs(upper_length-lower_length)), upper_length+lower_length)
    if reach < 1e-9:
        raise ValueError("接触解退化")
    along = (upper_length**2-lower_length**2+reach**2)/(2*reach)
    height = math.sqrt(max(0., upper_length**2-along**2))
    joint = tuple(a+b*along+c*height for a, b, c in zip(root, direction, bend))
    end = tuple(a+b*reach for a, b in zip(root, direction))
    return {"joint": joint, "end": end, "unreachableDistance": abs(distance-reach)}
