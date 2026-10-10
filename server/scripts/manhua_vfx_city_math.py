"""有界街区翻折参数；只接受程序场景，不接任意脚本或外部资产路径。"""
def validate_city(params, duration):
    from manhua_vfx_math import keys, number
    keys(params, ('blocks','foldDeg','foldStartSec','foldEndSec','streetWidth','buildingHeight','lensMm'))
    for key,lo,hi in (('blocks',2,6),('foldDeg',30,150),('foldStartSec',0,30),('foldEndSec',0,30),
                      ('streetWidth',4,12),('buildingHeight',5,20),('lensMm',24,65)):
        number(params[key],lo,hi,key)
    if not isinstance(params['blocks'],int):raise ValueError('楼群数量须为整数')
    if not params['foldStartSec']<params['foldEndSec']<duration:
        raise ValueError('翻折结束须晚于开始并早于图层结束')


def city_angle(age, params):
    q=max(0.,min(1.,(age-params['foldStartSec'])/(params['foldEndSec']-params['foldStartSec'])))
    return params['foldDeg']*q*q*(3-2*q)
