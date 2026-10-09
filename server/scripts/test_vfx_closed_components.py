"""纯几何内存验证：间隙、包含、相交、UV缝与不闭合回退；无媒体生成。"""
from manhua_vfx_world_quality import closed_component_bounds, aabb_distance

faces = [[0,3,2,1],[4,5,6,7],[0,1,5,4],[1,2,6,5],[2,3,7,6],[3,0,4,7]]
def cube(x, size=.5):
    return [(x+a*size,b*size,c*size) for a,b,c in [(-1,-1,-1),(1,-1,-1),(1,1,-1),(-1,1,-1),(-1,-1,1),(1,-1,1),(1,1,1),(-1,1,1)]]
points=cube(-2)+cube(2)
polygons=faces+[[v+8 for v in f] for f in faces]
components=closed_component_bounds(points,polygons)
assert len(components)==2
fragment=closed_component_bounds(cube(0,.25),faces)[0]
assert min(aabb_distance(a,fragment) for a in components)==1.25
# 碎片完全包在实体内、只跨过表面和相切均不能过净空。
for x,size in [(-2,.1),(-1.5,.2),(-1.25,.25)]:
    enclosed=closed_component_bounds(cube(x,size),faces)[0]
    assert min(aabb_distance(a,enclosed) for a in components)==0
# glTF每面独立顶点仍须焊接回闭合体，不得把六张面当六个薄盒。
split_points=[];split_faces=[]
for face in polygons:
    start=len(split_points);split_points.extend(points[index] for index in face)
    split_faces.append(list(range(start,start+len(face))))
assert closed_component_bounds(split_points,split_faces)==components
# 开口与非流形都回退整体盒：保持原保守门禁，不以部件拆分放过包含。
for bad in [polygons[:-1],polygons+[polygons[0]]]:
    result=closed_component_bounds(points,bad)
    assert len(result)==1 and aabb_distance(result[0],fragment)==0
print('CLOSED_COMPONENT_BOUNDS_PASS: gap/containment/intersection/touch/UV seams/open/nonmanifold')
