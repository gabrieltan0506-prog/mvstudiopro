"""用镜像已有 OpenCV 与随源码固定的 YuNet 定位人脸；运行时不联网。"""
import hashlib
import json
from pathlib import Path
import sys

if Path('/opt/file-conversion-ocr').is_dir():
    sys.path.insert(0, '/opt/file-conversion-ocr')
import cv2

cv2.setNumThreads(1)
model = Path(__file__).resolve().parent.parent / 'models' / 'cover-face' / 'yunet.onnx'
manifest = json.loads((model.parent / 'manifest.json').read_text())
if hashlib.sha256(model.read_bytes()).hexdigest() != manifest['sha256']:
    raise RuntimeError('人脸定位模型校验失败')
source = cv2.imread(sys.argv[1])
if source is None:
    raise RuntimeError('无法读取封面')
h, w = source.shape[:2]
scale = min(1.0, 1400 / max(w, h))
small = cv2.resize(source, (round(w * scale), round(h * scale)))
detector = cv2.FaceDetectorYN.create(str(model), '', (small.shape[1], small.shape[0]), 0.85, 0.3, 100)
_, faces = detector.detect(small)
regions = []
if faces is not None:
    for face in faces:
        x, y, bw, bh = [float(n) for n in face[:4]]
        x1, y1 = max(0.0, x / small.shape[1]), max(0.0, y / small.shape[0])
        x2, y2 = min(1.0, (x + bw) / small.shape[1]), min(1.0, (y + bh) / small.shape[0])
        if x2 > x1 and y2 > y1:
            regions.append([x1, y1, x2 - x1, y2 - y1])
print(json.dumps({'method': 'opencv-yunet-2026may', 'modelSha256': manifest['sha256'], 'regions': regions}))
