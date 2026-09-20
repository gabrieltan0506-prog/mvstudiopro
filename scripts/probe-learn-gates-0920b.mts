/**
 * 漫剧学习链 0920 改动 · 离线探针（零外呼、零密钥、零 Fly、零付费）
 * =============================================================
 *
 * 验什么（用户 0920 原话令逐条）：
 *   ① 整形模型 GLM-5.3 → GLM-5.3 Flash，OpenRouter 转主档，provider 仍钉 z-ai/fp8
 *   ② Qwen 只留 plan_sg_qwen；其余三档撤出发起顺序但**必须继续被识别**（停用 ≠ 撤销识别）
 *   ③ 单条证据段 30 → 60 秒，15 秒软线停发（long_take_count 不再发），容差 20% → 拒收线 72 秒
 *   ④ shot_density_low / shot_avg_too_long / ad_ratio_suspicious 只记 advisory，不触发重试
 *   ⑤ 覆盖率保持 90%（用户明确不要求 100%）
 *   ⑥ 降档重试梯度 5 发 [0.7, 0.65, 0.65, 0.6, 0.6]，且指纹只取 [1]/[last] → 不动已付费身份
 *   ⑦ legacyBefore0920 复原历史段缓存指纹（30 秒上限 + 旧 glmRepairModel），单一真源变体表
 *
 * 判据纪律（《判据收口与探针纪律》《断言必须能失败》）：
 *   · 阈值全部**先写死期望值**（72 / 60 / 0.20 / 5 发 / 90%），不写 expect(X).toBe(X)
 *   · 每条断言都有**反例**：把被测常量/名单/代码改坏（源码文本变异 → 克隆一份源码树重跑），
 *     对应断言必须变红；变异锚点匹配不到 1 处即判「变异无效」，整轮作废
 *   · 最硬一条：另开只读工作树到换档前的真代码算历史指纹，本树用 legacyBefore0920 复算，
 *     要求**逐位相同**；并自带反向对照（legacyBefore0920:false 必须全部不同）
 *
 * 跑法：
 *   pnpm exec tsx scripts/probe-learn-gates-0920b.mts                # 全量（断言 + 反例 + 跨工作树指纹）
 *   pnpm exec tsx scripts/probe-learn-gates-0920b.mts --assert-only  # 只跑断言（最快）
 *   pnpm exec tsx scripts/probe-learn-gates-0920b.mts --no-negatives # 断言 + 指纹复原，不跑变异
 *   pnpm exec tsx scripts/probe-learn-gates-0920b.mts --base-ref=488312c9
 *   pnpm exec tsx scripts/probe-learn-gates-0920b.mts --json=/tmp/probe-0920b.json
 *   可选：--keep-mutants（保留变异副本便于复查）  --only-legacy-fingerprint  --require-clean
 *
 * 退出码：0 = 全绿（含所有反例都如期变红）；1 = 任一断言红 / 任一反例没红 / 变异锚点失配。
 *
 * 只读：本脚本**不修改**任何产品代码，只在 `<repo>/.probe-mutants-0920b/`（跑完即删）
 * 与 `~/Documents/Codex/wt/<repo>-baseline-<ref>/`（跑完即 git worktree remove）里造临时副本。
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// ───────────────────────────── 运行参数 ─────────────────────────────
const ARGV = process.argv.slice(2);
const flag = (name: string) => ARGV.includes(`--${name}`);
const opt = (name: string, fallback = "") => {
  const hit = ARGV.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..");
/** 被测源码根：默认本工作树；变异子进程指向克隆副本。 */
const SRC_ROOT = path.resolve(process.env.PROBE_SRC_ROOT || REPO);
const IS_CHILD = Boolean(process.env.PROBE_SRC_ROOT) || flag("child");
const BASE_REF = opt("base-ref", "9e57e371");
const RUN_NEGATIVES = !flag("assert-only") && !flag("no-negatives") && !flag("only-legacy-fingerprint") && !IS_CHILD;
const RUN_LEGACY_FP = (!flag("assert-only") && !flag("no-legacy-fingerprint")) || flag("only-legacy-fingerprint");
const ONLY_LEGACY_FP = flag("only-legacy-fingerprint");
const JSON_OUT = opt("json");
const KEEP_MUTANTS = flag("keep-mutants");
const TSX_BIN = path.join(REPO, "node_modules/.bin/tsx");

const RUNNER_REL = "server/services/manhuaNativeDeepReadRunner.ts";
const BAILIAN_REL = "server/services/bailianChat.ts";
const GLM_MODELS_REL = "server/services/glmModels.ts";
const EVIDENCE_REL = "server/services/manhuaNativeDeepReadGlmEvidence.ts";

// ───────────────────────────── 期望值（先写死，不许从被测对象取） ─────────────────────────────
const EXPECT = {
  openrouterModel: "z-ai/glm-5.3-flash",
  evolinkModel: "glm-5.3-flash",
  openrouterLegacyModel: "z-ai/glm-5.3",
  evolinkLegacyModel: "glm-5.3",
  providerSlug: "z-ai/fp8",
  structuringChain: ["openrouter", "evolink_glm", "plan_sg_qwen"],
  structuringChainQwenFirst: ["plan_sg_qwen", "openrouter", "evolink_glm"],
  retiredQwenGateways: ["plan_bj_qwen", "openrouter_qwen", "evolink_qwen"],
  mustStayRecognized: ["plan_bj_qwen", "openrouter_qwen", "evolink_qwen", "plan_sg_qwen", "openrouter", "evolink_glm"],
  glm53True: ["z-ai/glm-5.3", "glm-5.3", "z-ai/glm-5.3-flash", "glm-5.3-flash"],
  glm53False: ["z-ai/glm-5.3-flashx", "glm-5.2", "z-ai/glm"],
  shotHardMaxSec: 60,
  shotHardMaxSecBefore0920: 30,
  shotRejectSec: 72,
  gateToleranceRatio: 0.20,
  gateDeviationRetryRatio: 0.20,
  coverageRetryRatio: 0.90,
  retryTemperatures: [0.7, 0.65, 0.65, 0.6, 0.6],
  retryShots: 5,
  fingerprintRetryTemp: 0.65,
  fingerprintFinalRetryTemp: 0.6,
  advisoryOnlyCodes: ["shot_density_low", "shot_avg_too_long", "ad_ratio_suspicious"],
  legacyVariantCount: 10,
  pre0906Variants: [
    "legacyBeforeCoverage0906",
    "legacyBeforeExplicitShotWindows0906",
    "legacyBeforeRequiredBranches0906",
    "legacyBeforeStrict0906",
  ],
} as const;
const EPS = 1e-9;

