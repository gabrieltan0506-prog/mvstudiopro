// Only the in-memory OLE parser is bundled; no filesystem or DOCX ZIP parser.
const WordOleExtractor = require("word-extractor/lib/word-ole-extractor");
const BufferReader = require("word-extractor/lib/buffer-reader");
self.onmessage = async (event: MessageEvent<ArrayBuffer>) => {
  try {
    const bytes = Buffer.from(event.data);
    if (bytes.subarray(0, 8).toString("hex") !== "d0cf11e0a1b11ae1")
      throw new Error("DOC 文件格式无法读取。");
    const result = await new WordOleExtractor().extract(
      new BufferReader(bytes)
    );
    const sections = [
      result.getBody(),
      result.getFootnotes(),
      result.getEndnotes(),
      result.getTextboxes(),
    ].filter((s: string) => s?.trim());
    const text = sections.join("\n\n");
    if (text.length > 400000) throw new Error("原文超过40万字符，请分卷导入。");
    self.postMessage({ text });
  } catch {
    self.postMessage({ error: "DOC 无法完整读取，请另存为 DOCX 后导入。" });
  }
};
