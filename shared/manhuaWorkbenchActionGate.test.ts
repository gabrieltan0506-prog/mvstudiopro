import { describe, expect, it } from "vitest";
import {
  explainManhuaClipActionGate,
  explainManhuaKeyartActionGate,
} from "./manhuaWorkbenchActionGate";

const readyGate = {
  castLocked: true,
  sceneLocked: true,
  castImagesReady: true,
  sceneImageReady: true,
  hintZh: null as string | null,
  missingCastIds: [] as string[],
};

describe("manhuaWorkbenchActionGate", () => {
  it("explains missing cast lock instead of silent block", () => {
    const msg = explainManhuaKeyartActionGate({
      outlineComplete: true,
      assetGate: { ...readyGate, castLocked: false, castImagesReady: false },
    });
    expect(msg).toMatch(/锁定人物/);
  });

  it("explains missing scene plate", () => {
    const msg = explainManhuaKeyartActionGate({
      outlineComplete: true,
      assetGate: {
        ...readyGate,
        sceneImageReady: false,
        hintZh: "请补主场景空镜",
      },
    });
    expect(msg).toMatch(/主场景空镜|场景/);
  });

  it("allows keyart when assets ready", () => {
    expect(
      explainManhuaKeyartActionGate({
        outlineComplete: true,
        assetGate: readyGate,
      }),
    ).toBeNull();
  });

  it("clip gate asks for keyarts when stills missing", () => {
    const msg = explainManhuaClipActionGate({
      outlineComplete: true,
      assetGate: readyGate,
      stillsReadyEnough: false,
    });
    expect(msg).toMatch(/关键静帧|垫图/);
  });

  it("clip gate skips full assetGate when stills already pixel-locked", () => {
    const msg = explainManhuaClipActionGate({
      outlineComplete: true,
      assetGate: {
        ...readyGate,
        castLocked: false,
        castImagesReady: false,
        sceneLocked: false,
        sceneImageReady: false,
      },
      assetScriptStaleHintZh: "剧本人物已变",
      stillsReadyEnough: true,
    });
    expect(msg).toBeNull();
  });

  it("clip gate still surfaces burn hint when stills ready", () => {
    const msg = explainManhuaClipActionGate({
      outlineComplete: true,
      assetGate: readyGate,
      stillsReadyEnough: true,
      videoBurnHintZh: "请先确认按秒导戏单",
    });
    expect(msg).toMatch(/导戏单/);
  });

  it("clip gate blocks on cast mismatch even when stills are ready", () => {
    // 静帧齐 → 旧逻辑直接放行，于是拿库里无关的脸出片，白烧一次视频钱
    const msg = explainManhuaClipActionGate({
      outlineComplete: true,
      assetGate: readyGate,
      stillsReadyEnough: true,
      segmentCastMismatchHintZh: "第 1 段的「沈沧澜」在已有资产里找不到对应的图",
    });
    expect(msg).toMatch(/沈沧澜/);
  });

  it("clip gate stays open when assets and script line up", () => {
    const msg = explainManhuaClipActionGate({
      outlineComplete: true,
      assetGate: readyGate,
      stillsReadyEnough: true,
      segmentCastMismatchHintZh: null,
    });
    expect(msg).toBeNull();
  });

  it("clip gate blocks when nobody's face is bound even though stills are ready", () => {
    // 线上实况：五段静帧全齐，对照表却一行角色都没有——门禁放行，
    // 于是每段模型自己捏脸，十段十个人，钱花完才看得出来
    const msg = explainManhuaClipActionGate({
      outlineComplete: true,
      assetGate: readyGate,
      stillsReadyEnough: true,
      segmentNoFaceLockHintZh:
        "第 1、2 段还没绑上任何角色定妆图，出片不锁脸",
    });
    expect(msg).toMatch(/不锁脸/);
  });

  it("clip gate keeps the two asset failures worded apart", () => {
    // 「图对不上名字」要去重出设定图，「还没出图」要去生成——指错按钮等于白忙
    const mismatch = explainManhuaClipActionGate({
      outlineComplete: true,
      assetGate: readyGate,
      stillsReadyEnough: true,
      segmentCastMismatchHintZh: "第 1 段的「沈沧澜」在已有资产里找不到对应的图",
    });
    const noLock = explainManhuaClipActionGate({
      outlineComplete: true,
      assetGate: readyGate,
      stillsReadyEnough: true,
      segmentNoFaceLockHintZh: "第 1 段还没绑上任何角色定妆图，出片不锁脸",
    });
    expect(mismatch).not.toBe(noLock);
  });
});
