import { describe, expect, it, vi } from "vitest";
import { defaultCanvasBlock, type CanvasBlock } from "./canvasTypes";
import {
  buildLocalCloudDraftSnapshot,
  serializeCloudDraftForUpload,
  cloudDraftBlocksToCanvas,
  tryLoadLocalCanvas,
  trySaveLocalCanvas,
} from "./manhuaCloudDraftSync";
import { parseManhuaCloudDraftPayload } from "@shared/manhuaCloudDraft";
import { isManhuaKeyartLookCurrent } from "@shared/manhuaKeyartLookState";
import {
  emptyManhuaClipQualityChecks,
  manhuaClipQualityAllowsAssemble,
} from "@shared/manhuaClipQuality";
import { findManhuaFinalVideoVersionIdentity } from "@shared/manhuaFinalPostProd";
import type { ManhuaRenderedSubtitle } from "@shared/manhuaRenderedSubtitle";
import { refreshManhuaDraftSignedUrls } from "../../../server/services/manhuaDraftUrlRefresh";

const bucket = "test-merged-draft-bucket";
const signed = (name: string) =>
  `https://storage.googleapis.com/${bucket}/${name}?X-Goog-Signature=test-old`;
const renewed = (name: string) =>
  `https://storage.googleapis.com/${bucket}/${name}?X-Goog-Signature=test-renewed`;
const timeline = (text: string): ManhuaRenderedSubtitle => ({
  version: 1,
  textSource: "assembly_script_snapshot",
  timing: "rendered_shot_windows",
  durationSec: 10,
  cues: [
    { shotIndex: 1, order: 1, startSec: 1.125, endSec: 9.875, textZh: text },
  ],
});

function sourceBlocks(): CanvasBlock[] {
  const image = (id: string, valid: boolean): CanvasBlock => ({
    ...defaultCanvasBlock("image", 0, 0),
    id,
    status: "done",
    outputUrl: signed(`${id}.png`),
    outputUrls: [signed(`${id}.png`)],
    manhuaKeyartLookState: {
      required: "橙红旧眼罩",
      generatedFor: valid ? "橙红旧眼罩" : "旧黑眼罩",
      generatedUrl: signed(`${id}.png`),
    },
  });
  return [
    image("keyart-e01-valid", true),
    image("keyart-e01-stale", false),
    {
      ...defaultCanvasBlock("video", 0, 0),
      id: "clip-e01-g01-a",
      episodeIndex: 1,
      videoModel: "seedance-2.5",
      status: "error",
      outputUrl: signed("clip-current.mp4"),
      outputUrls: [
        signed("clip-current.mp4"),
        ...Array.from({ length: 12 }, (_, i) => signed(`history-${i}.mp4`)),
      ],
      seedance25WorkMode: "video_edit",
      refVideoUrl: signed("clip-current.mp4"),
      seedance25RefVideoUrls: [signed("clip-current.mp4")],
      videoTaskId: "test-pending-edit",
      videoTaskEngine: "seedance",
      videoTaskStatus: "reconcile_manual",
      error: "结果待核对，不重发任务",
      manhuaClipQuality: {
        status: "failed",
        checks: emptyManhuaClipQualityChecks(),
        failedKeys: ["CHARACTER_MATCH"],
        summary: "角色不符",
        raw: "失败原文不截断",
        attempts: 1,
        reviewedAt: "2026-09-06T00:00:00Z",
      },
    },
    {
      ...defaultCanvasBlock("video", 0, 0),
      id: "final-e01",
      episodeIndex: 1,
      status: "done",
      outputUrl: signed("final-2.mp4"),
      outputUrls: [signed("final-2.mp4"), signed("final-1.mp4")],
      manhuaFinalVersions: [1, 2].map(n => ({
        origin: "assemble" as const,
        url: signed(`final-${n}.mp4`),
        jobId: `test-final-${n}`,
        gcsUri: `gs://${bucket}/final-${n}.mp4`,
        createdAt: n,
        subtitleTimeline: timeline(`第${n}版原对白`),
      })),
    },
  ];
}

