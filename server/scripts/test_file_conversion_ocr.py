"""OCR质量守门测试；不生成图像，不访问网络，只检查低置信度与缺页处理。"""
import importlib.util
from pathlib import Path
import json
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("conversion_ocr", Path(__file__).with_name("file_conversion_ocr.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class OcrQualityContract(unittest.TestCase):
    def run_case(self, lines):
        with tempfile.TemporaryDirectory() as temp:
            source = Path(temp) / "input.json"
            output = Path(temp) / "output.json"
            source.write_text(json.dumps([{"image": "test-only-no-image"}, {"text": "原有文字层"}]))
            with patch.object(module, "RapidOCR", return_value=lambda _: (lines, [])):
                module.recognize(source, output)
            return json.loads(output.read_text())

    def test_low_confidence_is_retained_and_marked(self):
        result = self.run_case([[[[0, 0]] * 4, "清晰正文", 0.99], [[[0, 0]] * 4, "模糊专名", 0.80]])
        self.assertEqual(len(result["pages"]), 2)
        self.assertIn("〔识别待核：模糊专名〕", result["pages"][0])
        self.assertEqual(result["pages"][1], "原有文字层")
        self.assertTrue(result["warnings"])

    def test_empty_or_unreliable_page_fails(self):
        with self.assertRaisesRegex(RuntimeError, "没有识别出文字"):
            self.run_case([])
        with self.assertRaisesRegex(RuntimeError, "识别可靠性不足"):
            self.run_case([[[[0, 0]] * 4, "乱码", 0.50]])


if __name__ == "__main__":
    unittest.main()
