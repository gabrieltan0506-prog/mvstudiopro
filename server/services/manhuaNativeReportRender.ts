/**
 * 原生精读证据 → 报告 HTML 渲染服务（¥0，零模型调用）。
 * **只渲染模型字段原文，不加任何编辑/蒸馏层**；完整 JSON 永久保留，报告字幕只展示
 * keyMoments 前后 2 秒内的旁证。帧优先正式卡 evidenceFrames，再回退旧探针帧包。
 *
 * 两个入口：
 * - renderNativeEvidenceReportFromObjectNames：生产路由唯一入口。按 provenance 里的
 *   精确证据对象名逐个下载，缺失/损坏/段号断裂/digest 混杂一律抛错（fail closed），
 *   绝不列目录猜证据、绝不上传半成品报告。帧包例外：帧缺失只降级为「未抽帧」。
 * - renderNativeEvidenceReport：旧列目录入口，仅供 CLI 探针脚本兼容使用。
 */
import { Storage } from "@google-cloud/storage";
import type { ManhuaViralTemplateEvidenceFrame } from "../../shared/manhuaViralTemplateBank.js";
import {
  downloadGcsObjectVersioned,
  getGcsBucketName,
  listGcsObjectNamesByPrefix,
  uploadBufferToGcs,
} from "./gcs.js";

const FIELD_LABELS: Record<string, string> = {
  emotionTagsZh: "情绪", narrativeFeatureTagsZh: "叙事特色", performanceTagsZh: "表演",
  audiovisualTagsZh: "视听", audienceExperienceTagsZh: "观众体验",
  beatStructureZh: "节拍结构", moodArcZh: "情绪弧", reusableZh: "可复用手法", genPromptHintZh: "生成提示线索",
  hintZh: "本镜观察", unitTypeZh: "运镜解读", shotSizeZh: "景别", angleZh: "机位角度", compositionZh: "构图", cameraMoveZh: "运镜",
  blockingZh: "调度", bodyActionZh: "身体动作", limbPropActionZh: "肢体道具", microExpressionZh: "微表情",
  gazeBreathZh: "视线呼吸", relationshipReactionZh: "关系反应", lightingZh: "灯光", actionZh: "动作叙述",
  transitionInZh: "入镜转场", evidenceRole: "证据角色",
  emotionArcZh: "情绪弧", toneZh: "语气", sfxZh: "音效", bgmZh: "配乐",
  atmosphereZh: "气氛", silenceZh: "留白",
  audioBeatStructureZh: "声音节奏", mixNotesZh: "混音", reusableAudioZh: "可复用声音手法",
  genAudioHintZh: "生成声音要素",
};
const fieldLabel = (key: string): string => FIELD_LABELS[key] ?? key;

