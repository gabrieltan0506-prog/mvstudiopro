import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  ingestManhuaDirectorBoardFileWithFeedback,
  resolveManhuaAdvisorSelection,
  resolveManhuaAdvisorShotsFromBlocks,
  resolveManhuaDirectorBoardImageGeometry,
  resolveManhuaDirectorOverlayBaseUrl,
  shouldShowManhuaAsset3dRow,
} from "../components/ManhuaScriptWorkbench.js";

const workbenchSource = readFileSync(
  new URL("../components/ManhuaScriptWorkbench.tsx", import.meta.url),
  "utf8",
);
const omniSource = readFileSync(
  new URL("../pages/OmniCanvas.tsx", import.meta.url),
  "utf8",
);

describe("漫剧导演策略前台接线", () => {
  it("顾问只接收工作台真实选中镜，无镜头时不制造兜底镜", () => {
    const shot = {
      index: 4,
      durationSec: 5,
      sceneZh: "雨巷",
      shotSizeZh: "近景",
      cameraZh: "平视跟拍",
      actionZh: "阿菁停步回望",
    } as never;
    expect(resolveManhuaAdvisorSelection({ episodeIndex: 2, shot })).toEqual({
      episodeIndex: 2,
      segmentIndex: 2,
      shot,
    });
    expect(resolveManhuaAdvisorSelection({ episodeIndex: 2, shot: null })).toBeNull();
  });

  it("未运行节点只有 prompt 时不上报假镜；outputText 才产生真实镜头", () => {
    expect(
      resolveManhuaAdvisorShotsFromBlocks({
        beats: {
          prompt: "1. 默认模板镜头\n2. 默认模板动作",
          outputText: "",
        },
      }),
    ).toEqual([]);
    const actual = resolveManhuaAdvisorShotsFromBlocks({
      beats: {
        prompt: "1. 默认模板镜头",
        outputText: "1. 近景：阿菁停步回望\n2. 全景：雨巷尽头亮起灯火",
      },
    });
    expect(actual).toHaveLength(2);
    expect(actual.map((shot) => shot.actionZh)).toEqual([
      "阿菁停步回望",
      "雨巷尽头亮起灯火",
    ]);
  });

  it("展示去名冻结状态，但不新增工作流阶段", () => {
    expect(omniSource).toContain(
      "directorStrategyContract={directorStrategyContract}",
    );
    expect(workbenchSource).toContain("data-manhua-director-strategy-status");
    expect(workbenchSource).toContain("创作策略 · {directorStrategyContract.labelZh}");
    expect(workbenchSource).toContain('directorStrategyContract.version === 2 ? directorStrategyContract.revision : "原版 v1 · 保持不变"');
    expect(workbenchSource).toContain("已锁定");
    expect(workbenchSource).toContain("创作策略 · 旧项目待升级");
    expect(workbenchSource).toContain("data-manhua-director-overlay-panel");
    expect(workbenchSource).toContain('data-state={');
    expect(workbenchSource).toContain("先生成本段静帧，或上传本段导演板");
    expect(workbenchSource).not.toMatch(
      /activeBoardBaseUrl\s*&&\s*activeDirectorBoardMotionOverlay\s*\?\s*\(/,
    );
    expect(workbenchSource).not.toContain('id: "director_strategy"');
  });

  it("轨迹底图只取同段导演板或该段首镜静帧，不接受整集或当前其他镜兜底", () => {
    const segmentBoardUrls = {
      1: "https://cdn.example/segment-01.png",
      2: "https://cdn.example/segment-02.png",
      3: "https://cdn.example/segment-03.png",
    };
    expect(
      resolveManhuaDirectorOverlayBaseUrl({
        segmentIndex: 2,
        segmentBoardUrls,
        segmentFirstShotStillUrl: "https://cdn.example/shot-04.png",
      }),
    ).toBe("https://cdn.example/segment-02.png");
    expect(
      [1, 2, 3].map((segmentIndex) =>
        resolveManhuaDirectorOverlayBaseUrl({ segmentIndex, segmentBoardUrls }),
      ),
    ).toEqual([
      "https://cdn.example/segment-01.png",
      "https://cdn.example/segment-02.png",
      "https://cdn.example/segment-03.png",
    ]);
    expect(
      resolveManhuaDirectorOverlayBaseUrl({
        segmentIndex: 2,
        segmentFirstShotStillUrl: "https://cdn.example/shot-04.png",
      }),
    ).toBe("https://cdn.example/shot-04.png");
    expect(resolveManhuaDirectorOverlayBaseUrl({ segmentIndex: 2 })).toBeNull();
  });

  it("底图必须读到真实像素尺寸才产生可确认比例", () => {
    expect(
      resolveManhuaDirectorBoardImageGeometry({ width: 1080, height: 1920 }),
    ).toEqual({
      width: 1080,
      height: 1920,
      ratio: 0.5625,
      baseAspectRatio: "9:16",
    });
    expect(
      resolveManhuaDirectorBoardImageGeometry({ width: 1920, height: 1080 }),
    ).toEqual({
      width: 1920,
      height: 1080,
      ratio: 1920 / 1080,
      baseAspectRatio: "16:9",
    });
    expect(
      resolveManhuaDirectorBoardImageGeometry({ width: 0, height: 1080 }),
    ).toBeNull();
    expect(
      resolveManhuaDirectorBoardImageGeometry({
        width: 1920,
        height: Number.NaN,
      }),
    ).toBeNull();
  });

  it("导演板上传成功透传当前段，失败时返回 false 并交给统一反馈", async () => {
    const file = { name: "segment-02.png" } as File;
    const onIngest = vi.fn().mockResolvedValue(undefined);
    const onError = vi.fn();
    await expect(
      ingestManhuaDirectorBoardFileWithFeedback({
        file,
        segmentIndex: 2,
        onIngest,
        onError,
      }),
    ).resolves.toBe(true);
    expect(onIngest).toHaveBeenCalledWith(file, 2);
    expect(onError).not.toHaveBeenCalled();

    onIngest.mockRejectedValueOnce(new Error("裁切失败"));
    await expect(
      ingestManhuaDirectorBoardFileWithFeedback({
        file,
        segmentIndex: 2,
        onIngest,
        onError,
      }),
    ).resolves.toBe(false);
    expect(onError).toHaveBeenLastCalledWith("裁切失败");
  });

  it("3D 资格与失败原因只在已展开的人物卡出现", () => {
    expect(
      shouldShowManhuaAsset3dRow({
        role: "character",
        cardExpanded: true,
        hasAction: true,
      }),
    ).toBe(true);
    for (const role of ["scene", "prop", "wardrobe", "unset"]) {
      expect(
        shouldShowManhuaAsset3dRow({ role, cardExpanded: true, hasAction: true }),
      ).toBe(false);
    }
    expect(
      shouldShowManhuaAsset3dRow({
        role: "character",
        cardExpanded: false,
        hasAction: true,
      }),
    ).toBe(false);
  });
});
