import { describe, expect, it } from "vitest";
import { parseWorkbenchShotsFromTextResult, groupShotsIntoSegments, formatWorkbenchSegmentClipInjectBlock, formatWorkbenchShotInjectBlock, hasExplicitManhuaShotBlocks } from "./manhuaScriptWorkbench";
import { buildManhuaEpisodeSegmentPlanFixtureMarkdown } from "./manhuaEpisodeSegmentPlan";
import { resolveShotsForEpisodeKeyarts, ensureManhuaFragmentClips, prepareManhuaFactoryClipInput } from "../client/src/lib/canvasDramaStudio";
import { defaultCanvasBlock } from "../client/src/lib/canvasTypes";
import { buildRoughCutClipsFromShots } from "./manhuaEditWorkflowBank";
import { buildManhuaSubtitleCues } from "./manhuaEditSubtitle";
import { normalizeManhuaRoughShotOrder } from "./manhuaEditOrder";
import { isManhuaKeyartLookCurrent, recordManhuaKeyartLookOutput } from "./manhuaKeyartLookState";

const source = `## 分镜
### 段01
1. **镜01｜中近景｜从先生肩后过肩看娘**
动作链：先生把药碗递到娘面前。
对手互动：阿菁伸手护住娘。
台词：先生：「先喝药。」
2. **镜02｜特写｜镜头随视线前推**
动作链：阿菁抬眼看先生。
台词：阿菁：「你想要什么？」
### 段02
1. **镜01｜近景｜固定机位**
动作链：墨屠停在门外。
台词：无
2. **镜02｜低机位仰拍｜门槛低视角**
动作链：墨屠跨过门槛，将伤肩送向先生。
道具入画：碗沿承接落下的血。
台词：墨屠：「用我的。」`;
function sourceBlocks() { return [{ ...defaultCanvasBlock("text", 0, 0), id: "reverse-e01-probe", episodeIndex: 1, outputText: source }]; }

