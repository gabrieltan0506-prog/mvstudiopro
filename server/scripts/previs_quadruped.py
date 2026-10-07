"""Four-legged landmark and driver contract. Suggestions always require visual correction.

The existing 16 serialized slots are retained: arm slots are the front legs,
leg slots are the hind legs, and pelvis/spine are the rear/front torso.
This module never downloads models, creates fake weights, or accepts quality.
"""
import math

# Existing procedural horse: 1=front-left, 3=front-right, 2=hind-left, 0=hind-right.
SOURCE_BONE_MAP = {"pelvis": "body", "spine": "body", "neck": "neck", "head": "head"}
for suffix, front, hind in (("1", "1", "2"), ("-1", "3", "0")):
    for target, source in (("upper_arm", "upper_leg"), ("forearm", "lower_leg"), ("hand", "foot")):
        SOURCE_BONE_MAP[target + suffix] = source + front
    for name in ("upper_leg", "lower_leg", "foot"):
        SOURCE_BONE_MAP[name + suffix] = name + hind


def suggest_joints(bounds):
    low, high = bounds
    if any(not math.isfinite(n) for row in bounds for n in row) or any(high[i] <= low[i] for i in range(3)):
        raise ValueError("四足包围盒无效")
    def point(x, y, z):
        return [low[0] + (high[0]-low[0])*x,
                low[1] + (high[1]-low[1])*y,
                low[2] + (high[2]-low[2])*z]
    joints = {"pelvis": point(.23,.5,.58), "waist": point(.40,.5,.58),
              "chest": point(.58,.5,.58), "neck": point(.66,.5,.86),
              "headTop": point(.92,.5,.86)}
    for side, y in (("L",.72),("R",.28)):
        for name, x, z in (("shoulder",.58,.58),("elbow",.59,.34),
                           ("wrist",.60,.055),("handTip",.66,.055),
                           ("hip",.23,.58),("knee",.20,.34),
                           ("ankle",.23,.055),("toe",.29,.055)):
            joints[name+side] = point(x,y,z)
    return joints


def validate_landmarks(points):
    """Geometry checks supplement, never replace, front/side manual confirmation."""
    for a,b in (("pelvis","spine"),("spine","neck"),("neck","head")):
        if (points[a][1]-points[b][0]).length > .005:
            raise ValueError("四足躯干关节必须连续")
    if points["spine"][1].x <= points["pelvis"][0].x or points["head"][1].x <= points["head"][0].x:
        raise ValueError("四足站姿须按+X朝前校正前躯与鼻尖")
    for side in (-1,1):
        suffix = str(side)
        for chain in (("upper_arm","forearm","hand"),("upper_leg","lower_leg","foot")):
            upper, lower, hoof = [points[name+suffix] for name in chain]
            if (upper[1]-lower[0]).length > .005 or (lower[1]-hoof[0]).length > .005:
                raise ValueError("四足腿部关节必须连续")
            if lower[1].z >= upper[0].z-.1 or upper[1].z >= upper[0].z or lower[1].z >= lower[0].z:
                raise ValueError("四足绑定只接受四蹄向下的站姿，不能将卧姿冒充站姿")
            if upper[0].y*side <= 0 or hoof[0].y*side <= 0:
                raise ValueError("四足左右腿须位于身体对应侧")
        if points["upper_arm"+suffix][0].x <= points["upper_leg"+suffix][0].x+.1:
            raise ValueError("四足前后腿必须分离，不能复用人体关节")
