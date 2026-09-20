import { afterEach, expect, it, vi } from "vitest";
import { formatWorkbenchSegmentClipInjectBlock } from "@shared/manhuaScriptWorkbench";
import { previewCanvasBlockOutbound } from "./canvasRunBlock";
import { defaultCanvasBlock } from "./canvasTypes";

afterEach(() => vi.unstubAllGlobals());
it("具名多轮对白到真实出站预览仍分人分句，零网络", async () => {
  const network = vi.fn(() => { throw new Error("离线探针禁止网络"); });
  vi.stubGlobal("fetch", network);
  const prompt = formatWorkbenchSegmentClipInjectBlock({
    shots: [{ index: 1, durationSec: 4, cameraZh: "中景固定", actionZh: "甲背娘缓慢走路", dialogueZh: "娘：「慢点。」；甲：「好，我扶着您。」" }],
    durationSec: 4, segmentIndex: 1, totalSegments: 1,
  });
  const preview = await previewCanvasBlockOutbound({ userRole: "admin", optimizeCopy: async () => "" }, {
    ...defaultCanvasBlock("video", 0, 0), id: "clip-e01-g01",
    videoModel: "seedance-2.5", prompt, refImageUrl: "https://test.invalid/identity.png",
  });
  expect(network).not.toHaveBeenCalled();
  expect(preview.body.prompt).toMatch(/娘(?:以[^说]+)?说\{慢点。\}/);
  expect(preview.body.prompt).toMatch(/甲(?:以[^说]+)?说\{好，我扶着您。\}/);
  expect(preview.body.prompt).not.toContain("说{娘");
  expect(preview.body.prompt).toContain("0–2s");
  expect(preview.body.prompt).toContain("2–4s");
});

it.each<{ name: string; dialogue: string | undefined; lines: string[] | undefined; map: Record<string, string>; expected: string[]; texts: string[] }>([
  { name: "无备用表、具名已映射", dialogue: "娘：「慢点。」", lines: undefined, map: { 娘: "@角色2", 甲: "@角色1" }, expected: ["@角色2"], texts: ["慢点。"] },
  { name: "有备用表、具名未映射", dialogue: "娘：「慢点。」", lines: ["备用台词"], map: {}, expected: ["娘"], texts: ["慢点。"] },
  { name: "有备用表、多说话人分别映射", dialogue: "娘：「慢点。」；甲：「好。」", lines: ["备用台词"], map: { 娘: "@角色2", 甲: "@角色1" }, expected: ["@角色2", "@角色1"], texts: ["慢点。", "好。"] },
  { name: "备用表补缺、多人未映射", dialogue: undefined, lines: ["娘：「慢点。」；甲：「好。」"], map: {}, expected: ["娘", "甲"], texts: ["慢点。", "好。"] },
  { name: "旧裸台词", dialogue: "慢点。", lines: undefined, map: {}, expected: [], texts: ["慢点。"] },
])("$name 到真实出站保留身份与原文", async row => {
  const network = vi.fn(() => { throw new Error("离线探针禁止网络"); });
  vi.stubGlobal("fetch", network);
  const prompt = formatWorkbenchSegmentClipInjectBlock({ shots: [{ index: 1, durationSec: 4, cameraZh: "中景固定", actionZh: "静立", dialogueZh: row.dialogue }], durationSec: 4, segmentIndex: 1, totalSegments: 1, segmentDialogueLines: row.lines, speakerTagByNameZh: row.map });
  const preview = await previewCanvasBlockOutbound({ userRole: "admin", optimizeCopy: async () => "" }, { ...defaultCanvasBlock("video", 0, 0), id: "clip-e01-g01", videoModel: "seedance-2.5", prompt, refImageUrl: "https://test.invalid/identity.png" });
  const text = String(preview.body.prompt);
  for (const identity of row.expected) expect(text).toContain(`${identity}说{`);
  for (const line of row.texts) expect(text).toContain(`{${line}}`);
  expect(text).not.toContain("备用台词");
  expect(network).not.toHaveBeenCalled();
});

it("静音覆盖优先于原对白、备用对白及额外轮次", async () => {
  const network = vi.fn(() => { throw new Error("离线探针禁止网络"); });
  vi.stubGlobal("fetch", network);
  const prompt = formatWorkbenchSegmentClipInjectBlock({ shots: [{ index: 1, durationSec: 4, cameraZh: "中景固定", actionZh: "静立", dialogueZh: "娘：「慢点。」", dialogueSuppressed: true, additionalDialogueCues: [{ dialogueZh: "甲：「好。」" }] }], durationSec: 4, segmentIndex: 1, totalSegments: 1, segmentDialogueLines: ["备用台词", "额外台词"] });
  const preview = await previewCanvasBlockOutbound({ userRole: "admin", optimizeCopy: async () => "" }, { ...defaultCanvasBlock("video", 0, 0), id: "clip-e01-g01", videoModel: "seedance-2.5", prompt, refImageUrl: "https://test.invalid/identity.png" });
  expect(preview.body.prompt).not.toMatch(/慢点|好。|备用台词|额外台词|说\{/);
  expect(network).not.toHaveBeenCalled();
});

it.each(["墨屠（肩伤）", "墨屠(肩伤)", "墨屠/黑衣客", "来自北境守夜军团的第一任统领"])("无fallback时保留完整署名 %s，不能混入朗读", async identity => {
  const network = vi.fn(() => { throw new Error("离线探针禁止网络"); });
  vi.stubGlobal("fetch", network);
  const prompt = formatWorkbenchSegmentClipInjectBlock({ shots: [{ index: 1, durationSec: 4, cameraZh: "中景固定", actionZh: "静立", dialogueZh: `${identity}：「退后。」；娘：「慢点。」` }], durationSec: 4, segmentIndex: 1, totalSegments: 1 });
  const preview = await previewCanvasBlockOutbound({ userRole: "admin", optimizeCopy: async () => "" }, { ...defaultCanvasBlock("video", 0, 0), id: "clip-e01-g01", videoModel: "seedance-2.5", prompt, refImageUrl: "https://test.invalid/identity.png" });
  expect(preview.body.prompt).toContain(`${identity}说{退后。}`);
  expect(preview.body.prompt).toContain("娘说{慢点。}");
  expect(preview.body.prompt).not.toContain(`说{${identity}`);
  expect(network).not.toHaveBeenCalled();
});
