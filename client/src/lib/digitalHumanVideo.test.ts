import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("./flyHealthGate", () => ({
  withFlyHealthGate: async (_origin: string, run: () => Promise<unknown>) =>
    run(),
}));
vi.mock("./longJobsFlyOrigin", () => ({
  withLongJobsFlyDirect: (url: string) => url,
  flyHealthProbeOriginForUrl: () => "https://test.invalid",
}));
vi.mock("./videoUpscaleApi", () => ({ probeVideoDurationSec: async () => 12 }));
import { digitalHumanVideoBlock } from "./digitalHumanVideo";
import { previewCanvasBlockOutbound } from "./canvasRunBlock";
import type { DigitalHumanVideo } from "@shared/digitalHumanStudio";
const row: DigitalHumanVideo = {
  requestId: "a51d8a78-1c90-4f1d-9c1e-324e7a3f4661",
  fingerprint: "test",
  status: "submitted",
  prompt:
    "目标时长：12秒。@图片1为讲述者，@图片2为场景，@音频1为完整对白。你好，这是声音测试。",
  portrait: { source: "https://test.invalid/person.png", name: "本人" },
  scene: { source: "https://test.invalid/room.png", name: "场景" },
  audioSource: "https://test.invalid/voice.wav",
  audioRequestId: "test-audio",
  durationSec: 12,
  aspectRatio: "9:16",
  extraPortraits: [],
};
afterEach(() => vi.unstubAllGlobals());
describe("数字人到现有Seedance执行器的真实组装（禁止网络）", () => {
  it("720p2.5保留人物、场景和完整配音，预览不付费", async () => {
    const network = vi.fn(async () => {
      throw new Error("禁止测试访问真实服务");
    });
    vi.stubGlobal("fetch", network);
    const block = await digitalHumanVideoBlock(row);
    const out = await previewCanvasBlockOutbound(
      {
        userId: "7",
        userRole: "admin",
        optimizeCopy: async () => {
          throw new Error("不得调用文案生成");
        },
      },
      block
    );
    expect(out.engine).toBe("seedance-2.5");
    expect(out.durationSec).toBe(12);
    expect(out.refs.imageUrls).toEqual([row.portrait.source, row.scene.source]);
    expect(out.refs.audioUrls).toEqual([row.audioSource]);
    expect(out.body.resolution).toBe("720p");
    expect(network).not.toHaveBeenCalled();
  });
  it("多人、3D视角与已审白模都进入生产出站预览", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("禁止真实网络");
      })
    );
    const multi = {
      ...row,
      extraPortraits: [
        { source: "https://test.invalid/listener.png", name: "听众" },
      ],
      stageFrame: { source: "https://test.invalid/stage.png", name: "视角图" },
      previs: {
        url: "https://test.invalid/previs.mp4",
        durationSec: 12,
        updatedAt: "2026-10-14",
        motionGuideZh: "按白模保留两人位置与机位",
      },
    };
    const block = await digitalHumanVideoBlock(multi);
    const out = await previewCanvasBlockOutbound(
      {
        userId: "7",
        userRole: "admin",
        optimizeCopy: async () => {
          throw new Error("不得生成文案");
        },
      },
      block
    );
    expect(out.refs.imageUrls).toHaveLength(4);
    expect(out.refs.videoUrls).toContain(multi.previs.url);
    expect(out.refs.audioUrls).toEqual([row.audioSource]);
  });
});

for (const model of ["seedance-2.0-mini", "wan-3.0"] as const) {
  it(`${model}出站保留本人原声且不会悄悄换引擎或分辨率`, async () => {
    const network=vi.fn(async()=>{throw new Error("禁止真实请求")});vi.stubGlobal("fetch",network);
    const block=await digitalHumanVideoBlock({...row,filmModel:model,prompt:row.prompt+"运镜：固定中景；灯光：左侧柔光。"});
    const out=await previewCanvasBlockOutbound({userId:"7",userRole:"admin",optimizeCopy:async()=>{throw Error("禁止生成")}},block);
    expect(out.engine).toBe(model);expect(out.refs.audioUrls).toEqual([row.audioSource]);
    expect(out.body.resolution).toBe(model==="seedance-2.0-mini"?"480p":"720p");
    expect(out.durationSec).toBe(12);expect(network).not.toHaveBeenCalled();
  });
}
