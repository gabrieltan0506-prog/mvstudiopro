import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import {
  createManhuaPrevisStudio,
  formatPrevisMotionGuide,
} from "@shared/manhuaPrevis";
import {
  manhuaGeneratedPrevisCoverageIssue,
  manhuaPrevisSourceLabel,
} from "@shared/manhuaPrevisScope";
import { parseManhuaClipTargetDurationSec } from "@shared/manhuaScriptWorkbench";
import { clampManhuaClipDurationSecForVideoModel } from "@shared/manhuaSeedanceLayout";
import {
  buildManhuaCloudDraftPayload,
  parseManhuaCloudDraftPayload,
} from "@shared/manhuaCloudDraft";
import { defaultCanvasBlock } from "./canvasTypes";

function fixture() {
  const studio = createManhuaPrevisStudio(
    5,
    "11111111-1111-4111-8111-111111111111"
  );
  studio.spec.scriptSource = {
    compilerVersion: 1,
    shots: [{ index: 2, durationSec: 5, actionZh: "阿菁抬臂保护" }],
    unmappedShotIndices: [],
  };
  const take = {
    jobId: "previs-old",
    requestId: "22222222-2222-4222-8222-222222222222",
    gcsUri: "gs://offline/old.mp4",
    url: "https://offline.invalid/old.mp4",
    durationSec: 5,
    createdAt: "2026-09-20",
    spec: structuredClone(studio.spec),
  };
  studio.history = [take];
  studio.selectedJobId = take.jobId;
  const reference = {
    gcsUri: take.gcsUri,
    url: take.url,
    durationSec: 5,
    updatedAt: take.createdAt,
    motionGuideZh: formatPrevisMotionGuide(take.spec),
  };
  return { studio, take, reference };
}
function realPublish(
  block: ReturnType<typeof defaultCanvasBlock>,
  sourceShots: Array<{ index: number }>
) {
  const source = readFileSync(
    new URL("../components/canvas/ManhuaPrevisStudio.tsx", import.meta.url),
    "utf8"
  );
  const sf = ts.createSourceFile(
    "studio.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
  let body = "";
  function visit(n: ts.Node) {
    if (ts.isFunctionDeclaration(n) && n.name?.text === "publish")
      body = n.getText(sf);
    ts.forEachChild(n, visit);
  }
  visit(sf);
  expect(body).toBeTruthy();
  const updates: unknown[] = [];
  const errors: string[] = [];
  const latest = {
    current: {
      block,
      studio: block.previsStudio,
      onChange: (...args: unknown[]) => {
        updates.push(args);
        return true;
      },
    },
  };
  const context = {
    latest,
    sourceShots,
    setError: (error: string) => errors.push(error),
    manhuaGeneratedPrevisCoverageIssue,
    parseManhuaClipTargetDurationSec,
    clampManhuaClipDurationSecForVideoModel,
  };
  const fn = runInNewContext(
    ts.transpileModule(body, {
      compilerOptions: { target: ts.ScriptTarget.ES2022 },
    }).outputText + "\npublish",
    context
  );
  return { publish: fn, updates, errors, latest };
}
describe("白模现有来源与整段覆盖", () => {
  it("有记录只展示真实原镜，无记录不猜当前镜", () => {
    const f = fixture();
    expect(manhuaPrevisSourceLabel(f.take.spec)).toBe("原稿来源：第 2 镜");
    expect(manhuaPrevisSourceLabel()).toContain("未记录原镜归属");
    f.studio.spec.scriptSource!.unmappedShotIndices = [2];
    expect(manhuaPrevisSourceLabel(f.studio.spec)).toContain("未自动映射");
  });
  it("真实publish同时拦截采用及旧参考恢复，未改旧候选与媒体", () => {
    const f = fixture();
    const block = {
      ...defaultCanvasBlock("video", 0, 0),
      prompt: "【第1段·15s】",
      videoModel: "seedance-2.5" as const,
      previsStudio: f.studio,
      manhuaSegmentRefs: { previs: f.reference },
    };
    const before = structuredClone(block);
    const p = realPublish(block, [{ index: 1 }, { index: 2 }, { index: 3 }]);
    expect(p.publish(f.studio, f.reference)).toBe(false);
    expect(
      p.publish({ ...f.studio, selectedJobId: undefined }, f.reference)
    ).toBe(false);
    expect(p.errors.every(e => e.includes("系统白模"))).toBe(true);
    expect(p.updates).toEqual([]);
    expect(block).toEqual(before);
    expect(p.publish(f.studio)).toBe(true); // 保存/恢复配置和候选本身不受阻
  });
  it("真实publish放行同长同镜系统候选与手动短参考", () => {
    const f = fixture();
    const block = {
      ...defaultCanvasBlock("video", 0, 0),
      prompt: "【第1段·5s】",
      videoModel: "seedance-2.5" as const,
      previsStudio: f.studio,
    };
    const p = realPublish(block, [{ index: 2 }]);
    expect(p.publish(f.studio, f.reference)).toBe(true);
    const manual = {
      url: "https://offline.invalid/manual.mp4",
      durationSec: 2,
      updatedAt: "2026-09-20",
    };
    expect(p.publish(f.studio, manual)).toBe(true);
    expect(p.updates).toHaveLength(2);
  });
  it("同长却归属别镜仍拒绝；未记录来源不伪造镜号", () => {
    const f = fixture();
    expect(
      manhuaGeneratedPrevisCoverageIssue({
        reference: f.reference,
        studio: f.studio,
        durationSec: 5,
        shotIndexes: [3],
      })
    ).toContain("别镜");
    f.take.spec.scriptSource!.shots.push({
      index: 3,
      durationSec: 5,
      actionZh: "墨屠护住阿菁",
    });
    expect(
      manhuaGeneratedPrevisCoverageIssue({
        reference: f.reference,
        studio: f.studio,
        durationSec: 5,
        shotIndexes: [3, 2],
      })
    ).toContain("别镜");
    delete f.take.spec.scriptSource;
    expect(
      manhuaGeneratedPrevisCoverageIssue({
        reference: f.reference,
        studio: f.studio,
        durationSec: 5,
        shotIndexes: [3],
      })
    ).toBeUndefined();
    expect(manhuaPrevisSourceLabel(f.take.spec)).toContain("未记录");
  });
  it("云备份往返保留来源及系统标识，旧选用恢复后仍不能以5秒替15秒", () => {
    const f = fixture();
    const block = {
      ...defaultCanvasBlock("video", 0, 0),
      id: "clip-e01-g01",
      previsStudio: f.studio,
      manhuaSegmentRefs: { previs: f.reference },
    };
    const restored = parseManhuaCloudDraftPayload(
      JSON.stringify(
        buildManhuaCloudDraftPayload({
          writerSession: {},
          blocks: [block],
          edges: [],
        })
      )
    )!.canvas.blocks[0];
    expect(restored.previsStudio!.history[0].spec.scriptSource).toEqual(
      f.take.spec.scriptSource
    );
    expect(
      manhuaGeneratedPrevisCoverageIssue({
        reference: restored.manhuaSegmentRefs!.previs,
        studio: restored.previsStudio,
        durationSec: 15,
      })
    ).toContain("系统白模");
    expect(restored.manhuaSegmentRefs!.previs!.url).toBe(f.reference.url);
  });
  it("历史缺失仍按已有系统专属动作说明拦截；普通短上传不被阻断", () => {
    const f = fixture();
    expect(
      manhuaGeneratedPrevisCoverageIssue({
        reference: f.reference,
        durationSec: 15,
      })
    ).toContain("系统白模");
    expect(
      manhuaGeneratedPrevisCoverageIssue({
        reference: { ...f.reference, motionGuideZh: undefined },
        durationSec: 15,
      })
    ).toBeUndefined();
  });
});
