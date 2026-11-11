import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  formatVideoBreakdownRecreatePrompt,
  validateVideoBreakdownTiming,
  videoBreakdownSchema,
  type VideoBreakdown,
} from "../../shared/videoBreakdown";
import { resolveGeminiModel } from "../../shared/geminiModelConfig";
import { videoBreakdownCredits } from "../../shared/videoBreakdown";
import { videoBreakdownFixture } from "./videoBreakdown.fixture";
import {
  VIDEO_BREAKDOWN_STALE_MS,
  buildVideoBreakdownPrompt,
  buildVideoBreakdownUploadObjectName,
  createVideoBreakdownUpload,
  cutVideoBreakdownClips,
  extractKeyMomentFrames,
  filterVideoBreakdownKeyMoments,
  videoBreakdownKeyMomentLimit,
  type VideoBreakdownOptionalDrop,
  deriveVideoBreakdownJobId,
  getVideoBreakdown,
  normalizeVideoBreakdown,
  parseAndFixVideoBreakdown,
  recoverInterruptedVideoBreakdownJobs,
  resetVideoBreakdownRuntimeForTest,
  startVideoBreakdown,
  verifyVideoBreakdownSource,
  videoBreakdownChargeKey,
  videoBreakdownJobPrefix,
  videoBreakdownRefundKey,
  type MediaRun,
  type VideoBreakdownDeps,
} from "./videoBreakdown";

const BUCKET = "test-bucket";
const UID = 42;
const OTHER = 7;
const srcObject = (uid = UID) => `uploads/u${uid}/video-breakdown/0b5d-clip.mp4`;
const srcUri = (uid = UID) => `gs://${BUCKET}/${srcObject(uid)}`;

describe("契约 schema 往返", () => {
  it("夹具过 schema 与秒位校验；JSON 往返不变；秒锁文本可拼出", () => {
    const value = videoBreakdownFixture();
    const parsed = videoBreakdownSchema.parse(JSON.parse(JSON.stringify(value)));
    expect(parsed).toEqual(value);
    expect(validateVideoBreakdownTiming(parsed)).toEqual([]);
    expect(formatVideoBreakdownRecreatePrompt(parsed.segments[1]!)).toContain("0.0–5.0秒：");
  });
  it("parseAndFixVideoBreakdown 以实测时长为准并通过", () => {
    const raw = { ...videoBreakdownFixture(), durationSec: 31.7, kind: "x" };
    const out = parseAndFixVideoBreakdown(raw, 30.04);
    expect(out.kind).toBe("video_breakdown_v1");
    expect(out.durationSec).toBe(30);
  });
});

describe("确定性修正", () => {
  it("秒位吸附、首尾相接、0.1 秒取整、编号重排、镜头夹回段内", () => {
    const v = videoBreakdownFixture();
    // 乱序 + 编号错 + 缝隙/重叠 + 首尾偏差 + 多位小数
    v.segments[0] = { ...v.segments[0]!, index: 5, startSec: 0.43, endSec: 9.62 };
    v.segments[1] = { ...v.segments[1]!, index: 5, startSec: 10.38, endSec: 20.47 };
    v.segments[2] = { ...v.segments[2]!, index: 9, startSec: 19.93, endSec: 29.04 };
    v.segments[0]!.shots[1] = { ...v.segments[0]!.shots[1]!, endSec: 10.4 };
    v.segments[1]!.shots[0] = { ...v.segments[1]!.shots[0]!, startSec: 9.7 };
    v.segments = [v.segments[2]!, v.segments[0]!, v.segments[1]!];
    const out = normalizeVideoBreakdown(v, 30.04);
    expect(out.segments.map(s => [s.index, s.startSec, s.endSec])).toEqual([[0, 0, 10], [1, 10, 20.2], [2, 20.2, 30]]);
    expect(out.segments[0]!.shots[1]!.endSec).toBe(10);
    expect(out.segments[1]!.shots[0]!.startSec).toBe(10);
    expect(validateVideoBreakdownTiming(out)).toEqual([]);
  });
  it("提示词时间窗误写成全片绝对秒时换算为段内相对秒；略超段长夹到段长", () => {
    const v = videoBreakdownFixture();
    v.segments[2]!.recreatePrompt.timeline = [{ fromSec: 20, toSec: 25, text: "a" }, { fromSec: 25, toSec: 30, text: "b" }];
    v.segments[1]!.recreatePrompt.timeline = [{ fromSec: 0, toSec: 10.6, text: "c" }];
    const out = normalizeVideoBreakdown(v, 30);
    expect(out.segments[2]!.recreatePrompt.timeline.map(w => [w.fromSec, w.toSec])).toEqual([[0, 5], [5, 10]]);
    expect(out.segments[1]!.recreatePrompt.timeline[0]!.toSec).toBe(10);
  });
  it("超出吸附范围不硬改：大缺口交给校验报出", () => {
    const v = videoBreakdownFixture();
    v.segments[1] = { ...v.segments[1]!, startSec: 14, shots: v.segments[1]!.shots.map((s, i) => (i === 0 ? { ...s, startSec: 14 } : s)) };
    expect(() => parseAndFixVideoBreakdown(v, 30)).toThrow(/秒位校验不过：.*第2段与上一段不相接/);
  });
  it("结构不合契约给出简明中文路径", () => {
    const v = videoBreakdownFixture() as unknown as Record<string, unknown>;
    delete (v.overview as Record<string, unknown>).visualGenes;
    expect(() => parseAndFixVideoBreakdown(v, 30)).toThrow(/结构不合契约：overview\.visualGenes/);
  });
});

