"""高级网格完整投影与独立拓扑预算；不采样或丢弃任何顶点。"""
import math

# 旧2700人帧只覆盖程序白模。本门禁另限制实际顶点×帧×最坏构图扫描次数。
# 这是保守的资源保护值，不是Linux600秒性能承诺；实测通过后才能扩大。
MAX_PROJECTION_WORK = 12_000_000


def validate_projection_work(vertices, frames, portrait):
    if type(vertices) is not int or vertices < 0 or type(frames) is not int or not 48 <= frames <= 720:
        raise ValueError("角色拓扑预算参数无效")
    passes = 3 if portrait else 1
    units = vertices * frames * passes
    if units > MAX_PROJECTION_WORK:
        raise ValueError("高级模型投影量%d超过%d顶点帧，请降低模型顶点数、缩短片段或改用横屏；未开始模型动画与渲染" % (units, MAX_PROJECTION_WORK))
    return units


def make_projector(scene, camera):
    """每帧固定相机矩阵与视锥；逐点只做局部坐标变换和透视除法。"""
    from mathutils import Vector
    inverse = camera.matrix_world.normalized().inverted()
    corners = camera.data.view_frame(scene=scene)
    perspective = camera.data.type != "ORTHO"
    xs = [p.x / -p.z if perspective else p.x for p in corners]
    ys = [p.y / -p.z if perspective else p.y for p in corners]
    left, bottom = min(xs), min(ys)
    width, height = max(xs) - left, max(ys) - bottom
    if not all(math.isfinite(n) for n in (left, bottom, width, height)) or width <= 0 or height <= 0:
        raise ValueError("相机投影范围无效")

    def project(point):
        local = inverse @ point
        depth = -local.z
        if perspective and depth == 0:
            return Vector((.5, .5, 0))
        scale = depth if perspective else 1
        return Vector(((local.x / scale - left) / width, (local.y / scale - bottom) / height, depth))

    return project
