import { readFileSync } from "node:fs";
import ts from "typescript";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MANHUA_BOARD_MOTION_OVERLAY_FORMAT } from "@shared/manhuaDirectorBoardOverlay";
import { collectManhuaBackupImageSources } from "./manhuaBackupImageSources";
import { buildManhuaCloudDraftPayload } from "@shared/manhuaCloudDraft";
import {
  loadManhuaDirectorBoardBySegment,
  loadManhuaDirectorBoardMainByEpisode,
  loadManhuaDirectorBoardOverlayBySegment,
  normalizeDirectorBoardBySegment,
  normalizeDirectorBoardMainByEpisode,
  normalizeDirectorBoardOverlayBySegment,
  saveManhuaDirectorBoardBySegment,
  saveManhuaDirectorBoardMainByEpisode,
  saveManhuaDirectorBoardOverlayBySegment,
} from "./manhuaDirectorBoardStore";

afterEach(() => vi.unstubAllGlobals());

function board(label: string) {
  return {
    gcsUri: `gs://test-bucket/${label}.png`,
    url: `https://example.invalid/${label}.png`,
  };
}

function overlay() {
  return {
    format: MANHUA_BOARD_MOTION_OVERLAY_FORMAT,
    episodeIndex: 1,
    segmentIndex: 1,
    shotIndex: 1,
    imageSpace: "normalized",
    sourceRevision: "test-revision",
    baseAspectRatio: "16:9",
    actorRoutes: [],
    cameraPath: null,
    axis: { subjectAnchors: [{ entityId: "甲", at: { x: 0.4, y: 0.6 } }] },
    landingPoints: [],
    userAdjusted: false,
    needsReview: true,
  };
}

function setup() {
  const values = new Map<string, string>();
  const localStorage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
  vi.stubGlobal("window", { localStorage });
  vi.stubGlobal("localStorage", localStorage);
  let main = normalizeDirectorBoardMainByEpisode({ 1: board("old-main") });
  let segment = normalizeDirectorBoardBySegment({
    1: { 1: board("old-segment") },
  });
  let overlays = normalizeDirectorBoardOverlayBySegment({
    1: { 1: overlay() },
  });
  saveManhuaDirectorBoardMainByEpisode(main);
  saveManhuaDirectorBoardBySegment(segment);
  saveManhuaDirectorBoardOverlayBySegment(overlays);
  expect(loadManhuaDirectorBoardMainByEpisode()[1]).toEqual(board("old-main"));
  expect(loadManhuaDirectorBoardBySegment()[1]?.[1]).toEqual(
    board("old-segment")
  );
  expect(loadManhuaDirectorBoardOverlayBySegment()[1]?.[1]).toBeDefined();

  // 执行真实恢复回调中的板图段，不在测试里重写恢复分支。
  const source = readFileSync(
    new URL("../pages/OmniCanvas.tsx", import.meta.url),
    "utf8"
  );
  const callbackStart = source.indexOf(
    "const applyCloudDraftToUi = useCallback("
  );
  const begin = source.indexOf(
    "materializedBoardIdsRef.current.clear();",
    callbackStart
  );
  const end = source.indexOf("const restoredCastLane =", begin);
  if (callbackStart < 0 || begin < 0 || end < 0)
    throw new Error("找不到真实板图恢复段");
  const compiled = ts.transpileModule(source.slice(begin, end), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.None,
    },
  }).outputText;
  const materializedBoardIdsRef = {
    current: new Set(["board-e01", "board-e01-s01"]),
  };
  const resignedPropGcsUriRef = {
    current: new Set(["gs://test-bucket/old-prop.png"]),
  };
  const resignedBoardGcsUriRef = {
    current: new Set(["gs://test-bucket/old-main.png"]),
  };
  const setMain = vi.fn((value: typeof main) => {
    main = value;
  });
  const setSegment = vi.fn((value: typeof segment) => {
    segment = value;
  });
  const setOverlays = vi.fn((value: typeof overlays) => {
    overlays = value;
  });
  const deps = {
    materializedBoardIdsRef,
    resignedPropGcsUriRef,
    resignedBoardGcsUriRef,
    normalizeDirectorBoardMainByEpisode,
    normalizeDirectorBoardBySegment,
    normalizeDirectorBoardOverlayBySegment,
    saveManhuaDirectorBoardMainByEpisode,
    saveManhuaDirectorBoardBySegment,
    saveManhuaDirectorBoardOverlayBySegment,
    setDirectorBoardMainByEpisode: setMain,
    setDirectorBoardBySegment: setSegment,
    setDirectorBoardMotionOverlayBySegment: setOverlays,
  };
  const execute = new Function("prefs", ...Object.keys(deps), compiled);
  return {
    restore: (prefs: Record<string, unknown>) =>
      execute(prefs, ...Object.values(deps)),
    prefs: () => ({
      directorBoardMainByEpisode: main,
      directorBoardBySegment: segment,
      directorBoardMotionOverlayBySegment: overlays,
    }),
    materializedBoardIdsRef,
    resignedPropGcsUriRef,
    resignedBoardGcsUriRef,
    setters: [setMain, setSegment, setOverlays],
  };
}

