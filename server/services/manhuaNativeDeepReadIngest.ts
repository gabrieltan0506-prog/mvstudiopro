/**
 * 原生视频精读 → 待审模板卡入库。
 *
 * 立此模块的原因（0824 用户原话）：
 * > 「你不进模板库，要给我导入的方式跟接口，要不然我这钱不白烧了吗」
 *
 * 精读跑完只落一堆 JSON 到临时目录，等于花钱买了看不见的东西。
 * 这里补上最后一段：**产出 → 模板卡 → `proposals/` → 审批页 → 批准 → 编剧室可选**。
 *
 * 三条与抽帧链路不同的设计：
 *
 * 1. **一集一张卡**，不做跨集聚合。18 分钟单集自带完整节奏结构，
 *    20 集揉成一张 128 拍的卡等于把每集都稀释掉 1/20。
 * 2. **每集跑完立刻入库**，不攒到最后。中途挂了，已烧的钱已经变成卡；
 *    重跑时 `listIngestedNativeDeepReadEpisodes()` 列一次就知道跳哪几集。
 * 3. **门禁在写之前**。空卡、全段失败的卡不许进库——审批人点开一张没有镜头的卡，
 *    比根本没有这张卡更浪费时间，而且会掩盖「这集其实没学到」的事实。
 */
import {
  downloadGcsObject,
  getGcsBucketName,
  listGcsObjectNamesByPrefix,
  uploadBufferToGcsIfAbsent,
} from "./gcs.js";
import { guessLane } from "../../shared/manhuaTemplateLearnSeries.js";
import {
  parseManhuaViralTemplateCard,
  type ManhuaViralTemplateCard,
  type ManhuaViralTemplateLane,
} from "../../shared/manhuaViralTemplateBank.js";
import type { NativeDeepReadOutput } from "../../shared/manhuaNativeDeepRead.js";

/** 与 manhuaViralTemplateStore 的 proposals 前缀一致；改这里等于改入库位置 */
export const NATIVE_DEEP_READ_PROPOSAL_PREFIX = "manhua-template-learn/proposals/";

/** 低于这个镜头数不算学到东西，拒绝入库 */
export const NATIVE_DEEP_READ_MIN_SHOTS = 6;

/** 精读入库所需的最小产出形状（runner 的返回值是它的超集） */
export type NativeDeepReadIngestSource = NativeDeepReadOutput & {
  model: string;
  attemptedSegments: number;
  usingPlanQuota?: boolean;
  usage?: { costCny?: number };
};

export type NativeDeepReadIngestInput = {
  /** 合集标识，同一合集的各集共用 */
  seriesKey: string;
  /** 集序号，1-based */
  episodeIndex: number;
  /** 该集来源地址，只进 sourceRefs 做溯源，不进任何提示词 */
  sourceUrl: string;
  /** 该集时长（秒），进摘要 */
  durationSec?: number;
  /**
   * 赛道判断用的中性文本（题材关键词即可）。
   *
   * ⚠️ **不要传外部平台剧名**：卡面 nameZh 也不从这里取。
   * 判据走全站唯一的 `guessLane()`，不在本模块另写一套。
   */
  laneHintZh?: string;
  /** 显式指定赛道时跳过推断 */
  laneZh?: ManhuaViralTemplateLane;
  result: NativeDeepReadIngestSource;
};

/**
 * 对象名与卡 id 的**唯一真源**。
 *
 * 断点续跑、写入、去重三处都必须走这两个函数——三处各自拼字符串，
 * 就会出现「写进去的和查出来的对不上，于是每次重跑都重烧一遍」。
 */
export function nativeDeepReadProposalId(seriesKey: string, episodeIndex: number): string {
  // 剥非法字符会让 "a/b" 与 "ab" 落到同一张卡，后写的覆盖先写的且不报错 —— 宁可拒绝
  const key = String(seriesKey || "").trim();
  if (!/^[0-9A-Za-z_-]{1,40}$/.test(key)) {
    throw new Error("seriesKey 格式无效，拒绝静默改写以免不同合集发生碰撞");
  }
  const episode = Number(episodeIndex);
  if (!Number.isInteger(episode) || episode < 1 || episode > 999) {
    throw new Error("episodeIndex 必须是 1–999 的整数");
  }
  const ep = String(episode).padStart(3, "0");
  return `tpl_native_${key}_ep${ep}`;
}

