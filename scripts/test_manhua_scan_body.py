"""验证 HTML 正文与伪成功页面的边界。"""
from pathlib import Path
import runpy
import unittest

extract = runpy.run_path(str(Path(__file__).with_name("manhua-scan-body.py")))["extract"]
paragraph = "这是一段用于测试的报道正文，记录作品的上线时间、统计周期与样本来源。" * 2


class BodyExtractionTest(unittest.TestCase):
    def test_article_and_publisher_container(self):
        for root in ('article', 'div class="cententWrap__hash"'):
            html = f'<{root}><nav><p>{paragraph}导航</p></nav><h1>标题</h1><p>{paragraph}</p></{root.split()[0]}>'
            self.assertEqual(extract(html), paragraph)

    def test_rejects_empty_navigation_title_and_challenge(self):
        for html in (
            f"<title>{paragraph}</title><article><p>{paragraph}</p></article>",
            f"<article><p><a>{paragraph}</a></p></article>",
            f"<article><aside><p>{paragraph}</p></aside></article>",
            f"<title>404 Page not found</title><article><p>{paragraph}</p></article>",
            f"<h1>安全验证</h1><article><p>{paragraph}</p></article>",
            f"<p>{paragraph}</p>",
        ):
            with self.subTest(html=html), self.assertRaises(ValueError):
                extract(html)


if __name__ == "__main__":
    unittest.main()