describe("工作区恢复真实板图分支", () => {
  it.each([
    {},
    {
      directorBoardMainByEpisode: null,
      directorBoardBySegment: null,
      directorBoardMotionOverlayBySegment: null,
    },
  ])("旧快照缺板图时清空当前 UI 和独立存储，不污染后续备份：%j", prefs => {
    const state = setup();
    state.restore(prefs);
    expect(state.prefs()).toEqual({
      directorBoardMainByEpisode: {},
      directorBoardBySegment: {},
      directorBoardMotionOverlayBySegment: {},
    });
    for (const setter of state.setters) expect(setter).toHaveBeenCalledOnce();
    expect(state.materializedBoardIdsRef.current.size).toBe(0);
    expect(state.resignedPropGcsUriRef.current.size).toBe(0);
    expect(state.resignedBoardGcsUriRef.current.size).toBe(0);
    expect(loadManhuaDirectorBoardMainByEpisode()).toEqual({});
    expect(loadManhuaDirectorBoardBySegment()).toEqual({});
    expect(loadManhuaDirectorBoardOverlayBySegment()).toEqual({});
    expect(
      collectManhuaBackupImageSources(
        buildManhuaCloudDraftPayload({
          writerSession: {},
          blocks: [],
          edges: [],
          factoryPrefs: state.prefs(),
        })
      )
    ).toEqual([]);
  });

  it("合法新板保留长期身份与访问地址，刷新和再备份只消费新板", () => {
    const state = setup();
    state.restore({
      directorBoardMainByEpisode: { 2: board("new-main") },
      directorBoardBySegment: { 2: { 3: board("new-segment") } },
      directorBoardMotionOverlayBySegment: { 1: { 1: overlay() } },
    });
    const prefs = state.prefs();
    expect(prefs.directorBoardMainByEpisode).toEqual({ 2: board("new-main") });
    expect(prefs.directorBoardBySegment).toEqual({
      2: { 3: board("new-segment") },
    });
    expect(loadManhuaDirectorBoardMainByEpisode()).toEqual(
      prefs.directorBoardMainByEpisode
    );
    expect(loadManhuaDirectorBoardBySegment()).toEqual(
      prefs.directorBoardBySegment
    );
    expect(loadManhuaDirectorBoardOverlayBySegment()).toEqual(
      prefs.directorBoardMotionOverlayBySegment
    );
    expect(
      collectManhuaBackupImageSources(
        buildManhuaCloudDraftPayload({
          writerSession: {},
          blocks: [],
          edges: [],
          factoryPrefs: prefs,
        })
      )
    ).toEqual([
      { sourceUrl: board("new-main").url, gcsUri: board("new-main").gcsUri },
      {
        sourceUrl: board("new-segment").url,
        gcsUri: board("new-segment").gcsUri,
      },
    ]);
  });
});