function assertRestored(blocks: CanvasBlock[], url = signed) {
  expect(blocks).toHaveLength(4);
  expect(isManhuaKeyartLookCurrent(blocks[0])).toBe(true);
  expect(isManhuaKeyartLookCurrent(blocks[1])).toBe(false);
  expect(blocks[0].manhuaKeyartLookState?.generatedUrl).toBe(
    blocks[0].outputUrl
  );
  const clip = blocks[2];
  expect(clip.outputUrl).toBe(url("clip-current.mp4"));
  expect(clip.outputUrls).toEqual([
    url("clip-current.mp4"),
    ...Array.from({ length: 12 }, (_, i) => url(`history-${i}.mp4`)),
  ]);
  expect(clip.manhuaClipQuality).toEqual(sourceBlocks()[2].manhuaClipQuality);
  expect(
    manhuaClipQualityAllowsAssemble({
      outputUrl: clip.outputUrl,
      quality: clip.manhuaClipQuality,
    })
  ).toBe(false);
  expect(clip).toMatchObject({
    status: "error",
    videoTaskId: "test-pending-edit",
    videoTaskStatus: "reconcile_manual",
    videoTaskEngine: "seedance",
    seedance25WorkMode: "video_edit",
    error: "结果待核对，不重发任务",
    refVideoUrl: url("clip-current.mp4"),
    seedance25RefVideoUrls: [url("clip-current.mp4")],
  });
  const final = blocks[3];
  expect(final.outputUrl).toBe(url("final-2.mp4"));
  expect(final.outputUrls).toEqual([url("final-2.mp4"), url("final-1.mp4")]);
  expect(final.manhuaFinalVersions).toHaveLength(2);
  for (const n of [1, 2])
    expect(
      findManhuaFinalVideoVersionIdentity(final, url(`final-${n}.mp4`))
    ).toMatchObject({
      jobId: `test-final-${n}`,
      gcsUri: `gs://${bucket}/final-${n}.mp4`,
      subtitleTimeline: timeline(`第${n}版原对白`),
    });
}

function cloudPayload(blocks: CanvasBlock[]) {
  const serialized = serializeCloudDraftForUpload(
    buildLocalCloudDraftSnapshot({ writerSession: {}, blocks, edges: [] })
  );
  expect(serialized).toBeTruthy();
  const parsed = parseManhuaCloudDraftPayload(serialized!);
  expect(parsed).not.toBeNull();
  return parsed!;
}

describe("合并后造型回执、视频历史、待核对任务与实际字幕合同共存", () => {
  it("真实本机保存加载再两次云序列化恢复不丢任一合同", () => {
    const source = sourceBlocks();
    const before = JSON.stringify(source);
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
    };
    expect(trySaveLocalCanvas(source, [], storage)).toBe(true);
    const local = tryLoadLocalCanvas(storage)!;
    assertRestored(local.blocks);
    const first = cloudDraftBlocksToCanvas(
      cloudPayload(local.blocks).canvas.blocks
    );
    assertRestored(first);
    assertRestored(cloudDraftBlocksToCanvas(cloudPayload(first).canvas.blocks));
    expect(JSON.stringify(source)).toBe(before);
  });

  it("真实续签遍历只用虚构签名器，保持当前版本字幕绑定与失效造型状态", () => {
    const payload = cloudPayload(sourceBlocks());
    const before = JSON.stringify(payload);
    const sign = vi.fn((uri: string) =>
      renewed(uri.slice(`gs://${bucket}/`.length))
    );
    const refreshed = refreshManhuaDraftSignedUrls(payload, {
      bucketName: bucket,
      sign,
    });
    expect(refreshed.stats.refreshed).toBeGreaterThan(20);
    expect(sign).toHaveBeenCalledWith(`gs://${bucket}/final-2.mp4`, 604800);
    assertRestored(
      cloudDraftBlocksToCanvas(refreshed.payload.canvas.blocks),
      renewed
    );
    expect(JSON.stringify(payload)).toBe(before);
  });
});
