import { afterEach, expect, it, vi } from "vitest";
import { importManhuaEpisodeStoryboard, resolveShotsForEpisodeKeyartsResult, spawnManhuaDramaStudio } from "./canvasDramaStudio";
import { requireVoiceStoryboardCandidate, saveVoiceStoryboard, type VoiceStoryboardCandidate } from "./creativeVoiceStoryboard";
import { isManhuaKeyartSourceCurrent } from "@shared/manhuaKeyartLookState";

afterEach(() => vi.restoreAllMocks());
const table = `## 分镜表
| 镜号 | 秒位 | 景别·运镜 | 画面 | 台词/字幕 | 音效·配乐 |
|---|---|---|---|---|---|
| 1 | 0–5s | 特写·跟针 | 四枚金针落入穴位 | 先生：“先镇住气，再说别的。” | 针光轻鸣 |
| 2 | 5–10s | 近景·固定 | 墨屠低声马嘶，阿菁落泪抚颈 | 无对白 | 马嘶与鼻息，无BGM |`;
function fixture() {
  const a = spawnManhuaDramaStudio({ topic: "金针与抚马", episodeIndex: 2 });
  const b = spawnManhuaDramaStudio({ topic: "第一集保留", episodeIndex: 1 });
  return { blocks: [...b.blocks, ...a.blocks], edges: [...b.edges, ...a.edges] };
}

it("免费导入执行真实物化与下游解析，不调用网络、生成器或改变原画布", () => {
  const graph = fixture(), original = JSON.stringify(graph);
  const fetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("不得访问网络"));
  const result = importManhuaEpisodeStoryboard({ graph, episode: 2, text: table, ensureOptions: {} });
  expect(fetch).not.toHaveBeenCalled();
  expect(JSON.stringify(graph)).toBe(original);
  const parsed = resolveShotsForEpisodeKeyartsResult(result.blocks, 2);
  expect(parsed.isFallback).toBe(false);
  expect(parsed.sourceErrors).toEqual([]);
  expect(parsed.shots.map(shot => shot.durationSec)).toEqual([5, 5]);
  expect(JSON.stringify(parsed.shots)).toContain("先镇住气，再说别的。");
  expect(JSON.stringify(parsed.shots)).toContain("墨屠低声马嘶");
  expect(result.blocks.find(b => b.id.startsWith("beats-e02"))?.outputText).toBe(table);
  expect(result.blocks.find(b => b.id.startsWith("reverse-e02"))?.outputText).toBe(table);
  for (const block of graph.blocks.filter(b => b.episodeIndex === 1))
    expect(result.blocks.find(b => b.id === block.id)).toBe(block);
  expect(result.edges.filter(e => e.fromId.includes("e01"))).toEqual(graph.edges.filter(e => e.fromId.includes("e01")));
});

it.each(["", "只有34镜文字说明，没有实际秒位。", table.replace("5–10s", "5–5s"), table.replace("5–10s", "6–10s")])(
  "空原文、缺秒位或坏行不得用默认秒数冒充候选：%s", text => {
    const graph = fixture(), original = JSON.stringify(graph);
    expect(() => importManhuaEpisodeStoryboard({ graph, episode: 2, text, ensureOptions: {} })).toThrow(/完整秒位分镜表/);
    expect(JSON.stringify(graph)).toBe(original);
  }
);

it("真实34镜全部进入消费者，不按旧18镜或引擎单段容量截掉后半剧情", () => {
  const text = "## 分镜表\n| 镜号 | 秒位 | 景别·运镜 | 画面 | 台词/字幕 | 音效·配乐 |\n|---|---|---|---|---|---|\n" +
    Array.from({ length: 34 }, (_, i) => `| ${i + 1} | ${i * 5}–${(i + 1) * 5}s | 中景·跟拍 | 第${i + 1}镜角色动作 | 无对白 | 环境声 |`).join("\n");
  const result = importManhuaEpisodeStoryboard({ graph: fixture(), episode: 2, text, ensureOptions: {} });
  expect(resolveShotsForEpisodeKeyartsResult(result.blocks, 2).shots).toHaveLength(34);
  expect(resolveShotsForEpisodeKeyartsResult(result.blocks, 2).shots.at(-1)?.actionZh).toContain("第34镜角色动作");
});

it("旧付费图和另一集视频完整保留，新镜头源版本改变，不将旧图当作新稿产物", () => {
  const graph = fixture();
  const old = graph.blocks.find(b => b.id.startsWith("keyart-e02"))!;
  old.outputUrl = "/assets/test-retained-image.png";
  old.status = "done";
  old.manhuaKeyartSourceState = { required: "old-source", generatedFor: "old-source", generatedUrl: old.outputUrl };
  const video = graph.blocks.find(b => b.id.startsWith("clip-e01"))!;
  video.outputUrl = "/assets/test-retained-video.mp4";
  const result = importManhuaEpisodeStoryboard({ graph, episode: 2, text: table, ensureOptions: {} });
  const retained = result.blocks.find(b => b.id === old.id)!;
  expect(retained.outputUrl).toBe(old.outputUrl);
  expect(retained.manhuaKeyartSourceState?.required).not.toBe("old-source");
  expect(retained.manhuaKeyartSourceState?.generatedFor).toBe("old-source");
  expect(isManhuaKeyartSourceCurrent(retained)).toBe(false);
  expect(result.blocks.find(b => b.id === video.id)).toBe(video);
});

it("完整候选保存再恢复沿原采用校验，换正文/画布后禁止覆盖", () => {
  const graph = fixture();
  const result = importManhuaEpisodeStoryboard({ graph, episode: 2, text: table, ensureOptions: {} });
  const candidate: VoiceStoryboardCandidate = { id: "test-import", scope: "test-user:test-project", episode: 2,
    source: "test-current-source", status: "ready", resultState: "returned", ...result };
  const data = new Map<string, string>();
  const storage = { setItem: (key: string, value: string) => { data.set(key, value); }, getItem: (key: string) => data.get(key) ?? null };
  saveVoiceStoryboard(storage, "test-candidate", candidate);
  const restored = JSON.parse(storage.getItem("test-candidate")!) as VoiceStoryboardCandidate;
  expect(requireVoiceStoryboardCandidate(restored, candidate.scope, 2, candidate.source).text).toBe(table);
  expect(() => requireVoiceStoryboardCandidate(restored, "other-project", 2, candidate.source)).toThrow();
  expect(() => requireVoiceStoryboardCandidate(restored, candidate.scope, 2, "changed-source")).toThrow(/已变化/);
});