export function nativeDeepReadProposalObjectName(seriesKey: string, episodeIndex: number): string {
  return `${NATIVE_DEEP_READ_PROPOSAL_PREFIX}${nativeDeepReadProposalId(seriesKey, episodeIndex)}.json`;
}

/** 从对象名反解集号，供断点续跑用；不是本模块写的卡返回 null */
export function parseNativeDeepReadEpisodeIndex(
  objectName: string,
  seriesKey: string,
): number | null {
  const id = nativeDeepReadProposalId(seriesKey, 1).replace(/ep001$/, "");
  const m = String(objectName || "").match(
    new RegExp(`${id.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}ep(\\d{3})\\.json$`),
  );
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n >= 1 ? n : null;
}

export type NativeDeepReadIngestRejection = {
  ok: false;
  reasonZh: string;
};

/**
 * 入库门禁：什么样的产出才配写进模板库。
 *
 * 判据只在这一处，写入与预检共用。`truncated` 不拦——触顶说明学得多，
 * 卡面会标出来让审批人知道被抽稀过，但不该因此丢掉整集。
 */
export function checkNativeDeepReadIngestable(
  result: NativeDeepReadIngestSource,
): { ok: true } | NativeDeepReadIngestRejection {
  if (!result || !Array.isArray(result.beatGrid)) {
    return { ok: false, reasonZh: "精读产出为空" };
  }

  const attemptedSegments = Number(result.attemptedSegments);
  const segmentCount = Number(result.segmentCount);
  const failedSegmentCount = Number(result.failedSegmentCount);

  if (!String(result.model || "").trim()) {
    return { ok: false, reasonZh: "精读产出缺少模型标识" };
  }
  if (!Number.isInteger(attemptedSegments) || attemptedSegments < 1) {
    return { ok: false, reasonZh: "计划精读段数无效" };
  }
  if (!Number.isInteger(segmentCount) || segmentCount < 0 || segmentCount > attemptedSegments) {
    return { ok: false, reasonZh: "成功段数超出计划范围" };
  }
  if (segmentCount === 0) {
    return { ok: false, reasonZh: `全部 ${result.attemptedSegments} 段精读失败，没有可入库的结构` };
  }
  // 计数自相矛盾说明上游装配出错，此时写出来的 provenance 是假账，宁可拒收
  if (
    !Number.isInteger(failedSegmentCount)
    || failedSegmentCount < 0
    || failedSegmentCount !== attemptedSegments - segmentCount
  ) {
    return { ok: false, reasonZh: "成功段数与失败段数不一致，未写入来源记录" };
  }
  if (Number(result.shotCount) !== result.beatGrid.length) {
    return { ok: false, reasonZh: "镜头计数与镜头表长度不一致" };
  }
  if (!Number.isInteger(Number(result.droppedCount)) || Number(result.droppedCount) < 0) {
    return { ok: false, reasonZh: "丢弃镜头计数无效" };
  }

  // 按数组长度判会被空镜头骗过去：解析器随后会把空镜头全滤掉，落库变成空卡
  const usableShotCount = result.beatGrid.filter(
    (beat) => String(beat?.conflictZh || "").trim() && String(beat?.visualZh || "").trim(),
  ).length;

  if (usableShotCount < NATIVE_DEEP_READ_MIN_SHOTS) {
    return {
      ok: false,
      reasonZh: `仅解析到 ${usableShotCount} 个有效镜头（低于 ${NATIVE_DEEP_READ_MIN_SHOTS} 镜下限），判为没学到`,
    };
  }
  return { ok: true };
}

const cut = (v: unknown, max: number): string => String(v || "").trim().slice(0, max);

/**
 * 产出 → 卡（纯函数，不碰网络，可单测）。
 *
 * 卡面上每一栏都必须能追到精读的原始字段：
 * - `summaryZh` / `hook3sZh` ← moodArc 与首镜，**不是**套话模板
 * - `reusableZh` / `genPromptHintZh` ← 精读独有的两栏，抽帧链路给不出
 * - `castShape` 精读学不到（提示词是镜头级的），故写「待补」而不是编一个。
 *   `待` 开头是本仓既有约定，下游按前缀就能认出「这栏没学到」。
 */
