"""镜头移动与焦距分别卡点；旧配置仍按整镜平滑起停。"""
import math

def camera_progress(shot, frame, key='motionWindow'):
    window = shot.get(key) or shot
    begin = math.floor(window['startSec'] * 24 + .5) + 1
    end = math.floor(window['endSec'] * 24 + .5)
    progress = max(0., min(1., (frame - begin) / max(1, end - begin)))
    return progress * progress * (3 - 2 * progress)
