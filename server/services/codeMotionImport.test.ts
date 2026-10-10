import { expect, it, vi } from "vitest";
import {
  importCodeMotionFile,
  type CodeMotionImportDeps,
} from "./codeMotionImport";
function deps(buffer: Buffer): CodeMotionImportDeps {
  return {
    resolve: async () => "gs://test/uploads/u1/test",
    read: async () => buffer,
    extract: vi.fn(),
    archive: vi.fn(),
  };
}
it("MD完整展示供选择，4000字以上不自动截断", async () => {
  const buffer = Buffer.from("全文".repeat(2500));
  const result = await importCodeMotionFile(
    "1",
    { name: "材料.md", bytes: buffer.length, gcsUri: "gs://test/source" },
    deps(buffer)
  );
  expect(result.kind).toBe("document");
  expect(result.kind === "document" && result.text.length).toBe(5000);
});
it("文档实际大小和UTF8错误必须拒绝", async () => {
  const buffer = Buffer.from([255, 0]);
  await expect(
    importCodeMotionFile(
      "1",
      { name: "材料.md", bytes: 1, gcsUri: "gs://test/source" },
      deps(buffer)
    )
  ).rejects.toThrow("大小");
  await expect(
    importCodeMotionFile(
      "1",
      { name: "材料.md", bytes: 2, gcsUri: "gs://test/source" },
      deps(buffer)
    )
  ).rejects.toThrow("UTF-8");
});
it("PDF元数据回退不能冒充读到正文，且拒绝伪后缀", async () => {
  const buffer = Buffer.from("%PDF-test");
  const d = deps(buffer);
  d.extract = vi
    .fn()
    .mockResolvedValue({ text: "PDF metadata only", method: "pdf_strings" });
  await expect(
    importCodeMotionFile(
      "1",
      { name: "材料.pdf", bytes: buffer.length, gcsUri: "gs://test/source" },
      d
    )
  ).rejects.toThrow("未进行文字辨识");
  await expect(
    importCodeMotionFile(
      "1",
      { name: "材料.docx", bytes: buffer.length, gcsUri: "gs://test/source" },
      d
    )
  ).rejects.toThrow("不是有效 DOCX");
});
it("图片真实解码再归档，伪装成PNG的文字不得进入方案", async () => {
  const buffer = Buffer.from("not png");
  const d = deps(buffer);
  await expect(
    importCodeMotionFile(
      "1",
      { name: "图.png", bytes: buffer.length, gcsUri: "gs://test/source" },
      d
    )
  ).rejects.toThrow();
  expect(d.archive).not.toHaveBeenCalled();
});