export function buildNativeDeepReadProposalCard(
  input: NativeDeepReadIngestInput,
): ManhuaViralTemplateCard | null {
  const gate = checkNativeDeepReadIngestable(input.result);
  if (!gate.ok) return null;
  // 没有来源地址的卡无法溯源，等于学到的东西说不清出处
  const sourceUrl = String(input.sourceUrl || "").trim();
  if (!sourceUrl) return null;

  const r = input.result;
  const today = new Date().toISOString().slice(0, 10);
  const laneZh = input.laneZh
    || guessLane(`${input.laneHintZh || ""}\n${r.reusableZh || ""}\n${r.beatStructureZh || ""}`);

  // 开场钩子取真实首 3 秒的镜头，不用套话
  const opening = r.beatGrid
    .filter((b) => Number(b.atSec) <= 3)
    .slice(0, 2)
    .map((b) => [b.shotSizeZh, b.visualZh].filter(Boolean).join("·"))
    .filter(Boolean)
    .join("；");
  const hook3sZh = cut(opening || r.beatStructureZh, 200)
    || "开场即进冲突（原生精读未取到首镜描述）";

  const durSec = Math.max(0, Math.floor(Number(input.durationSec) || 0));
  const factsZh = [
    `原生精读${r.beatGrid.length}镜`,
    `${r.segmentCount}/${r.attemptedSegments}段`,
    durSec > 0 ? `${Math.round(durSec / 60)}分钟` : "",
    r.truncated ? "已抽稀" : "",
  ]
    .filter(Boolean)
    .join(" · ");
  const summaryZh = cut(r.moodArcZh ? `${factsZh}；${r.moodArcZh}` : factsZh, 120);

  const card: ManhuaViralTemplateCard = {
    id: nativeDeepReadProposalId(input.seriesKey, input.episodeIndex),
    // 中性命名：不写外部剧名，只写赛道与集号
    nameZh: cut(`${laneZh}·原生第${input.episodeIndex}集节奏`, 32),
    laneZh,
    summaryZh,
    hook3sZh,
    beatGrid: r.beatGrid,
    reusableZh: r.reusableZh,
    genPromptHintZh: r.genPromptHintZh,
    scenePoolHints: [],
    castShape: {
      leadDesireZh: "待补：原生精读只学镜头拍法，人物欲望需另行补全",
      pressureZh: "待补：压力来源未从镜头层学到",
    },
    densityHints: { minBodyChars: 280, minDialogueLines: 8, minLocationHits: 2 },
    sourceRefs: [
      {
        url: sourceUrl,
        fetchedAt: today,
        noteZh: cut(
          `第${input.episodeIndex}集 · ${r.model} · 丢弃${r.droppedCount}镜 · `
            + `失败${r.failedSegmentCount}段${r.usingPlanQuota === false ? " · 按量付费" : ""}`,
          120,
        ),
      },
    ],
    status: "proposed",
    updatedAt: new Date().toISOString(),
    provenance: {
      nativeVideoDeepRead: {
        model: r.model,
        attemptedSegments: r.attemptedSegments,
        successSegments: r.segmentCount,
        shotCount: r.beatGrid.length,
        droppedCount: r.droppedCount,
        truncated: r.truncated,
        usingPlanQuota: r.usingPlanQuota,
        costCny: Number(r.usage?.costCny) || 0,
      },
    },
  };
  // 过一次库里的解析器：入库形状与读取形状必须同源，否则写得进读不出。
  // 解析器会滤掉空镜头，故解析后再验一次镜头数——门禁看的是入参，这里看的是落库实物
  const parsed = parseManhuaViralTemplateCard(card);
  return parsed && parsed.beatGrid.length >= NATIVE_DEEP_READ_MIN_SHOTS ? parsed : null;
}

/**
 * 断点续跑：列出该合集已入库的集号。
 *
 * 只认**内容有效**的卡。列表或单卡状态无法确认时**直接停止续跑**——
 * 把「未知」当成「未跑」会让 20 集全部重烧一遍，钱是真花出去的；
 * 内容异常交人工核对，不在这里自动覆盖。
 *
 * ⚠️ prefix 必须走 literalPrefix：目录前缀模式会给末尾补 `/`，
 * 查出来永远是 `tpl_native_<key>_ep/`，匹配不到任何 `ep001.json`，
 * 于是续跑恒返回空集、每次重跑都重烧。
 */