// ───────────────────────────── 断言骨架 ─────────────────────────────
type Check = { id: string; titleZh: string; ok: boolean; detailZh: string; skipped?: boolean };
const checks: Check[] = [];
const fmt = (v: unknown) => (typeof v === "string" ? JSON.stringify(v) : JSON.stringify(v ?? null));

function fail(msg: string): never { throw new Error(msg); }
function eq(actual: unknown, expected: unknown, labelZh: string) {
  if (!Object.is(actual, expected)) fail(`${labelZh}：实际 ${fmt(actual)} ≠ 期望 ${fmt(expected)}`);
}
function near(actual: number, expected: number, labelZh: string) {
  if (!(Math.abs(Number(actual) - expected) <= EPS)) fail(`${labelZh}：实际 ${actual} ≠ 期望 ${expected}`);
}
function eqArray(actual: unknown, expected: readonly unknown[], labelZh: string) {
  const a = Array.from(actual as unknown[] ?? []);
  if (JSON.stringify(a) !== JSON.stringify(expected)) fail(`${labelZh}：实际 ${fmt(a)} ≠ 期望 ${fmt(expected)}`);
}
function check(id: string, titleZh: string, body: () => string | void) {
  try {
    const detail = body();
    checks.push({ id, titleZh, ok: true, detailZh: String(detail ?? "OK") });
  } catch (error) {
    checks.push({ id, titleZh, ok: false, detailZh: error instanceof Error ? error.message : String(error) });
  }
}
function skip(id: string, titleZh: string, whyZh: string) {
  checks.push({ id, titleZh, ok: true, skipped: true, detailZh: `跳过：${whyZh}` });
}

// ───────────────────────────── 被测模块（按 SRC_ROOT 动态载入） ─────────────────────────────
const importFrom = async (rel: string) => import(pathToFileURL(path.join(SRC_ROOT, rel)).href) as Promise<any>;
const readSrc = (rel: string) => readFileSync(path.join(SRC_ROOT, rel), "utf8");
const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex").slice(0, 16);

const R = await importFrom(RUNNER_REL);
const B = await importFrom(BAILIAN_REL);
const G = await importFrom(GLM_MODELS_REL);
const runnerSrc = readSrc(RUNNER_REL);
const evidenceSrc = readSrc(EVIDENCE_REL);

// ───────────────────────────── 段卡夹具（自带，不依赖 *.test.ts） ─────────────────────────────
/** 与 manhuaNativeDeepReadRunner.test.ts 的 makeSegmentPayload 同形：足以过硬门，密度可调。 */
function makeSegmentPayload(input: {
  segmentIndex: number;
  startSec: number;
  endSec: number;
  hasAudio?: boolean;
  shotCountOverride?: number;
  shotsOverride?: Array<{ startSec: number; endSec: number; evidenceRole?: string }>;
}): Record<string, unknown> {
  const lenSec = input.endSec - input.startSec;
  const floors = R.resolveNativeDeepReadSegmentFloors(lenSec);
  const shotCount = input.shotCountOverride ?? floors.minShots + 2;
  const shotLen = lenSec / shotCount;
  const shotFields = (i: number) => ({
    hintZh: "探针观察：本镜人物手持道具，背景留出空地",
    unitTypeZh: "剪辑镜头",
    shotSizeZh: "近景",
    angleZh: "平视",
    compositionZh: "角色居中，前景留出运动空间",
    cameraMoveZh: "固定机位",
    blockingZh: "角色正面站位，保持对峙距离",
    bodyActionZh: "重心前移后停住",
    limbPropActionZh: "右手握住道具并抬起",
    microExpressionZh: "眉心收紧，嘴角克制",
    gazeBreathZh: "视线锁住对手，呼吸渐重",
    relationshipReactionZh: "对方后退后本角色向前压近",
    lightingZh: "顶光冷调",
    actionZh: `人物动作${i}`,
    transitionInZh: "硬切",
    evidenceRole: "story",
  });
  const shots = input.shotsOverride
    ? input.shotsOverride.map((row, i) => ({ ...shotFields(i), ...row }))
    : Array.from({ length: shotCount }, (_, i) => ({
      startSec: Math.round((input.startSec + i * shotLen) * 100) / 100,
      endSec: i === shotCount - 1 ? input.endSec : Math.round((input.startSec + (i + 1) * shotLen) * 100) / 100,
      ...shotFields(i),
    }));
  const trackCount = Math.max(floors.minAudioTracks, 4);
  const trackLen = Math.floor(lenSec / trackCount);
  const cuesPerTrack = Math.ceil((floors.minAudioCues + trackCount) / trackCount);
  const audioTrack = Array.from({ length: trackCount }, (_, i) => {
    const fromSec = i * trackLen;
    const toSec = i === trackCount - 1 ? lenSec : (i + 1) * trackLen;
    return {
      fromSec, toSec,
      emotionArcZh: `压迫渐强${i}`,
      toneZh: "低声克制",
      sfxZh: "环境风声",
      bgmZh: "弦乐铺底",
      atmosphereZh: "紧绷",
      silenceZh: "",
      cues: Array.from({ length: cuesPerTrack }, (_, k) => ({
        atSec: Math.min(toSec, fromSec + k), kind: "sfx" as const, detailZh: `音效事件${i}-${k}`,
      })),
    };
  });
  return {
    shots,
    keyMoments: [
      { atSec: Math.round((input.startSec + lenSec * 0.2) * 10) / 10, kindZh: "剧情", noteZh: `第${input.segmentIndex + 1}段冲突升级` },
      { atSec: Math.round((input.startSec + lenSec * 0.7) * 10) / 10, kindZh: "情绪", noteZh: `第${input.segmentIndex + 1}段情绪峰值` },
    ],
    subtitles: [{ atSec: input.startSec, textZh: "字幕原文" }],
    audioResolution: input.hasAudio === false ? [] : [{
      chunkIndex: input.segmentIndex,
      analysis: {
        audioTrack,
        audioBeatStructureZh: "先抑后扬",
        mixNotesZh: "对白前置",
        reusableAudioZh: "低频铺垫承压",
        genAudioHintZh: "弦乐渐强+环境声",
      },
    }],
    beatStructureZh: "憋三秒后爆",
    moodArcZh: "压抑→爆发",
    classification: {
      emotionTagsZh: ["压迫渐强"],
      narrativeFeatureTagsZh: ["信息递进"],
      performanceTagsZh: ["克制爆发"],
      audiovisualTagsZh: ["冷暖对撞"],
      audienceExperienceTagsZh: ["持续紧张"],
    },
    reusableZh: "开场即冲突的通用做法",
    genPromptHintZh: "景别递进+顶光",
  };
}
const SEG_BASE = { episodeIndex: 1, segmentIndex: 0, startSec: 0, endSec: 300, hasAudio: true } as const;
const advisoryCodesOf = (raw: Record<string, unknown>, over: Record<string, unknown> = {}) =>
  (R.assertNativeDeepReadSegmentDensity({ ...SEG_BASE, ...over, raw }).advisories as Array<{ code: string }>)
    .map((row) => row.code);

