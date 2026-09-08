import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";

const source = ts.createSourceFile("PlatformPage.tsx", readFileSync("client/src/pages/PlatformPage.tsx", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function find(predicate: (node: ts.Node) => boolean) {
  let result: ts.Node | undefined;
  function walk(node: ts.Node) { if (result) return; if (predicate(node)) result = node; else ts.forEachChild(node, walk); }
  walk(source); if (!result) throw Error("真实父页入口未找到"); return result;
}
function handler(tag: string, text: string, attr = "onChange") {
  const node = find(node => (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) && node.tagName.getText(source) === tag && node.getText(source).includes(text)) as ts.JsxSelfClosingElement;
  const attribute = node.attributes.properties.find(property => ts.isJsxAttribute(property) && property.name.getText(source) === attr) as ts.JsxAttribute;
  const expression = (attribute.initializer as ts.JsxExpression).expression;
  if (!expression) throw Error("入口回调缺失"); return expression;
}
function declared(name: string) { return (find(node => ts.isVariableDeclaration(node) && node.name.getText(source) === name) as ts.VariableDeclaration).initializer!; }
function execute(expression: ts.Node, scope: Record<string, unknown>) {
  const compiled = ts.transpileModule(`const handler = ${expression.getText(source)};`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  return new Function(...Object.keys(scope), `${compiled}\nreturn handler;`)(...Object.values(scope));
}
describe("父页真实知识卡入口统一全文阅读", () => {
  it("上传器把大小PDF原文件完整交给阅读入口，不抽文本或买图", async () => {
    const start = vi.fn(async (..._args: any[]) => {});
    const onUpload = execute(handler("input", 'accept=".md,.txt,.pdf'), { startKnowledgeReadingFiles: start });
    const files = [new File(["测试小PDF"], "small.pdf"), new File(["x".repeat(1_500_000)], "large.pdf")];
    const event = { target: { files, value: "原选择" } };
    onUpload(event);
    expect(start).toHaveBeenCalledWith(files);
    expect(start.mock.calls[0][0][0]).toBe(files[0]);
    expect(event.target.value).toBe("");
  });
  it("长正文保留完整文本，不能输入时切成旧分框流水线", () => {
    const setText = vi.fn(); const setOrigin = vi.fn();
    const onChange = execute(handler("textarea", "value={customNoteText}"), { setCustomNoteText: setText, setCustomNoteSourceFromDocument: setOrigin });
    const text = "甲".repeat(100_001);
    onChange({ target: { value: text } });
    expect(setText).toHaveBeenCalledWith(text);
    expect(setOrigin).toHaveBeenCalledWith(false);
  });
  it("校对应用不截断、不触发付费生成", () => {
    const setText = vi.fn();
    execute(handler("KnowledgeCardTextReviewPanel", "/text-review/single", "onApply"), { setCustomNoteText: setText })("甲".repeat(100_001));
    expect(setText.mock.calls[0][0]).toHaveLength(100_001);
  });
  it("正文生成与资产按钮都先阅读全文，不走旧上/下篇出图", async () => {
    const start = vi.fn(async (..._args: any[]) => {});
    const generate = execute(declared("handleGenerateCustomNote"), { customNoteBusy: false, customNoteKind: "single_page_knowledge_card", customNoteText: "完整正文", startKnowledgeReadingText: start });
    await generate();
    const asset = execute(declared("handleAssetGenerateFromText"), { useCallback: (fn: unknown) => fn, generateCustomNoteOne: () => { throw Error("不能直接出图"); }, mapCustomNoteError: () => "", startKnowledgeReadingText: start });
    const text = "甲".repeat(20_000);
    await asset(text, "single_page_knowledge_card");
    expect(start.mock.calls).toEqual([["完整正文"], [text, { fromDocument: true }]]);
  });
  it("EPUB自动准备完整PDF后走同一上传与阅读入口，不要求用户下载重传", async () => {
    const pdfFiles = [new File(["离线测试PDF1"], "第一部分.pdf"), new File(["离线测试PDF2"], "第二部分.pdf")];
    const prepare = vi.fn(async () => pdfFiles);
    const upload = vi.fn(async ({file}: {file: File}) => `gs://test-bucket/uploads/u7/${file.name}`);
    const finish = vi.fn(async () => {});
    const noop = () => {};
    const start = execute(declared("startKnowledgeReadingFiles"), {
      withReadingOperation: (action: () => Promise<void>) => action(), user: {id: 7},
      readingSessionRef: {current: null}, readingAccountRef: {current: 7},
      setCustomNoteUploadBusy: noop, setCustomNoteUploadStatus: noop, prepareKnowledgeCardEpubFiles: prepare,
      prepareEpubPdfMutation: {mutateAsync: vi.fn()}, uploadKnowledgeCardFileToGcs: upload,
      getUploadUrlMutation: {mutateAsync: vi.fn()}, saveReading: (value: unknown) => value,
      customNoteDistillModel: "gpt-5.6-sol", customNoteImages: [], customNoteImageUpper: null, customNoteImageLower: null,
      setCustomNoteKind: noop, setOutputType: noop, finishReadingPlan: finish,
    });
    const epub = new File(["离线EPUB"], "电子书.epub");
    await start([epub]);
    expect(prepare).toHaveBeenCalledWith(expect.objectContaining({file: epub, userId: 7}));
    expect(upload.mock.calls.map(([value]) => value.file)).toEqual(pdfFiles);
    expect(finish).toHaveBeenCalledWith(expect.objectContaining({files: [
      {gcsUri: "gs://test-bucket/uploads/u7/第一部分.pdf", mimeType: "application/pdf", fileName: "第一部分.pdf"},
      {gcsUri: "gs://test-bucket/uploads/u7/第二部分.pdf", mimeType: "application/pdf", fileName: "第二部分.pdf"},
    ], pending: "reading"}));
  });
});
