import { describe, expect, it } from "vitest";
import {
  compileManhuaDirectorBoardOverlay,
  compileManhuaSegmentDirectorBoardOverlay,
  type CompileManhuaDirectorBoardOverlayInput,
} from "./manhuaDirectorBoardOverlayCompile";

function base(
  overrides: Partial<CompileManhuaDirectorBoardOverlayInput> = {}
): CompileManhuaDirectorBoardOverlayInput {
  return {
    episodeIndex: 1,
    segmentIndex: 1,
    beat: {
      castZh: "沈策；韩廷玉",
      wardrobePropZh: "玄甲；令牌",
      performanceZh:
        "沈策从画面左侧向右冲，在画面中央撞上韩廷玉；韩廷玉从画面右侧向左后退",
      lightingCameraZh: "镜头向右横移跟拍",
    },
    ...overrides,
  };
}

describe("compileManhuaDirectorBoardOverlay", () => {
  it("空输入惰性返回 null，不凭默认值造路线", () => {
    expect(
      compileManhuaDirectorBoardOverlay({ episodeIndex: 1, segmentIndex: 1 })
    ).toBeNull();
  });

  it("含糊动作只产待复核空层，不把情绪词猜成坐标", () => {
    const result = compileManhuaDirectorBoardOverlay(
      base({
        beat: {
          castZh: "沈策；韩廷玉",
          performanceZh: "两人激烈对峙，气氛震撼",
          lightingCameraZh: "压迫感构图",
        },
      })
    );
    expect(result).not.toBeNull();
    expect(result?.actorRoutes).toEqual([]);
    expect(result?.cameraPath).toBeNull();
    expect(result?.axis).toBeNull();
    expect(result?.landingPoints).toEqual([]);
    expect(result?.needsReview).toBe(true);
  });

  it("明确的双人方向、跟拍与中央碰撞编译成可核对实数", () => {
    const result = compileManhuaDirectorBoardOverlay(base());
    expect(result?.actorRoutes).toHaveLength(2);
    expect(
      result?.actorRoutes.map(route => [route.entityId, route.points])
    ).toEqual([
      [
        "沈策",
        [
          { x: 0.16, y: 0.66 },
          { x: 0.82, y: 0.66 },
        ],
      ],
      [
        "韩廷玉",
        [
          { x: 0.84, y: 0.66 },
          { x: 0.18, y: 0.66 },
        ],
      ],
    ]);
    expect(result?.cameraPath).toMatchObject({
      move: "track",
      points: result?.actorRoutes[0]?.points,
      source: "legacy_explicit",
    });
    expect(result?.axis?.screenDirection).toBe("left_to_right");
    expect(result?.landingPoints).toEqual([
      {
        landingId: "landing-1",
        kind: "collision",
        at: { x: 0.5, y: 0.58 },
        entityIds: ["沈策", "韩廷玉"],
      },
    ]);
  });

  it("道具明确飞行时绑定道具，不误标成人物路线", () => {
    const result = compileManhuaDirectorBoardOverlay(
      base({
        beat: {
          castZh: "沈策",
          wardrobePropZh: "玄甲；令牌",
          performanceZh: "沈策把令牌从画面左侧抛向画面右侧",
          lightingCameraZh: "固定机位",
        },
      })
    );
    expect(result?.actorRoutes).toMatchObject([
      { entityId: "令牌", entityKind: "prop", source: "legacy_explicit" },
    ]);
    expect(result?.cameraPath).toBeNull();
  });

  it("推近可形成摄影机路径；无人物方向时仍不造人物路线", () => {
    const result = compileManhuaDirectorBoardOverlay(
      base({
        beat: {
          castZh: "沈策；韩廷玉",
          performanceZh: "两人沉默对视",
          lightingCameraZh: "中景缓慢推近至面部近景",
        },
      })
    );
    expect(result?.actorRoutes).toEqual([]);
    expect(result?.cameraPath).toEqual({
      move: "push",
      points: [
        { x: 0.5, y: 0.2 },
        { x: 0.5, y: 0.58 },
      ],
      source: "legacy_explicit",
      confidence: 0.78,
    });
  });

  it("明确结构化坐标优先于旧文本，越界子项被安全丢弃", () => {
    const result = compileManhuaDirectorBoardOverlay(
      base({
        structuredMotion: {
          actorRoutes: [
            {
              entityId: "沈策",
              entityKind: "character",
              points: [
                { x: 0.2, y: 0.7 },
                { x: 1.4, y: 0.7 },
              ],
            },
          ],
          cameraPath: {
            move: "pan",
            points: [
              { x: 0.15, y: 0.3 },
              { x: 0.85, y: 0.3 },
            ],
          },
        },
      })
    );
    expect(result?.actorRoutes).toEqual([]);
    expect(result?.cameraPath?.source).toBe("structured");
    expect(result?.cameraPath?.points).toEqual([
      { x: 0.15, y: 0.3 },
      { x: 0.85, y: 0.3 },
    ]);
    expect(result?.needsReview).toBe(true);
  });

  it("相同输入得到相同 revision；人工端点在重编译后保留并标修订复核", () => {
    const first = compileManhuaDirectorBoardOverlay(base());
    const again = compileManhuaDirectorBoardOverlay(base());
    expect(first?.sourceRevision).toBe(again?.sourceRevision);
    const adjusted = first && {
      ...first,
      actorRoutes: first.actorRoutes.map((route, index) =>
        index === 0
          ? {
              ...route,
              points: [{ x: 0.07, y: 0.73 }, route.points[1]!],
              source: "user_adjusted" as const,
              confidence: 1,
            }
          : route
      ),
      userAdjusted: true,
      needsReview: false,
    };
    const recompiled = compileManhuaDirectorBoardOverlay(
      base({
        sourceRevision: "script-revision-2",
        existingOverlay: adjusted,
      })
    );
    expect(recompiled?.actorRoutes[0]?.points[0]).toEqual({ x: 0.07, y: 0.73 });
    expect(recompiled?.sourceRevision).toBe("script-revision-2");
    expect(recompiled?.userAdjusted).toBe(true);
    expect(recompiled?.needsReview).toBe(true);
  });

  it("同一底图的自动轨迹确认后保持已确认；重出底图只标待复核", () => {
    const first = compileManhuaDirectorBoardOverlay(
      base({ baseMediaIdentity: "https://cdn.example/board-a.png" }),
    )!;
    const confirmed = { ...first, needsReview: false };
    const stable = compileManhuaDirectorBoardOverlay(
      base({
        baseMediaIdentity: "https://cdn.example/board-a.png?signed=rotated",
        existingOverlay: confirmed,
      }),
    );
    expect(stable?.sourceRevision).toBe(confirmed.sourceRevision);
    expect(stable?.needsReview).toBe(false);

    const rebound = compileManhuaDirectorBoardOverlay(
      base({
        baseMediaIdentity: "https://cdn.example/board-b.png",
        existingOverlay: confirmed,
      }),
    );
    expect(rebound?.sourceRevision).not.toBe(confirmed.sourceRevision);
    expect(rebound?.needsReview).toBe(true);
  });

  it("段级 UI 与消费共用同一 revision；换板或改整段动作后恢复待复核", () => {
    const segmentInput = {
      episodeIndex: 2,
      segmentIndex: 3,
      segmentBoardUrls: { 3: "https://cdn.example/segment-03.png" },
      segmentFirstShotStillUrl: "https://cdn.example/shot-07.png",
      beat: {
        castZh: "沈策",
        performanceZh: "沈策从画面左侧向右走",
        lightingCameraZh: "镜头向右横移跟拍",
      },
      shots: [
        { index: 7, actionZh: "沈策从画面左侧向中央走", cameraZh: "固定机位" },
        { index: 8, actionZh: "沈策从中央继续向画面右侧走", cameraZh: "向右跟拍" },
      ],
    };
    const compiled = compileManhuaSegmentDirectorBoardOverlay({
      ...segmentInput,
      baseAspectRatio: "9:16",
    })!;
    const confirmed = { ...compiled, needsReview: false };

    const consumed = compileManhuaSegmentDirectorBoardOverlay({
      ...segmentInput,
      existingOverlay: confirmed,
    });
    expect(consumed).toEqual(confirmed);

    const changedBoard = compileManhuaSegmentDirectorBoardOverlay({
      ...segmentInput,
      segmentBoardUrls: { 3: "https://cdn.example/segment-03-v2.png" },
      existingOverlay: confirmed,
    });
    expect(changedBoard?.sourceRevision).not.toBe(confirmed.sourceRevision);
    expect(changedBoard?.baseAspectRatio).toBe("9:16");
    expect(changedBoard?.needsReview).toBe(true);

    const changedAction = compileManhuaSegmentDirectorBoardOverlay({
      ...segmentInput,
      shots: [
        segmentInput.shots[0],
        { ...segmentInput.shots[1], actionZh: "沈策从中央退回画面左侧" },
      ],
      existingOverlay: confirmed,
    });
    expect(changedAction?.sourceRevision).not.toBe(confirmed.sourceRevision);
    expect(changedAction?.needsReview).toBe(true);
  });

  it("消费端旧草稿没有 overlay 或同段底图时保持空值惰性", () => {
    expect(
      compileManhuaSegmentDirectorBoardOverlay({
        episodeIndex: 1,
        segmentIndex: 1,
        segmentFirstShotStillUrl: "https://cdn.example/shot-01.png",
        shots: [{ index: 1, actionZh: "人物从左向右走" }],
      }),
    ).toBeNull();
    expect(
      compileManhuaSegmentDirectorBoardOverlay({
        episodeIndex: 1,
        segmentIndex: 1,
        baseAspectRatio: "16:9",
        shots: [{ index: 1, actionZh: "人物从左向右走" }],
      }),
    ).toBeNull();
  });
});