// ───────────────────────────── 历史指纹用例矩阵（跨工作树逐位比对） ─────────────────────────────
type FingerprintCase = { key: string; input: Record<string, unknown> };
function buildFingerprintCases(): FingerprintCase[] {
  const shapes = [
    { tag: "s0-c6-fps1", sourceDigest: "probe0920b-digest-aaaa", episodeIndex: 1, episodeDurationSec: 1800, segment: { startSec: 0, endSec: 300 }, segmentIndex: 0, segmentCount: 6, videoFps: 1 },
    { tag: "s3-c6-fps2-hint", sourceDigest: "probe0920b-digest-aaaa", episodeIndex: 1, episodeDurationSec: 1800, segment: { startSec: 900, endSec: 1200, hintZh: "第四段：巷战追逐" }, segmentIndex: 3, segmentCount: 6, videoFps: 2 },
    { tag: "s5-c6-tail9", sourceDigest: "probe0920b-digest-bbbb", episodeIndex: 7, episodeDurationSec: 1089, segment: { startSec: 1080, endSec: 1089 }, segmentIndex: 5, segmentCount: 6, videoFps: 1 },
    { tag: "s0-c4-fps0.5", sourceDigest: "probe0920b-digest-cccc", episodeIndex: 12, episodeDurationSec: 1200, segment: { startSec: 0, endSec: 300 }, segmentIndex: 0, segmentCount: 4, videoFps: 0.5 },
    { tag: "s7-c8-long", sourceDigest: "probe0920b-digest-dddd", episodeIndex: 20, episodeDurationSec: 2817, segment: { startSec: 2400, endSec: 2817 }, segmentIndex: 7, segmentCount: 8, videoFps: 1 },
    { tag: "s1-c6-hint-outer", sourceDigest: "probe0920b-digest-eeee", episodeIndex: 3, episodeDurationSec: 1800, segment: { startSec: 300, endSec: 600 }, segmentIndex: 1, segmentCount: 6, videoFps: 1, hintZh: "调用方外层 hint" },
  ];
  const variants: Array<Record<string, boolean>> = [
    {},
    { legacyBeforeCoverage0906: true },
    { legacyBeforeExplicitShotWindows0906: true },
    { legacyBeforeRequiredBranches0906: true },
    { legacyBeforeStrict0906: true },
  ];
  const cases: FingerprintCase[] = [];
  for (const shape of shapes) {
    for (const hasAudio of [false, true]) {
      for (const variant of variants) {
        const { tag, ...rest } = shape;
        cases.push({
          key: `${tag}|audio=${hasAudio}|${Object.keys(variant)[0] ?? "current"}`,
          input: { ...rest, hasAudio, ...variant },
        });
      }
    }
  }
  return cases;
}