describe("提示词与配置", () => {
  it("提示词含逐镜时间码、禁编造、禁导演名/作品名；不写死模型", () => {
    const p = buildVideoBreakdownPrompt({ durationSec: 30 });
    expect(p).toContain("逐镜时间码");
    expect(p).toContain("禁止编造");
    expect(p).toContain("导演名");
    expect(p).toContain("作品名");
    expect(p).not.toMatch(/gemini/i);
    expect(resolveGeminiModel("videoBreakdown", {})).toBe("gemini-3.8-flash");
    expect(resolveGeminiModel("videoBreakdown", { VIDEO_BREAKDOWN_MODEL: "gemini-4.0-flash" })).toBe("gemini-4.0-flash");
  });
  it("标价（契约函数）：120.0 秒=30、120.1 秒=40、300 秒=210", () => {
    expect(videoBreakdownCredits(120.0)).toBe(30);
    expect(videoBreakdownCredits(120.1)).toBe(40);
    expect(videoBreakdownCredits(300)).toBe(210);
    expect(videoBreakdownCredits(30)).toBe(30);
  });
});

describe("归属校验", () => {
  it("只收本桶本人拉片前缀下的视频对象", () => {
    expect(verifyVideoBreakdownSource(UID, srcUri(), BUCKET)).toEqual({ objectName: srcObject(), mimeType: "video/mp4" });
    expect(verifyVideoBreakdownSource(UID, srcUri(OTHER), BUCKET)).toBeNull();
    expect(verifyVideoBreakdownSource(UID, `gs://other-bucket/${srcObject()}`, BUCKET)).toBeNull();
    expect(verifyVideoBreakdownSource(UID, `gs://${BUCKET}/uploads/u${UID}/video-breakdown/../u7/x.mp4`, BUCKET)).toBeNull();
    expect(verifyVideoBreakdownSource(UID, `gs://${BUCKET}/uploads/u${UID}/x.mp4`, BUCKET)).toBeNull();
    expect(verifyVideoBreakdownSource(UID, `gs://${BUCKET}/uploads/u${UID}/video-breakdown/a.exe`, BUCKET)).toBeNull();
    expect(verifyVideoBreakdownSource(UID, `gs://${BUCKET}/uploads/u${UID}/video-breakdown/a.mov`, BUCKET)?.mimeType).toBe("video/quicktime");
  });
  it("上传签名：对象名服务端生成在本人前缀，大小上限签进链接", async () => {
    expect(buildVideoBreakdownUploadObjectName(UID, "../../我的 片.MOV", "video/quicktime", "u-1")).toBe(`uploads/u${UID}/video-breakdown/u-1-video.mov`);
    expect(buildVideoBreakdownUploadObjectName(UID, "my clip_01.mp4", "video/mp4", "u-2")).toBe(`uploads/u${UID}/video-breakdown/u-2-my-clip_01.mp4`);
    const signer = vi.fn(async (p: any) => ({ bucket: BUCKET, objectName: p.objectName, gcsUri: `gs://${BUCKET}/${p.objectName}`, uploadUrl: "https://upload.example/x", requiredHeaders: { "x-goog-content-length-range": `0,${p.maxBytes}` } }));
    const out = await createVideoBreakdownUpload({ id: UID }, { fileName: "a.mp4", contentType: "video/mp4", bytes: 1234 }, signer as any);
    expect(signer.mock.calls[0]![0].maxBytes).toBe(1234);
    expect(out.gcsUri).toMatch(new RegExp(`^gs://${BUCKET}/uploads/u${UID}/video-breakdown/.+\\.mp4$`));
    expect(verifyVideoBreakdownSource(UID, out.gcsUri, BUCKET)).not.toBeNull();
    expect(out.requiredHeaders).toEqual({ "x-goog-content-length-range": "0,1234" });
  });
});

