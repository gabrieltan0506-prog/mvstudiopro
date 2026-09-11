import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import {
  buildManhuaWriterSession,
  parseManhuaWriterSession,
  serializeManhuaWriterSession,
  MANHUA_WRITER_SESSION_FORMAT,
} from "@shared/manhuaWriterSession";
import {
  parseManhuaCloudDraftPayload,
  serializeManhuaCloudDraftPayload,
} from "@shared/manhuaCloudDraft";

const omniSource = readFileSync(new URL("../pages/OmniCanvas.tsx", import.meta.url), "utf8");
const workbenchSource = readFileSync(
  new URL("../components/ManhuaScriptWorkbench.tsx", import.meta.url),
  "utf8",
);
const pipelineSource = readFileSync(new URL("./canvasDramaStudio.ts", import.meta.url), "utf8");
const sessionSource = readFileSync(
  new URL("../../../shared/manhuaWriterSession.ts", import.meta.url),
  "utf8",
);

describe("漫剧分镜容量模式接线（manhuaSegmentCapacityMode）", () => {
  it("runFactory 把本集容量模式喂给 ensureManhuaFragmentClips，超容量在扣费前抛错", () => {
    const factory = omniSource
      .split("const runFactory = useCallback(")[1]!
      .split("const handleRetakeClip = useCallback(")[0]!;
    expect(factory).toMatch(
      /segmentCapacityMode: getManhuaSegmentCapacityMode\(\s*segmentCapacityModeByEpisode,\s*episodeIndex,\s*\)/,
    );
    // 只断言「它在依赖数组里」，不断言排第几：0911 有人往数组尾部追加依赖，
    // 旧的按位置写死的断言就红了，但接线其实没坏。依赖真漏了才是问题——
    // 回调会闭包住旧的容量模式，换集后按上一集的容量扣费。
    const tree = ts.createSourceFile("OmniCanvas.tsx", omniSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let dependencies: string[] = [];
    const visit = (node: ts.Node) => {
      if (ts.isVariableDeclaration(node) && node.name.getText(tree) === "runFactory" && node.initializer && ts.isCallExpression(node.initializer)) {
        const values = node.initializer.arguments[1];
        if (values && ts.isArrayLiteralExpression(values)) dependencies = values.elements.map(value => value.getText(tree));
      }
      ts.forEachChild(node, visit);
    };
    visit(tree);
    expect(dependencies).toContain("segmentCapacityModeByEpisode");
    expect(pipelineSource).toContain("segmentCapacityMode?: ManhuaSegmentCapacityMode | null;");
    expect(pipelineSource).toMatch(
      /planManhuaSegmentCapacity\(\{[\s\S]*?mode: opts\.segmentCapacityMode,[\s\S]*?\}\);\s*if \(!capacityPlan\.ok\) throw new Error\(capacityPlan\.errorZh\);/,
    );
  });

  it("按集持久化：本机会话与云快照都带 segmentCapacityModeByEpisode，恢复时归一化", () => {
    expect(sessionSource).toContain("segmentCapacityModeByEpisode: Record<string, ManhuaSegmentCapacityMode>;");
    expect(sessionSource).toContain(
      "segmentCapacityModeByEpisode: normalizeManhuaSegmentCapacityModeByEpisode(",
    );
    // 本机 LS effect 与云快照两处都要写
    expect(omniSource.match(/^\s+segmentCapacityModeByEpisode,$/gm)?.length ?? 0).toBeGreaterThanOrEqual(4);
    expect(omniSource).toContain(
      "setSegmentCapacityModeByEpisode(\n      normalizeManhuaSegmentCapacityModeByEpisode(session.segmentCapacityModeByEpisode),",
    );
  });

  it("工作台有按集选择器，且与生成入口读同一份模式", () => {
    expect(workbenchSource).toContain("data-manhua-segment-capacity-mode");
    expect(workbenchSource).toContain("onSegmentCapacityModeChange?.(");
    expect(workbenchSource).toContain("getManhuaSegmentCapacityMode(segmentCapacityModeByEpisode, focusEpisode)");
    expect(omniSource).toContain("segmentCapacityModeByEpisode={segmentCapacityModeByEpisode}");
    expect(omniSource).toContain("onSegmentCapacityModeChange={setSegmentCapacityModeForEpisode}");
  });

  it("会话 / 云草稿 sanitizer 白名单放行该字段，非法值被清洗", () => {
    const session = buildManhuaWriterSession({
      format: MANHUA_WRITER_SESSION_FORMAT,
      segmentCapacityModeByEpisode: { "1": "auto_by_source", "2": "bogus" as never },
    });
    expect(session.segmentCapacityModeByEpisode).toEqual({ "1": "auto_by_source" });
    const round = parseManhuaWriterSession(serializeManhuaWriterSession(session));
    expect(round?.segmentCapacityModeByEpisode).toEqual({ "1": "auto_by_source" });

    const draft = parseManhuaCloudDraftPayload(
      JSON.parse(serializeManhuaCloudDraftPayload({
        format: "mv-manhua-cloud-draft-v1",
        clientUpdatedAt: new Date(0).toISOString(),
        writerSession: session,
        canvas: { blocks: [], edges: [] },
      })),
    );
    expect(draft?.writerSession.segmentCapacityModeByEpisode).toEqual({ "1": "auto_by_source" });
  });

  it("资产门禁空表时横幅给「从剧本提取资产表」出路，不再是死路", () => {
    expect(omniSource).toContain('data-manhua-action="extract-asset-tables"');
    expect(omniSource).toContain("deriveWriterAssetTablesFromScript({");
    expect(omniSource.match(/setWriterConfirmAssetTablesEmpty\(densityGate\.assetTablesEmpty\);/g)).toHaveLength(2);
  });

  it("容量对照带时长档；补跑/重拍的 ensure 也传容量模式；段表重排前弹确认", () => {
    const omni = readFileSync(new URL("../pages/OmniCanvas.tsx", import.meta.url), "utf8");
    expect(omni).toContain("lengthTierId: writerLengthTierId,");
    expect((omni.match(/segmentCapacityMode: getManhuaSegmentCapacityMode\(/g) || []).length).toBeGreaterThanOrEqual(5);
    expect(omni).toContain("countManhuaRenderedClipsToArchiveOnResegment(");
    expect(omni).toContain("段表重排未确认，未扣费");
    const wb = readFileSync(new URL("../components/ManhuaScriptWorkbench.tsx", import.meta.url), "utf8");
    expect(wb).toContain("lengthTierId: episodeLengthTierId,");
  });
});
