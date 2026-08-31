import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

// 本模块只验包装器行为；所有上游与生产常量以虚构夹具隔离，不加载生产服务。
vi.mock("./manhuaNativeDeepReadRunner", () => ({
  NATIVE_DEEP_READ_GENERATION_CONFIG: {
    temperature: 0.7, maxOutputTokens: 65_536, candidateCount: 1, audioTimestamp: true,
    responseMimeType: "application/json", responseSchema: { type: "OBJECT", required: ["shots"] },
    thinkingConfig: { thinkingLevel: "HIGH", includeThoughts: false },
    mediaResolution: "MEDIA_RESOLUTION_MEDIUM",
  },
  NATIVE_DEEP_READ_RETRY_TEMPERATURES: [0.7, 0.6, 0.55],
}));

import { NATIVE_DEEP_READ_GENERATION_CONFIG } from "./manhuaNativeDeepReadRunner";
import { measureNativeProbeConcurrency } from "./manhuaNativeDeepReadProbeEvidence";
import {
  assertNativeProbeImage,
  createNativeProbeAuditedPost,
  NATIVE_PROBE_ATTESTATION_REQUIRED_PATHS,
  verifyNativeProbeSourceAttestation,
  type NativeProbeRequestAudit,
  type NativeProbeTransportEvent,
} from "./manhuaNativeDeepReadProbeRuntime";

function request(temperature = 0.7) {
  return {
    contents: [{ role: "user", parts: [
      { fileData: { fileUri: "gs://test-bucket/segment.mp4", mimeType: "video/mp4" }, videoMetadata: { fps: 10 } },
      { text: "完整提示词测试夹具" },
    ] }],
    generationConfig: JSON.parse(JSON.stringify({ ...NATIVE_DEEP_READ_GENERATION_CONFIG, temperature })) as Record<string, unknown>,
  };
}