describe("可选三块：坏了就丢", () => {
  const withOverview = (extra: Record<string, unknown>) => {
    const v = videoBreakdownFixture() as any;
    v.overview = { ...v.overview, ...extra };
    return v;
  };
  const craft = { reusableTechniques: ["低机位仰拍 + 缓推，把压迫感推到顶点"], rhythmStructure: "慢铺垫 → 快切 → 留白", emotionArc: "平静 → 紧张 → 释然", styleTags: ["冷峻", "手持"] };
  const sound = { rhythm: "前疏后密", mix: "音乐在前，环境声让位", reusableTechniques: "鼓点卡切镜", generationElements: "钢琴 + 弦乐铺底，90 BPM，风声音效" };

  it("三块合格时原样保留", () => {
    const drops: VideoBreakdownOptionalDrop[] = [];
    const out = parseAndFixVideoBreakdown(withOverview({ craft, sound, keyMoments: [{ atSec: 12.34, type: "emotion", note: "回头微笑" }] }), 30, { hasAudio: true, drops });
    expect(out.overview.craft).toEqual(craft);
    expect(out.overview.sound).toEqual(sound);
    expect(out.overview.keyMoments).toEqual([{ atSec: 12.3, type: "emotion", note: "回头微笑" }]);
    expect(drops).toEqual([]);
    expect(videoBreakdownSchema.parse(out)).toEqual(out);
  });
  it("craft 不合格：只丢 craft，主体与其他块照留，不抛错", () => {
    const drops: VideoBreakdownOptionalDrop[] = [];
    const out = parseAndFixVideoBreakdown(withOverview({ craft: { reusableTechniques: [], extra: 1 }, sound }), 30, { hasAudio: true, drops });
    expect(out.overview.craft).toBeUndefined();
    expect(out.overview.sound).toEqual(sound);
    expect(out.segments).toHaveLength(3);
    expect(drops.map(d => d.block)).toEqual(["craft"]);
  });
  it("sound：文本秒位剥掉后保留；缺字段整块丢；无音轨整块丢", () => {
    const a = parseAndFixVideoBreakdown(withOverview({ sound: { ...sound, rhythm: "在01:23处鼓点进入，前疏后密" } }), 30, { hasAudio: true });
    expect(a.overview.sound!.rhythm).not.toMatch(/\d:\d\d/);
    expect(a.overview.sound!.rhythm).toContain("鼓点进入");
    const drops: VideoBreakdownOptionalDrop[] = [];
    const b = parseAndFixVideoBreakdown(withOverview({ sound: { rhythm: "x" } }), 30, { hasAudio: true, drops });
    expect(b.overview.sound).toBeUndefined();
    expect(drops[0]!.block).toBe("sound");
    const drops2: VideoBreakdownOptionalDrop[] = [];
    const c = parseAndFixVideoBreakdown(withOverview({ sound }), 30, { hasAudio: false, drops: drops2 });
    expect(c.overview.sound).toBeUndefined();
    expect(drops2[0]!.reasonZh).toContain("无音轨");
  });
  it("keyMoments：越界 / 类型非法 / 说明为空逐条丢，其余保留；非数组整块丢；都不抛错", () => {
    const drops: VideoBreakdownOptionalDrop[] = [];
    const out = parseAndFixVideoBreakdown(withOverview({ keyMoments: [
      { atSec: 5, type: "cut", note: "切近景" },
      { atSec: 31, type: "cut", note: "越界" },
      { atSec: -1, type: "cut", note: "负秒" },
      { atSec: 8, type: "audio", note: "类型非法" },
      { atSec: 9, type: "story", note: "" },
      { atSec: 5.04, type: "cut", note: "重复" },
      "garbage",
    ] }), 30, { drops });
    expect(out.overview.keyMoments).toEqual([{ atSec: 5, type: "cut", note: "切近景" }]);
    expect(drops).toEqual([expect.objectContaining({ block: "keyMoments", count: 5 })]);
    const drops2: VideoBreakdownOptionalDrop[] = [];
    const out2 = parseAndFixVideoBreakdown(withOverview({ keyMoments: { atSec: 1 } }), 30, { drops: drops2 });
    expect(out2.overview.keyMoments).toBeUndefined();
    expect(drops2[0]!.reasonZh).toContain("不是数组");
  });
  it("keyMoments 数量上限：每 10 秒至多 3 条（类型不重复者优先），总数 ≤60", () => {
    expect(videoBreakdownKeyMomentLimit(30)).toBe(9);
    expect(videoBreakdownKeyMomentLimit(5)).toBe(3);
    expect(videoBreakdownKeyMomentLimit(300)).toBe(60);
    const drops: VideoBreakdownOptionalDrop[] = [];
    const win = filterVideoBreakdownKeyMoments([
      { atSec: 1, type: "cut", note: "a" }, { atSec: 2, type: "cut", note: "b" }, { atSec: 3, type: "cut", note: "c" },
      { atSec: 4, type: "emotion", note: "d" }, { atSec: 5, type: "story", note: "e" },
    ], 30, drops)!;
    expect(win.map(m => m.note)).toEqual(["a", "d", "e"]);
    expect(drops[0]).toMatchObject({ count: 2 });
    const types = ["cut", "emotion", "lighting", "story"] as const;
    const many = Array.from({ length: 30 }, (_, w) => types.map((type, k) => ({ atSec: w * 10 + k * 2 + 0.5, type, note: `${w}-${k}` }))).flat();
    const drops3: VideoBreakdownOptionalDrop[] = [];
    const kept = filterVideoBreakdownKeyMoments(many, 300, drops3)!;
    expect(kept).toHaveLength(60);
    // 按名次轮转保留：每个 10 秒窗都留 2 条，覆盖全片
    for (let w = 0; w < 30; w += 1) expect(kept.filter(m => Math.floor(m.atSec / 10) === w)).toHaveLength(2);
    expect(kept.map(m => m.atSec)).toEqual([...kept.map(m => m.atSec)].sort((a, b) => a - b));
    expect(drops3.map(d => d.count)).toEqual([30, 30]);
  });
  it("提示词：有音轨要声音块与配乐要素，无音轨不要；重点时刻上限随片长", () => {
    const a = buildVideoBreakdownPrompt({ durationSec: 30, hasAudio: true });
    expect(a).toContain("generationElements");
    expect(a).toContain("不转录台词");
    expect(a).toContain("全片至多 9 条");
    expect(a).toContain("用什么拍法");
    const b = buildVideoBreakdownPrompt({ durationSec: 300, hasAudio: false });
    expect(b).toContain("不要输出 overview.sound");
    expect(b).toContain("全片至多 60 条");
  });
});

