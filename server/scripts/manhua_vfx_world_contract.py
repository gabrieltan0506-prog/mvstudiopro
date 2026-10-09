"""与共享schema一致的三维路线/受光输入门禁，不接受可执行配置。"""
from manhua_vfx_math import keys, number


def validate_world_options(world, bindings):
    render=world.get('render')
    if render is not None:
        keys(render,('quality','samples','exposure','keyEnergy','fillRatio','exportLayers'))
        if render['quality'] not in ('preview','beauty') or type(render['exportLayers']) is not bool:
            raise ValueError('三维画质或分层选项无效')
        if type(render['samples']) is not int:raise ValueError('采样数必须是整数')
        if render['exportLayers'] and render['quality']!='beauty':raise ValueError('分层输出须选择精细受光')
        for name,lo,hi in [('samples',16,64),('exposure',-2,2),('keyEnergy',100,3000),('fillRatio',0,1)]:
            number(render[name],lo,hi,name)
    if world.get('environment') is not None:
        import re
        environment=world['environment']
        keys(environment,('worldTaskId','sceneRef','sourceVersion'))
        if not re.fullmatch(r'mw_[a-f0-9]{24}',str(environment['worldTaskId'])) or not isinstance(environment['sceneRef'],str) or not 1<=len(environment['sceneRef'])<=160 or not isinstance(environment['sourceVersion'],str) or not 1<=len(environment['sourceVersion'])<=4096:
            raise ValueError('正式场景版本绑定无效')
        if not render or render['quality']!='beauty' or render['exportLayers']:
            raise ValueError('正式3DGS场景须使用完整材质且关闭同场分层下载')
    choreography=world.get('choreography')
    if choreography is None:return
    keys(choreography,('clearanceMeters','routes'))
    number(choreography['clearanceMeters'],.01,.5,'clearanceMeters')
    routes=choreography['routes']
    if not isinstance(routes,list) or not 1<=len(routes)<=6:raise ValueError('穿行角色数量无效')
    if not isinstance(bindings,list) or not bindings:raise ValueError('穿行缺少服务端角色身份')
    identities={row.get('actorId') for row in bindings};seen=set()
    for route in routes:
        keys(route,('actorId','points'))
        actor=route['actorId'];points=route['points']
        if not isinstance(actor,str) or not 1<=len(actor)<=100 or actor not in identities or actor in seen:
            raise ValueError('穿行角色不属于原场景或身份重复')
        seen.add(actor)
        if not isinstance(points,list) or not 2<=len(points)<=12:raise ValueError('路线节点数量无效')
        previous=-1
        for point in points:
            keys(point,('timeSec','position','facingDeg'))
            time=number(point['timeSec'],0,30,'timeSec')
            if abs(time*24-round(time*24))>1e-6 or time<=previous:raise ValueError('路线秒位须按24帧对齐并递增')
            previous=time
            if not isinstance(point['position'],list) or len(point['position'])!=2:raise ValueError('路线须为地面二维坐标')
            for value in point['position']:number(value,-12,12,'position')
            number(point['facingDeg'],-180,180,'facingDeg')
        if not any(abs(p['position'][i]-points[0]['position'][i])>.01 for p in points for i in range(2)):
            raise ValueError('穿行路线缺少实际位移')
