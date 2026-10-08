"""人体接触锚点；只做坐标运算，不创建媒体或替代真实网格审片。"""
import math


def head_contact_target(head_origin, rest_to_pose_rotation, scale):
    """+X 前向静止姿态中的掩口锚点，随当前头骨旋转，不能锁在角色世界轴。"""
    origin = tuple(float(value) for value in head_origin)
    rotation = tuple(tuple(float(value) for value in row) for row in rest_to_pose_rotation)
    if len(origin) != 3 or len(rotation) != 3 or any(len(row) != 3 for row in rotation):
        raise ValueError("掩口锚点需要三维位置与三阶旋转")
    if not math.isfinite(scale) or scale <= 0 or not all(math.isfinite(v) for v in origin + sum(rotation, ())):
        raise ValueError("掩口锚点参数必须有限且比例为正")
    # 检查正交旋转，避免缩放或镜像把身份模型的接触位置悄悄改变。
    for i in range(3):
        for j in range(3):
            dot = sum(rotation[i][k]*rotation[j][k] for k in range(3))
            if abs(dot-(1. if i == j else 0.)) > 1e-5:
                raise ValueError("掩口锚点矩阵必须为旋转")
    a, b, c = rotation
    determinant = a[0]*(b[1]*c[2]-b[2]*c[1])-a[1]*(b[0]*c[2]-b[2]*c[0])+a[2]*(b[0]*c[1]-b[1]*c[0])
    if determinant < 0:
        raise ValueError("掩口锚点不接受镜像旋转")
    offset = (.125*scale, -.025*scale, .055*scale)
    return tuple(origin[i]+sum(rotation[i][j]*offset[j] for j in range(3)) for i in range(3))
