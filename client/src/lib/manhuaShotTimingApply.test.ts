import { describe, expect, it, vi } from "vitest";
import { createCanvasAudioCue, emptyCanvasAudioStudio } from "@shared/canvasAudioStudio";
import { readManhuaTimedStoryboard } from "@shared/manhuaTimedStoryboard";
import type { ManhuaWriterPack } from "@shared/manhuaWriterRoom";
import { ensureManhuaFragmentClips, expandManhuaShotKeyartsAfterReverse, queuedManhuaClipBlocks, spawnManhuaDramaStudio } from "./canvasDramaStudio";
import { applyManhuaShotTimingEdit, manhuaRestoreConfirmationBlocker } from "./manhuaShotTimingApply";

function chain() {
  const spawned = spawnManhuaDramaStudio({ topic: "墨菁传", episodeIndex: 1, videoModel: "seedance-2.5" });
  const reverse = spawned.blocks.find(b => b.id.startsWith("reverse-"))!;
  const rows = Array.from({ length: 18 }, (_, i) => {
    const index = i + 1;
    const dialogue = index === 14 ? "阿菁：先送娘去治病" : index === 16 ? "坐堂先生：药只能压三天" : "无";
    return `| ${index} | ${i * 5}–${(i + 1) * 5}秒 | 近景 | 镜${index}动作 | ${dialogue} |`;
  });
  const outputText = `## 分镜表\n| 镜号 | 秒位 | 景别/运镜 | 画面 | 对白 |\n|---|---|---|---|---|\n${rows.join("\n")}`;
  const source = spawned.blocks.map(b => b.id === reverse.id ? { ...b, status: "done" as const, outputText } : b);
  const expanded = expandManhuaShotKeyartsAfterReverse(source, spawned.edges, reverse.id, { videoModel: "seedance-2.5" });
  const ready = expanded.blocks.map(b => b.id.startsWith("keyart-") ? { ...b, status: "done" as const, outputUrl: `https://example.test/${b.id}.png` } : b);
  const initial = ensureManhuaFragmentClips(ready, expanded.edges, 1, { videoModel: "seedance-2.5" });
  const writerPack = { seriesTitle: "墨菁传", logline: "", charactersMd: "", propsMd: "", locationsMd: "", episodes: [{ index: 1, title: "坊市一掌", body: outputText, endHook: "" }], rawMarkdown: "", episodeCount: 1 } as ManhuaWriterPack;
  return { initial, writerPack };
}
const paid = (id: string) => ({ id: `take-${id}`, gcsUri: `gs://test-bucket/${id}.wav`, previewUrl: "", durationSec: 3, createdAt: "2026-09-28", inputKey: `old-${id}` });
const cue = (id: string) => ({ ...createCanvasAudioCue("dialogue", id), speakerZh: "原角色", textZh: `已审${id}`, voice: "locked-voice", takes: [paid(id)], selectedTakeId: `take-${id}`, approved: true });