export async function listIngestedNativeDeepReadEpisodes(
  seriesKey: string,
  maxEpisodes = 200,
): Promise<Set<number>> {
  const done = new Set<number>();
  const prefix =
    `${NATIVE_DEEP_READ_PROPOSAL_PREFIX}`
    + nativeDeepReadProposalId(seriesKey, 1).replace(/\d{3}$/, "");

  let names: string[];
  try {
    names = await listGcsObjectNamesByPrefix({
      prefix,
      maxResults: maxEpisodes,
      literalPrefix: true,
    });
  } catch (e) {
    throw new Error(
      `无法核对已入库集，已停止续跑以避免重复精读：${e instanceof Error ? e.message : e}`,
    );
  }

  for (const name of names) {
    const idx = parseNativeDeepReadEpisodeIndex(name, seriesKey);
    if (!idx) continue;
    try {
      const { buffer } = await downloadGcsObject({
        gcsUri: `gs://${getGcsBucketName()}/${name}`,
      });
      const card = parseManhuaViralTemplateCard(JSON.parse(buffer.toString("utf8")));
      if (
        !card
        || card.id !== nativeDeepReadProposalId(seriesKey, idx)
        || !card.provenance?.nativeVideoDeepRead
        || card.beatGrid.length < NATIVE_DEEP_READ_MIN_SHOTS
      ) {
        throw new Error("卡片形状或来源记录无效");
      }
      done.add(idx);
    } catch (e) {
      throw new Error(
        `第${idx}集已有对象但无法确认内容，已停止续跑：${e instanceof Error ? e.message : e}`,
      );
    }
  }
  return done;
}

export type NativeDeepReadIngestResult = {
  card: ManhuaViralTemplateCard;
  gcsUri: string;
  objectName: string;
  /** false 表示同一集已经由另一任务先写入，本次复用已有卡 */
  created: boolean;
};

/**
 * 写一集进 `proposals/`。
 *
 * 不合门禁直接抛，**不写半截卡**——调用方据此决定是重跑还是记账放过。
 */
export async function ingestNativeDeepReadEpisode(
  input: NativeDeepReadIngestInput,
): Promise<NativeDeepReadIngestResult> {
  const gate = checkNativeDeepReadIngestable(input.result);
  if (!gate.ok) {
    throw new Error(`第${input.episodeIndex}集精读不满足入库门禁：${gate.reasonZh}`);
  }
  if (!String(input.sourceUrl || "").trim()) {
    throw new Error(`第${input.episodeIndex}集缺少来源地址，未写入不可追溯的模板卡`);
  }

  const card = buildNativeDeepReadProposalCard(input);
  if (!card) throw new Error(`第${input.episodeIndex}集精读装卡失败（解析器拒收）`);

  const objectName = nativeDeepReadProposalObjectName(input.seriesKey, input.episodeIndex);
  const bucket = getGcsBucketName();
  const gcsUri = `gs://${bucket}/${objectName}`;
  // 条件创建（ifGenerationMatch=0）：两个任务同时跑同一集时，后到者不覆盖先写入的
  const uploaded = await uploadBufferToGcsIfAbsent({
    bucket,
    objectName,
    buffer: Buffer.from(`${JSON.stringify(card, null, 2)}\n`, "utf8"),
    contentType: "application/json",
  });

  if (!uploaded.created) {
    const { buffer } = await downloadGcsObject({ gcsUri });
    const existing = parseManhuaViralTemplateCard(JSON.parse(buffer.toString("utf8")));
    if (
      !existing
      || existing.id !== card.id
      || !existing.provenance?.nativeVideoDeepRead
      || existing.beatGrid.length < NATIVE_DEEP_READ_MIN_SHOTS
    ) {
      throw new Error(`第${input.episodeIndex}集同名对象已存在但内容无效，未覆盖，请人工核对`);
    }
    return { card: existing, gcsUri, objectName, created: false };
  }

  return { card, gcsUri, objectName, created: true };
}
