"""
0917 朝向判定噪声线（不开 Blender，纯 python3 可跑）：
0916 阿菁 A-pose 线上真跑 feetForwardMeters = -0.0104（1 厘米）被判「背对 +X」，正面预览却是正脸。
用法：python3 server/scripts/test_auto_rig_orientation.py
"""
import importlib.util
from pathlib import Path

here = Path(__file__).parent
spec = importlib.util.spec_from_file_location("run_manhua_auto_rig", here / "run_manhua_auto_rig.py")
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)
verdict = runner.orientation_verdict

# 线上真值：1 厘米在 1.7 m 身高的 2%（3.4 cm）噪声线内 → 不判朝向，但要留一句提示
real = verdict(-0.0104, 0.3987, 0.793, 1.7)
assert real["suspect"] is False, real
assert real["noiseFloorMeters"] == 0.034, real
assert real["reasons"] == [] and len(real["notes"]) == 1 and "正面预览" in real["notes"][0], real
# 反例必须红：明显在躯干后方（10 cm）→ 仍判背对
back = verdict(-0.10, 0.3987, 0.793, 1.7)
assert back["suspect"] is True and any("背对" in r for r in back["reasons"]) and back["notes"] == [], back
# 刚好压线外一点点 → 判；压线内 → 不判（阈值先写死，不拿被测对象自证）
assert verdict(-0.0341, 0.4, 0.8, 1.7)["suspect"] is True
assert verdict(-0.0339, 0.4, 0.8, 1.7)["suspect"] is False
# 正向也在噪声线内 → 同样只提示不判
assert verdict(0.01, 0.4, 0.8, 1.7)["suspect"] is False and verdict(0.01, 0.4, 0.8, 1.7)["notes"]
# 90° 错误（深度 ≥ 宽度）与噪声线无关，照判
side = verdict(0.05, 0.9, 0.4, 1.7)
assert side["suspect"] is True and any("90°" in r for r in side["reasons"]), side
print("test_auto_rig_orientation OK")