describe("重点时刻抽帧", () => {
  it("长边 ≤1280 的 JPEG；失败条为 null，其余照常；贴片尾往前让", async () => {
    const dir = await mkdtemp(path.join(tmp, "km-"));
    const calls: string[][] = [];
    const run: MediaRun = async (_cmd, args) => {
      calls.push(args);
      if (args[args.length - 1]!.endsWith("km-001.jpg")) throw new Error("ffmpeg exited 1");
      await writeFile(args[args.length - 1]!, "jpg");
      return { stdout: "", stderr: "" };
    };
    const out = await extractKeyMomentFrames({ srcFile: "src.mp4", dir, durationSec: 30, moments: [{ atSec: 3 }, { atSec: 10 }, { atSec: 30 }], objectNameFor: i => `f/${i}.jpg`, signal: new AbortController().signal },
      { run, uploadFile: async () => {} });
    expect(out).toEqual(["f/0.jpg", null, "f/2.jpg"]);
    expect(calls[0]!.join(" ")).toContain("min(1280,iw)");
    expect(calls[0]!.join(" ")).toContain("-frames:v 1");
    expect(calls[2]![calls[2]!.indexOf("-ss") + 1]).toBe("29.950");
  });
});

// ─── 任务流程（替身：内存 GCS / ffmpeg / 模型 / 账本） ──────────────

type Harness = ReturnType<typeof harness>;
function harness(opts: { duration?: number; callImpl?: VideoBreakdownDeps["call"]; failClip?: number; failFrame?: number; balance?: number } = {}) {
  const store = new Map<string, Buffer>();
  store.set(srcObject(), Buffer.from("video"));
  let now = Date.parse("2026-11-11T00:00:00Z");
  const charges = new Map<string, number>();
  const refunds = new Set<string>();
  const logs: string[] = [];
  const duration = opts.duration ?? 30;
  const run: MediaRun = async (command, args) => {
    if (command === "ffprobe") {
      const file = args[args.length - 1]!;
      const m = /seg-(\d+)\.mp4$/.exec(file);
      const len = m ? Number(process.env.__VB_CLIP_LEN__ || 10) : duration;
      return { stdout: JSON.stringify({ format: { duration: String(len) }, streams: [{ codec_type: "video" }, { codec_type: "audio" }] }), stderr: "" };
    }
    const out = args[args.length - 1]!;
    const idx = Number(/seg-(\d+)\.mp4$/.exec(out)?.[1]);
    if (idx === opts.failClip) throw new Error("ffmpeg exited 1");
    const km = /km-(\d+)\.jpg$/.exec(out);
    if (km && Number(km[1]) === opts.failFrame) throw new Error("ffmpeg exited 1");
    await writeFile(out, "clip");
    return { stdout: "", stderr: "" };
  };
  const call = vi.fn(opts.callImpl ?? (async (input: any) => {
    await input.save("hop-1-vertex-request", { prompt: input.prompt });
    const value = input.validate(videoBreakdownFixture());
    await input.save("hop-1-vertex-parsed", value);
    return { value, channel: "Vertex", model: input.model, failuresZh: [], payload: {} };
  }) as any);
  const charge = vi.fn(async (userId: number, amount: number, _a: string, _d: string, o: { chargeKey: string }) => {
    if (charges.has(o.chargeKey)) return { success: true, cost: charges.get(o.chargeKey)!, alreadyCharged: true };
    charges.set(o.chargeKey, amount);
    return { success: true, cost: amount };
  });
  const refund = vi.fn(async (input: { chargeKey: string; refundKey: string }) => {
    if (!charges.has(input.chargeKey) || refunds.has(input.refundKey)) return { refunded: 0 };
    refunds.add(input.refundKey);
    return { refunded: charges.get(input.chargeKey)! };
  });
  const deps: Partial<VideoBreakdownDeps> = {
    bucket: () => BUCKET,
    createIfAbsent: async (name, buffer) => {
      if (store.has(name)) return { created: false };
      store.set(name, buffer);
      return { created: true };
    },
    put: async (name, buffer) => { store.set(name, buffer); },
    read: async name => store.get(name) ?? null,
    stat: async name => (store.has(name) ? { byteLength: store.get(name)!.length } : null),
    list: async prefix => Array.from(store.keys()).filter(k => k.startsWith(prefix)),
    sign: (uri, seconds) => `https://signed.example/${uri.slice(5)}?X-Goog-Expires=${seconds}`,
    call,
    downloadToFile: async (_uri, file) => { await writeFile(file, "video"); return 5; },
    uploadFile: async (_file, name) => { store.set(name, Buffer.from("clip")); },
    run,
    balance: async () => ({ totalAvailable: opts.balance ?? 100 }),
    charge: charge as any,
    refund: refund as any,
    now: () => now,
    tmpRoot: () => tmp,
    log: line => logs.push(line),
  };
  return {
    store, deps, call, charge, refund, logs, charges, refunds,
    advance: (ms: number) => { now += ms; },
    state: (jobId: string, uid = UID) => JSON.parse(store.get(`${videoBreakdownJobPrefix(uid, jobId)}/state.json`)!.toString()),
  };
}

