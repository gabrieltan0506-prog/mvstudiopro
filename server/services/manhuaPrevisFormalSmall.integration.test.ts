/** 需分别确认后显式运行：正式来源、准备、渲染、报告、GLB 导出及编码的坐姿/扶坐小样。
 * 只隔离任务记录及对象存储 I/O；不替换生产算法、校验器或子进程命令。
 */
import { afterEach, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { manhuaPrevisRequestSchema } from "../../shared/manhuaPrevis";
import { getCompletedManhua3dSource, resetManhua3dTaskDependenciesForTests,
  setManhua3dTaskDependenciesForTests } from "./manhua3dTask";
import { preparePrevisModels, type PrevisModelDeps } from "./manhuaPrevisModels";
import { renderManhuaPrevis, runPrevisProcess } from "./manhuaPrevisRender";
import { validatePrevisAnimation } from "./manhuaPrevisAnimation";

const enabled = process.env.PREVIS_FORMAL_SMALL_MEDIA_CONFIRMED === "1";
const assisted = process.env.PREVIS_ASSISTED_SIT_MEDIA_CONFIRMED === "1";
const sha = (value: Buffer) => createHash("sha256").update(value).digest("hex");
afterEach(() => {
  resetManhua3dTaskDependenciesForTests();
  vi.unstubAllEnvs();
});

it.skipIf(!enabled&&!assisted)(assisted?"正式生产路径：双手扶坐96帧及最终蒙皮报告、动画、视频一致":"正式生产路径：两身高坐姿48帧、报告、带骨动画及可解码视频一致", async () => {
  if(enabled&&assisted)throw Error("每次只确认一种小样内容，禁止合并两次媒体提交");
  const durationSec=assisted?4:2,frameCount=durationSec*24;
  const base = process.env.PREVIS_TEST_OUTPUT || path.join(tmpdir(), "previs-formal-small");
  await mkdir(base, { recursive: true });
  const root = await mkdtemp(path.join(base, "run-"));
  const records = path.join(root, "records"), artifacts = path.join(root, "artifacts");
  await Promise.all([mkdir(records), mkdir(artifacts)]);
  console.log("FORMAL_SMALL_OUTPUT", root);
  vi.stubEnv("MANHUA_3D_TASK_DIR", records);
  // 只使用隔离的本地测试记录。任何上游调用或生产云读取都应使测试失败。
  const forbidden = async () => { throw Error("小样禁止访问生产存储或模型服务"); };
  setManhua3dTaskDependenciesForTests({ getBucketName: () => "test-only",
    readMirroredRecord: forbidden, submit: forbidden, poll: forbidden,
    downloadGlb: forbidden, uploadGlb: forbidden, signGlb: () => { throw Error("禁止签名"); } });
  const signal = AbortSignal.timeout(10 * 60_000);
  const blender = process.env.PREVIS_BLENDER_TEST || "blender";
  const fixtureScript = path.resolve("server/scripts/test_previs_drama_rigged.py");
  await runPrevisProcess(blender, ["--background", "--factory-startup", "--disable-autoexec",
    "--threads", "2", "--python-exit-code", "1", "--python", fixtureScript,
    "--", root, "--fixtures-only"], signal);
  const bytesByUri = new Map<string, Buffer>();
  for (const suffix of ["a", "b"]) {
    const bytes = await readFile(path.join(root, `TEST_ONLY-drama-rigged-${suffix}.glb`));
    const taskId = `m3d_TEST_ONLY_formal_${suffix}`, uri = `gs://test-only/fixture/${suffix}.glb`;
    bytesByUri.set(uri, bytes);
    await writeFile(path.join(records, `${taskId}.json`), JSON.stringify({ taskId,
      userId: 7, assetRef: `TEST_ONLY-char-${suffix}`, status: "succeeded",
      glbGcsUri: uri, glbBytes: bytes.length, glbSha256: sha(bytes) }));
  }
  const inspect: PrevisModelDeps["inspect"] = async input => {
    const bytes = bytesByUri.get(input.gcsUri);
    if (!bytes || bytes.length > input.maxBytes) throw Error("测试对象未授权或超限");
    input.signal?.throwIfAborted(); input.onChunk?.(bytes);
    return { bucket: "test-only", objectName: input.gcsUri.slice("gs://test-only/".length),
      byteLength: bytes.length, sha256: sha(bytes), header: bytes.subarray(0, 20) };
  };
  const input = manhuaPrevisRequestSchema.parse({
    requestId: assisted?"33333333-3333-4333-8333-333333331009":"33333333-3333-4333-8333-333333331008",
    scopeId: "11111111-1111-4111-8111-111111111008", clipId: assisted?"TEST_ONLY-assisted-sit":"TEST_ONLY-formal-sit",
    spec: { version: 1, durationSec, aspect: "16:9", exportAnimation: true,
      actors: (assisted?[1.7,1.6]:[1.7, 2.55]).map((height, i) => ({ id: assisted?(i?"被扶者":"扶助者"):(i ? "高个" : "矮个"), nameZh: assisted?(i?"被扶者":"扶助者"):(i ? "高个" : "矮个"),
        shape: "human", assetRef: `TEST_ONLY-char-${i ? "b" : "a"}`,
        start: [assisted?(i?0:-.55):(i ? 1.1 : -1.1), 0], end: [assisted?(i?0:-.55):(i ? 1.1 : -1.1), 0],
        moveStartSec: 0, moveEndSec: durationSec, facingDeg: 0,
        actions: assisted?[]:[{ kind: "sit", startSec: 0, endSec: 2 }],
        ...(assisted&&i?{humanPosture:{mode:"rise_to_sit",startSec:.5,endSec:2.5,supportHeight:.45,reclineDeg:45}}:{}),
        riggedModel: { sourceJobId: `m3d_TEST_ONLY_formal_${i ? "b" : "a"}`, forwardAxis: "+X", targetHeight: height } })),
      ...(assisted?{handContacts:["-1","1"].map(side=>({id:`扶坐${side}`,actorId:"扶助者",targetActorId:"被扶者",hand:`hand${side}`,bone:`upper_arm${side}`,along:.5,offset:[0,0,0],startSec:0,contactSec:.5,releaseSec:3.5,endSec:4}))}:{}),
      cameras: [{ startSec: 0, endSec: durationSec, position: assisted?[3,-7,2.5]:[4, -11, 3.2], target: assisted?[0,0,.9]:[0, 0, 1.3], lens: 35 }] },
  });
  await writeFile(path.join(root, "input.json"), JSON.stringify(input, null, 2));
  // 同一正式来源函数拒绝错用户；不通过自造成功回执跳过身份校验。
  await expect(getCompletedManhua3dSource("m3d_TEST_ONLY_formal_a", 8, "TEST_ONLY-char-a")).rejects.toThrow("本人");
  const commands: { command: string; args: string[] }[] = [];
  const result = await renderManhuaPrevis(input, "7", { signal }, {
    blender, useXvfb: process.platform === "linux", lowPriority: process.platform === "linux",
    prepareModels: (spec, user, dir, cancel) => preparePrevisModels(spec, user, dir, cancel,
      { source: getCompletedManhua3dSource, inspect }),
    run: async (command, args, cancel) => {
      commands.push({ command, args });
      await writeFile(path.join(root, "commands.json"), JSON.stringify(commands, null, 2));
      // 保留真实 stdout，正式入口需要读取 ffprobe 的 JSON 回执。
      return runPrevisProcess(command, args, cancel);
    },
    upload: async ({ objectName, buffer }) => {
      const local = path.join(artifacts, objectName);
      await mkdir(path.dirname(local), { recursive: true }); await writeFile(local, buffer);
      return { bucket: "test-only", objectName, gcsUri: `gs://test-only/${objectName}` };
    },
  });
  expect(result.report.frames).toBe(frameCount);
  expect(result.report.actors).toHaveLength(2);
  expect(result.bytes).toBeGreaterThan(1000);
  expect(result.animation).toBeDefined();
  const artifact = (uri: string) => readFile(path.join(artifacts, uri.slice("gs://test-only/".length)));
  const video = await artifact(result.gcsUri);
  expect(video.length).toBe(result.bytes);
  expect(sha(video)).toBe(result.sha256);
  const probeBytes = await artifact(result.probeGcsUri);
  expect(sha(probeBytes)).toBe(result.probeSha256);
  const probe = JSON.parse(probeBytes.toString());
  const videoStreams = probe.streams.filter((stream: { codec_type: string }) => stream.codec_type === "video");
  expect(videoStreams).toHaveLength(1);
  expect(Number(videoStreams[0].nb_read_frames)).toBe(frameCount);
  expect(Number(probe.format.duration)).toBeCloseTo(durationSec, 1);
  expect(probe.streams.some((stream: { codec_type: string }) => stream.codec_type === "audio")).toBe(false);
  const glb = await artifact(result.animation!.glbGcsUri);
  const frames = await artifact(result.animation!.framesGcsUri);
  expect(sha(glb)).toBe(result.animation!.sha256);
  expect(sha(frames)).toBe(result.animation!.framesSha256);
  expect(validatePrevisAnimation(JSON.parse(frames.toString()), glb, input.spec).frames).toHaveLength(frameCount);
  if(assisted){
    expect(result.report.handContacts).toHaveLength(2);
    for(const row of result.report.handContacts!){
      expect(row.samples).toHaveLength(frameCount);
      expect(row.source.kind).toBe("riggedModel");expect(row.targetSource.kind).toBe("riggedModel");
      expect(row.samples.every(sample=>sample.surface&&sample.surface.residual<=.005)).toBe(true);
    }
  }
  const scripts = commands.flatMap(({ args }) => args.filter(arg => arg.endsWith(".py")));
  expect(scripts).toContain(path.resolve("server/scripts/render-manhua-previs.py"));
  expect(scripts).toContain(path.resolve("server/scripts/export_previs_animation.py"));
  expect(scripts.every(script => script.startsWith(path.resolve("server/scripts") + path.sep))).toBe(true);
  await writeFile(path.join(root, "result.json"), JSON.stringify(result, null, 2));
  console.log("FORMAL_SMALL_PASS", JSON.stringify({ root, frames: frameCount, bytes: result.bytes,
    animationSha: result.animation!.sha256, productionRendererDirect: true,
    productionRendererSha256:sha(await readFile(path.resolve("server/scripts/render-manhua-previs.py"))),
    productionUiValidated: false, projectCharactersValidated: false }));
}, 660_000);