describe("多行镜块真实消费", () => {
 it("正文其他章节的示例镜块不抢真实分镜区段表优先级", () => {
  const board = "### 段01\n- 本段意图：递药救人。\n- 人物：先生、娘。\n- 动作：先生递药，娘接住。\n### 段02\n- 本段意图：主动献血。\n- 人物：墨屠。\n- 动作：墨屠跨门。";
  const raw = `## 示例\n1. **镜01｜近景｜固定机位**\n动作链：示例动作不属于正文。\n\n## 分镜表\n${board}\n\n## 说明\n保留原段表。`;
  expect(hasExplicitManhuaShotBlocks(raw)).toBe(false);
  const read = (text: string) => resolveShotsForEpisodeKeyarts([{ ...sourceBlocks()[0]!, outputText: text }], 1);
  expect(read(raw)).toEqual(read(`## 分镜表\n${board}`));
 });
 it.each(["乱码XYZ", ""])("合法镜头后夹入无效摄影标题%s，不吞作上一镜动作或绕过旧段表", camera => {
  const mixed = `1. **镜01｜近景｜固定机位**\n动作链：先生递药。\n2. **镜02｜${camera}**\n动作链：娘接药。`;
  expect(hasExplicitManhuaShotBlocks(mixed)).toBe(false);
  expect(parseWorkbenchShotsFromTextResult(mixed).shots).toHaveLength(2);
  const oldPlan = buildManhuaEpisodeSegmentPlanFixtureMarkdown();
  const read = (text: string) => resolveShotsForEpisodeKeyarts([{ ...sourceBlocks()[0]!, outputText: text }], 1);
  expect(read(oldPlan + "\n" + mixed)).toHaveLength(read(oldPlan).length);
 });
 it("旧默认静帧和成片保留，但新正文改变源指纹后不再冒充已就绪", async () => {
  const oldSource = ["全景，平视，缓慢推近", "中景，固定机位，三分构图", "中近景，轻微横移", "特写，平视，微推"].map((camera, i) => `${i + 1}. ${camera}：旧标题${i + 1}`).join("\n");
  const oldBlocks = [{ ...sourceBlocks()[0]!, outputText: oldSource }, ...[1,2,3,4].map(index => ({ ...defaultCanvasBlock("image",0,0), id: `keyart-e01-s0${index}-restore`, episodeIndex: 1, outputUrl: `https://test.invalid/old-${index}.png`, outputUrls: [`https://test.invalid/history-${index}.png`] }))];
  const old = ensureManhuaFragmentClips(oldBlocks, [], 1, { videoModel: "seedance-2.5" });
  const saved = old.blocks.map(block => block.id.startsWith("keyart-") ? { ...block, manhuaKeyartSourceState: recordManhuaKeyartLookOutput({ manhuaKeyartLookState: block.manhuaKeyartSourceState }, block.outputUrl) } : block.id.startsWith("clip-") ? { ...block, outputUrl: "https://test.invalid/old-clip.mp4", outputUrls: ["https://test.invalid/history-clip.mp4"] } : block);
  const current = ensureManhuaFragmentClips(saved.map(block => block.id.startsWith("reverse-") ? { ...block, outputText: source } : block), old.edges, 1, { videoModel: "seedance-2.5" });
  for (const previous of saved.filter(block => block.outputUrl)) {
    const kept = current.blocks.find(block => block.id === previous.id)!;
    expect(kept.outputUrl).toBe(previous.outputUrl);
    expect(kept.outputUrls).toEqual(previous.outputUrls);
    if (kept.id.startsWith("keyart-")) {
      expect(isManhuaKeyartLookCurrent({ ...previous, manhuaKeyartLookState: previous.manhuaKeyartSourceState })).toBe(true);
      expect(isManhuaKeyartLookCurrent({ ...kept, manhuaKeyartLookState: kept.manhuaKeyartSourceState })).toBe(false);
      expect(kept.manhuaKeyartSourceState!.generatedFor).toBe(previous.manhuaKeyartSourceState!.generatedFor);
      expect(kept.manhuaKeyartSourceState!.required).not.toBe(previous.manhuaKeyartSourceState!.required);
    }
  }
  const clip = current.blocks.find(block => block.id.startsWith("clip-") && !block.archivedFromPreviousScript)!;
  await expect(prepareManhuaFactoryClipInput({ blocks: current.blocks, edges: current.edges, blockId: clip.id, fallbackBlock: clip, stage: "clip", episodeIndex: 1, preparedVideoEdit: false })).rejects.toThrow("原稿分镜已变更或旧图尚未核对原镜身份");
 });
 it("空镜块/乱码不覆盖旧段表，Markdown标签和显式时间不丢", () => {
  const oldPlan = buildManhuaEpisodeSegmentPlanFixtureMarkdown();
  const read = (text: string) => resolveShotsForEpisodeKeyarts([{ ...sourceBlocks()[0]!, outputText: text }], 1);
  const expected = read(oldPlan);
  for (const suffix of ["\n### 段01", "\n1. **镜01｜乱码XYZ**", "\n1. **镜01｜近景｜固定机位**\n**动作链**：\n**台词**：无"]) {
    expect(hasExplicitManhuaShotBlocks(suffix)).toBe(false);
    expect(read(oldPlan + suffix).length).toBe(expected.length);
  }
  const timed = parseWorkbenchShotsFromTextResult("1. **镜07（0–5s）｜近景｜固定机位**\n**动作链**：娘接住药碗。\n**台词**：娘：「谢谢。」\n2. **镜12｜低机位仰拍｜时长：7秒**\n**动作**：墨屠跨门。\n**对白**：墨屠：「我来。」");
  expect(timed.shots.map(s=>[s.index,s.durationSec])).toEqual([[1,5],[2,7]]);
  expect(timed.shots[0]!.dialogueZh).toContain("谢谢");
  expect(timed.shots[1]!.dialogueZh).toContain("我来");
  expect(timed.shots[0]!.actionZh).toContain("娘接住药碗");
 });
 it("原秒位表继续优先，不被附带镜块改写时间合同", () => {
  const text = "| 镜号 | 秒位 | 景别/运镜 | 画面 | 对白 |\n| 1 | 0–3s | 近景固定 | 推门 | 无 |\n| 2 | 3–8s | 低机位仰拍 | 跨门 | 我来。 |\n\n1. **镜01｜全景｜固定机位**\n动作链：附带示例。";
  const shots = parseWorkbenchShotsFromTextResult(text).shots;
  expect(shots.map(s=>s.durationSec)).toEqual([3,5]);
  expect(shots[0]!.actionZh).toBe("推门");
 });
 it("重复段内镜号不覆盖，标题摄影与完整正文分别进入字段", () => {
  const result = parseWorkbenchShotsFromTextResult(source);
  expect(result.isFallback).toBe(false);
  expect(result.shots.map(s => s.index)).toEqual([1,2,3,4]);
  expect(result.shots[0]).toMatchObject({ cameraZh: "中近景，从先生肩后过肩看娘", cameraAngleId: "ang_04_ots", dialogueZh: "先生：「先喝药。」" });
  expect(result.shots[0]!.actionZh).toContain("先生把药碗递到娘面前");
  expect(result.shots[0]!.actionZh).toContain("阿菁伸手护住娘");
  expect(result.shots[3]).toMatchObject({ cameraZh: "低机位仰拍，门槛低视角", cameraAngleId: "ang_02_low" });
  expect(result.shots[3]!.actionZh).toContain("碗沿承接落下的血");
  expect(result.shots[2]!.dialogueZh).toBeUndefined();
 });
 it("生产resolve→分段→静帧/成片消费者保留原机位且不拼默认镜头", () => {
  const shots = resolveShotsForEpisodeKeyarts(sourceBlocks(), 1);
  expect(shots).toHaveLength(4);
  const prompt = formatWorkbenchSegmentClipInjectBlock({segmentIndex:1,durationSec:20,shots:shots.map(s=>({...s,durationSec:5}))});
  expect(prompt).toContain("过肩");expect(prompt).toContain("低机位仰拍");
  expect(prompt).toContain("把药碗递到娘面前");expect(prompt).toContain("先喝药");expect(prompt).toContain("将伤肩送向先生");
  expect(prompt).not.toMatch(/平视|缓慢推近|轻微横移|\*\*镜/);
  expect(formatWorkbenchShotInjectBlock(shots[3]!)).toContain("机位·仰拍");
  const blocks=[...sourceBlocks(),...shots.map(s=>({...defaultCanvasBlock("image",0,0),id:`keyart-e01-s${String(s.index).padStart(2,"0")}-probe`,episodeIndex:1,outputUrl:"https://test.invalid/still.png"}))];
  const prepared=ensureManhuaFragmentClips(blocks,[],1,{videoModel:"seedance-2.5"});
  const prompts=prepared.blocks.filter(b=>b.id.startsWith("clip-")&&!b.archivedFromPreviousScript).map(b=>b.prompt).join("\n");
  expect(prompts).toContain("门槛低视角");expect(prompts).toContain("先喝药");expect(prompts).not.toContain("缓慢推近");
 });
 it("容量拆分保留源镜身份/摄影，粗剪重排字幕仍跟原镜对白", () => {
  const shots=resolveShotsForEpisodeKeyarts(sourceBlocks(),1).map(s=>({...s,durationSec:s.index===1?20:5}));
  const segments=groupShotsIntoSegments(shots,{videoModel:"seedance-2.0"});
  expect(segments.every(s=>s.durationSec<=15)).toBe(true);
  expect(segments.flatMap(s=>s.shots).filter(s=>s.index===1).every(s=>s.cameraZh===shots[0]!.cameraZh)).toBe(true);
  expect(new Set(segments.flatMap(s=>s.shots.map(x=>x.index)))).toEqual(new Set([1,2,3,4]));
  const order=normalizeManhuaRoughShotOrder(shots.map(s=>s.index),[4,1,3,2]);
  const roughClips=buildRoughCutClipsFromShots(shots,{order});
  const cues=buildManhuaSubtitleCues({roughClips,shots,enabled:true});
  expect(cues.map(c=>c.shotIndex)).toEqual([4,1,2]);
  expect(cues[0]!.textZh).toContain("用我的");expect(cues[1]!.textZh).toContain("先喝药");
 });
 it("单镜显式块不会回落18镜模板，旧单行与表格保持可读", () => {
  expect(parseWorkbenchShotsFromTextResult("1. **镜01｜近景｜固定机位**\n动作链：抬手。").shots).toHaveLength(1);
  expect(parseWorkbenchShotsFromTextResult("1. 近景：抬手\n2. 全景：后退").shots.map(s=>s.cameraZh)).toEqual(["近景","全景"]);
  expect(parseWorkbenchShotsFromTextResult("| 1 | 过肩 | 递药 |\n| 2 | 低机位仰拍 | 入门 |").shots).toHaveLength(2);
 });
});
