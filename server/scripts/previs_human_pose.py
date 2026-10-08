"""只校验人工提供的人体关节点；不识别人形，不生成骨骼或媒体。"""
import math


def validate_human_arm_pose(points, pose):
    if pose not in ("A", "T", "bent_arms"):
        raise ValueError("人体姿态须为 A/T 或直立屈臂")
    required = [key + str(side) for side in (-1, 1) for key in ("upper_arm", "forearm", "hand", "upper_leg", "lower_leg")]
    for name in required:
        pair = points.get(name)
        if pair is None or len(pair) != 2 or any(len(v) != 3 or any(not math.isfinite(float(x)) for x in v) for v in pair):
            raise ValueError("人工关节点须完整且坐标有限")
        if not .02 <= math.dist(*pair) <= 1:
            raise ValueError("人工骨长不在支持范围")
    for side in (-1, 1):
        suffix = str(side)
        upper, forearm, hand = (points[key + suffix] for key in ("upper_arm", "forearm", "hand"))
        if any(math.dist(a[1], b[0]) > .005 for a, b in ((upper, forearm), (forearm, hand))):
            raise ValueError("人工手臂关节必须连续")
        if pose == "bent_arms":
            # 屈臂的手可在胸前，不能套用展臂末端宽度；左右肩仍必须明确。
            if upper[0][1] * side <= 0:
                raise ValueError("屈臂关节点须明确左右肩，不能交换或位于中轴")
        else:
            arm = tuple(b-a for a, b in zip(upper[0], hand[1]))
            if arm[1] * side < .25 or abs(arm[0]) > .15 or arm[2] > .05 or arm[2] < -.7:
                raise ValueError("人工关节点不符合 +X 朝向的 A/T 展臂范围")
            if pose == "T" and abs(arm[2]) > .08:
                raise ValueError("T 型手臂必须接近水平")
        for key in ("upper_leg", "lower_leg"):
            head, tail = points[key + suffix]
            if tail[2] >= head[2]:
                raise ValueError("腿部关节点必须符合直立姿态")