describe("逐次真实请求审计包装器", () => {
  it("审计等待期间不计入传输在途，审计完成后才记录真实调用起止", async () => {
    let finishAudit!: () => void;
    let finishPost!: () => void;
    const auditPending = new Promise<void>((resolve) => { finishAudit = resolve; });
    const postPending = new Promise<void>((resolve) => { finishPost = resolve; });
    const events: NativeProbeTransportEvent[] = [];
    const post = vi.fn(async () => { await postPending; return "响应"; });
    const pending = createNativeProbeAuditedPost(post, () => auditPending, (event) => { events.push(event); })(request());
    expect(events).toEqual([]);
    expect(post).not.toHaveBeenCalled();
    finishAudit();
    await Promise.resolve();
    expect(events.map((event) => event.status)).toEqual(["started"]);
    expect(post).toHaveBeenCalledTimes(1);
    finishPost();
    expect(await pending).toBe("响应");
    expect(events.map((event) => event.status)).toEqual(["started", "completed"]);
    expect(events[0]!.callId).toBe(events[1]!.callId);
    expect(events.every((event) => event.stage === "visual_model" && Number.isFinite(event.observedAtMs))).toBe(true);
  });

  it("两份审计同时等待但真实传输串行时峰值只能是1", async () => {
    const releaseAudit: Array<() => void> = [];
    const events: NativeProbeTransportEvent[] = [];
    const post = vi.fn(async () => "响应");
    const audited = createNativeProbeAuditedPost(post, () => new Promise<void>((resolve) => {
      releaseAudit.push(resolve);
    }), (event) => { events.push(event); });
    const first = audited(request());
    const second = audited(request(0.6));
    expect(events).toEqual([]);
    releaseAudit[0]!();
    await first;
    releaseAudit[1]!();
    await second;
    expect(events.map((event) => event.status)).toEqual(["started", "completed", "started", "completed"]);
    expect(events[0]!.callId).not.toBe(events[2]!.callId);
    expect(measureNativeProbeConcurrency(events)).toEqual({ peak: 1, callCount: 2, errorsZh: [] });
  });

  it("审计或参数失败均为零传输事件，上游失败只记录一对生命周期", async () => {
    const events: NativeProbeTransportEvent[] = [];
    const recordEvent = (event: NativeProbeTransportEvent) => { events.push(event); };
    const post = vi.fn(async () => "响应");
    await expect(createNativeProbeAuditedPost(post, async () => { throw new Error("保存失败"); }, recordEvent)(request())).rejects.toThrow("保存失败");
    await expect(createNativeProbeAuditedPost(post, async () => {}, recordEvent)(request(0.8))).rejects.toThrow("不合规");
    expect(events).toEqual([]);
    expect(post).not.toHaveBeenCalled();
    const failure = new Error("上游失败");
    await expect(createNativeProbeAuditedPost(async () => { throw failure; }, async () => {}, recordEvent)(request())).rejects.toBe(failure);
    expect(events.map((event) => event.status)).toEqual(["started", "failed"]);
    expect(measureNativeProbeConcurrency(events)).toEqual({ peak: 1, callCount: 1, errorsZh: [] });
  });

  it.each([0.7, 0.6, 0.55])("候选梯度 %s 保留 HIGH，审计完成后只发送一次实际快照", async (temperature) => {
    const order: string[] = [];
    const response = { status: 200, text: "测试响应" };
    const body = request(temperature);
    const signal = new AbortController().signal;
    const post = vi.fn(async (_body: unknown, _signal?: AbortSignal) => { order.push("post"); return response; });
    const record = vi.fn(async (audit: NativeProbeRequestAudit) => {
      order.push("audit");
      expect(audit.validation.status).toBe("pass");
      expect(audit.requestSha256).toBe(createHash("sha256").update(JSON.stringify(body)).digest("hex"));
    });
    expect(await createNativeProbeAuditedPost(post, record)(body, signal)).toBe(response);
    expect(order).toEqual(["audit", "post"]);
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith(body, signal);
    expect(post.mock.calls[0]![0]).not.toBe(body);
  });

  it.each([
    { name: "丢失媒体分辨率", change: (body: ReturnType<typeof request>) => { delete body.generationConfig.mediaResolution; } },
    { name: "丢失 Schema", change: (body: ReturnType<typeof request>) => { delete body.generationConfig.responseSchema; } },
    { name: "未知温度", change: (body: ReturnType<typeof request>) => { body.generationConfig.temperature = 0.8; } },
    { name: "旧 budget", change: (body: ReturnType<typeof request>) => { body.generationConfig.thinkingConfig = { thinkingBudget: 12_000 }; } },
    { name: "两种思考参数同传", change: (body: ReturnType<typeof request>) => { body.generationConfig.thinkingConfig = { thinkingLevel: "HIGH", thinkingBudget: 12_000, includeThoughts: false }; } },
    { name: "媒体分辨率移到 Part", change: (body: ReturnType<typeof request>) => {
      delete body.generationConfig.mediaResolution;
      Object.assign(body.contents[0]!.parts[0]!, { mediaResolution: "MEDIA_RESOLUTION_MEDIUM" });
    } },
    { name: "媒体分辨率重复放入 Part", change: (body: ReturnType<typeof request>) => {
      Object.assign(body.contents[0]!.parts[0]!, { mediaResolution: "MEDIA_RESOLUTION_MEDIUM" });
    } },
  ])("$name：保存失败审计后零发送", async ({ change }) => {
    const body = request();
    change(body);
    const post = vi.fn(async (_body: unknown, _signal?: AbortSignal) => ({}));
    const audits: NativeProbeRequestAudit[] = [];
    await expect(createNativeProbeAuditedPost(post, async (audit) => { audits.push(audit); })(body)).rejects.toThrow("探针实际请求不合规");
    expect(audits).toHaveLength(1);
    expect(audits[0]!.validation.status).toBe("fail");
    expect(audits[0]!.requestSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(post).not.toHaveBeenCalled();
  });

  it("审计存储失败时零发送并透传原错误", async () => {
    const failure = new Error("审计对象保存失败");
    const post = vi.fn(async (_body: unknown, _signal?: AbortSignal) => ({}));
    await expect(createNativeProbeAuditedPost(post, async () => { throw failure; })(request())).rejects.toBe(failure);
    expect(post).not.toHaveBeenCalled();
  });

  it("等待审计期间原请求被修改，也只发送已审核快照", async () => {
    const body = request();
    const post = vi.fn(async (_body: unknown, _signal?: AbortSignal) => ({}));
    await createNativeProbeAuditedPost(post, async () => {
      body.generationConfig.temperature = 0.9;
    })(body);
    expect(post.mock.calls[0]![0]).toMatchObject({ generationConfig: { temperature: 0.7 } });
  });

  it("签名媒体地址仅留原始字节哈希；审计不泄漏签名且不截断正文", async () => {
    const body = request();
    body.contents[0]!.parts[0]!.fileData!.fileUri = "https://storage.example.test/video.mp4?X-Goog-Signature=test-signature&X-Goog-Credential=test-credential";
    body.contents[0]!.parts[1]!.text = "真实提示词".repeat(200);
    const audits: NativeProbeRequestAudit[] = [];
    const post = vi.fn(async (_body: unknown, _signal?: AbortSignal) => ({}));
    await createNativeProbeAuditedPost(post, async (audit) => { audits.push(audit); })(body);
    const saved = JSON.stringify(audits[0]);
    expect(saved).toContain("[签名地址已隐藏]");
    expect(saved).not.toContain("test-signature");
    expect(saved).not.toContain("test-credential");
    expect(saved).toContain("真实提示词".repeat(200));
    expect(audits[0]!.requestSha256).toBe(createHash("sha256").update(JSON.stringify(body)).digest("hex"));
    expect(post.mock.calls[0]![0]).toEqual(body);
  });

  it("意外进入请求体的鉴权字段脱敏留证，并阻止发送", async () => {
    const body = { ...request(), headers: { Authorization: "Bearer test-key", Cookie: "test-cookie" }, apiKey: "test-api-key" };
    const audits: NativeProbeRequestAudit[] = [];
    const post = vi.fn(async (_body: unknown, _signal?: AbortSignal) => ({}));
    await expect(createNativeProbeAuditedPost(post, async (audit) => { audits.push(audit); })(body)).rejects.toThrow("鉴权头或凭证");
    const saved = JSON.stringify(audits[0]);
    expect(saved).not.toContain("test-key");
    expect(saved).not.toContain("test-cookie");
    expect(saved).not.toContain("test-api-key");
    expect(post).not.toHaveBeenCalled();
  });

  it("不可序列化请求也先记录明确失败，不伪造请求哈希", async () => {
    const body: Record<string, unknown> = request();
    body.self = body;
    const post = vi.fn(async (_body: unknown, _signal?: AbortSignal) => ({}));
    const audits: NativeProbeRequestAudit[] = [];
    await expect(createNativeProbeAuditedPost(post, async (audit) => { audits.push(audit); })(body)).rejects.toThrow("无法序列化");
    expect(audits[0]).toMatchObject({ requestSha256: null, request: null, validation: { status: "fail" } });
    expect(post).not.toHaveBeenCalled();
  });

  it("上游失败只透传，不因包装器再次发送", async () => {
    const failure = new Error("上游连接中断");
    const post = vi.fn(async () => { throw failure; });
    const record = vi.fn(async () => {});
    await expect(createNativeProbeAuditedPost(post, record)(request())).rejects.toBe(failure);
    expect(post).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledTimes(1);
  });
});

describe("镜像标签身份核对", () => {
  const commit = "a".repeat(40);
  const imageRef = `registry.fly.io/mvstudiopro:sha-${commit}`;
  it("完整提交与镜像 sha 标签一致才返回身份声明", () => {
    expect(assertNativeProbeImage(commit, imageRef)).toEqual({ commit, imageRef });
    expect(assertNativeProbeImage(commit, `${imageRef}@sha256:${"b".repeat(64)}`)).toEqual({ commit, imageRef: `${imageRef}@sha256:${"b".repeat(64)}` });
  });
  it.each([undefined, "", "005f22b", "HEAD", "z".repeat(40)])("非法或缺失提交 %s 不推断 HEAD", (expected) => {
    expect(() => assertNativeProbeImage(expected, imageRef)).toThrow("40 位提交");
  });
  it.each([undefined, "", "registry.fly.io/mvstudiopro:probe-v31", `registry.fly.io/mvstudiopro:sha-${"b".repeat(40)}`, `${imageRef}@sha256:short`])("镜像缺失、probe标签或身份不符 %s 关闭式失败", (actual) => {
    expect(() => assertNativeProbeImage(commit, actual)).toThrow();
  });
});

describe("已推提交的运行时源码清单核验", () => {
  const commit = "a".repeat(40);
  function fixture() {
    const sources = new Map<string, Buffer>(NATIVE_PROBE_ATTESTATION_REQUIRED_PATHS.map((path) =>
      [path, Buffer.from(`测试源码内容：${path}\n`, "utf8")]));
    const manifest = { schemaVersion: 1, commit, files: Array.from(sources).map(([path, bytes]) => ({
      path, sha256: createHash("sha256").update(bytes).digest("hex"),
    })) };
    const readSource = vi.fn(async (path: string) => {
      const bytes = sources.get(path);
      if (!bytes) throw new Error("测试文件不存在");
      return bytes;
    });
    return { sources, manifest, readSource };
  }

  it("全部字节匹配后返回文件数及规范化清单哈希，不返回源码", async () => {
    const { manifest, readSource } = fixture();
    const result = await verifyNativeProbeSourceAttestation(manifest, commit, readSource);
    const canonical = { schemaVersion: 1, commit, files: [...manifest.files].sort((a, b) => a.path < b.path ? -1 : 1) };
    expect(result).toEqual({ commit, filesChecked: NATIVE_PROBE_ATTESTATION_REQUIRED_PATHS.length, manifestSha256: createHash("sha256").update(JSON.stringify(canonical)).digest("hex") });
    expect(readSource).toHaveBeenCalledTimes(NATIVE_PROBE_ATTESTATION_REQUIRED_PATHS.length);
    expect(JSON.stringify(result)).not.toContain("测试源码内容");
    manifest.files.reverse();
    expect(await verifyNativeProbeSourceAttestation(manifest, commit, readSource)).toEqual(result);
  });

  it.each([
    "server/services/manhuaNativeDeepReadRunner.ts",
    "scripts/manhua-native-two-segment-douyin-probe.mts",
  ])("%s 单字节变化即失败", async (path) => {
    const { sources, manifest, readSource } = fixture();
    sources.get(path)![0] ^= 1;
    await expect(verifyNativeProbeSourceAttestation(manifest, commit, readSource)).rejects.toThrow(`源码 SHA-256 不匹配：${path}`);
  });

  it.each([
    "shared/manhuaNativeDeepReadJob.ts",
    "server/services/manhuaNativeDeepReadPlan.ts",
    "server/services/manhuaNativeDeepReadProbeDiagnostic.ts",
  ])("自定义分片的生产契约 %s 必须纳入源码校验，缺失或改写都不能发车", async (path) => {
    expect(NATIVE_PROBE_ATTESTATION_REQUIRED_PATHS).toContain(path);
    const { sources, manifest, readSource } = fixture();
    sources.get(path)![0] ^= 1;
    await expect(verifyNativeProbeSourceAttestation(manifest, commit, readSource)).rejects.toThrow(`源码 SHA-256 不匹配：${path}`);
    manifest.files = manifest.files.filter((row) => row.path !== path);
    await expect(verifyNativeProbeSourceAttestation(manifest, commit, readSource)).rejects.toThrow("缺少关键文件");
  });

  it.each(NATIVE_PROBE_ATTESTATION_REQUIRED_PATHS)("缺少关键文件 %s 时在读取前拒绝", async (path) => {
    const { manifest, readSource } = fixture();
    manifest.files = manifest.files.filter((row) => row.path !== path);
    await expect(verifyNativeProbeSourceAttestation(manifest, commit, readSource)).rejects.toThrow("缺少关键文件");
    expect(readSource).not.toHaveBeenCalled();
  });

  it("提交不匹配或不是完整 SHA 均在读取前失败", async () => {
    const { manifest, readSource } = fixture();
    await expect(verifyNativeProbeSourceAttestation(manifest, "b".repeat(40), readSource)).rejects.toThrow("提交不一致");
    await expect(verifyNativeProbeSourceAttestation(manifest, "HEAD", readSource)).rejects.toThrow("40 位提交");
    expect(readSource).not.toHaveBeenCalled();
  });

  it("运行时文件缺失时失败，不将读取错误中的内容带入回报", async () => {
    const { manifest } = fixture();
    await expect(verifyNativeProbeSourceAttestation(manifest, commit, async () => {
      throw new Error("test-key 不可回报的读取上下文");
    })).rejects.toThrow(/^源码文件缺失或不可读取：package.json$/);
  });

  it("重复路径与空清单关闭式失败", async () => {
    const { manifest, readSource } = fixture();
    manifest.files.push({ ...manifest.files[0]! });
    await expect(verifyNativeProbeSourceAttestation(manifest, commit, readSource)).rejects.toThrow("路径重复");
    await expect(verifyNativeProbeSourceAttestation({ ...manifest, files: [] }, commit, readSource)).rejects.toThrow("非空 files");
    expect(readSource).not.toHaveBeenCalled();
  });

  it.each(["../package.json", "/app/package.json", "server/../package.json", "server/./x.ts", "server//x.ts", "server\\x.ts", "server/%2e%2e/x.ts", "client/x.ts", "server/x.env", "server/x.ts\n"])("非法路径 %s 在读取前失败", async (path) => {
    const { manifest, readSource } = fixture();
    manifest.files.push({ path, sha256: "a".repeat(64) });
    await expect(verifyNativeProbeSourceAttestation(manifest, commit, readSource)).rejects.toThrow("路径不在允许范围");
    expect(readSource).not.toHaveBeenCalled();
  });

  it("合法范围内额外文件也必须逐个验证，不能只查关键文件", async () => {
    const { sources, manifest, readSource } = fixture();
    const path = "shared/extra.json";
    const bytes = Buffer.from("测试额外文件");
    sources.set(path, bytes);
    manifest.files.push({ path, sha256: createHash("sha256").update(bytes).digest("hex") });
    expect((await verifyNativeProbeSourceAttestation(manifest, commit, readSource)).filesChecked).toBe(NATIVE_PROBE_ATTESTATION_REQUIRED_PATHS.length + 1);
    sources.set(path, Buffer.from("已改变"));
    await expect(verifyNativeProbeSourceAttestation(manifest, commit, readSource)).rejects.toThrow("源码 SHA-256 不匹配");
  });
});
