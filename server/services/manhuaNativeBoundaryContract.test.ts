import { describe, it, expect, vi, afterEach } from "vitest";
import {
  buildBoundaryEvidenceBundle,
  prepareBoundaryStructuringBatch,
} from "./manhuaNativeBoundaryExperiment";
import { buildBoundaryStructuringContract } from "./manhuaNativeBoundaryContract";
import {
  nativeDeepReadStructuringJsonSchema,
  invokeNativeDeepReadGlmStructuring,
} from "./manhuaNativeDeepReadRunner";
import { invokeGlmJsonChatWithGatewayFallback } from "./bailianChat";
function fixture() {
  const bundle = buildBoundaryEvidenceBundle(
    [1, 2].map(attemptNumber => ({
      sourceDigest: "test-source",
      segmentIndex: 0,
      attemptNumber,
      startSec: 0,
      endSec: 10,
      rawObjectName: `test-only/${attemptNumber}.json`,
      gate: { status: "accepted" as const },
      raw: {
        shots: [
          {
            startSec: 0,
            endSec: 2,
            evidenceRole: "story",
            hintZh: attemptNumber === 1 ? "男子开门" : "女子关门",
          },
        ],
      },
    }))
  );
  const contract = buildBoundaryStructuringContract(
    nativeDeepReadStructuringJsonSchema(),
    bundle
  );
  const output = {
    shots: [],
    keyMoments: [],
    subtitles: [],
    audioResolution: [],
    beatStructureZh: "测试节拍",
    moodArcZh: "测试情绪",
    reusableZh: "测试手法",
    genPromptHintZh: "测试提示",
    classification: {
      emotionTagsZh: [],
      narrativeFeatureTagsZh: [],
      performanceTagsZh: [],
      audiovisualTagsZh: [],
      audienceExperienceTagsZh: [],
    },
    _unresolvedEvidence: bundle.evidence.map(e => ({
      sourceIds: [e.id],
      reasonZh: "两稿矛盾",
      row: e.row,
    })),
    _conflictResolutions: contract.groups.map(g => ({
      ...g,
      status: "unresolved",
      selectedSourceIds: [],
      reasonZh: "两稿矛盾无法确认",
    })),
  };
  return { bundle, contract, output };
}
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
describe("多稿冲突schema与返回强校验", () => {
  it("真实来源形成冲突组且默认schema不变", () => {
    const before = JSON.stringify(nativeDeepReadStructuringJsonSchema());
    const { contract, output } = fixture();
    expect(contract.groups).toHaveLength(1);
    expect(contract.groups[0]!.sourceIds).toHaveLength(2);
    expect(() => contract.validate(output)).not.toThrow();
    expect(JSON.stringify(nativeDeepReadStructuringJsonSchema())).toBe(before);
  });
  it.each(["_conflictResolutions", "_unresolvedEvidence"])(
    "缺少必填%s拒收",
    key => {
      const { contract, output } = fixture();
      const bad: Record<string, unknown> = structuredClone(output);
      delete bad[key];
      expect(() => contract.validate(bad)).toThrow("schema");
    }
  );
  it("拒收假已解决、虚构来源、篡改原文和重复组", () => {
    const { contract, output } = fixture();
    const bad = structuredClone(output);
    bad._conflictResolutions[0]!.status = "resolved";
    expect(() => contract.validate(bad)).toThrow("状态");
    const invented = structuredClone(output);
    invented._unresolvedEvidence[0]!.sourceIds = ["test-invented"];
    expect(() => contract.validate(invented)).toThrow("对账");
    const changed = structuredClone(output);
    changed._unresolvedEvidence[0]!.row.hintZh = "无依据新动作";
    expect(() => contract.validate(changed)).toThrow("原文");
    const duplicate = structuredClone(output);
    duplicate._conflictResolutions.push(duplicate._conflictResolutions[0]!);
    expect(() => contract.validate(duplicate)).toThrow("schema");
  });
  it("正文缺少来源拒收；保留全部替代原文才能接受取舍", () => {
    const { contract, output, bundle } = fixture();
    expect(() =>
      contract.validate({ ...output, shots: [bundle.evidence[0]!.row] })
    ).toThrow("_sourceIds");
    const row = {
      ...bundle.evidence[0]!.row,
      _sourceIds: bundle.evidence.map(e => e.id),
      _sourceAlternatives: [
        { sourceId: bundle.evidence[1]!.id, fields: bundle.evidence[1]!.row },
      ],
    };
    const good = {
      ...output,
      shots: [row],
      _unresolvedEvidence: [],
      _conflictResolutions: contract.groups.map(g => ({
        ...g,
        status: "resolved",
        selectedSourceIds: [bundle.evidence[0]!.id],
        reasonZh: "测试取舍并保留另一稿原文",
      })),
    };
    expect(() => contract.validate(good)).not.toThrow();
    expect(() =>
      contract.validate({ ...good, shots: [{ ...row, endSec: 9 }] })
    ).toThrow("对账");
  });
  it("runner实际挂schema；raw先存，坏输出不能成为parsed", async () => {
    const { bundle, output } = fixture();
    const order: string[] = [];
    let captured: any;
    const invoke = vi.fn(async (p: any) => {
      captured = p;
      const content = JSON.stringify(output);
      await p.onRawResponse({
        gateway: "openrouter",
        model: "z-ai/glm-5.3",
        httpStatus: 200,
        contentType: "application/json",
        bodyText: content,
        bodyComplete: true,
        receivedBytes: Buffer.byteLength(content),
      });
      p.validateContent(content);
      return {
        gateway: "openrouter",
        model: "z-ai/glm-5.3",
        gatewayTrace: [],
        usage: {},
        choices: [{ finish_reason: "stop" }],
      };
    });
    const deps = {
      invoke: invoke as never,
      evidence: {
        getBucket: () => "mv-studio-pro-vertex-video-temp",
        upload: vi.fn(async (p: any) => {
          order.push(p.objectName.split("/").at(-1));
          return { created: true, generation: "test" };
        }) as never,
      },
    };
    const result = await invokeNativeDeepReadGlmStructuring(
      { system: "测试", user: "测试", boundaryEvidence: bundle },
      undefined,
      undefined,
      deps
    );
    expect(result.raw._conflictResolutions).toHaveLength(1);
    expect(captured.requireResponseJsonSchema).toBe(true);
    expect(captured.responseJsonSchema.schema.required).toContain(
      "_conflictResolutions"
    );
    expect(order).toEqual(["request.json", "raw-1.json", "parsed.json"]);
    delete (output as Record<string, unknown>)._conflictResolutions;
    order.length = 0;
    await expect(
      invokeNativeDeepReadGlmStructuring(
        { system: "测试", user: "测试", boundaryEvidence: bundle },
        undefined,
        undefined,
        deps
      )
    ).rejects.toThrow("schema");
    expect(order).toEqual(["request.json", "raw-1.json"]);
  });
  it("OpenRouter发包使用json_schema，不支持的fallback不能降级", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    vi.stubEnv("EVOLINK_API_KEY", "test-key");
    vi.stubEnv("WAN_PLAN_API_KEY", "test-key");
    const calls: any[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url, init) => {
        calls.push(JSON.parse(init.body));
        return new Response(
          JSON.stringify({
            choices: [
              { finish_reason: "stop", message: { content: '{"ok":true}' } },
            ],
            usage: {},
            model: "z-ai/glm-5.3",
          }),
          { headers: { "content-type": "application/json" } }
        );
      })
    );
    const schema = {
      name: "test",
      schema: {
        type: "object",
        properties: { ok: { type: "boolean" } },
        required: ["ok"],
        additionalProperties: false,
      },
    };
    await invokeGlmJsonChatWithGatewayFallback({
      system: "test",
      user: "test",
      gatewayOrder: ["plan_bj_qwen"],
      responseJsonSchema: schema,
      requireResponseJsonSchema: true,
    });
    expect(calls[0].response_format).toEqual({
      type: "json_schema",
      json_schema: { ...schema, strict: true },
    });
    calls.length = 0;
    // 0906：GLM 两档（OpenRouter/EvoLink）不接强制 schema，发包前拒绝
    await expect(
      invokeGlmJsonChatWithGatewayFallback({
        system: "test",
        user: "test",
        gatewayOrder: ["openrouter"],
        responseJsonSchema: schema,
        requireResponseJsonSchema: true,
      })
    ).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });
});

