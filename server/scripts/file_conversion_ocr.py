"""只读本地扫描页，使用镜像内置的OCR模型；不下载模型、不调用外部服务。"""
import json
from pathlib import Path
import sys

# 独立安装目录避免覆盖现有Python/Blender依赖；本地开发可用独立venv。
package_dir = Path("/opt/file-conversion-ocr")
if package_dir.is_dir():
    sys.path.insert(0, str(package_dir))

from rapidocr_onnxruntime import RapidOCR
import rapidocr_onnxruntime
import onnxruntime

onnxruntime.disable_telemetry_events()


def recognize(manifest_path, output_path):
    model_root = Path(rapidocr_onnxruntime.__file__).parent / "models"
    names = ("ch_PP-OCRv4_det_infer.onnx", "ch_ppocr_mobile_v2.0_cls_infer.onnx", "ch_PP-OCRv4_rec_infer.onnx")
    if not all((model_root / name).is_file() for name in names):
        raise RuntimeError("镜像内OCR模型缺失，已停止；不会联网下载")
    # 固定CPU线程数，避免抢占整机；模型随固定版本wheel提供。
    engine = RapidOCR(det_limit_side_len=2048, max_side_len=4096,
                      intra_op_num_threads=2, inter_op_num_threads=1,
                      det_model_path=str(model_root / names[0]),
                      cls_model_path=str(model_root / names[1]),
                      rec_model_path=str(model_root / names[2]))
    items = json.loads(Path(manifest_path).read_text(encoding="utf-8"))
    pages, confidences, warnings, lines_by_page = [], [], [], []
    for index, item in enumerate(items):
        if item.get("text", "").strip():
            pages.append(item["text"])
            confidences.append(100)
            lines_by_page.append([])
            continue
        result, _ = engine(item["image"])
        if not result:
            raise RuntimeError(f"第{index + 1}页没有识别出文字，未生成缺页文档")
        lines = [{"box": box, "text": text, "confidence": float(score)} for box, text, score in result]
        mean = sum(line["confidence"] for line in lines) / len(lines)
        # 置信度只用于拒绝明显不可用的结果，不能当作全文正确性证明。
        if mean < 0.85:
            raise RuntimeError(f"第{index + 1}页识别可靠性不足，未交付乱码文档，请使用清晰原件")
        text_lines = []
        for line in lines:
            text = line["text"]
            if line["confidence"] < 0.90:
                text = f"〔识别待核：{text}〕"
                warnings.append(f"第{index + 1}页有低置信度文字，请对照原件")
            text_lines.append(text)
        pages.append("\n".join(text_lines))
        confidences.append(round(mean * 100, 2))
        lines_by_page.append(lines)
    Path(output_path).write_text(json.dumps({"pages": pages, "confidences": confidences,
                                            "warnings": sorted(set(warnings)), "lines": lines_by_page},
                                           ensure_ascii=False), encoding="utf-8")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("需要扫描页清单与结果文件路径")
    recognize(sys.argv[1], sys.argv[2])