const esc = (v: unknown): string => String(v ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
/**
 * 0902 荧光笔 v2（用户实测打回 v1：词表只会点亮「留白/静默」这类通用词，
 * 真戏眼是整句——「女子妖化反杀」「妖物骇人登场」）。改为**子句级提炼**：
 * 按中文标点切子句，含强信号词的整个子句上实心亮黄底；未命中的子句里
 * 再做词级次高亮。全部在 esc 之后进行，防注入不松动。
 */
const STRONG_SIGNAL_RE = new RegExp([
  "反杀", "妖化", "黑化", "觉醒", "夺舍", "骇人", "登场", "现身", "突破",
  "蜕变", "暴露", "揭穿", "真相", "身份", "翻脸", "背叛", "贪婪", "杀机",
  "反转", "转折", "高潮", "爆发", "决裂", "复仇", "绝境", "崩溃", "牺牲",
  "坠落", "激战", "斩", "弑", "灭口", "质问", "威胁", "告白", "生死",
].join("|"));
const WORD_EMPHASIS_RE = new RegExp(`(${[
  "钩子", "悬念", "冲突", "对峙", "蓄势", "铺垫", "收束", "骤停", "定格",
  "静默", "留白", "怒吼", "嘶吼", "升级", "召见",
].join("|")})`, "g");
const STRONG_STYLE =
  "background:#ffd23f;color:#6b3200;font-weight:700;padding:0 3px;border-radius:3px";
const WORD_STYLE =
  "background:#ffe08a;color:#8a2a00;font-weight:600;padding:0 2px;border-radius:2px";
/** 子句切分保留分隔符；子句上限 60 字防整段刷黄失焦 */
const emphasize = (v: unknown): string => {
  const escaped = esc(v);
  return escaped
    .split(/([，。；！？：\n]|→)/)
    .map((piece) => {
      if (/^[，。；！？：\n→]$/.test(piece)) return piece;
      if (piece.length >= 2 && piece.length <= 60 && STRONG_SIGNAL_RE.test(piece)) {
        return `<b style="${STRONG_STYLE}">${piece}</b>`;
      }
      return piece.replace(WORD_EMPHASIS_RE, `<b style="${WORD_STYLE}">$1</b>`);
    })
    .join("");
};
const mmss = (s: number): string => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

function makeSigner() {
  const creds = JSON.parse(String(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON || "{}")) as {
    client_email?: string; private_key?: string; project_id?: string;
  };
  const storage = new Storage({
    credentials: { client_email: creds.client_email, private_key: creds.private_key },
    projectId: creds.project_id,
  });
  return async (
    bucketName: string,
    objectName: string,
    /** 报告 HTML 传 true：签名里带 attachment，点导出即下载而非浏览器内联预览。 */
    asDownload = false,
  ): Promise<string> => {
    const downloadName = objectName.split("/").pop() || "report.html";
    const [url] = await storage.bucket(bucketName).file(objectName).getSignedUrl({
      version: "v4", action: "read", expires: Date.now() + 6 * 24 * 3600 * 1000,
      ...(asDownload
        ? { responseDisposition: `attachment; filename="${downloadName}"` }
        : {}),
    });
    return url;
  };
}

/** 0902 用户拍板：帧图内嵌 data URI——报告自包含、可直接发客户，不外泄存储与链接细节。 */
async function embedFrameImage(bucket: string, objectName: string): Promise<string | null> {
  try {
    const { buffer } = await downloadGcsObjectVersioned({ gcsUri: `gs://${bucket}/${objectName}` });
    const mime = objectName.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg";
    return `data:${mime};base64,${buffer.toString("base64")}`;
  } catch {
    return null;
  }
}

async function tryJson(bucket: string, objectName: string): Promise<Record<string, unknown> | null> {
  try {
    const { buffer } = await downloadGcsObjectVersioned({ gcsUri: `gs://${bucket}/${objectName}` });
    return JSON.parse(buffer.toString("utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** fail closed：证据对象必须存在且是合法 JSON 对象，缺失/损坏直接抛错。 */
async function mustJson(bucket: string, objectName: string): Promise<Record<string, unknown>> {
  let buffer: Buffer;
  try {
    ({ buffer } = await downloadGcsObjectVersioned({ gcsUri: `gs://${bucket}/${objectName}` }));
  } catch (e) {
    throw new Error(`证据对象缺失或不可读：${objectName}（${e instanceof Error ? e.message : String(e)}）`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(buffer.toString("utf8"));
  } catch {
    throw new Error(`证据对象损坏（非法 JSON）：${objectName}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`证据对象损坏（非对象）：${objectName}`);
  }
  return parsed as Record<string, unknown>;
}

/** GLM 永久证据保存的是 `{ parsed: ... }`；部分网关还会再包一层 `{ answer: "JSON" }`。 */
function unwrapGlmReportCard(evidence: Record<string, unknown>): Record<string, unknown> {
  let current: unknown = evidence.parsed ?? evidence;
  for (let depth = 0; depth < 3; depth += 1) {
    if (!current || typeof current !== "object" || Array.isArray(current)) break;
    const row = current as Record<string, unknown>;
    const answer = row.answer;
    if (typeof answer !== "string" || !answer.trim()) return row;
    try {
      current = JSON.parse(answer);
    } catch {
      throw new Error("GLM 整集 parsed 证据的 answer 不是合法 JSON");
    }
  }
  if (!current || typeof current !== "object" || Array.isArray(current)) {
    throw new Error("GLM 整集 parsed 证据不是 JSON 对象");
  }
  return current as Record<string, unknown>;
}

const SUMMARY_TEXT_KEYS = ["beatStructureZh", "moodArcZh", "reusableZh", "genPromptHintZh"] as const;

type SegmentRaw = { segmentIndex: number; raw: Record<string, unknown> };

/**
 * 段卡拼接（无删节）：shots/subtitles/audioResolution 顺序合并；
 * 摘要四字段与五维分类不再「取第一个非空」，而是**合并全段**：
 * 文本字段按段号标注拼接，分类标签跨段去重并集。
 */
type NativeReportSegmentSpan = { startSec: number; endSec: number };

function normalizedReportChunkSpans(
  spans: readonly NativeReportSegmentSpan[] | undefined,
  expectedCount: number,
): Array<{ chunkIndex: number; startSec: number; endSec: number }> | undefined {
  if (!spans) return undefined;
  if (spans.length !== expectedCount) {
    throw new Error(`报告分片计划应有 ${expectedCount} 段，实际为 ${spans.length} 段`);
  }
  const normalized = spans.map((span, chunkIndex) => {
    const startSec = Number(span.startSec);
    const endSec = Number(span.endSec);
    if (!Number.isFinite(startSec) || !Number.isFinite(endSec) || startSec < 0 || endSec <= startSec) {
      throw new Error(`报告第${chunkIndex + 1}段真实秒位无效`);
    }
    return { chunkIndex, startSec, endSec };
  });
  if (Math.abs(normalized[0]?.startSec ?? 0) > 0.01
    || normalized.some((span, index) => index > 0
      && Math.abs(span.startSec - normalized[index - 1]!.endSec) > 0.01)) {
    throw new Error("报告真实分片计划不连续或不是从 0 秒开始");
  }
  return normalized;
}

function assembleCardFromSegments(
  segments: SegmentRaw[],
  segmentSpans?: readonly NativeReportSegmentSpan[],
): Record<string, unknown> {
  const merged: Record<string, unknown> = { shots: [], subtitles: [], audioResolution: [] };
  /**
   * 🔴 keyMoments / excludedAdRanges 必须一并合并（0830 审查 P0）。
   * 生产入口只有 renderNativeEvidenceReportFromObjectNames 一条，从不传 glmCardObjectName，
   * 因此必然走本函数。此前本函数整字段丢掉这两项 ⇒ 报告里「重点时刻」与「广告区间」
   * 恒为 0、被高亮的重点时刻表永远空态——**功能在生产上是死的**。
   * 秒位口径：段卡的 shots/subtitles/keyMoments 都是**全片绝对秒**（段提示词硬约束 1），
   * 这里与 shots 同样直接拼接，不加 offset。
   */
  const keyMoments: Array<Record<string, unknown>> = [];
  const excludedAdRanges: Array<Record<string, unknown>> = [];
  const chunkSpans: Array<{ chunkIndex: number; startSec: number; endSec: number }> = [];
  const summaryParts: Record<string, string[]> = {};
  const classification: Record<string, unknown[]> = {};
  for (const { segmentIndex, raw } of segments) {
    for (const key of ["shots", "subtitles", "audioResolution"] as const) {
      (merged[key] as unknown[]).push(...(Array.isArray(raw[key]) ? raw[key] as unknown[] : []));
    }
    for (const span of Array.isArray(raw.chunkSpans) ? raw.chunkSpans as Array<Record<string, unknown>> : []) {
      chunkSpans.push({
        chunkIndex: Number(span.chunkIndex),
        startSec: Number(span.startSec),
        endSec: Number(span.endSec),
      });
    }
    for (const row of Array.isArray(raw.keyMoments) ? raw.keyMoments as Array<Record<string, unknown>> : []) {
      if (Number.isFinite(Number(row?.atSec))) keyMoments.push(row);
    }
    for (const row of Array.isArray(raw.excludedAdRanges) ? raw.excludedAdRanges as Array<Record<string, unknown>> : []) {
      excludedAdRanges.push(row);
    }
    for (const key of SUMMARY_TEXT_KEYS) {
      const value = String(raw[key] ?? "").trim();
      if (value) (summaryParts[key] ??= []).push(`【第${segmentIndex + 1}段】${value}`);
    }
    const cl = raw.classification;
    if (cl && typeof cl === "object" && !Array.isArray(cl)) {
      for (const [key, value] of Object.entries(cl as Record<string, unknown>)) {
        if (!Array.isArray(value)) continue;
        const bucketList = (classification[key] ??= []);
        for (const tag of value) if (!bucketList.includes(tag)) bucketList.push(tag);
      }
    }
  }
  for (const key of SUMMARY_TEXT_KEYS) {
    if (summaryParts[key]?.length) merged[key] = summaryParts[key].join("\n");
  }
  if (Object.keys(classification).length) merged.classification = classification;
  const plannedChunkSpans = normalizedReportChunkSpans(segmentSpans, segments.length);
  if (plannedChunkSpans) merged.chunkSpans = plannedChunkSpans;
  else if (chunkSpans.length > 0) merged.chunkSpans = chunkSpans;
  if (keyMoments.length > 0) {
    // 同秒同类去重后按秒位排序（与 shared mapper 同口径）
    const seen = new Set<string>();
    merged.keyMoments = keyMoments
      .filter((row) => {
        const key = `${Math.round(Number(row.atSec) * 10)}|${String(row.kindZh ?? "")}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => Number(a.atSec) - Number(b.atSec));
  }
  if (excludedAdRanges.length > 0) merged.excludedAdRanges = excludedAdRanges;
  return merged;
}

type RenderCoreInput = {
  labelZh: string;
  card: Record<string, unknown>;
  /** 报告头部注明的数据来源口径 */
  sourceLabelZh: string;
  evidenceFrames?: ManhuaViralTemplateEvidenceFrame[];
  framesV2SummaryObjectName?: string;
  framesPrefix?: string;
  reportObjectName: string;
};

export type NativeReportRenderResult = {
  reportUrl: string; bytes: number; frames: number; frameSource: string; shots: number;
};

async function renderCardToReport(input: RenderCoreInput): Promise<NativeReportRenderResult> {
  const bucket = getGcsBucketName();
  const sign = makeSigner();
  const card = input.card;

  const shots = ((Array.isArray(card.shots) ? card.shots : []) as Array<Record<string, unknown>>)
    .filter((shot) => shot.evidenceRole !== "non_story_ad");
  const keyMoments = (Array.isArray((card as { keyMoments?: unknown }).keyMoments)
    ? (card as { keyMoments: Array<Record<string, unknown>> }).keyMoments
    : [])
    // NaN 参与比较会打乱有效元素顺序，且会渲染出 NaN:NaN 的秒位——先滤再排。
    .filter((row) => Number.isFinite(Number(row.atSec)))
    .slice()
    .sort((a, b) => Number(a.atSec) - Number(b.atSec));
  const KIND_ICON: Record<string, string> = {
    切镜: "🎬", 情绪: "😨", 灯光: "💡", 剧情: "📖", 音轨: "🎵",
  };
  /** 0902 精华投影：模型自标「重点时刻」按秒位点亮命中的镜头行/音轨行——真提炼不靠词表猜 */
  const KM_KIND_COLOR: Record<string, string> = {
    切镜: "#3a7bd5", 情绪: "#e0559d", 灯光: "#e8823a", 剧情: "#b8452f", 音轨: "#2f9e8f",
  };
  const keyMomentsInRange = (startSec: number, endSec: number) =>
    keyMoments.filter((km) => {
      const at = Number(km.atSec);
      return at >= startSec && at < endSec;
    });
  if (shots.length === 0) {
    throw new Error("该集没有逐镜证据层（v8 之前学习的旧集需重学后才能出报告）");
  }

  // 帧包**始终可选**：summary 缺失/损坏只降级为「未抽帧」，绝不让报告因此失败。
  const framesSummary = input.framesV2SummaryObjectName
    ? await tryJson(bucket, input.framesV2SummaryObjectName)
    : null;
  let frameSource = "正式卡重点时刻抽帧";
  let frameList = (Array.isArray(input.evidenceFrames) ? input.evidenceFrames : [])
    .map((frame) => ({ ...frame, reasons: [frame.kindZh] })) as Array<Record<string, unknown>>;
  if (frameList.length === 0) {
    frameSource = "frames-v2（按戏抽帧）";
    frameList = (Array.isArray(framesSummary?.frames) ? framesSummary!.frames : []) as Array<Record<string, unknown>>;
  }
  if (frameList.length === 0 && input.framesPrefix) {
    frameSource = "frames（逐镜中点）";
    let names: string[] = [];
    try {
      names = await listGcsObjectNamesByPrefix({
        prefix: input.framesPrefix, literalPrefix: true, maxResults: 400,
      });
    } catch {
      names = [];
    }
    frameList = names.map((objectName) => {
      const m = /seg(\d+)\/shot(\d+)-(\d+)ds/.exec(objectName);
      return { seg: Number(m?.[1] ?? 0), shot: Number(m?.[2] ?? 0), atSec: Number(m?.[3] ?? 0) / 10, reasons: [], objectName };
    });
  }
  if (frameList.length === 0) frameSource = "未抽帧（该集尚无帧包）";
  /**
   * 0902 用户拍板：「留白」「气势爆发」这类 ≤5 字标注没信息量——过短时从命中
   * 镜头的动作/肢体/微表情字段里捡 6–24 字的描述顶上，实在凑不出就只留秒位。
   */
  const richCaption = (primary: unknown, shot: Record<string, unknown>): string => {
    const candidates = [
      String(primary ?? ""),
      String(shot.actionZh ?? ""),
      String(shot.bodyActionZh ?? ""),
      String(shot.limbPropActionZh ?? ""),
      String(shot.microExpressionZh ?? ""),
    ].map((t) => t.trim()).filter(Boolean);
    for (const c of candidates) if (c.length >= 6) return c.slice(0, 24);
    const joined = candidates.slice(0, 2).join("·");
    return joined.length >= 6 ? joined.slice(0, 24) : "";
  };
  const tiles: string[] = [];
  /** 帧编号锚点表：重点时刻表用「（图N）」跳转对照（0902 用户拍板） */
  const frameAnchors: Array<{ no: number; atSec: number }> = [];
  for (const frame of frameList) {
    // 0902：帧图内嵌进 HTML，报告发出去不带任何仓储线索；单帧失败跳过不毁整页
    const dataUri = await embedFrameImage(bucket, String(frame.objectName));
    if (!dataUri) continue;
    const frameNo = tiles.length + 1;
    frameAnchors.push({ no: frameNo, atSec: Number(frame.atSec) });
    const reasons = (Array.isArray(frame.reasons) ? frame.reasons : []) as string[];
    const badge = reasons.map((r) => `<span style="background:#f6efe0;border:1px solid #e0d2b4;border-radius:8px;padding:0 6px;margin-right:3px;color:#6b5b4a">${esc(r)}</span>`).join("");
    const frameAtSec = Number(frame.atSec);
    const shot = shots.find((s) => frameAtSec >= Number(s.startSec) && frameAtSec < Number(s.endSec)) || {};
    tiles.push(`<div id="frame-${frameNo}" style="width:158px;position:relative;scroll-margin-top:20px"><span style="position:absolute;top:4px;left:4px;background:rgba(58,123,213,.92);color:#fff;font-size:.68em;font-weight:700;border-radius:6px;padding:1px 6px">图${frameNo}</span><img loading="lazy" src="${dataUri}" style="width:158px;border-radius:4px"><div style="font-size:.7em;color:#7a6f5d">${mmss(frameAtSec)} ${badge}${esc(richCaption(frame.noteZh, shot))}</div></div>`);
  }

  const cl = (card.classification ?? {}) as Record<string, unknown>;
  const tags = Object.entries(cl)
    .filter(([, v]) => Array.isArray(v))
    .map(([k, v]) => `<div style="margin:4px 0"><b style="color:#8a6a1f">${esc(fieldLabel(k))}</b>：${(v as unknown[]).map((t) => `<span style="background:#f6efe0;border:1px solid #e0d2b4;border-radius:10px;padding:2px 10px;margin:2px;display:inline-block;color:#6b5b4a">${esc(t)}</span>`).join(" ")}</div>`)
    .join("");
  /**
   * 0830 报告规格：摘要四栏拆成四个独立区块（可复用手法 / 生成提示要素 /
   * 节奏结构 / 情绪推进），不再挤成一叠小卡——它们是这张卡最值钱的部分。
   */
  const summaryTextOf = (key: (typeof SUMMARY_TEXT_KEYS)[number]): string =>
    String(card[key] ?? "").trim() || "本集未整理出该项";

  const FIELDS = ["hintZh", "unitTypeZh", "shotSizeZh", "angleZh", "compositionZh", "cameraMoveZh", "blockingZh", "bodyActionZh", "limbPropActionZh", "microExpressionZh", "gazeBreathZh", "relationshipReactionZh", "lightingZh", "actionZh", "transitionInZh"];
  /**
   * 0902 三审拍板：色块必须有语义，不做斑马纹——只有两类真金上色：
   * 🟥 剧情亮点/转折（仅「剧情/情绪」类重点时刻）；🟦 运镜/剪辑技巧（词表识别）。
   */
  const CAMERA_CRAFT_RE = /甩|环绕|旋转|升格|慢动作|定格|一镜到底|俯冲|希区柯克|急推|急拉|变焦|穿越|跟拍/;
  const TRANSITION_CRAFT_RE = /叠化|闪白|闪黑|匹配|遮罩|甩接|变速/;
  const STORY_KINDS = new Set(["剧情", "情绪"]);
  /**
   * 0902 四审拍板：「剪辑镜头」占 99% 是废话填充——这栏改推导「镜头变化」：
   * 景别/机位对比前一镜（特写→近景、俯拍→平视）；拆分镜是内部手法，
   * 前台写「同镜延续」；无变化留空。
   */
  /**
   * 0902 六审定稿：这栏是「运镜解读」——只写手法的用意与预期效果，
   * 裸名词（全景/仰拍…）是隔壁景别/机位栏的复读，一律不写。
   * 全部确定性词典推导，零模型调用。
   */
  const SIZE_ORDER = ["大远景", "远景", "全景", "中全景", "中景", "中近景", "近景", "特写", "大特写"];
  const sizeRank = (v: string): number => {
    for (let i = SIZE_ORDER.length - 1; i >= 0; i -= 1) if (v.includes(SIZE_ORDER[i]!)) return i;
    return -1;
  };
  const INTRA_MOVE_RE = /转|→/;
  const endStateOf = (v: string) => v.split(INTRA_MOVE_RE).pop()!.trim();
  const startStateOf = (v: string) => v.split(INTRA_MOVE_RE)[0]!.trim();
  /** 特殊运镜/转场 → 用意·效果（审片工艺词典） */
  const CRAFT_EFFECTS: Array<[RegExp, string]> = [
    [/甩/, "甩镜·情绪急转不断链"],
    [/环绕|旋转/, "环绕·对峙张力标记"],
    [/升格|慢动作/, "升格·关键瞬间放大"],
    [/定格/, "定格·记忆点盖章"],
    [/跟拍/, "跟拍·伴随式沉浸"],
    [/手持|晃动|震动/, "手持·不安临场感"],
    [/俯冲/, "俯冲·命运压落"],
    [/急推|变焦/, "急推变焦·压迫聚焦"],
    [/一镜到底/, "一镜到底·沉浸不切"],
    [/叠化/, "叠化·时间与心理过渡"],
    [/闪白|闪黑/, "闪白黑·冲击断点"],
    [/匹配/, "匹配剪辑·丝滑跨场"],
    [/甩接/, "甩接·动势缝合"],
  ];
  /**
   * 风格语感词典（蒸馏自 seedance-shot-design/references/director-styles.md
   * 导演风格参数化映射库；遵循其去名化规范——只用风格称谓不点名）。
   * 命中镜头构图/光影/运镜签名时吐一句「手法·预期效果」判词。
   */
  const SIGNATURE_EFFECTS: Array<[RegExp, string]> = [
    [/对称|居中构图/, "对称舞台构图·秩序感与仪式感"],
    [/巨物|渺小|庞然/, "巨物压迫构图·人物渺小宿命感"],
    [/缓慢推轨|极缓推|缓推/, "冷峻缓推·庄重压场蓄势"],
    [/霓虹/, "霓虹迷幻光·暧昧疏离情绪"],
    [/剪影|逆光/, "剪影叙事·遮蔽悬念立轮廓"],
    [/体积雾|体积光|丁达尔/, "体积光雾·神性纵深氛围"],
    [/暴雨|雷暴|风雪|大雪/, "天气叙事·情绪外化入景"],
    [/高对比|硬光/, "高反差布光·冷感惊悚张力"],
    [/低角度广角|广角贴地/, "低机位广角·夸张气势冲击"],
    [/浅景深|背景虚化/, "浅景深隔离·视线强制聚焦"],
    [/长焦压缩/, "长焦压缩·人物与命运贴脸"],
  ];
  const shotChangeZh = (index: number): string => {
    const cur = shots[index]!;
    if (String(cur.unitTypeZh ?? "").trim() === "拆分镜证据段") return "同镜延续";
    const prev = (index > 0 ? shots[index - 1]! : {}) as Record<string, unknown>;
    const notes: string[] = [];
    // 景别语义（0902 七审：跳两档以上或触端点才说话；措辞按目标景别+镜内容变化，
    // 「推近·锁定情绪反应」曾 56 连发沦为新复读机——同方向也必须不同词）
    const curSizeRaw = String(cur.shotSizeZh ?? "").trim();
    const fromSize = INTRA_MOVE_RE.test(curSizeRaw)
      ? startStateOf(curSizeRaw)
      : endStateOf(String(prev.shotSizeZh ?? ""));
    const toSize = endStateOf(curSizeRaw);
    const fromRank = sizeRank(fromSize);
    const toRank = sizeRank(toSize);
    if (fromRank >= 0 && toRank >= 0 && fromRank !== toRank) {
      const jump = Math.abs(toRank - fromRank);
      const toExtreme = toSize.includes("特写") || toSize.includes("远景");
      if (jump >= 2 || toExtreme) {
        const hasMicro = Boolean(String(cur.microExpressionZh ?? "").trim());
        const hasFight = /打|战|斗|追|劈|斩|挥/.test(String(cur.actionZh ?? ""));
        const hasRelation = Boolean(String(cur.relationshipReactionZh ?? "").trim());
        if (toRank > fromRank) {
          notes.push(
            toSize.includes("大特写") ? "怼至大特写·情绪显微镜"
            : toSize.includes("特写") ? (hasMicro ? "推至特写·微表情入账" : "推至特写·细节定音")
            : hasRelation ? "逼近对峙·关系张力升温"
            : jump >= 3 ? "陡然贴近·冲击式聚焦"
            : "收紧视距·压缩注意力",
          );
        } else {
          notes.push(
            toSize.includes("大远景") ? "甩到大远景·个体没入天地"
            : toSize.includes("远景") ? "退至远景·孤立感与规模感"
            : hasFight ? "拉开武戏·全身调度入镜"
            : jump >= 3 ? "骤然抽离·上帝视角断情"
            : "放宽视野·亮出场面调度",
          );
        }
      }
    }
    // 机位语义
    const curAngleRaw = String(cur.angleZh ?? "").trim();
    const fromAngle = INTRA_MOVE_RE.test(curAngleRaw)
      ? startStateOf(curAngleRaw)
      : endStateOf(String(prev.angleZh ?? ""));
    const toAngle = endStateOf(curAngleRaw);
    if (toAngle && toAngle !== fromAngle) {
      if (toAngle.includes("俯")) notes.push("转俯拍·压顶示弱势");
      else if (toAngle.includes("仰")) notes.push("转仰拍·仰视立威压");
      else if (toAngle.includes("平") && (fromAngle.includes("俯") || fromAngle.includes("仰"))) {
        notes.push("回平视·情绪落地");
      }
    }
    // 情绪转轨（0902 七审补：前后镜微表情极性变化本身就是技巧）
    const EMOTION_BUCKETS: Array<[RegExp, string]> = [
      [/怒|狠|咬牙|暴戾/, "怒"], [/恐|惧|怕|颤|瑟/, "惧"], [/泪|哭|悲|哀|恸/, "悲"],
      [/惊|愕|瞪/, "惊"], [/笑|喜|悦|欣/, "喜"], [/冷|漠|淡然|面无表情/, "冷"],
    ];
    const emotionBucketOf = (text: string): string => {
      for (const [re, name] of EMOTION_BUCKETS) if (re.test(text)) return name;
      return "";
    };
    const curEmotion = emotionBucketOf(`${String(cur.microExpressionZh ?? "")}${String(cur.gazeBreathZh ?? "")}`);
    const prevEmotion = emotionBucketOf(`${String(prev.microExpressionZh ?? "")}${String(prev.gazeBreathZh ?? "")}`);
    if (curEmotion && prevEmotion && curEmotion !== prevEmotion) {
      notes.push(`情绪转轨·${prevEmotion}转${curEmotion}`);
    }
    // 站位改写：调度里出现关键站位语义（新出现才记，避免延续镜刷屏）
    const BLOCKING_EFFECTS: Array<[RegExp, string]> = [
      [/背对|背身|转身背/, "背身站位·拒绝对话感"],
      [/逼近|上前|欺身|贴近/, "逼近站位·压迫升级"],
      [/后退|后撤|退步/, "后撤站位·势弱让步"],
      [/跪|伏地|瘫/, "跪伏姿态·权力落差具象"],
      [/包围|合围|围拢/, "合围站位·困局成型"],
      [/对峙|相对而立|对视僵/, "对峙站位·顶牛张力"],
    ];
    const curBlocking = String(cur.blockingZh ?? "");
    const prevBlocking = String(prev.blockingZh ?? "");
    for (const [re, effect] of BLOCKING_EFFECTS) {
      if (re.test(curBlocking) && !re.test(prevBlocking) && !notes.includes(effect)) {
        notes.push(effect);
        break;
      }
    }
    // 跨场切换：昼夜/内外光环境跳变
    const envTokenOf = (text: string): string => {
      if (/夜|月|烛|灯笼/.test(text)) return "夜";
      if (/日|昼|阳光|白天/.test(text)) return "日";
      return "";
    };
    const curEnv = envTokenOf(`${String(cur.lightingZh ?? "")}${String(cur.actionZh ?? "")}`);
    const prevEnv = envTokenOf(`${String(prev.lightingZh ?? "")}${String(prev.actionZh ?? "")}`);
    if (curEnv && prevEnv && curEnv !== prevEnv) {
      notes.push(`跨场切换·${prevEnv}转${curEnv}空间叙事推进`);
    }
    // 特殊运镜/转场词典
    const craftSource = `${String(cur.cameraMoveZh ?? "")} ${String(cur.transitionInZh ?? "")}`;
    for (const [re, effect] of CRAFT_EFFECTS) {
      if (re.test(craftSource) && !notes.includes(effect)) notes.push(effect);
    }
    // 风格语感：扫构图/光影/运镜签名（导演风格库蒸馏）
    const signatureSource = `${String(cur.compositionZh ?? "")} ${String(cur.lightingZh ?? "")} ${String(cur.cameraMoveZh ?? "")}`;
    for (const [re, effect] of SIGNATURE_EFFECTS) {
      if (notes.length >= 3) break;
      if (re.test(signatureSource) && !notes.includes(effect)) notes.push(effect);
    }
    if (index === 0 && !notes.length) return "开场镜";
    return notes.slice(0, 3).join(" · ");
  };
  // 相邻镜同判词只留第一次——语义不因重复贬值
  const changeNotesByIndex = shots.map((_, index) => shotChangeZh(index));
  for (let i = shots.length - 1; i > 0; i -= 1) {
    if (changeNotesByIndex[i] && changeNotesByIndex[i] === changeNotesByIndex[i - 1]) {
      changeNotesByIndex[i] = "";
    }
  }
  const shotRows = shots.map((shot, shotIndex) => {
    const startSec = Number(shot.startSec) || 0;
    const endSec = Number(shot.endSec) || 0;
    const storyMoments = keyMomentsInRange(startSec, endSec)
      .filter((km) => STORY_KINDS.has(String(km.kindZh)));
    const cameraCraft = CAMERA_CRAFT_RE.test(String(shot.cameraMoveZh ?? ""))
      || TRANSITION_CRAFT_RE.test(String(shot.transitionInZh ?? ""));
    const accent = storyMoments.length ? "#b8452f" : cameraCraft ? "#3a7bd5" : "";
    const marks = storyMoments.length
      ? storyMoments.map((km) => KIND_ICON[String(km.kindZh)] ?? "⭐").join("")
      : cameraCraft ? "🎥" : "";
    const stickyStyle = `position:sticky;left:0;background:${accent ? "#fff3d6" : "#efe5cc"};color:#8a6a1f;white-space:nowrap${accent ? `;border-left:3px solid ${accent};font-weight:700` : ""}`;
    return `<tr${accent ? ` style="background:${accent}14"` : ""}><td style="${stickyStyle}">${marks ? `${marks} ` : ""}${mmss(startSec)}–${mmss(endSec)}</td>${FIELDS.map((field) => {
      if (field === "unitTypeZh") {
        const change = changeNotesByIndex[shotIndex]!;
        return `<td style="padding:3px 8px;min-width:90px;color:#6b5b4a">${change ? `<b style="color:#4a6b8a">${esc(change)}</b>` : ""}</td>`;
      }
      const craftCell = cameraCraft
        && (field === "cameraMoveZh" || field === "transitionInZh")
        && (CAMERA_CRAFT_RE.test(String(shot[field] ?? "")) || TRANSITION_CRAFT_RE.test(String(shot[field] ?? "")));
      return `<td style="padding:3px 8px;min-width:90px">${craftCell
        ? `<span style="background:#3a7bd51f;border:1px solid #3a7bd5;border-radius:6px;padding:0 5px;color:#2a5da8;font-weight:700">${esc(shot[field])}</span>`
        : emphasize(shot[field])}</td>`;
    }).join("")}</tr>`;
  }).join("");

  const AUDIO_TRACK_FIELDS = ["emotionArcZh", "toneZh", "sfxZh", "bgmZh", "atmosphereZh", "silenceZh"] as const;
  const AUDIO_CHUNK_FIELDS = ["audioBeatStructureZh", "mixNotesZh", "reusableAudioZh", "genAudioHintZh"] as const;
  const audioChunks = (Array.isArray(card.audioResolution) ? card.audioResolution : []) as Array<{
    chunkIndex?: number;
    analysis?: Record<string, unknown> & { audioTrack?: Array<Record<string, unknown>> };
  }>;
  const spanByChunk = new Map<number, number>(
    (Array.isArray((card as { chunkSpans?: unknown }).chunkSpans)
      ? (card as { chunkSpans: Array<{ chunkIndex: number; startSec: number }> }).chunkSpans
      : []
    ).map((span) => [Number(span.chunkIndex), Number(span.startSec)]),
  );
  const audioSections = audioChunks.map((chunk) => {
    // 真实段界优先（第四节 chunkSpans）；仅无段界的旧卡回落 300s 惯例偏移。
    const offset = spanByChunk.get(Number(chunk.chunkIndex) || 0)
      ?? (Number(chunk.chunkIndex) || 0) * 300;
    const analysis = (chunk.analysis ?? {}) as Record<string, unknown> & { audioTrack?: Array<Record<string, unknown>> };
    const chunkMeta = AUDIO_CHUNK_FIELDS
      .map((key) => `<div style="margin:2px 0"><b style="color:#8a6a1f">${fieldLabel(key)}</b>：<span style="color:#857a66;white-space:pre-wrap">${esc(analysis[key])}</span></div>`)
      .join("");
    const trackRows = (Array.isArray(analysis.audioTrack) ? analysis.audioTrack : []).map((track) => {
      const cues = (Array.isArray(track.cues) ? track.cues : []) as Array<Record<string, unknown>>;
      const cueSpans = cues.map((cue) => `<span style="background:#e7dcc2;border-radius:8px;padding:1px 8px;display:inline-block;margin:1px">${mmss(offset + Number(cue.atSec))} ${esc(cue.kind)} ${esc(cue.detailZh)}</span>`).join(" ");
      const trackFrom = offset + Number(track.fromSec);
      const trackTo = offset + Number(track.toSec);
      const hitMoments = keyMomentsInRange(trackFrom, trackTo)
        .filter((km) => ["剧情", "情绪", "音轨"].includes(String(km.kindZh)));
      const accent = hitMoments.length
        ? KM_KIND_COLOR[String(hitMoments[0]!.kindZh)] || "#b8452f"
        : "";
      const marks = hitMoments.map((km) => KIND_ICON[String(km.kindZh)] ?? "⭐").join("");
      return `<tr${accent ? ` style="background:${accent}14"` : ""}><td style="color:#8a6a1f;white-space:nowrap${accent ? `;border-left:3px solid ${accent};font-weight:700` : ""}">${marks ? `${marks} ` : ""}${mmss(trackFrom)}–${mmss(trackTo)}</td>${AUDIO_TRACK_FIELDS.map((key) => `<td style="padding:3px 8px">${emphasize(track[key])}</td>`).join("")}<td style="color:#857a66">${cueSpans}</td></tr>`;
    }).join("");
    // 0902 用户拍板：分片是后台手法不进前台——标题只标时间段
    const trackList = Array.isArray(analysis.audioTrack) ? analysis.audioTrack : [];
    const rangeFrom = trackList.length
      ? offset + Math.min(...trackList.map((t) => Number(t.fromSec) || 0))
      : offset;
    const rangeTo = trackList.length
      ? offset + Math.max(...trackList.map((t) => Number(t.toSec) || 0))
      : offset;
    return `<div style="margin:14px 0"><h3 style="color:#7a6f5d;margin:6px 0">声音节点 · ${mmss(rangeFrom)}–${mmss(rangeTo)}</h3>${chunkMeta}<div style="overflow-x:auto"><table style="border-collapse:collapse;width:100%;font-size:.85em"><tr><th style="padding:4px 8px;color:#7a6f5d">秒位</th>${AUDIO_TRACK_FIELDS.map((key) => `<th style="padding:4px 8px;color:#7a6f5d">${fieldLabel(key)}</th>`).join("")}<th style="padding:4px 8px;color:#7a6f5d">声音事件</th></tr>${trackRows}</table></div></div>`;
  }).join("");

  const subtitles = (Array.isArray(card.subtitles) ? card.subtitles : []) as Array<Record<string, unknown>>;

  /* ───────── 0830 用户拍板的报告规格：KPI / 镜长分布 / 重点时刻 / 剧情节点 ───────── */

  const shotSpans = shots
    .map((shot) => ({ from: Number(shot.startSec), to: Number(shot.endSec) }))
    .filter((x) => Number.isFinite(x.from) && Number.isFinite(x.to) && x.to > x.from);
  /**
   * 🔴 覆盖按**区间并集**算，不是时长之和（0830 审查 P0）：
   * 重叠区间会被重复计入，「覆盖 X 分钟」可能超过整集时长——
   * 而这份报告存在的意义之一就是抓「镜头重叠/过度合并」，这个指标偏偏在异常时
   * 往「更好看」的方向失真。重叠另单列成红字告警，那才是审片人要的信号。
   */
  const sortedSpans = shotSpans.slice().sort((a, b) => a.from - b.from);
  let coveredSec = 0;
  let overlapSec = 0;
  let overlapCount = 0;
  let cursor = Number.NEGATIVE_INFINITY;
  for (const span of sortedSpans) {
    if (span.from < cursor) {
      overlapCount += 1;
      overlapSec += Math.min(cursor, span.to) - span.from;
    }
    const from = Math.max(span.from, cursor);
    if (span.to > from) { coveredSec += span.to - from; cursor = span.to; }
  }
  const avgShotSec = shotSpans.length ? coveredSec / shotSpans.length : 0;
  /**
   * 🔴 必须从**未过滤**的原始 card.shots 上数（0830 审查 P0）：
   * 上方 shots 已经 filter 掉 non_story_ad，在它上面再找广告镜恒为空——第三次同型空改。
   * 文案也随之改成「已剔除 M 广告镜」：这些镜本就不在 shots 里，说「含」是错的。
   */
  const adShotCount = (Array.isArray(card.shots) ? card.shots as Array<Record<string, unknown>> : [])
    .filter((shot) => shot.evidenceRole === "non_story_ad").length;
  const adRanges = (Array.isArray((card as { excludedAdRanges?: unknown }).excludedAdRanges)
    ? (card as { excludedAdRanges: Array<Record<string, unknown>> }).excludedAdRanges
    : []);
  const audioSegCount = audioChunks.reduce((sum, chunk) => (
    sum + (Array.isArray(chunk.analysis?.audioTrack) ? chunk.analysis!.audioTrack!.length : 0)
  ), 0);

  /** 重点时刻（v12）：模型自报的抓帧秒位，五类＝切镜/情绪/灯光/剧情/音轨。 */
  type KeyMomentSubtitle = { atSec: number; textZh: string };
  const subtitlesByKeyMoment = new Map<number, KeyMomentSubtitle[]>();
  for (const subtitle of subtitles.slice().sort((a, b) => Number(a.atSec) - Number(b.atSec))) {
    const atSec = Number(subtitle.atSec);
    const textZh = String(subtitle.textZh ?? "").trim();
    if (!Number.isFinite(atSec) || !textZh) continue;
    let nearestIndex = -1;
    let nearestDistance = Number.POSITIVE_INFINITY;
    keyMoments.forEach((moment, index) => {
      const distance = Math.abs(atSec - Number(moment.atSec));
      if (distance <= 2 && distance < nearestDistance) {
        nearestIndex = index;
        nearestDistance = distance;
      }
    });
    if (nearestIndex < 0) continue;
    const rows = subtitlesByKeyMoment.get(nearestIndex) ?? [];
    rows.push({ atSec, textZh });
    subtitlesByKeyMoment.set(nearestIndex, rows);
  }
  const keyMomentSubtitleCount = Array.from(subtitlesByKeyMoment.values())
    .reduce((sum, rows) => sum + rows.length, 0);
  // 0902 用户拍板：说明列与截图标注同源重复——瘦身为 秒位/类型/关键字幕/对照截图 四栏
  const kmRows = keyMoments.map((row, index) => {
    const at = Number(row.atSec);
    let best: { no: number; d: number } | null = null;
    for (const anchor of frameAnchors) {
      const d = Math.abs(anchor.atSec - at);
      if (d <= 2.5 && (!best || d < best.d)) best = { no: anchor.no, d };
    }
    const frameRef = best
      ? `<a href="#frame-${best.no}" style="color:#3a7bd5;font-weight:700;text-decoration:none">图${best.no}</a>`
      : '<span style="color:#9a8d75">—</span>';
    const subtitleCell = (subtitlesByKeyMoment.get(index) ?? []).map((subtitle) => (
      `<div><span style="color:#8a6a1f;white-space:nowrap">${mmss(subtitle.atSec)}</span> <b style="color:#8a2a1a">${esc(subtitle.textZh)}</b></div>`
    )).join("") || '<span style="color:#9a8d75">—</span>';
    return `<tr><td style="color:#8a6a1f;white-space:nowrap">${mmss(at)}</td>`
      + `<td style="white-space:nowrap">${KIND_ICON[String(row.kindZh)] ?? ""} ${esc(row.kindZh)}</td>`
      + `<td>${subtitleCell}</td>`
      + `<td style="white-space:nowrap;text-align:center">${frameRef}</td></tr>`;
  }).join("");

  /** 镜长分布：一眼看粒度，长镜区间标红。 */
  const buckets: Array<[string, number, number]> = [
    ["0–2s", 0, 2], ["2–4s", 2, 4], ["4–6s", 4, 6], ["6–10s", 6, 10],
    ["10–15s", 10, 15], ["15–30s", 15, 30], ["30s+", 30, Number.POSITIVE_INFINITY],
  ];
  const hist = buckets.map(([label, lo, hi]) => ({
    label,
    n: shotSpans.filter((x) => (x.to - x.from) >= lo && (x.to - x.from) < hi).length,
    warn: lo >= 15,
  }));
  const histPeak = Math.max(1, ...hist.map((row) => row.n));
  const histBars = hist.map((row) => (
    `<div style="display:flex;align-items:center;gap:10px;margin:5px 0">`
    + `<span style="width:64px;color:#857a66;font-size:12px">${row.label}</span>`
    + `<span style="height:15px;border-radius:3px;min-width:2px;width:${Math.round((row.n / histPeak) * 100)}%;`
    + `background:${row.warn ? "#b5473a" : "linear-gradient(90deg,#3a7bd5,#7b5cd6)"}"></span>`
    + `<span style="color:#857a66;font-size:12px">${row.n}</span></div>`
  )).join("");

  /**
   * 粒度判定用**膨胀倍数**而非绝对镜长——绝对值是体裁相关的
   * （漫剧 2.8–4.3s/镜，真人剧更长），跨体裁会误判。此处无输入基准，
   * 故只在明显异常（平均 >12 秒）时示警，其余一律按正常呈现。
   */
  /**
   * 🔴 秒位非法的镜必须显式呈报（0830 审查 P0）：shotSpans 会静默丢掉它们，
   * 而 KPI「镜头数」用的是 shots.length，两个数字会静静地不自洽；
   * 极端情况全部镜无效 ⇒ avgShotSec=0 ⇒ 旧逻辑输出「✅ 粒度正常 · 0.0 秒」绿灯报喜。
   */
  const invalidShotCount = shots.length - shotSpans.length;
  const grainBad = shotSpans.length === 0 || avgShotSec > 12;
  const grainColor = grainBad ? "#b5473a" : "#5c7a3a";
  const grainText = shotSpans.length === 0
    ? "🔴 全部镜头秒位非法，无法判定粒度"
    : (avgShotSec > 12
      ? `🔴 平均镜长 ${avgShotSec.toFixed(1)} 秒，疑似镜头被过度合并`
      : `✅ 粒度正常 · 平均镜长 ${avgShotSec.toFixed(1)} 秒`)
      + (invalidShotCount > 0 ? ` · ⚠️ ${invalidShotCount} 镜秒位非法，未计入镜长统计` : "")
      + (overlapCount > 0 ? ` · 🔴 ${overlapCount} 处镜头重叠，共 ${overlapSec.toFixed(1)} 秒` : "");

  const kpi = [
    [String(shots.length), "镜头数"],
    [`${avgShotSec.toFixed(1)}s`, "平均镜长"],
    [String(keyMomentSubtitleCount), "重点字幕"],
    [String(keyMoments.length), "重点时刻"],
    [String(audioSegCount), "音轨段"],
    [String(adRanges.length), "广告区间"],
  ].map(([value, label], kpiIndex) => {
    const accent = ["#7b5cd6", "#e0559d", "#e8823a", "#2f9e8f", "#3a7bd5", "#b8452f"][kpiIndex % 6]!;
    return (
      `<div style="background:#fffdf6;border:1.5px solid ${accent};border-radius:12px;`
      + `padding:12px 16px;min-width:120px;box-shadow:0 1px 6px rgba(150,110,60,.10)">`
      + `<b style="display:block;font-size:1.7em;color:${accent};line-height:1.3">${esc(value)}</b>`
      + `<span style="color:#6b5b4a">${esc(label)}</span></div>`
    );
  }).join("");

  /**
   * 0902 用户拍板：借图文知识卡片模板的简版基因——每个区块是一张圆角描金
   * 知识卡，标题带 ①②③ 圈号徽章；highlight 卡加深底突出重点。
   */
  // 0902 用户拍板：配色对齐其小红书趋势报告色号——每张知识卡轮换一个强调色
  const CARD_ACCENTS = ["#7b5cd6", "#e0559d", "#e8823a", "#2f9e8f", "#3a7bd5", "#b8452f"] as const;
  let sectionNo = 0;
  const section = (titleZh: string, body: string, highlight = false) => {
    sectionNo += 1;
    const accent = CARD_ACCENTS[(sectionNo - 1) % CARD_ACCENTS.length]!;
    const badge = sectionNo <= 10 ? String.fromCharCode(0x245f + sectionNo) : String(sectionNo);
    return (
      `<section style="background:${highlight ? "#fff8ec" : "#fffdf6"};border:1px solid ${accent}33;`
      + `border-top:4px solid ${accent};border-radius:14px;padding:16px 20px;margin-top:22px;`
      + `box-shadow:0 2px 10px rgba(150,110,60,.10)">`
      + `<h2 style="display:flex;align-items:center;gap:10px;color:${accent};margin:0 0 10px;font-size:1.12em">`
      + `<span style="display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;`
      + `border-radius:50%;background:${accent};color:#fff;font-size:.85em;flex:none">${badge}</span>`
      + `${esc(titleZh)}</h2>${body}</section>`
    );
  };
  const panel = (text: unknown) => (
    `<div style="background:#fffbf0;border:1px dashed #d9c48e;border-radius:10px;`
    + `padding:14px 18px;margin-top:6px;white-space:pre-wrap;line-height:1.75">${emphasize(text)}</div>`
  );
  const tableOf = (headers: string[], rows: string) => (
    `<div style="overflow-x:auto"><table style="border-collapse:collapse;width:100%;font-size:.85em;margin-top:8px">`
    + `<tr>${headers.map((h) => `<th style="padding:6px 10px;color:#6b4c12;background:#f0e3c4;text-align:left;`
      + `border:1px solid #e2d2a8">${esc(h)}</th>`).join("")}</tr>`
    + `${rows}</table></div>`
  );

  // 0902 用户拍板：labelZh 里的 seriesKey 前缀与来源术语不进客户页面，只留「第 N 集」
  const displayLabelZh = (/第\s*\d+\s*集/.exec(String(input.labelZh || ""))?.[0])
    || String(input.labelZh || "").trim()
    || "本集";
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(displayLabelZh)} 逐帧审片手记</title></head><body style="margin:0;background:#f4e3cb"><div style="font-family:'Songti SC','Kaiti SC','STKaiti',serif;background:linear-gradient(180deg,#f8f0e1 0%,#f4e3cb 55%,#eecaa4 100%);background-attachment:fixed;color:#3d3428;padding:28px;max-width:1200px;margin:auto">
<p style="color:#8a5a12;letter-spacing:.3em;font-size:.8em">${esc(displayLabelZh)} · 逐镜逐秒审读整理 · 字幕只记重点时刻前后两秒</p>
<h1 style="font-size:2.1em;margin:.2em 0;color:#472a56;letter-spacing:.1em">逐帧审片手记</h1>
<div style="height:4px;max-width:420px;background:linear-gradient(90deg,#7b5cd6,#e0559d,#e8823a,#2f9e8f,#3a7bd5);border-radius:3px;margin:6px 0 2px"></div>
<p style="color:#7a6f5d;margin:.3em 0 0">${shots.length} 镜（已剔除 ${adShotCount} 广告镜）· ${keyMomentSubtitleCount} 重点字幕 · ${keyMoments.length} 重点时刻 · 精选画面 ${tiles.length} 张 · 覆盖 ${(coveredSec / 60).toFixed(1)} 分钟</p>

<div style="display:flex;gap:12px;flex-wrap:wrap;margin:18px 0">${kpi}</div>
<p style="margin:6px 0 0"><span style="display:inline-block;background:#fffdf6;border:1px solid ${grainColor}55;border-radius:999px;padding:4px 14px;color:${grainColor};font-weight:600;font-size:.9em">${grainText}</span></p>

${section("📏 镜长分布", histBars)}
${section("💡 可复用手法总结", panel(summaryTextOf("reusableZh")))}
${section("🧭 生成提示要素", panel(summaryTextOf("genPromptHintZh")))}
${section("🥁 节奏结构", panel(summaryTextOf("beatStructureZh")))}
${section("🌊 情绪推进", panel(summaryTextOf("moodArcZh")))}
${section("🏷️ 五维标签墙", tags)}
${section(`⭐ 重点时刻表 · ${keyMoments.length} 条`, keyMoments.length
    ? tableOf(["秒位", "类型", "关键字幕（前后 2 秒）", "对照截图"], kmRows)
    : `<p style="color:#857a66">本集手记未单列重点时刻</p>`, true)}
${section("🎞️ 视频节点区域", `<div style="display:flex;flex-wrap:wrap;gap:8px">${tiles.join("")}</div>`)}
${section("🎧 声音节点区域", audioSections)}
<details style="margin-top:22px;background:#fffdf6;border:1px solid #b8452f33;border-top:4px solid #b8452f;border-radius:14px;padding:14px 20px;box-shadow:0 2px 10px rgba(150,110,60,.10)" open><summary style="color:#b8452f;font-weight:600;font-size:1.1em;cursor:pointer">全镜头表 · ${shots.length} 镜 × ${FIELDS.length} 字段</summary><div style="margin:8px 0 4px;font-size:.8em;color:#7a6f5d">色块图例：<span style="background:#b8452f14;border-left:3px solid #b8452f;padding:1px 8px;font-weight:700;color:#8a2a1a">剧情亮点/转折</span>　<span style="background:#3a7bd514;border-left:3px solid #3a7bd5;padding:1px 8px;font-weight:700;color:#2a5da8">运镜/剪辑技巧</span>　其余行不上色</div><div style="overflow-x:auto;max-height:70vh;overflow-y:auto"><table style="border-collapse:collapse;font-size:.8em"><tr><th style="position:sticky;left:0;background:#efe5cc">秒位</th>${FIELDS.map((f) => `<th style="padding:4px 8px;color:#7a6f5d">${fieldLabel(f)}</th>`).join("")}</tr>${shotRows}</table></div></details>
<div style="text-align:center;margin-top:36px"><span style="display:inline-block;background:#fdf3dd;border:1.5px solid #e8823a;border-radius:999px;padding:8px 22px;color:#b25a1a;font-size:.85em">⭐ 逐帧逐秒审读整理 · 仅作学习拆解，版权归原作品所有</span></div></div></body></html>`;

  await uploadBufferToGcs({
    bucket,
    objectName: input.reportObjectName,
    contentType: "text/html; charset=utf-8",
    buffer: Buffer.from(html, "utf8"),
  });
  const reportUrl = await sign(bucket, input.reportObjectName, true);
  return { reportUrl, bytes: html.length, frames: tiles.length, frameSource, shots: shots.length };
}

export type NativeReportFromObjectNamesInput = {
  labelZh: string;
  /** provenance.nativeVideoDeepRead.segmentEvidenceObjectNames 的精确对象名，禁止列目录推断。 */
  evidenceObjectNames: string[];
  /** 路由已知集号时传入，与每份证据的 episodeIndex 强校验。 */
  expectEpisodeIndex?: number;
  /** 路由已知系列时传入，与每份证据的 seriesKey 强校验（防跨系列证据拼进同一报告）。 */
  expectSeriesKey?: string;
  /** 卡片 provenance 的 sourceDigest；与证据 digest 强校验（防换来源快照）。 */
  expectSourceDigest?: string;
  /** 卡片 provenance 的 attemptedSegments；证据名个数必须严格等于它（防少段导出）。 */
  expectSegmentCount?: number;
  /** 首次学习时保存的真实分片边界；音轨局部秒只能用它换算，禁止回退固定 300 秒。 */
  segmentSpans?: NativeReportSegmentSpan[];
  /** GLM 整集卡对象名（provenance 明示时传入；传了就必须能读到，fail closed）。 */
  glmCardObjectName?: string;
  /** 完整卡入库时按 keyMoments 抽取的正式帧证据；优先于旧探针帧包。 */
  evidenceFrames?: ManhuaViralTemplateEvidenceFrame[];
  framesV2SummaryObjectName?: string;
  framesPrefix?: string;
  reportObjectName: string;
};

/**
 * 生产路由唯一入口：按精确证据对象名渲染。
 * 校验：每个对象必须存在且合法；证据名个数与卡片 attemptedSegments 一致；
 * episodeIndex/seriesKey 全一致（且与 expectEpisodeIndex/expectSeriesKey 一致）；
 * segmentIndex 无重复且严格等于下标（0..n-1，缺首段/末段一样拦下）；
 * sourceDigest 合法（64 位 hex）、全一致且与卡片 provenance 一致。
 * 任一不满足即抛错，不上传半成品。
 */
export async function renderNativeEvidenceReportFromObjectNames(
  input: NativeReportFromObjectNamesInput,
): Promise<NativeReportRenderResult> {
  const bucket = getGcsBucketName();
  const names = (input.evidenceObjectNames ?? []).map((n) => String(n || "").trim()).filter(Boolean);

  if (names.length === 0) {
    throw new Error("provenance 没有 segmentEvidenceObjectNames，拒绝列目录猜证据；该集需重学后再出报告");
  }
  // 段数门禁：卡片 provenance 说有 N 段，证据名就必须正好 N 个。
  // 少首段、少末段都在这里拦下——排序连续性检查看不出「整体少一段」。
  if (input.expectSegmentCount !== undefined) {
    const expected = Number(input.expectSegmentCount);
    if (!Number.isInteger(expected) || expected < 1 || names.length !== expected) {
      throw new Error(`证据段数不完整：卡片应有 ${input.expectSegmentCount} 段，provenance 只有 ${names.length} 段`);
    }
  }
  const segments: Array<SegmentRaw & {
    objectName: string; episodeIndex: number; seriesKey: string; sourceDigest: string;
  }> = [];
  for (const objectName of names) {
    const entry = await mustJson(bucket, objectName);
    const raw = entry.raw;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new Error(`证据对象缺少 raw 段卡本体：${objectName}`);
    }
    const episodeIndex = Number(entry.episodeIndex);
    const segmentIndex = Number(entry.segmentIndex);
    const seriesKey = String(entry.seriesKey ?? "").trim();
    const sourceDigest = String(entry.sourceDigest ?? "").trim();
    if (!Number.isInteger(episodeIndex) || !Number.isInteger(segmentIndex) || segmentIndex < 0) {
      throw new Error(`证据对象 episodeIndex/segmentIndex 非法：${objectName}`);
    }
    if (!seriesKey) {
      throw new Error(`证据对象缺少 seriesKey：${objectName}`);
    }
    if (!/^[a-f0-9]{64}$/i.test(sourceDigest)) {
      throw new Error(`证据对象 sourceDigest 非法：${objectName}`);
    }
    segments.push({ objectName, episodeIndex, seriesKey, segmentIndex, sourceDigest, raw: raw as Record<string, unknown> });
  }

  const episodes = new Set(segments.map((s) => s.episodeIndex));
  if (episodes.size !== 1) {
    throw new Error(`证据 episodeIndex 不一致：${Array.from(episodes).join(",")}`);
  }
  if (input.expectEpisodeIndex !== undefined && segments[0]!.episodeIndex !== input.expectEpisodeIndex) {
    throw new Error(`证据 episodeIndex=${segments[0]!.episodeIndex} 与请求集号 ${input.expectEpisodeIndex} 不符`);
  }
  const seriesKeys = new Set(segments.map((s) => s.seriesKey));
  if (seriesKeys.size !== 1) {
    throw new Error(`证据 seriesKey 不一致：${Array.from(seriesKeys).join(",")}`);
  }
  if (input.expectSeriesKey !== undefined && segments[0]!.seriesKey !== input.expectSeriesKey) {
    throw new Error(`证据 seriesKey=${segments[0]!.seriesKey} 与请求系列 ${input.expectSeriesKey} 不符`);
  }
  const digests = new Set(segments.map((s) => s.sourceDigest));
  if (digests.size !== 1) {
    throw new Error("证据 sourceDigest 混杂：不同来源快照的段卡不能拼进同一份报告");
  }
  if (input.expectSourceDigest !== undefined
    && segments[0]!.sourceDigest.toLowerCase() !== String(input.expectSourceDigest).trim().toLowerCase()) {
    throw new Error("证据 sourceDigest 与卡片 provenance 不符");
  }
  segments.sort((a, b) => a.segmentIndex - b.segmentIndex);
  for (let i = 0; i < segments.length; i++) {
    if (i > 0 && segments[i]!.segmentIndex === segments[i - 1]!.segmentIndex) {
      throw new Error(`证据 segmentIndex 重复：seg${segments[i]!.segmentIndex}`);
    }
    // 严格等于下标：0..n-1 一个不缺。只查「相邻连续」会放过整体缺首段/缺末段。
    if (segments[i]!.segmentIndex !== i) {
      throw new Error(`证据 segmentIndex 不完整：应有 seg${i}，实际为 seg${segments[i]!.segmentIndex}`);
    }
  }

  const assembledSegments = assembleCardFromSegments(segments, input.segmentSpans);
  let reportCard = assembledSegments;
  let sourceLabelZh = `parsed 段卡拼接 · ${segments.length} 段（provenance 精确寻址）`;
  if (input.glmCardObjectName) {
    const glmEvidence = await mustJson(bucket, input.glmCardObjectName);
    reportCard = {
      ...unwrapGlmReportCard(glmEvidence),
      // GLM 不负责复述真实分片边界；报告音轨秒位只认首次学习计划。
      ...(assembledSegments.chunkSpans ? { chunkSpans: assembledSegments.chunkSpans } : {}),
    };
    if (Array.isArray(assembledSegments.excludedAdRanges)
      && assembledSegments.excludedAdRanges.length > 0) {
      reportCard.excludedAdRanges = assembledSegments.excludedAdRanges;
    } else {
      delete reportCard.excludedAdRanges;
    }
    sourceLabelZh = "GLM 整集卡（provenance 精确寻址）";
  }

  return renderCardToReport({
    labelZh: input.labelZh,
    card: reportCard,
    sourceLabelZh,
    evidenceFrames: input.evidenceFrames,
    framesV2SummaryObjectName: input.framesV2SummaryObjectName,
    framesPrefix: input.framesPrefix,
    reportObjectName: input.reportObjectName,
  });
}

export type NativeReportRenderInput = {
  /** 报告标题里的身份标识（run id 或 剧集标识） */
  labelZh: string;
  /** parsed 段卡前缀（segment-evidence/tpl_native_..._epNNN/） */
  evidencePrefix: string;
  /** GLM 整集卡对象名（可无） */
  glmCardObjectName?: string;
  /** 帧包前缀（无 v2 时回退；可都不存在） */
  framesV2SummaryObjectName?: string;
  framesPrefix?: string;
  /** 报告落点对象名 */
  reportObjectName: string;
};

/**
 * 旧列目录入口：仅供 CLI 探针脚本兼容。生产路由一律走
 * renderNativeEvidenceReportFromObjectNames（provenance 精确寻址）。
 */
export async function renderNativeEvidenceReport(input: NativeReportRenderInput): Promise<NativeReportRenderResult> {
  const bucket = getGcsBucketName();

  const glm = input.glmCardObjectName ? await tryJson(bucket, input.glmCardObjectName) : null;
  let card = glm;
  if (!card) {
    const names = await listGcsObjectNamesByPrefix({
      prefix: input.evidencePrefix, literalPrefix: true, maxResults: 200,
    });
    // 同契约重跑会产生同段多份不可变证据：按 segmentIndex 去重，取排序最后一份。
    const dedupedBySegment = new Map<number, string>();
    for (const name of names.sort()) {
      const m = /\/seg(\d+)-/.exec(name);
      dedupedBySegment.set(Number(m?.[1] ?? -1), name);
    }
    const segments: SegmentRaw[] = [];
    for (const [segmentIndex, name] of Array.from(dedupedBySegment.entries()).sort((a, b) => a[0] - b[0])) {
      const entry = await tryJson(bucket, name);
      const raw = (entry?.raw ?? {}) as Record<string, unknown>;
      segments.push({ segmentIndex: segmentIndex >= 0 ? segmentIndex : segments.length, raw });
    }
    card = assembleCardFromSegments(segments);
  }

  return renderCardToReport({
    labelZh: input.labelZh,
    card,
    sourceLabelZh: glm ? "GLM 整集卡" : "parsed 段卡拼接（CLI 列目录兼容口径）",
    framesV2SummaryObjectName: input.framesV2SummaryObjectName,
    framesPrefix: input.framesPrefix,
    reportObjectName: input.reportObjectName,
  });
}
