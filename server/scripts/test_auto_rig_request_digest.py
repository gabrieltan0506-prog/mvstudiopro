"""
0917 检查↔绑定契约摘要（纯 python3，不开 Blender）：
python3 server/scripts/test_auto_rig_request_digest.py
"""
import importlib.util
from pathlib import Path

here = Path(__file__).parent
spec = importlib.util.spec_from_file_location("run_manhua_auto_rig", here / "run_manhua_auto_rig.py")
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)
d = runner.request_digest

SHA = "826e0607858c505b300c42191e00a21de1a5d613ff00a303958b69fb5f35946a"
base = {"pose": "A", "forwardAxis": "+X", "targetHeight": 1.7}
# 同文件同设置：跨调用、大小写 SHA、1.7 与 1.70 都相同
assert d(SHA, base) == d(SHA, dict(base)) == d(SHA.upper(), {**base, "targetHeight": 1.70})
# 任一项变都不同（坏例必须红）
assert d(SHA, base) != d("0" * 64, base)
assert d(SHA, base) != d(SHA, {**base, "pose": "T"})
assert d(SHA, base) != d(SHA, {**base, "forwardAxis": "-Y"})
assert d(SHA, base) != d(SHA, {**base, "targetHeight": 1.75})
# 代理参数版本进摘要：改常量即失配
saved = runner.REQUEST_DIGEST_VERSION
before = d(SHA, base)
runner.REQUEST_DIGEST_VERSION = saved + "|x"
assert d(SHA, base) != before
runner.REQUEST_DIGEST_VERSION = saved
assert d(SHA, base) == before
assert len(d(SHA, base)) == 64
print("test_auto_rig_request_digest OK")
