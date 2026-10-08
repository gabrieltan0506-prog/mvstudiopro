"""按静止骨轴计算最短摆动，避免直立骨经过全局上轴时凭空翻滚。"""


def rotation_from_rest(rest_matrix, rest_direction, direction):
    if rest_direction.length < 1e-8 or direction.length < 1e-8:
        raise ValueError("骨骼端点重合，无法计算姿态")
    return (rest_direction.normalized().rotation_difference(direction.normalized())
            @ rest_matrix.to_quaternion())
