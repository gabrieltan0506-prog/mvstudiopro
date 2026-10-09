import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { artMotionJobSchema } from "../../shared/artMotion";
const m = vi.hoisted(() => ({
  cloud: new Map<string, Buffer>(),
  upload: vi.fn(),
  inspect: vi.fn(),
  load: vi.fn(),
  list: vi.fn(),
  config: vi.fn(),
}));
vi.mock("./gcs", () => ({
  getGcsBucketName: () => "bucket",
  uploadBufferToGcsIfAbsent: m.upload,
  inspectGcsObjectBounded: m.inspect,
}));
vi.mock("../jobs/repository", () => ({ getJobByIdStrict: m.load }));
vi.mock("./flyMachines", () => ({
  listFlyMachines: m.list,
  resolveFlyMachinesConfig: m.config,
}));
import {
  archiveStageWorldSnapshot,
  readStageWorldSnapshot,
} from "./manhuaStageWorldSnapshot";
import { readStageWorld } from "./manhuaStageWorldBridge";
const input = artMotionJobSchema.parse({
  action: "art_motion",
  requestId: "c1007000-1234-4234-8234-123456789abc",
  scopeKey: "owned",
  params: {
    version: 1,
    mode: "animation",
    grammar: "y5_kinetic_type",
    duration: 2,
    width: 720,
    height: 1280,
    fps: 24,
    cues: [],
    data: {},
    stageAnimation: {
      previsJobId: `prv_${"c".repeat(48)}`,
      scopeId: "c1007000-1234-4234-8234-123456789abd",
      clipId: "clip-owned",
      worldTaskId: "world-owned",
      sceneRef: "scene-owned",
      worldSourceVersion: "v1",
    },
  },
});
const world = {
  taskId: "world-owned",
  status: "succeeded",
  sceneRef: "scene-owned",
  sourceVersion: "v1",
  assets: {
    spz500kGcsUri: "gs://bucket/manhua-world/u7/world-owned/scene-500k.spz",
  },
} as any;
beforeEach(() => {
  vi.clearAllMocks();
  m.cloud.clear();
  m.upload.mockImplementation(async ({ objectName, buffer }: any) => {
    if (m.cloud.has(objectName)) return { created: false };
    m.cloud.set(objectName, Buffer.from(buffer));
    return { created: true };
  });
  m.inspect.mockImplementation(async ({ gcsUri, onChunk }: any) => {
    const b = m.cloud.get(gcsUri.replace("gs://bucket/", ""));
    if (!b) throw new Error("gcs_download_failed:404");
    onChunk(b);
    return {};
  });
  m.load.mockResolvedValue({ userId: "7", type: "post_prod", input });
  m.config.mockReturnValue({ appName: "offline" });
  m.list.mockResolvedValue([
    { id: "site", state: "started", processGroup: "app" },
  ]);
  vi.stubEnv("FLY_MACHINE_ID", "worker");
  vi.stubEnv("MANHUA_HEAVY_MACHINE_ID", "worker");
  vi.stubEnv("JWT_SECRET", "offline-only-test-secret-length-32");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
it("入队快照封存后工作机通过DB与GCS读取，网站失联也不访问桥", async () => {
  await archiveStageWorldSnapshot("7", input, world);
  const network = vi.fn().mockRejectedValue(new Error("website down"));
  vi.stubGlobal("fetch", network);
  expect(await readStageWorld("7", input.requestId, world.taskId)).toEqual(
    world
  );
  expect(m.load).toHaveBeenCalled();
  expect(m.list).not.toHaveBeenCalled();
  expect(network).not.toHaveBeenCalled();
});
it("数据库重排请求与params对象键后同请求快照仍可读取", async () => {
  const submitted = input;
  await archiveStageWorldSnapshot("7", submitted, world);
  m.load.mockResolvedValueOnce({ userId: "7", type: "post_prod",
    input: { params: Object.fromEntries(Object.entries(submitted.params).reverse()),
      scopeKey: submitted.scopeKey, requestId: submitted.requestId, action: submitted.action } });
  expect(await readStageWorld("7", input.requestId, world.taskId)).toEqual(world);
  expect(m.list).not.toHaveBeenCalled();
});
it("同请求同版本幂等，不同快照拒绝覆盖且不写工作机/data", async () => {
  await archiveStageWorldSnapshot("7", input, world);
  await archiveStageWorldSnapshot("7", input, world);
  await expect(
    archiveStageWorldSnapshot("7", input, { ...world, sourceVersion: "v2" })
  ).rejects.toThrow("内容冲突");
  expect(await readStageWorldSnapshot("7", input)).toEqual(world);
});
it("跨账号、输入变化和摘要损坏拒绝，不得借网站fallback绕过", async () => {
  await archiveStageWorldSnapshot("7", input, world);
  m.load.mockResolvedValueOnce({ userId: "8", type: "post_prod", input });
  await expect(
    readStageWorld("7", input.requestId, world.taskId)
  ).rejects.toThrow("归属");
  await expect(
    readStageWorldSnapshot("7", { ...input, scopeKey: "other" })
  ).rejects.toThrow("不一致");
  const key = Array.from(m.cloud.keys())[0],
    value = JSON.parse(m.cloud.get(key)!.toString());
  value.world.sourceVersion = "changed";
  m.cloud.set(key, Buffer.from(JSON.stringify(value)));
  await expect(
    readStageWorld("7", input.requestId, world.taskId)
  ).rejects.toThrow("不一致");
  expect(m.list).not.toHaveBeenCalled();
});
it("GCS读取失败才用带签名的网站桥，两个存储都失败则明确失败", async () => {
  const network = vi
    .fn()
    .mockResolvedValue(new Response(JSON.stringify(world), { status: 200 }));
  vi.stubGlobal("fetch", network);
  expect(await readStageWorld("7", input.requestId, world.taskId)).toEqual(
    world
  );
  expect(m.list).toHaveBeenCalledTimes(1);
  const [url, opts] = network.mock.calls[0];
  expect(url).toContain("/api/internal/manhua-stage-world");
  expect(opts.headers["Fly-Force-Instance-Id"]).toBe("site");
  network.mockResolvedValueOnce(new Response("", { status: 503 }));
  await expect(
    readStageWorld("7", input.requestId, world.taskId)
  ).rejects.toThrow("均不可用");
});
it("GCS失败不能将输入偷偷存到工作机/data", async () => {
  m.upload.mockRejectedValueOnce(new Error("gcs down"));
  await expect(archiveStageWorldSnapshot("7", input, world)).rejects.toThrow(
    "工作机禁止"
  );
});