let tmp = "";
beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), "vb-test-"));
  resetVideoBreakdownRuntimeForTest();
  vi.stubEnv("VIDEO_BREAKDOWN_MODEL", "");
  vi.stubEnv("GEMINI_DEFAULT_MODEL", "");
  vi.stubEnv("__VB_CLIP_LEN__", "10");
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(tmp, { recursive: true, force: true });
});

async function runToEnd(h: Harness, requestId = "req-0001", user = { id: UID } as { id: number; role?: string }) {
  const started = await startVideoBreakdown(user, { gcsUri: srcUri(user.id === UID ? UID : user.id), requestId }, h.deps);
  await started.promise;
  return started.jobId;
}

describe("开单 / 执行 / 查询", () => {
  it("成功：按实测片长扣 30 一次、各阶段落 GCS、get 现签片段与原片（1 小时）", async () => {
    const h = harness();
    const jobId = await runToEnd(h);
    expect(jobId).toBe(deriveVideoBreakdownJobId(UID, "req-0001"));
    expect(h.charge).toHaveBeenCalledTimes(1);
    expect(h.charge.mock.calls[0]![1]).toBe(30);
    expect(h.charge.mock.calls[0]![4]).toEqual({ chargeKey: videoBreakdownChargeKey(UID, jobId) });
    expect(h.refund).not.toHaveBeenCalled();
    const prefix = videoBreakdownJobPrefix(UID, jobId);
    for (const name of ["request.json", "state.json", "probe.json", "pricing.json", "result.json", "evidence/hop-1-vertex-request.json", "evidence/hop-1-vertex-parsed.json", "clips/seg-000.mp4", "clips/seg-002.mp4"])
      expect(h.store.has(`${prefix}/${name}`), name).toBe(true);
    const call = h.call.mock.calls[0]![0] as any;
    expect(call.media.vertexFileUri).toBe(srcUri());
    expect(call.media.evolinkFileUri()).toMatch(/^https:\/\//);
    expect(call.model).toBe("gemini-3.8-flash");
    expect(call.repairPrompt).toBeTypeOf("function");
    const view = await getVideoBreakdown({ id: UID }, { jobId }, h.deps);
    expect(view.status).toBe("succeeded");
    expect(view.stage).toBe("done");
    expect(view.result?.segments).toHaveLength(3);
    expect(view.clipUrls).toHaveLength(3);
    expect(view.clipUrls!.every(u => u.includes("X-Goog-Expires=3600"))).toBe(true);
    expect(view.sourceUrl).toContain("X-Goog-Expires=3600");
    // 日志：开始 / 完成各一行，不含地址
    expect(h.logs.some(l => l.startsWith("[videoBreakdown] start "))).toBe(true);
    expect(h.logs.some(l => l.startsWith("[videoBreakdown] done "))).toBe(true);
    expect(h.logs.join("\n")).not.toMatch(/gs:\/\/|https:\/\//);
  });

  it("幂等：同 requestId 再 start 返回同一 jobId，不再扣费、不再看片", async () => {
    const h = harness();
    const a = await runToEnd(h);
    const b = await startVideoBreakdown({ id: UID }, { gcsUri: srcUri(), requestId: "req-0001" }, h.deps);
    expect(b.jobId).toBe(a);
    expect(b.promise).toBeUndefined();
    expect(h.charge).toHaveBeenCalledTimes(1);
    expect(h.call).toHaveBeenCalledTimes(1);
  });

  it("归属：别人的视频拒收且不扣费；别人的 jobId 查不到", async () => {
    const h = harness();
    await expect(startVideoBreakdown({ id: UID }, { gcsUri: srcUri(OTHER), requestId: "req-x001" }, h.deps)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(h.charge).not.toHaveBeenCalled();
    const jobId = await runToEnd(h);
    await expect(getVideoBreakdown({ id: OTHER }, { jobId }, h.deps)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("未上传完成 / 余额不足：拒绝且不占号", async () => {
    const h = harness({ balance: 5 });
    await expect(startVideoBreakdown({ id: UID }, { gcsUri: `gs://${BUCKET}/uploads/u${UID}/video-breakdown/missing.mp4`, requestId: "req-m001" }, h.deps)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(startVideoBreakdown({ id: UID }, { gcsUri: srcUri(), requestId: "req-p001" }, h.deps)).rejects.toMatchObject({ code: "PAYMENT_REQUIRED" });
    expect(h.charge).not.toHaveBeenCalled();
    expect(Array.from(h.store.keys()).some(k => k.endsWith("request.json"))).toBe(false);
  });

  it("管理员 / supervisor：0 扣费、不预检余额", async () => {
    const h = harness({ balance: 0 });
    await runToEnd(h, "req-a001", { id: UID, role: "admin" });
    await runToEnd(h, "req-a002", { id: UID, role: "supervisor" });
    expect(h.charge).not.toHaveBeenCalled();
  });

  it("模型两跳全失败：标失败、按 chargeKey 全额退一次；前台报错无上游原文/模型名/通道名", async () => {
    const h = harness({ callImpl: (async () => { throw new Error("听音识别全部通道失败：Vertex（HTTP 500）；EvoLink（写坏：gemini-3.8-flash bad）"); }) as any });
    const jobId = await runToEnd(h);
    expect(h.refund).toHaveBeenCalledTimes(1);
    expect(h.refund.mock.calls[0]![0]).toMatchObject({ chargeKey: videoBreakdownChargeKey(UID, jobId), refundKey: videoBreakdownRefundKey(UID, jobId) });
    expect(h.state(jobId)).toMatchObject({ status: "failed", refund: "done", failureCode: "model_failed" });
    const view = await getVideoBreakdown({ id: UID }, { jobId }, h.deps);
    expect(view.status).toBe("failed");
    expect(view.error).toContain("积分已退回");
    expect(view.error).not.toMatch(/gemini|vertex|evolink|HTTP|写坏/i);
    // 再查不重复退
    await getVideoBreakdown({ id: UID }, { jobId }, h.deps);
    expect(h.refunds.size).toBe(1);
    expect(h.logs.some(l => l.startsWith("[videoBreakdown] failed "))).toBe(true);
  });

  it("超时长：时长核对不过，不扣费、不调模型、无需退", async () => {
    const h = harness({ duration: 301 });
    const jobId = await runToEnd(h);
    expect(h.call).not.toHaveBeenCalled();
    expect(h.charge).not.toHaveBeenCalled();
    expect(h.refund).not.toHaveBeenCalled();
    expect(h.state(jobId)).toMatchObject({ status: "failed", failureCode: "too_long", refund: "none", charged: 0 });
    const error = (await getVideoBreakdown({ id: UID }, { jobId }, h.deps)).error!;
    expect(error).toMatch(/超过 5 分钟/);
    expect(error).not.toContain("积分");
  });

  it.each([[120.0, 30], [120.1, 40], [300, 210]])("按 ffprobe 实测片长 %s 秒扣 %s；扣费在时长核对之后、看片之前；失败全额退一次", async (duration, credits) => {
    const order: string[] = [];
    const h = harness({ duration, callImpl: (async () => { order.push("call"); throw new Error("x"); }) as any });
    h.charge.mockImplementationOnce(async (_u: number, amount: number, _a: string, _d: string, o: { chargeKey: string }) => {
      order.push("charge");
      h.charges.set(o.chargeKey, amount);
      return { success: true, cost: amount };
    });
    const jobId = await runToEnd(h, `req-price-${credits}`);
    expect(order).toEqual(["charge", "call"]);
    expect(h.charge).toHaveBeenCalledTimes(1);
    expect(h.charge.mock.calls[0]![1]).toBe(credits);
    expect(JSON.parse(h.store.get(`${videoBreakdownJobPrefix(UID, jobId)}/pricing.json`)!.toString())).toMatchObject({ durationSec: duration, price: credits });
    expect(h.refund).toHaveBeenCalledTimes(1);
    expect(h.state(jobId)).toMatchObject({ status: "failed", charged: credits, refund: "done" });
    // 再查 / 再 start 同 requestId：不重复扣、不重复退
    await getVideoBreakdown({ id: UID }, { jobId }, h.deps);
    await startVideoBreakdown({ id: UID }, { gcsUri: srcUri(), requestId: `req-price-${credits}` }, h.deps);
    expect(h.charge).toHaveBeenCalledTimes(1);
    expect(h.refunds.size).toBe(1);
  });

  it("实扣时余额不足：失败、不调模型、不退款", async () => {
    const h = harness({ duration: 300 });
    h.charge.mockResolvedValueOnce({ success: false, cost: 0 });
    const jobId = await runToEnd(h);
    expect(h.call).not.toHaveBeenCalled();
    expect(h.refund).not.toHaveBeenCalled();
    expect(h.state(jobId)).toMatchObject({ status: "failed", failureCode: "insufficient_credits", charged: 0 });
    expect((await getVideoBreakdown({ id: UID }, { jobId }, h.deps)).error).toMatch(/积分不足/);
  });

  it("扣费请求异常（账上实际未落）：失败结单查账退 0，前台不说已退回", async () => {
    const h = harness();
    h.charge.mockRejectedValueOnce(new Error("db timeout"));
    const jobId = await runToEnd(h);
    expect(h.call).not.toHaveBeenCalled();
    expect(h.refund).toHaveBeenCalledTimes(1);
    expect(h.state(jobId)).toMatchObject({ status: "failed", charged: 0, refund: "none" });
    expect((await getVideoBreakdown({ id: UID }, { jobId }, h.deps)).error).not.toContain("积分");
  });

  it("退款失败保留待退，查询时重试成功", async () => {
    const h = harness({ callImpl: (async () => { throw new Error("x"); }) as any });
    h.refund.mockRejectedValueOnce(new Error("db down"));
    const jobId = await runToEnd(h);
    expect(h.state(jobId).refund).toBe("pending");
    expect((await getVideoBreakdown({ id: UID }, { jobId }, h.deps)).error).toContain("积分已退回");
    expect(h.state(jobId).refund).toBe("done");
  });

  it("某段裁切失败不让整单失败：该段 clipUrl 为空串", async () => {
    const h = harness({ failClip: 1 });
    const jobId = await runToEnd(h);
    const view = await getVideoBreakdown({ id: UID }, { jobId }, h.deps);
    expect(view.status).toBe("succeeded");
    expect(view.clipUrls![0]).not.toBe("");
    expect(view.clipUrls![1]).toBe("");
    expect(view.clipUrls![2]).not.toBe("");
    expect(h.refund).not.toHaveBeenCalled();
  });

  it("重点时刻抽帧：get 现签到 keyMomentFrameUrls（下标对应），某帧失败为空串、整单照常成功", async () => {
    const withMoments = { ...videoBreakdownFixture() } as any;
    withMoments.overview = { ...withMoments.overview, keyMoments: [{ atSec: 2, type: "cut", note: "a" }, { atSec: 12, type: "emotion", note: "b" }, { atSec: 22, type: "story", note: "c" }], craft: { reusableTechniques: [] } };
    const h = harness({ failFrame: 1, callImpl: (async (input: any) => ({ value: input.validate(withMoments), channel: "Vertex", model: input.model, failuresZh: [], payload: {} })) as any });
    const jobId = await runToEnd(h);
    const view = await getVideoBreakdown({ id: UID }, { jobId }, h.deps);
    expect(view.status).toBe("succeeded");
    expect(view.result!.overview.keyMoments).toHaveLength(3);
    expect(view.result!.overview.craft).toBeUndefined();
    expect(view.keyMomentFrameUrls).toHaveLength(3);
    expect(view.keyMomentFrameUrls![0]).toContain("frames/km-000.jpg");
    expect(view.keyMomentFrameUrls![0]).toContain("X-Goog-Expires=3600");
    expect(view.keyMomentFrameUrls![1]).toBe("");
    expect(view.keyMomentFrameUrls![2]).not.toBe("");
    expect(h.store.has(`${videoBreakdownJobPrefix(UID, jobId)}/evidence/optional-drops.json`)).toBe(true);
    expect(h.logs.some(l => l.includes("optional_dropped") && l.includes("block=craft"))).toBe(true);
    expect(h.logs.some(l => l.includes("frames_partial"))).toBe(true);
  });

  it("进程重启：进行中单心跳超时 → get 标失败并退款；已完成单重启后照样读到", async () => {
    const h = harness();
    const doneId = await runToEnd(h, "req-done");
    // 伪造一张「别的进程开的、已停止心跳」的进行中单
    const jobId = deriveVideoBreakdownJobId(UID, "req-lost");
    const prefix = videoBreakdownJobPrefix(UID, jobId);
    h.charges.set(videoBreakdownChargeKey(UID, jobId), 20);
    const t = new Date(Date.parse("2026-11-11T00:00:00Z")).toISOString();
    h.store.set(`${prefix}/request.json`, Buffer.from("{}"));
    h.store.set(`${prefix}/state.json`, Buffer.from(JSON.stringify({ jobId, userId: UID, status: "running", stage: "watching", createdAt: t, updatedAt: t, heartbeatAt: t, instanceId: "old", sourceGsUri: srcUri(), charged: 20 })));
    h.store.set(`video-breakdown/_ledger/open/${UID}__${jobId}.json`, Buffer.from("{}"));
    resetVideoBreakdownRuntimeForTest(); // 模拟重启：进程内任务表清空
    expect((await getVideoBreakdown({ id: UID }, { jobId }, h.deps)).status).toBe("running"); // 心跳未超时
    h.advance(VIDEO_BREAKDOWN_STALE_MS + 1000);
    const view = await getVideoBreakdown({ id: UID }, { jobId }, h.deps);
    expect(view.status).toBe("failed");
    expect(view.error).toMatch(/服务重启中断.*积分已退回/);
    expect(h.refunds.has(videoBreakdownRefundKey(UID, jobId))).toBe(true);
    expect((await getVideoBreakdown({ id: UID }, { jobId: doneId }, h.deps)).status).toBe("succeeded");
    // 同 requestId 不会重开（不重复扣费）；换新 requestId 可重新开
    const again = await startVideoBreakdown({ id: UID }, { gcsUri: srcUri(), requestId: "req-lost" }, h.deps);
    expect(again.promise).toBeUndefined();
    const fresh = await startVideoBreakdown({ id: UID }, { gcsUri: srcUri(), requestId: "req-lost-2" }, h.deps);
    await fresh.promise;
    expect(h.state(fresh.jobId).status).toBe("succeeded");
  });

  it("启动清扫：开单未结单且心跳超时的单结单退款，之后不再重复处理", async () => {
    const h = harness();
    const jobId = deriveVideoBreakdownJobId(UID, "req-sweep");
    const prefix = videoBreakdownJobPrefix(UID, jobId);
    h.charges.set(videoBreakdownChargeKey(UID, jobId), 20);
    const t = new Date(Date.parse("2026-11-11T00:00:00Z")).toISOString();
    h.store.set(`${prefix}/state.json`, Buffer.from(JSON.stringify({ jobId, userId: UID, status: "queued", createdAt: t, updatedAt: t, heartbeatAt: t, instanceId: "old", sourceGsUri: srcUri(), charged: 20 })));
    h.store.set(`video-breakdown/_ledger/open/${UID}__${jobId}.json`, Buffer.from("{}"));
    h.advance(VIDEO_BREAKDOWN_STALE_MS + 1000);
    const first = await recoverInterruptedVideoBreakdownJobs(h.deps);
    expect(first).toMatchObject({ checked: 1, interrupted: 1, closed: 1 });
    expect(h.refund).toHaveBeenCalledTimes(1);
    const second = await recoverInterruptedVideoBreakdownJobs(h.deps);
    expect(second.checked).toBe(0);
    expect(h.refund).toHaveBeenCalledTimes(1);
  });
});

describe("裁片", () => {
  it("流复制时长不准 → 局部重编码；流复制准 → 不重编码", async () => {
    const dir = await mkdtemp(path.join(tmp, "cut-"));
    await writeFile(path.join(dir, "src.mp4"), "v");
    const calls: string[][] = [];
    let probeLen = 12.3; // 第一段：关键帧前移导致偏长
    const run: MediaRun = async (cmd, args) => {
      calls.push([cmd, ...args]);
      if (cmd === "ffprobe") return { stdout: JSON.stringify({ format: { duration: String(probeLen) }, streams: [{ codec_type: "video" }] }), stderr: "" };
      await writeFile(args[args.length - 1]!, "x");
      return { stdout: "", stderr: "" };
    };
    const uploaded: string[] = [];
    const out1 = await cutVideoBreakdownClips({ srcFile: path.join(dir, "src.mp4"), dir, segments: [{ startSec: 3, endSec: 13 }], objectNameFor: i => `c/${i}.mp4`, signal: new AbortController().signal },
      { run, uploadFile: async (_f, n) => { uploaded.push(n); } });
    expect(out1).toEqual([{ index: 0, objectName: "c/0.mp4", mode: "reencode" }]);
    const ffmpegArgs = calls.filter(c => c[0] === "ffmpeg").map(c => c.join(" "));
    expect(ffmpegArgs[0]).toContain("-c copy");
    expect(ffmpegArgs[1]).toContain("libx264");
    probeLen = 10.1;
    const out2 = await cutVideoBreakdownClips({ srcFile: path.join(dir, "src.mp4"), dir, segments: [{ startSec: 3, endSec: 13 }], objectNameFor: i => `d/${i}.mp4`, signal: new AbortController().signal },
      { run, uploadFile: async (_f, n) => { uploaded.push(n); } });
    expect(out2[0]!.mode).toBe("copy");
  });
});

export type { VideoBreakdown };