// ───────────────────────────── 断言组 ─────────────────────────────
function runAssertions() {
  // —— ① 整形模型换 Flash、OpenRouter 转主档、provider 仍钉死 ——
  check("A1", "OpenRouter 档模型 = GLM-5.3 Flash", () => {
    eq(B.OPENROUTER_GLM_MODEL, EXPECT.openrouterModel, "OPENROUTER_GLM_MODEL");
    return `OPENROUTER_GLM_MODEL=${B.OPENROUTER_GLM_MODEL}`;
  });
  check("A2", "EvoLink 档模型 = glm-5.3-flash", () => {
    eq(B.EVOLINK_GLM_MODEL, EXPECT.evolinkModel, "EVOLINK_GLM_MODEL");
  });
  check("A3", "OpenRouter provider 仍钉 z-ai/fp8", () => {
    eq(B.OPENROUTER_GLM_PROVIDER_SLUG, EXPECT.providerSlug, "OPENROUTER_GLM_PROVIDER_SLUG");
  });
  check("A4", "换档前旧 id 保留（只进历史身份，永不发请求）", () => {
    eq(B.OPENROUTER_GLM_LEGACY_MODEL_BEFORE_0920, EXPECT.openrouterLegacyModel, "OPENROUTER 旧 id");
    eq(B.EVOLINK_GLM_LEGACY_MODEL_BEFORE_0920, EXPECT.evolinkLegacyModel, "EvoLink 旧 id");
  });
  check("A5", "整形链发起顺序 = OpenRouter 主档 → EvoLink → plan_sg_qwen", () => {
    eqArray(B.STRUCTURING_CHAIN_GATEWAYS, EXPECT.structuringChain, "STRUCTURING_CHAIN_GATEWAYS");
  });
  check("A6", "Qwen 首发链 = plan_sg_qwen → openrouter → evolink_glm", () => {
    eqArray(B.STRUCTURING_CHAIN_QWEN_FIRST_GATEWAYS, EXPECT.structuringChainQwenFirst, "QWEN_FIRST 链序");
  });

  // —— ② 停用 ≠ 撤销识别 ——
  check("A7", "撤档三档不在任何发起顺序里（永不外呼）", () => {
    const chains = [...B.STRUCTURING_CHAIN_GATEWAYS, ...B.STRUCTURING_CHAIN_QWEN_FIRST_GATEWAYS];
    const leaked = EXPECT.retiredQwenGateways.filter((name) => chains.includes(name));
    if (leaked.length) fail(`撤档档位仍在发起顺序：${leaked.join("、")}`);
    if (!chains.includes("plan_sg_qwen")) fail("plan_sg_qwen 被误删：用户明令「plan sg qwen 可以留著」");
  });
  check("A8", "STRUCTURING_GATEWAYS 仍识别撤档三档（停用≠撤销识别）", () => {
    const missing = EXPECT.mustStayRecognized.filter((name) => !R.STRUCTURING_GATEWAYS.has(name));
    if (missing.length) fail(`回读白名单收缩，历史付费证据将作废：缺 ${missing.join("、")}`);
    return `白名单 ${Array.from(R.STRUCTURING_GATEWAYS).sort().join(",")}`;
  });
  check("A9", "STRUCTURING_EVIDENCE_GATEWAYS 同样不收缩（含源码单一真源检查）", () => {
    // 该常量未导出：一验它由四个单一真源 union 而成（源码文本），二按同一 union 复算成员。
    const decl = evidenceSrc.match(/const STRUCTURING_EVIDENCE_GATEWAYS[\s\S]{0,600}?\]\);/)?.[0] ?? "";
    if (!decl) fail("未找到 STRUCTURING_EVIDENCE_GATEWAYS 声明");
    for (const src of ["GLM_MODEL_GATEWAYS", "STRUCTURING_CHAIN_GATEWAYS", "STRUCTURING_CHAIN_QWEN_FIRST_GATEWAYS", "STRUCTURING_LEGACY_RECOGNIZED_GATEWAYS"]) {
      if (!decl.includes(src)) fail(`回读白名单未并入 ${src}（删名字＝历史付费证据作废）`);
    }
    const union = new Set<string>([
      ...Array.from(B.GLM_MODEL_GATEWAYS as Set<string>),
      ...B.STRUCTURING_CHAIN_GATEWAYS,
      ...B.STRUCTURING_CHAIN_QWEN_FIRST_GATEWAYS,
      ...B.STRUCTURING_LEGACY_RECOGNIZED_GATEWAYS,
    ]);
    const missing = EXPECT.mustStayRecognized.filter((name) => !union.has(name));
    if (missing.length) fail(`回读白名单缺 ${missing.join("、")}`);
  });
  check("A10", "isGlm53Model：新旧四个 id 全真，近似 id 全假", () => {
    for (const id of EXPECT.glm53True) if (!G.isGlm53Model(id)) fail(`${id} 应判真`);
    for (const id of EXPECT.glm53False) if (G.isGlm53Model(id)) fail(`${id} 应判假`);
  });

  // —— ③ 60 秒上限 / 20% 容差 / 72 秒拒收线 / 15 秒软线停发 ——
  check("A11", "单条证据段硬上限 = 60 秒，换档前值 = 30 秒", () => {
    near(R.NATIVE_DEEP_READ_SHOT_LONG_TAKE_HARD_MAX_SEC, EXPECT.shotHardMaxSec, "硬上限");
    near(R.NATIVE_DEEP_READ_SHOT_LONG_TAKE_HARD_MAX_SEC_BEFORE_0920, EXPECT.shotHardMaxSecBefore0920, "换档前硬上限");
  });
  check("A12", "单镜拒收线 = 72 秒", () => {
    near(R.NATIVE_DEEP_READ_SHOT_LONG_TAKE_REJECT_SEC, EXPECT.shotRejectSec, "REJECT_SEC");
  });
  check("A13", "容差 = 20%（门禁容差与数值偏差各一处，口径一致）", () => {
    near(R.NATIVE_DEEP_READ_GATE_TOLERANCE_RATIO, EXPECT.gateToleranceRatio, "GATE_TOLERANCE_RATIO");
    near(R.NATIVE_DEEP_READ_GATE_DEVIATION_RETRY_RATIO, EXPECT.gateDeviationRetryRatio, "GATE_DEVIATION_RETRY_RATIO");
  });
  check("A14", "覆盖率保持 90%（用户明确不要求 100%）", () => {
    near(R.NATIVE_DEEP_READ_SEGMENT_COVERAGE_RETRY_RATIO, EXPECT.coverageRetryRatio, "COVERAGE_RETRY_RATIO");
  });
  check("A18", "实跑门禁：72.0 秒单镜过、72.5 秒单镜拒（shot_evidence_too_long）", () => {
    // 🔴 填充镜自己也必须 ≤72 秒，否则被测边界根本没被摸到——原写法 {72,300} 是 228 秒，
    // 两个用例都会被**填充镜**拒掉，等于拿一个恒红的夹具去「验」阈值。
    const fill = (from: number) => {
      const out: Array<{ startSec: number; endSec: number }> = [];
      for (let t = from; t < 300; t += 60) out.push({ startSec: t, endSec: Math.min(300, t + 60) });
      return out;
    };
    const pass = makeSegmentPayload({ ...SEG_BASE, shotsOverride: [{ startSec: 0, endSec: 72 }, ...fill(72)] });
    R.assertNativeDeepReadSegmentDensity({ ...SEG_BASE, raw: pass });
    const rejectRaw = makeSegmentPayload({ ...SEG_BASE, shotsOverride: [{ startSec: 0, endSec: 72.5 }, ...fill(72.5)] });
    let thrown: any = null;
    try { R.assertNativeDeepReadSegmentDensity({ ...SEG_BASE, raw: rejectRaw }); } catch (error) { thrown = error; }
    if (!thrown) fail("72.5 秒单镜居然通过了硬闸");
    const code = String(thrown?.code ?? "");
    const msg = String(thrown?.message ?? "");
    if (code !== "shot_evidence_too_long") fail(`拒因应为 shot_evidence_too_long，实际 ${code || msg.slice(0, 80)}`);
    if (!msg.includes("72")) fail(`拒因文案未写明 72 秒线：${msg.slice(0, 120)}`);
    return "72.0 过 / 72.5 拒";
  });
  check("A19", "15 秒软线停发：20 秒一镜的段不产生 long_take_count", () => {
    const raw = makeSegmentPayload({
      ...SEG_BASE,
      shotsOverride: Array.from({ length: 15 }, (_, i) => ({ startSec: i * 20, endSec: (i + 1) * 20 })),
    });
    const codes = advisoryCodesOf(raw);
    if (codes.includes("long_take_count")) fail(`long_take_count 仍在发：${codes.join("、")}`);
    return `advisories=${codes.join("、") || "（无）"}`;
  });

  // —— ④ 三个 advisory 码只记不重试 ——
  check("A16", "三码已移出 COVERAGE_SOLO_RETRY_CODES", () => {
    const leaked = EXPECT.advisoryOnlyCodes.filter((code) => R.NATIVE_DEEP_READ_COVERAGE_SOLO_RETRY_CODES.has(code));
    if (leaked.length) fail(`仍在 SOLO 名单里（会触发重试烧钱）：${leaked.join("、")}`);
  });
  check("A17", "三码已进 NON_ACTIONABLE_RETRY_CODES（只记 advisory）", () => {
    const missing = EXPECT.advisoryOnlyCodes.filter((code) => !R.NATIVE_DEEP_READ_NON_ACTIONABLE_RETRY_CODES.has(code));
    if (missing.length) fail(`未进 advisory 名单：${missing.join("、")}`);
  });
  check("A20", "实跑验收：镜数稀疏/平均镜长偏大只记 advisory，retry=false", () => {
    const raw = makeSegmentPayload({
      ...SEG_BASE,
      shotsOverride: Array.from({ length: 5 }, (_, i) => ({ startSec: i * 60, endSec: (i + 1) * 60 })),
    });
    const codes = advisoryCodesOf(raw);
    const hit = EXPECT.advisoryOnlyCodes.filter((code) => codes.includes(code));
    if (hit.length === 0) fail(`夹具没有触发密度类 advisory（用例失效，需重造）：${codes.join("、") || "无"}`);
    const decision = R.evaluateNativeDeepReadSegmentAcceptance({ ...SEG_BASE, raw });
    if (decision.retry !== false) fail(`密度类 advisory 仍触发重试：retry=${decision.retry}，codes=${codes.join("、")}`);
    if (decision.coverageSoloRetry !== false) fail("密度类 advisory 仍被算进 coverageSoloRetry");
    return `advisory 命中 ${hit.join("、")}；retry=false`;
  });

  // —— ⑥ 降档重试梯度 5 发，且不动已付费身份 ——
  check("A15", "降档重试梯度 = [0.7,0.65,0.65,0.6,0.6]（共 5 发）", () => {
    eqArray(R.NATIVE_DEEP_READ_RETRY_TEMPERATURES, EXPECT.retryTemperatures, "RETRY_TEMPERATURES");
    eq(R.NATIVE_DEEP_READ_RETRY_TEMPERATURES.length, EXPECT.retryShots, "重试发数");
    near(R.NATIVE_DEEP_READ_RETRY_TEMPERATURES[1], EXPECT.fingerprintRetryTemp, "指纹取值 [1]");
    near(R.NATIVE_DEEP_READ_RETRY_TEMPERATURES.at(-1), EXPECT.fingerprintFinalRetryTemp, "指纹取值 [last]");
  });

  // —— ⑦ 历史身份变体表（单一真源） ——
  check("A21", "LEGACY_FINGERPRINT_VARIANTS = 5 形 × 2（含 legacyBefore0920），且两处消费者共用", () => {
    const variants = R.NATIVE_DEEP_READ_LEGACY_FINGERPRINT_VARIANTS as Array<Record<string, boolean>>;
    eq(variants.length, EXPECT.legacyVariantCount, "变体条数");
    const keys = variants.map((v) => JSON.stringify(Object.keys(v).sort()));
    for (const base of ["", ...EXPECT.pre0906Variants]) {
      const withoutNew = JSON.stringify(base ? [base] : []);
      const withNew = JSON.stringify(base ? [base, "legacyBefore0920"].sort() : ["legacyBefore0920"]);
      if (!keys.includes(withoutNew)) fail(`缺变体 ${withoutNew}`);
      if (!keys.includes(withNew)) fail(`缺 0920 复原变体 ${withNew}`);
    }
    const uses = runnerSrc.split("NATIVE_DEEP_READ_LEGACY_FINGERPRINT_VARIANTS").length - 1;
    if (uses < 3) fail(`变体表只被引用 ${uses - 1} 处：两处消费者必须共用单一真源（0906 分家事故）`);
    return `${variants.length} 变体 / 源码引用 ${uses - 1} 处`;
  });
  check("A22", "legacyBefore0920 确实改身份：同输入开关两态指纹必须不同", () => {
    const [sample] = buildFingerprintCases();
    const off = R.nativeDeepReadSegmentCacheFingerprint({ ...sample.input, legacyBefore0920: false });
    const on = R.nativeDeepReadSegmentCacheFingerprint({ ...sample.input, legacyBefore0920: true });
    if (off === on) fail("legacyBefore0920 开关不改指纹＝历史身份根本没复原（空壳开关）");
    return `${off.slice(0, 12)} ≠ ${on.slice(0, 12)}`;
  });
  check("A23", "提示词/schema 的秒数上限随身份切换（60 现行 / 30 历史）", () => {
    const now = String(R.buildNativeDeepReadObservationPlanBlock(300));
    const legacy = String(R.buildNativeDeepReadObservationPlanBlock(300, EXPECT.shotHardMaxSecBefore0920));
    if (!now.includes(`${EXPECT.shotHardMaxSec} 秒`)) fail("现行提示词未出现 60 秒上限");
    if (now.includes(`超过 ${EXPECT.shotHardMaxSecBefore0920} 秒`)) fail("现行提示词仍写着 30 秒上限");
    if (!legacy.includes(`${EXPECT.shotHardMaxSecBefore0920} 秒`)) fail("历史提示词未还原 30 秒上限");
    if (now === legacy) fail("提示词不随 capSec 变化＝指纹复原无意义");
  });
}