describe("改镜头时长／切点：就地重排分段，不重铺整集", () => {
  it("镜16切开后立刻有 A/B 两个新段：对白按镜号带回（未采用），已出片的第二段与静帧原地保留，不问归档", () => {
    const { initial, writerPack } = chain();
    const clips = queuedManhuaClipBlocks(initial.blocks, 1, "seedance-2.5");
    expect(clips).toHaveLength(3);
    const [, second, third] = clips;
    const studio = { ...emptyCanvasAudioStudio(), cues: [cue("script-shot-14-line-1"), cue("script-shot-16-line-1")] };
    const staged = initial.blocks.map(b => b.id === second!.id ? { ...b, outputUrl: "https://example.test/second.mp4" } : b.id === third!.id ? { ...b, audioStudio: studio } : b);
    const keyartsBefore = staged.filter(b => b.id.startsWith("keyart-")).map(b => [b.id, b.outputUrl]);
    const confirmArchive = vi.fn(() => true);
    const edited = applyManhuaShotTimingEdit({
      blocks: staged, edges: initial.edges, writerPack, episodeIndex: 1, shotIndex: 16, durationSec: 5, segmentBreakBefore: true,
      ensureOptions: { videoModel: "seedance-2.5" }, confirmArchive,
    });
    expect(edited.resegmentError).toBe("");
    expect(confirmArchive).not.toHaveBeenCalled();
    const active = queuedManhuaClipBlocks(edited.blocks, 1, "seedance-2.5");
    expect(active).toHaveLength(4);
    expect(active[1]).toMatchObject({ id: second!.id, outputUrl: "https://example.test/second.mp4" });
    expect(active[2]!.audioStudio?.cues.map(c => c.id)).toEqual(["script-shot-14-line-1"]);
    expect(active[3]!.audioStudio?.cues.map(c => c.id)).toEqual(["script-shot-16-line-1"]);
    expect(active.slice(2).flatMap(c => c.audioStudio!.cues).every(c => c.approved === false)).toBe(true);
    expect(edited.blocks.find(b => b.id === third!.id)).toMatchObject({ archivedFromPreviousScript: true, audioStudio: studio });
    // 静帧不归档、不重出
    expect(edited.blocks.filter(b => b.id.startsWith("keyart-") && !b.archivedFromPreviousScript).map(b => [b.id, b.outputUrl])).toEqual(keyartsBefore);
    // 剧本同步写入切点
    expect(readManhuaTimedStoryboard(edited.writerPack.episodes[0]!.body).rows.find(r => r.index === 16)?.segmentBreakBefore).toBe(true);
  });

  it("会停放已出片的段时先问；取消则整次不改、原稿不动", () => {
    const { initial, writerPack } = chain();
    const third = queuedManhuaClipBlocks(initial.blocks, 1, "seedance-2.5")[2]!;
    const staged = initial.blocks.map(b => b.id === third.id ? { ...b, outputUrl: "https://example.test/third.mp4" } : b);
    const confirmArchive = vi.fn(() => false);
    const bodyBefore = writerPack.episodes[0]!.body;
    expect(() => applyManhuaShotTimingEdit({
      blocks: staged, edges: initial.edges, writerPack, episodeIndex: 1, shotIndex: 16, durationSec: 5, segmentBreakBefore: true,
      ensureOptions: { videoModel: "seedance-2.5" }, confirmArchive,
    })).toThrow("已取消");
    expect(confirmArchive).toHaveBeenCalledWith(1);
    expect(writerPack.episodes[0]!.body).toBe(bodyBefore);
    expect(staged.find(b => b.id === third.id)).toMatchObject({ outputUrl: "https://example.test/third.mp4" });
    expect(staged.find(b => b.id === third.id)?.archivedFromPreviousScript).toBeFalsy();
  });
});

describe("只恢复确认（不重铺）的前提", () => {
  it("只改了时长：每镜都有现行静帧、无待确认改写 → 放行", () => {
    const { initial, writerPack } = chain();
    const edited = applyManhuaShotTimingEdit({ blocks: initial.blocks, edges: initial.edges, writerPack, episodeIndex: 1, shotIndex: 14, durationSec: 10.032, ensureOptions: { videoModel: "seedance-2.5" }, confirmArchive: () => true });
    expect(manhuaRestoreConfirmationBlocker({ blocks: edited.blocks, writerPack: edited.writerPack, episodeIndex: 1, advisorReconfirmFromEpisode: undefined })).toBe("");
  });
  it("有待确认的顾问改写，或剧情从某段起重写后后段静帧被清掉 → 拒绝，指向「确认剧本大纲」", () => {
    const { initial, writerPack } = chain();
    expect(manhuaRestoreConfirmationBlocker({ blocks: initial.blocks, writerPack, episodeIndex: 1, advisorReconfirmFromEpisode: 1 })).toContain("顾问改写");
    const rewritten = initial.blocks.filter(b => !(b.id.startsWith("keyart-") && /-s1[3-8]-/.test(b.id)));
    const blocker = manhuaRestoreConfirmationBlocker({ blocks: rewritten, writerPack, episodeIndex: 1, advisorReconfirmFromEpisode: undefined });
    expect(blocker).toContain("镜13");
    expect(blocker).toContain("确认剧本大纲");
    const archived = initial.blocks.map(b => b.id.startsWith("keyart-") && /-s1[3-8]-/.test(b.id) ? { ...b, archivedFromPreviousScript: true } : b);
    expect(manhuaRestoreConfirmationBlocker({ blocks: archived, writerPack, episodeIndex: 1, advisorReconfirmFromEpisode: undefined })).toContain("镜13");
  });
});