it("四片齐后一次组装；首发单稿原样保留，仅重试片处理两到三稿", () => {
  const attempts = [0, 1, 2, 3].flatMap(segmentIndex =>
    Array.from({ length: segmentIndex === 1 ? 3 : 1 }, (_, i) => ({
      sourceDigest: "test-source",
      segmentIndex,
      attemptNumber: i + 1,
      startSec: segmentIndex * 10,
      endSec: segmentIndex * 10 + 10,
      rawObjectName: `test-only/${segmentIndex}-${i}.json`,
      gate: { status: "accepted" as const },
      raw: {
        shots: [
          {
            startSec: segmentIndex * 10,
            endSec: segmentIndex * 10 + 2,
            evidenceRole: "story",
            hintZh: `原稿${segmentIndex}完整观察${i}`,
          },
        ],
        marker: `原稿${segmentIndex}附加字段`,
      },
    }))
  );
  const bundle = buildBoundaryEvidenceBundle(attempts);
  const result = prepareBoundaryStructuringBatch(bundle);
  expect(result.rawSegments).toHaveLength(4);
  expect(result.unchangedSegments).toEqual([0, 2, 3]);
  expect(result.processed.map(p => p.segmentIndex)).toEqual([1]);
  expect(result.processed[0]!.facts.stats.inputRecords).toBe(3);
  for (const id of [0, 2, 3])
    expect(result.rawSegments[id]).toEqual(
      bundle.annotated.find(r => (r._sourceAttempt as any).segmentIndex === id)
    );
});
