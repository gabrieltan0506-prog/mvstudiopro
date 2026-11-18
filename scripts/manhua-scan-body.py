"""从公开报道 HTML 的正文容器提取段落。只使用 Python 标准库。"""
from html.parser import HTMLParser
import re
import sys


class ArticleParser(HTMLParser):
    void = set("area base br col embed hr img input link meta param source track wbr".split())
    excluded = set("nav header footer aside form button script style template noscript a h1 h2 h3 h4 h5 h6".split())

    def __init__(self):
        super().__init__()
        self.stack = []
        self.paragraphs = []
        self.headings = []

    def handle_starttag(self, tag, attrs):
        if tag in self.void:
            return
        attrs = dict(attrs)
        classes = (attrs.get("class") or "").split()
        body, skip, paragraph, heading = self.stack[-1][1:] if self.stack else (False, False, None, None)
        body = body or tag == "article" or attrs.get("itemprop") == "articleBody" or any(
            c.startswith("cententWrap__") for c in classes
        )
        skip = skip or tag in self.excluded or attrs.get("role") == "navigation" or "hidden" in attrs or attrs.get("aria-hidden") == "true"
        if tag in ("title", "h1"):
            heading = []
            self.headings.append(heading)
        if tag == "p" and body and not skip:
            paragraph = []
            self.paragraphs.append(paragraph)
        self.stack.append((tag, body, skip, paragraph, heading))

    def handle_endtag(self, tag):
        for i in range(len(self.stack) - 1, -1, -1):
            if self.stack[i][0] == tag:
                del self.stack[i:]
                break

    def handle_data(self, data):
        if self.stack:
            _, _, skip, paragraph, heading = self.stack[-1]
            if heading is not None:
                heading.append(data)
            if paragraph is not None and not skip:
                paragraph.append(data)


def extract(html):
    parser = ArticleParser()
    parser.feed(html)
    parser.close()
    headings = [" ".join("".join(parts).split()) for parts in parser.headings]
    error = re.compile(r"安全验证|访问验证|人机验证|访问被拒|页面不存在|网页不存在|访问受限|验证码|just a moment|access denied|verify you are human|checking your browser|page not found|bad gateway|service unavailable|^\s*(?:403|404|493|500|502|503)\b", re.I)
    if any(error.search(h) for h in headings):
        raise ValueError("验证页或错误页")
    for parts in parser.paragraphs:
        text = " ".join("".join(parts).split())
        if len(text) > 40 and re.search(r"[。！？；]", text) and not error.search(text) and not any(text in h for h in headings):
            return text[:4000]
    raise ValueError("没有可核验的正文段落")


if __name__ == "__main__":
    try:
        print(extract(sys.stdin.read()))
    except ValueError as exc:
        sys.exit(str(exc))