// ───────────────────────────── 跨工作树：历史指纹逐位复原 ─────────────────────────────
const CHILD_SCRIPT_REL = "scripts/__probe-0920b-legacy-fingerprint-child.mts";
const CHILD_SOURCE = `import { readFileSync } from "node:fs";
import { nativeDeepReadSegmentCacheFingerprint } from "../server/services/manhuaNativeDeepReadRunner.js";
const cases = JSON.parse(readFileSync(process.argv[2]!, "utf8"));
const out = cases.map((row: any) => ({ key: row.key, fp: nativeDeepReadSegmentCacheFingerprint(row.input) }));
process.stdout.write("__FP_JSON__" + JSON.stringify(out));
`;

function baselineWorktreeDir(ref: string) {
  return path.join(os.homedir(), "Documents/Codex/wt", `${path.basename(REPO)}-baseline-${ref}`);
}

/** 在换档前的真代码上算历史指纹；返回 key → fingerprint。 */
function computeBaselineFingerprints(cases: FingerprintCase[]): Map<string, string> {
  const reuse = process.env.PROBE_BASELINE_DIR;
  const dir = reuse ? path.resolve(reuse) : baselineWorktreeDir(BASE_REF);
  let created = false;
  try {
    if (!reuse) {
      /**
       * 🔴 0920 用户令：「**不准開 fork**」「不許新建 git worktree」——他不愿同时面对两条修改路径。
       * 所以本探针**默认不自己开基线工作树**：要跑历史指纹复原这一档，必须由用户/接手人
       * 先自己准备好基线目录再用 `PROBE_BASELINE_DIR=<dir>` 指过来；
       * 只有显式 `--allow-baseline-worktree` 才允许脚本自己开（跑完强制删）。
       */
      if (!process.argv.includes("--allow-baseline-worktree")) {
        fail(
          "历史指纹复原档需要换档前的基线代码：请用 PROBE_BASELINE_DIR=<已有基线目录> 指定，"
          + "或显式加 --allow-baseline-worktree 允许本脚本临时开一棵基线工作树（默认禁止，用户明令不准开 fork）",
        );
      }
      if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
      const add = spawnSync("git", ["-C", REPO, "worktree", "add", "--detach", dir, BASE_REF], { encoding: "utf8" });
      if (add.status !== 0) fail(`建基线工作树失败（${BASE_REF}）：${add.stderr || add.stdout}`);
      created = true;
      if (!existsSync(path.join(dir, "node_modules"))) {
        symlinkSync(path.join(REPO, "node_modules"), path.join(dir, "node_modules"), "dir");
      }
      writeFileSync(path.join(dir, CHILD_SCRIPT_REL), CHILD_SOURCE, "utf8");
    }
    const caseFile = path.join(os.tmpdir(), `probe-0920b-cases-${process.pid}.json`);
    writeFileSync(caseFile, JSON.stringify(cases), "utf8");
    const run = spawnSync(TSX_BIN, [path.join(dir, CHILD_SCRIPT_REL), caseFile], { cwd: dir, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    rmSync(caseFile, { force: true });
    const marker = String(run.stdout || "").indexOf("__FP_JSON__");
    if (run.status !== 0 || marker < 0) {
      fail(`基线指纹子进程失败：${String(run.stderr || run.stdout || "").slice(-600)}`);
    }
    const rows = JSON.parse(String(run.stdout).slice(marker + "__FP_JSON__".length)) as Array<{ key: string; fp: string }>;
    return new Map(rows.map((row) => [row.key, row.fp]));
  } finally {
    if (created && !KEEP_MUTANTS) {
      spawnSync("git", ["-C", REPO, "worktree", "remove", "--force", dir], { encoding: "utf8" });
      rmSync(dir, { recursive: true, force: true });
    }
  }
}

function runLegacyFingerprintCheck() {
  const cases = buildFingerprintCases();
  let baseline: Map<string, string>;
  try {
    baseline = computeBaselineFingerprints(cases);
  } catch (error) {
    checks.push({
      id: "A24", titleZh: `跨工作树历史指纹逐位复原（基线 ${BASE_REF}）`,
      ok: false, detailZh: error instanceof Error ? error.message : String(error),
    });
    return;
  }
  check("A24", `跨工作树历史指纹逐位复原（基线 ${BASE_REF}，${cases.length} 例）`, () => {
    const bad: string[] = [];
    for (const item of cases) {
      const old = baseline.get(item.key);
      if (!old) { bad.push(`${item.key}: 基线无结果`); continue; }
      const now = R.nativeDeepReadSegmentCacheFingerprint({ ...item.input, legacyBefore0920: true });
      if (now !== old) bad.push(`${item.key}: 旧 ${old.slice(0, 12)} ≠ 新 ${now.slice(0, 12)}`);
    }
    if (bad.length) fail(`复原失败 ${bad.length}/${cases.length}（已付费分片会重买）：\n    ${bad.slice(0, 8).join("\n    ")}`);
    return `复原成功 ${cases.length}/${cases.length}（逐位相同）`;
  });
  check("A25", "反向对照：不开 legacyBefore0920 时必须全部对不上", () => {
    let same = 0;
    for (const item of cases) {
      const now = R.nativeDeepReadSegmentCacheFingerprint({ ...item.input, legacyBefore0920: false });
      if (now === baseline.get(item.key)) same += 1;
    }
    if (same !== 0) fail(`有 ${same}/${cases.length} 例在不开复原开关时也相同＝这批用例对换档不敏感，A24 的绿是假绿`);
    return `${cases.length}/${cases.length} 例全部不同（用例确实敏感）`;
  });
}

// ───────────────────────────── 反例（源码文本变异 → 对应断言必须变红） ─────────────────────────────
type Mutation = {
  id: string;
  whatZh: string;
  file: string;
  find: string;
  replace: string;
  expectRed: string[];
  mode?: "assert" | "legacy";
};
const MUTATIONS: Mutation[] = [
  {
    id: "N1", whatZh: "把单条证据段上限改回 30 秒", file: RUNNER_REL,
    find: "export const NATIVE_DEEP_READ_SHOT_LONG_TAKE_HARD_MAX_SEC = 60;",
    replace: "export const NATIVE_DEEP_READ_SHOT_LONG_TAKE_HARD_MAX_SEC = 30;",
    expectRed: ["A11", "A12", "A18", "A23"],
  },
  {
    id: "N2", whatZh: "把容差改回 15%", file: RUNNER_REL,
    find: "export const NATIVE_DEEP_READ_GATE_TOLERANCE_RATIO = 0.20;",
    replace: "export const NATIVE_DEEP_READ_GATE_TOLERANCE_RATIO = 0.15;",
    expectRed: ["A13", "A12", "A18"],
  },
  {
    id: "N3", whatZh: "把重试梯度改回 3 发", file: RUNNER_REL,
    find: "  [0.7, 0.65, 0.65, 0.6, 0.6] as const);",
    replace: "  [0.7, 0.65, 0.6] as const);",
    expectRed: ["A15"],
  },
  {
    id: "N4", whatZh: "把覆盖率抬到 100%", file: RUNNER_REL,
    find: "export const NATIVE_DEEP_READ_SEGMENT_COVERAGE_RETRY_RATIO = 0.90;",
    replace: "export const NATIVE_DEEP_READ_SEGMENT_COVERAGE_RETRY_RATIO = 1.0;",
    expectRed: ["A14"],
  },
  {
    id: "N5", whatZh: "把三个密度码塞回 SOLO 重试名单", file: RUNNER_REL,
    find: `  "coverage_missing", "coverage_head_gap", "coverage_tail_gap", "timeline_gap",`,
    replace: `  "coverage_missing", "coverage_head_gap", "coverage_tail_gap", "timeline_gap",\n  "shot_density_low", "shot_avg_too_long", "ad_ratio_suspicious",`,
    expectRed: ["A16"],
  },
  {
    id: "N6", whatZh: "把三个密度码从 advisory 名单里删掉", file: RUNNER_REL,
    find: `  // 0920 用户令：密度类与广告占比一律只记建议，不触发重试。\n  "shot_density_low", "shot_avg_too_long", "ad_ratio_suspicious",`,
    replace: "",
    expectRed: ["A17", "A20"],
  },
  {
    id: "N7", whatZh: "清空 legacy 识别名单（模拟 0920 白名单收缩事故）", file: BAILIAN_REL,
    find: `  "plan_bj_qwen", "openrouter_qwen", "evolink_qwen", "plan_sg_qwen",\n];`,
    replace: "];",
    expectRed: ["A8", "A9"],
  },
  {
    id: "N8", whatZh: "OpenRouter 档退回非 Flash 模型", file: BAILIAN_REL,
    find: `export const OPENROUTER_GLM_MODEL = "z-ai/glm-5.3-flash";`,
    replace: `export const OPENROUTER_GLM_MODEL = "z-ai/glm-5.3";`,
    expectRed: ["A1"],
  },
  {
    id: "N9", whatZh: "provider 锁松掉", file: BAILIAN_REL,
    find: `export const OPENROUTER_GLM_PROVIDER_SLUG = "z-ai/fp8";`,
    replace: `export const OPENROUTER_GLM_PROVIDER_SLUG = "z-ai";`,
    expectRed: ["A3"],
  },
  {
    id: "N10", whatZh: "isGlm53Model 不认 Flash 两个 id", file: GLM_MODELS_REL,
    find: "  return v === GLM_53_OPENROUTER_MODEL || v === GLM_53_EVOLINK_MODEL\n    || v === GLM_53_FLASH_OPENROUTER_MODEL || v === GLM_53_FLASH_EVOLINK_MODEL;",
    replace: "  return v === GLM_53_OPENROUTER_MODEL || v === GLM_53_EVOLINK_MODEL;",
    expectRed: ["A10"],
  },
  {
    id: "N11", whatZh: "变体表不再乘 legacyBefore0920 这一维", file: RUNNER_REL,
    find: "    .flatMap((version) => [version, { ...version, legacyBefore0920: true }]);",
    replace: "    ;",
    expectRed: ["A21"],
  },
  {
    id: "N12", whatZh: "撤档的北京套餐偷偷回到发起顺序", file: BAILIAN_REL,
    find: `  "openrouter", "evolink_glm", "plan_sg_qwen",\n];`,
    replace: `  "openrouter", "evolink_glm", "plan_sg_qwen", "plan_bj_qwen",\n];`,
    expectRed: ["A5", "A7"],
  },
  {
    id: "N13", whatZh: "恢复 15 秒软线的 long_take_count", file: RUNNER_REL,
    find: "  void physicalDurations;",
    replace: "  if (physicalDurations.some((d) => d > NATIVE_DEEP_READ_SHOT_SINGLE_MAX_SEC)) "
      + `out.push({ code: "long_take_count", detailZh: "变异注入", segmentIndex: input.segmentIndex });`,
    expectRed: ["A19"],
  },
  {
    id: "N14", whatZh: "把换档前上限写错（30 → 45），历史身份复原失效", file: RUNNER_REL,
    find: "export const NATIVE_DEEP_READ_SHOT_LONG_TAKE_HARD_MAX_SEC_BEFORE_0920 = 30;",
    replace: "export const NATIVE_DEEP_READ_SHOT_LONG_TAKE_HARD_MAX_SEC_BEFORE_0920 = 45;",
    expectRed: ["A24"], // 这条只跑跨工作树比对；A11 的反例由 N1 覆盖
    mode: "legacy",
  },
  {
    id: "N15", whatZh: "把旧 glmRepairModel 写成新值，历史身份复原失效", file: RUNNER_REL,
    find: "      ? `${EVOLINK_GLM_LEGACY_MODEL_BEFORE_0920}→${OPENROUTER_GLM_LEGACY_MODEL_BEFORE_0920}`",
    replace: "      ? NATIVE_DEEP_READ_GLM_STRUCTURING_MODEL",
    expectRed: ["A24"],
    mode: "legacy",
  },
];

const MUTANT_ROOT = path.join(REPO, ".probe-mutants-0920b");

function cloneSourceTree(dest: string) {
  mkdirSync(dest, { recursive: true });
  for (const dir of ["server", "shared"]) {
    const cloned = spawnSync("cp", ["-Rc", path.join(REPO, dir), dest], { encoding: "utf8" });
    if (cloned.status !== 0) {
      const plain = spawnSync("cp", ["-R", path.join(REPO, dir), dest], { encoding: "utf8" });
      if (plain.status !== 0) fail(`复制源码树失败：${plain.stderr}`);
    }
  }
}

function runNegatives(baselineDirForLegacy?: string) {
  rmSync(MUTANT_ROOT, { recursive: true, force: true });
  mkdirSync(MUTANT_ROOT, { recursive: true });
  try {
    for (const mutation of MUTATIONS) {
      const dir = path.join(MUTANT_ROOT, mutation.id);
      let outcome = "";
      try {
        cloneSourceTree(dir);
        const target = path.join(dir, mutation.file);
        const before = readFileSync(target, "utf8");
        const hits = before.split(mutation.find).length - 1;
        // 变异锚点必须唯一命中：改不动＝这条反例根本没生效，绿了也是假绿。
        if (hits !== 1) fail(`变异锚点命中 ${hits} 次（应为 1）——反例无效，整轮作废。锚点：${mutation.find.slice(0, 60)}…`);
        writeFileSync(target, before.replace(mutation.find, mutation.replace), "utf8");
        const args = [path.join(REPO, "scripts", path.basename(fileURLToPath(import.meta.url))), "--json=-"];
        args.push(mutation.mode === "legacy" ? "--only-legacy-fingerprint" : "--assert-only");
        const run = spawnSync(TSX_BIN, args, {
          cwd: REPO, encoding: "utf8", maxBuffer: 64 * 1024 * 1024,
          env: {
            ...process.env,
            PROBE_SRC_ROOT: dir,
            ...(mutation.mode === "legacy" && baselineDirForLegacy ? { PROBE_BASELINE_DIR: baselineDirForLegacy } : {}),
          },
        });
        const marker = String(run.stdout || "").indexOf("__PROBE_JSON__");
        if (marker < 0) fail(`变异子进程无结果（可能编译失败）：${String(run.stderr || run.stdout).slice(-500)}`);
        const childChecks = JSON.parse(String(run.stdout).slice(marker + "__PROBE_JSON__".length)) as Check[];
        const byId = new Map(childChecks.map((row) => [row.id, row]));
        const notRed = mutation.expectRed.filter((id) => {
          const row = byId.get(id);
          return !row || row.skipped || row.ok;
        });
        if (notRed.length) fail(`变异后这些断言没变红（断言不可证伪）：${notRed.join("、")}`);
        outcome = `期望变红的 ${mutation.expectRed.join("、")} 全部变红`;
      } catch (error) {
        checks.push({ id: mutation.id, titleZh: `反例 · ${mutation.whatZh}`, ok: false, detailZh: error instanceof Error ? error.message : String(error) });
        continue;
      } finally {
        if (!KEEP_MUTANTS) rmSync(dir, { recursive: true, force: true });
      }
      checks.push({ id: mutation.id, titleZh: `反例 · ${mutation.whatZh}`, ok: true, detailZh: outcome });
    }
  } finally {
    if (!KEEP_MUTANTS) rmSync(MUTANT_ROOT, { recursive: true, force: true });
  }
}

// ───────────────────────────── 自证清单（镜像=被测代码） ─────────────────────────────
function provenance() {
  const git = (args: string[]) => String(spawnSync("git", ["-C", REPO, ...args], { encoding: "utf8" }).stdout || "").trim();
  const dirty = git(["status", "--porcelain", "--", RUNNER_REL, BAILIAN_REL, GLM_MODELS_REL, EVIDENCE_REL]);
  return {
    repo: REPO,
    srcRoot: SRC_ROOT,
    head: git(["rev-parse", "--short", "HEAD"]),
    branch: git(["rev-parse", "--abbrev-ref", "HEAD"]),
    baseRef: BASE_REF,
    dirtyFiles: dirty ? dirty.split("\n") : [],
    fileSha: {
      runner: sha256(runnerSrc),
      bailian: sha256(readSrc(BAILIAN_REL)),
      glmModels: sha256(readSrc(GLM_MODELS_REL)),
      evidence: sha256(evidenceSrc),
    },
  };
}

// ───────────────────────────── 主流程 ─────────────────────────────
const prov = provenance();
if (!ONLY_LEGACY_FP) runAssertions();
if (RUN_LEGACY_FP) runLegacyFingerprintCheck();
else if (!ONLY_LEGACY_FP) skip("A24", "跨工作树历史指纹逐位复原", "本次按参数跳过（--assert-only / --no-legacy-fingerprint）");

if (RUN_NEGATIVES) {
  // 反例里有两条要跑跨工作树比对；基线工作树建一次供其复用，省掉 14 次 worktree add。
  const legacyNeeded = MUTATIONS.some((m) => m.mode === "legacy");
  let baselineDir: string | undefined;
  let baselineCreated = false;
  if (legacyNeeded) {
    baselineDir = baselineWorktreeDir(`${BASE_REF}-neg`);
    rmSync(baselineDir, { recursive: true, force: true });
    const add = spawnSync("git", ["-C", REPO, "worktree", "add", "--detach", baselineDir, BASE_REF], { encoding: "utf8" });
    if (add.status === 0) {
      baselineCreated = true;
      if (!existsSync(path.join(baselineDir, "node_modules"))) {
        symlinkSync(path.join(REPO, "node_modules"), path.join(baselineDir, "node_modules"), "dir");
      }
      writeFileSync(path.join(baselineDir, CHILD_SCRIPT_REL), CHILD_SOURCE, "utf8");
    } else {
      baselineDir = undefined;
      checks.push({ id: "N-setup", titleZh: "反例基线工作树", ok: false, detailZh: `建树失败：${add.stderr || add.stdout}` });
    }
  }
  try {
    runNegatives(baselineDir);
  } finally {
    if (baselineCreated && baselineDir && !KEEP_MUTANTS) {
      spawnSync("git", ["-C", REPO, "worktree", "remove", "--force", baselineDir], { encoding: "utf8" });
      rmSync(baselineDir, { recursive: true, force: true });
    }
  }
}

const failed = checks.filter((row) => !row.ok);
const payload = { provenance: prov, checks, failedCount: failed.length };

if (JSON_OUT === "-" || IS_CHILD) {
  process.stdout.write(`__PROBE_JSON__${JSON.stringify(checks)}`);
} else {
  const lines: string[] = [];
  lines.push("漫剧学习链 0920 离线探针");
  lines.push(`  仓库 ${prov.repo}`);
  lines.push(`  分支 ${prov.branch} @ ${prov.head}   基线 ${prov.baseRef}`);
  lines.push(`  被测源码 sha16：runner=${prov.fileSha.runner} bailian=${prov.fileSha.bailian} glmModels=${prov.fileSha.glmModels} evidence=${prov.fileSha.evidence}`);
  if (prov.dirtyFiles.length) {
    lines.push(`  ⚠️ 工作树有未提交改动：${prov.dirtyFiles.join(" | ")}`);
    lines.push("     → 本轮结论只对**本地这份代码**成立；按《探针必须跑已推送镜像》，推上去后必须重跑一遍再谈发车。");
  }
  lines.push("");
  for (const row of checks) {
    lines.push(`${row.skipped ? "⊘" : row.ok ? "✅" : "❌"} ${row.id} ${row.titleZh}`);
    if (row.detailZh) lines.push(`      ${row.detailZh.replace(/\n/g, "\n      ")}`);
  }
  lines.push("");
  lines.push(`断言/反例合计 ${checks.length} 条，红 ${failed.length} 条${failed.length ? "：" + failed.map((r) => r.id).join("、") : "（全绿）"}`);
  process.stdout.write(`${lines.join("\n")}\n`);
  if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify(payload, null, 2), "utf8");
}

if (flag("require-clean") && prov.dirtyFiles.length) process.exit(2);
process.exit(failed.length ? 1 : 0);
