/**
 * 1111 拉片（视频创作拆解）服务端：上传 → ffprobe 时长 → 看片（Gemini 两跳：Vertex gs:// → EvoLink 签名 https）
 * → 确定性修正 + 秒位校验（不过带原因同跳修复重写一次，仍不过切下一跳）→ 按段裁片 → 结果落 GCS。
 *
 * 契约：shared/videoBreakdown.ts（字段不得改）。模型经 resolveGeminiModel("videoBreakdown") 解析，不写死。
 * 两跳复用 server/gemini-audio.ts geminiAudioJsonWithFallback（超时/断线/HTTP 错/空回/写坏都切下一跳；
 * 每跳 request/raw/decoded/parsed/rejected 原始与解析 JSON 分别永久落 GCS，只增不删）。
 *
 * 任务状态：不进 server/jobs 的 DB 队列（那条队列按 worker 角色 / 重型机分流、类型枚举固定，接入成本高），
 * 改用「GCS 状态文件 + 进程内任务表」：
 *   video-breakdown/<uid>/<jobId>/request.json    —— 条件创建（ifGenerationMatch=0）原子占号，同 requestId 不重复开
 *   video-breakdown/<uid>/<jobId>/state.json      —— 状态（可覆写）；运行中每分钟心跳
 *   video-breakdown/<uid>/<jobId>/probe.json      —— ffprobe 结果
 *   video-breakdown/<uid>/<jobId>/evidence/*.json —— 每跳证据（只增不删）
 *   video-breakdown/<uid>/<jobId>/clips/seg-NNN.mp4
 *   video-breakdown/<uid>/<jobId>/result.json     —— 最终结果（进程重启后 get 照样读到）
 *   video-breakdown/_ledger/{open,closed}/<uid>__<jobId>.json —— 开单 / 结单登记，启动清扫据此找中断单
 * 进程重启：本机任务表没有、且心跳超过 VIDEO_BREAKDOWN_STALE_MS 的 queued/running 单判「中断」→ 标失败并按 chargeKey 原路全额退款
 * （refundKey 幂等，不会重复退）；用户换新 requestId 重新 start 即可。jobId 由 (userId, requestId) 派生，同单不会二次扣费。
 *
 * 计费（用户 2026-11-11 定价）：标价唯一真源 shared/videoBreakdown.ts videoBreakdownCredits(片长)；
 * 以 ffprobe 实测时长（取到契约精度 0.1 秒，即 result.durationSec）计价，扣费发生在时长核对通过之后、看片调用之前；
 * chargeKey 按 jobId 幂等；管理员/supervisor 0 扣；失败按 chargeKey 原路全额退。开单时只按起步价预检余额。
 *
 * 前台可见报错只给业务句（不含上游原文、模型名、通道名）；服务端日志只记阶段与结果码（不含地址与正文）。
 */
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import {
  VIDEO_BREAKDOWN_ACCEPT,
  VIDEO_BREAKDOWN_BASE_CREDITS,
  VIDEO_BREAKDOWN_MAX_BYTES,
  VIDEO_BREAKDOWN_MAX_SECONDS,
  validateVideoBreakdownTiming,
  videoBreakdownCredits,
  videoBreakdownSchema,
  type VideoBreakdown,
  type VideoBreakdownJobStatus,
  type VideoBreakdownJobView,
} from "../../shared/videoBreakdown";
import { resolveGeminiModel, type GeminiModelEnv } from "../../shared/geminiModelConfig.js";
// 只复用模板学习声音轨「文本不写第二份时间」的剥离函数（只读引用，不改模板学习代码）。
import { hasClockTextZh, stripClockTextZh } from "../../shared/manhuaNativeAudioAnalysis.js";

// ─── 常量 ─────────────────────────────────────────────

export const VIDEO_BREAKDOWN_ROOT = "video-breakdown";
export const VIDEO_BREAKDOWN_UPLOAD_SUBDIR = "video-breakdown";
/** 心跳间隔与判死阈值：本机任务表没有、心跳超过阈值的进行中任务视为进程重启中断。 */
export const VIDEO_BREAKDOWN_HEARTBEAT_MS = 60_000;
export const VIDEO_BREAKDOWN_STALE_MS = 5 * 60_000;
/** 单进程同时执行的拉片任务上限（下载 + ffmpeg 吃内存与 CPU），其余排队。 */
export const VIDEO_BREAKDOWN_CONCURRENCY = 2;
/** 单任务总时限（下载 + 看片 + 修复 + 裁片）。 */
export const VIDEO_BREAKDOWN_JOB_TIMEOUT_MS = 45 * 60_000;
/** 看片单跳时限：整支 ≤5 分钟视频 + 长 JSON 输出。 */
export const VIDEO_BREAKDOWN_MODEL_TIMEOUT_MS = 600_000;
export const VIDEO_BREAKDOWN_MAX_OUTPUT_TOKENS = 65_536;
/** 看片抽帧率（Vertex videoMetadata.fps；EvoLink 忽略按上游缺省）。镜头级切点 1fps 太粗，2fps × 300s 约 4 万帧 token。 */
export const VIDEO_BREAKDOWN_VIDEO_FPS = 2;
export const VIDEO_BREAKDOWN_TEMPERATURE = 0.4;
/** 片段与原片播放地址有效期（秒）：每次 get 现签。 */
export const VIDEO_BREAKDOWN_SIGNED_URL_SECONDS = 3600;
/** 流复制裁出时长与目标差超过此值即判切点不准，改局部重编码。 */
export const VIDEO_BREAKDOWN_CLIP_TOLERANCE_SEC = 0.25;

/** 确定性修正的吸附范围（秒）：超出范围不硬改，交给校验 → 修复重写。 */
const SNAP_EDGE_SEC = 2;
const SNAP_JOINT_SEC = 2;
const SNAP_SHOT_SEC = 1;
const SNAP_WINDOW_SEC = 1;

export function resolveVideoBreakdownModel(env?: GeminiModelEnv): string {
  return resolveGeminiModel("videoBreakdown", env);
}

export function videoBreakdownChargeKey(userId: number, jobId: string) {
  return `video-breakdown:${userId}:${jobId}`;
}
export function videoBreakdownRefundKey(userId: number, jobId: string) {
  return `video-breakdown-refund:${userId}:${jobId}`;
}

export const VIDEO_BREAKDOWN_JOB_ID_RE = /^vb_[a-f0-9]{32}$/;
/** jobId 由 (userId, requestId) 派生：同一 requestId 永远落到同一单（幂等），别人的 jobId 在本人前缀下不存在。 */
export function deriveVideoBreakdownJobId(userId: number, requestId: string) {
  return `vb_${createHash("sha256").update(`${userId}:${requestId}`).digest("hex").slice(0, 32)}`;
}

export function videoBreakdownJobPrefix(userId: number, jobId: string) {
  return `${VIDEO_BREAKDOWN_ROOT}/${userId}/${jobId}`;
}
export function videoBreakdownUploadPrefix(userId: number) {
  return `uploads/u${String(userId).replace(/[^0-9a-zA-Z_-]/g, "")}/${VIDEO_BREAKDOWN_UPLOAD_SUBDIR}/`;
}

const EXT_BY_TYPE: Record<(typeof VIDEO_BREAKDOWN_ACCEPT)[number], string> = {
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
};
const TYPE_BY_EXT: Record<string, string> = { mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm" };

/** 上传对象名：本人前缀 + UUID + 规整文件名 + 由类型决定的扩展名（客户端不可指定路径）。 */
export function buildVideoBreakdownUploadObjectName(userId: number, fileName: string, contentType: (typeof VIDEO_BREAKDOWN_ACCEPT)[number], uuid: string = randomUUID()) {
  const base = String(fileName || "video").replace(/\.[A-Za-z0-9]{1,5}$/, "").replace(/[^\w-]+/g, "-").replace(/-{2,}/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "video";
  return `${videoBreakdownUploadPrefix(userId)}${uuid}-${base}.${EXT_BY_TYPE[contentType]}`;
}

/** 归属核验：只收本桶、本人拉片上传前缀下的对象，拒绝越界形状。返回对象名，不合格返回 null。 */
export function verifyVideoBreakdownSource(userId: number, gcsUri: string, bucket: string): { objectName: string; mimeType: string } | null {
  const m = /^gs:\/\/([^/]+)\/(.+)$/.exec(String(gcsUri || "").trim());
  if (!m || m[1] !== bucket) return null;
  const objectName = m[2]!;
  if (objectName.includes("\\") || objectName.split("/").some(s => s === "" || s === "." || s === "..")) return null;
  const prefix = videoBreakdownUploadPrefix(userId);
  if (!objectName.startsWith(prefix) || objectName.length <= prefix.length) return null;
  const ext = /\.([a-z0-9]+)$/i.exec(objectName)?.[1]?.toLowerCase() ?? "";
  const mimeType = TYPE_BY_EXT[ext];
  if (!mimeType) return null;
  return { objectName, mimeType };
}

// ─── 确定性修正 + 校验 ─────────────────────────────────

const r1 = (n: number) => Math.round(n * 10) / 10;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

function formatZodIssues(error: z.ZodError): string {
  const lines = error.issues.slice(0, 12).map(i => `${i.path.join(".") || "(根)"}：${i.message}`);
  return `结构不合契约：${lines.join("；")}${error.issues.length > 12 ? `；等共 ${error.issues.length} 处` : ""}`;
}

/**
 * 确定性修正（不调模型、不删内容）：
 * 1) kind / durationSec 以服务端实测为准；
 * 2) 段按起点排序、编号重排为 0..n-1；
 * 3) 首段起点 ≤SNAP_EDGE_SEC 吸到 0，末段终点距片尾 ≤SNAP_EDGE_SEC 吸到片尾；相邻段缝隙/重叠 ≤SNAP_JOINT_SEC 取中点首尾相接；
 * 4) 镜头秒位越出所属段 ≤SNAP_SHOT_SEC 夹回段内，镜头按起点排序；
 * 5) 复刻提示词时间窗：若整段明显写成了全片绝对秒（全部落在段的绝对区间内、且超出段长）则换算为段内相对秒；越出段长 ≤SNAP_WINDOW_SEC 夹到段长；
 * 6) 全部秒位四舍五入到 0.1 秒。
 * 超出吸附范围的问题保留原样，交给 validateVideoBreakdownTiming 报出 → 修复重写。
 */
export function normalizeVideoBreakdown(value: VideoBreakdown, durationSec: number): VideoBreakdown {
  const duration = r1(durationSec);
  const segments = [...value.segments]
    .map(s => ({ ...s, startSec: r1(clamp(s.startSec, 0, duration)), endSec: r1(clamp(s.endSec, 0, duration)) }))
    .sort((a, b) => a.startSec - b.startSec || a.endSec - b.endSec);
  if (segments.length) {
    if (segments[0]!.startSec <= SNAP_EDGE_SEC) segments[0]!.startSec = 0;
    const last = segments[segments.length - 1]!;
    if (Math.abs(duration - last.endSec) <= SNAP_EDGE_SEC) last.endSec = duration;
  }
  for (let i = 1; i < segments.length; i += 1) {
    const prev = segments[i - 1]!;
    const cur = segments[i]!;
    if (prev.endSec !== cur.startSec && Math.abs(prev.endSec - cur.startSec) <= SNAP_JOINT_SEC) {
      const joint = r1((prev.endSec + cur.startSec) / 2);
      prev.endSec = joint;
      cur.startSec = joint;
    }
  }
  const fixed = segments.map((seg, index) => {
    const length = r1(seg.endSec - seg.startSec);
    const shots = seg.shots
      .map(shot => {
        let { startSec, endSec } = shot;
        if (startSec < seg.startSec && seg.startSec - startSec <= SNAP_SHOT_SEC) startSec = seg.startSec;
        if (endSec > seg.endSec && endSec - seg.endSec <= SNAP_SHOT_SEC) endSec = seg.endSec;
        return { ...shot, startSec: r1(startSec), endSec: r1(endSec) };
      })
      .sort((a, b) => a.startSec - b.startSec);
    let windows = seg.recreatePrompt.timeline.map(w => ({ ...w }));
    const maxTo = Math.max(...windows.map(w => w.toSec));
    const looksAbsolute = seg.startSec > 0
      && maxTo > length + SNAP_WINDOW_SEC
      && windows.every(w => w.fromSec >= seg.startSec - SNAP_WINDOW_SEC && w.toSec <= seg.endSec + SNAP_WINDOW_SEC);
    if (looksAbsolute) windows = windows.map(w => ({ ...w, fromSec: Math.max(0, w.fromSec - seg.startSec), toSec: w.toSec - seg.startSec }));
    windows = windows
      .map(w => ({ ...w, fromSec: r1(Math.max(0, w.fromSec)), toSec: r1(w.toSec > length && w.toSec - length <= SNAP_WINDOW_SEC ? length : w.toSec) }))
      .sort((a, b) => a.fromSec - b.fromSec);
    return { ...seg, index, shots, recreatePrompt: { ...seg.recreatePrompt, timeline: windows } };
  });
  return { ...value, kind: "video_breakdown_v1", durationSec: duration, segments: fixed };
}

// ─── 可选三块（craft / sound / keyMoments）：坏了就丢 ─────────

type Overview = VideoBreakdown["overview"];
type KeyMoment = NonNullable<Overview["keyMoments"]>[number];
const overviewShape = videoBreakdownSchema.shape.overview.shape;
const craftSchema = overviewShape.craft.unwrap();
const soundSchema = overviewShape.sound.unwrap();
const keyMomentSchema = overviewShape.keyMoments.unwrap().element;
export const VIDEO_BREAKDOWN_KEY_MOMENTS_PER_10S = 3;
export const VIDEO_BREAKDOWN_KEY_MOMENTS_MAX = 60;
/** 重点时刻条数上限：每 10 秒（不足 10 秒按 10 秒）至多 3 条，总数 ≤60。 */
export function videoBreakdownKeyMomentLimit(durationSec: number): number {
  return Math.min(VIDEO_BREAKDOWN_KEY_MOMENTS_MAX, Math.max(1, Math.ceil(durationSec / 10)) * VIDEO_BREAKDOWN_KEY_MOMENTS_PER_10S);
}

/** 丢弃记录：解析时收集，由任务层写日志与 optional-drops 证据（不进前台）。 */
export type VideoBreakdownOptionalDrop = { block: "craft" | "sound" | "keyMoments"; reasonZh: string; count?: number };

/** 声音块：文本里的钟表式秒位剥掉（数字秒位才是时间真源）；剥后为空或仍残留即整块丢。 */
function sanitizeSound(value: unknown): { sound?: Overview["sound"]; reasonZh?: string } {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const v = { ...(value as Record<string, unknown>) };
    for (const k of Object.keys(v)) if (typeof v[k] === "string") v[k] = stripClockTextZh(v[k] as string);
    value = v;
  }
  const parsed = soundSchema.safeParse(value);
  if (!parsed.success) return { reasonZh: formatZodIssues(parsed.error) };
  if (Object.values(parsed.data).some(t => hasClockTextZh(t))) return { reasonZh: "声音描述残留文本秒位" };
  return { sound: parsed.data };
}

/**
 * 重点时刻逐条过滤：非对象 / 类型不在五类 / 秒位越界（<0 或 > 片长）/ 说明不合格 → 逐条丢；
 * 秒位取 0.1 秒、按 (0.1 秒, 类型) 去重、按时间排序；
 * 条数上限：每个 10 秒窗至多 3 条（窗内类型不重复者优先、其次按时间），总数超限时按各窗名次轮转保留（保覆盖面）。
 */
export function filterVideoBreakdownKeyMoments(raw: unknown, durationSec: number, drops: VideoBreakdownOptionalDrop[] = []): KeyMoment[] | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (!Array.isArray(raw)) { drops.push({ block: "keyMoments", reasonZh: "不是数组，整块丢弃" }); return undefined; }
  let invalid = 0;
  const seen = new Set<string>();
  const valid: KeyMoment[] = [];
  for (const item of raw) {
    const parsed = keyMomentSchema.safeParse(item);
    if (!parsed.success || parsed.data.atSec > durationSec) { invalid += 1; continue; }
    const m = { ...parsed.data, atSec: r1(parsed.data.atSec) };
    const key = `${Math.round(m.atSec * 10)}|${m.type}`;
    if (seen.has(key)) continue;
    seen.add(key);
    valid.push(m);
  }
  if (invalid) drops.push({ block: "keyMoments", reasonZh: "秒位越界或类型/说明非法，逐条丢弃", count: invalid });
  valid.sort((a, b) => a.atSec - b.atSec);
  const windows = new Map<number, KeyMoment[]>();
  for (const m of valid) {
    const w = Math.min(Math.floor(m.atSec / 10), Math.max(0, Math.ceil(durationSec / 10) - 1));
    if (!windows.has(w)) windows.set(w, []);
    windows.get(w)!.push(m);
  }
  const ranked: Array<{ m: KeyMoment; rank: number }> = [];
  let overWindow = 0;
  windows.forEach(list => {
    const types = new Set<string>();
    const distinct = list.filter(m => (types.has(m.type) ? false : (types.add(m.type), true)));
    const rest = list.filter(m => !distinct.includes(m));
    const ordered = [...distinct, ...rest];
    overWindow += Math.max(0, ordered.length - VIDEO_BREAKDOWN_KEY_MOMENTS_PER_10S);
    ordered.slice(0, VIDEO_BREAKDOWN_KEY_MOMENTS_PER_10S).forEach((m, rank) => ranked.push({ m, rank }));
  });
  if (overWindow) drops.push({ block: "keyMoments", reasonZh: `单个 10 秒窗超过 ${VIDEO_BREAKDOWN_KEY_MOMENTS_PER_10S} 条，超出部分丢弃`, count: overWindow });
  const limit = videoBreakdownKeyMomentLimit(durationSec);
  ranked.sort((a, b) => a.rank - b.rank || a.m.atSec - b.m.atSec);
  if (ranked.length > limit) drops.push({ block: "keyMoments", reasonZh: `总数超过上限 ${limit} 条，超出部分丢弃`, count: ranked.length - limit });
  const kept = ranked.slice(0, limit).map(x => x.m).sort((a, b) => a.atSec - b.atSec);
  return kept.length ? kept : undefined;
}

/**
 * 两跳 validate：先把三块可选内容摘出来单独校验（任一块不过只丢那一块、记 drops，绝不抛错、不触发修复重写或切跳），
 * 主体：结构解析 → 确定性修正 → 结构复验 → 秒位硬校验；主体不过抛中文原因（作为「写坏」触发修复重写 / 切下一跳）。
 * 无音轨（hasAudio=false）时 sound 一律丢。
 */
export function parseAndFixVideoBreakdown(
  raw: unknown,
  durationSec: number,
  opts: { hasAudio?: boolean; drops?: VideoBreakdownOptionalDrop[] } = {},
): VideoBreakdown {
  const drops = opts.drops ?? [];
  let optional: Partial<Pick<Overview, "craft" | "sound" | "keyMoments">> = {};
  let pre = raw;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const top: Record<string, unknown> = { ...(raw as Record<string, unknown>), kind: "video_breakdown_v1", durationSec: r1(durationSec) };
    const ov = top.overview;
    if (ov && typeof ov === "object" && !Array.isArray(ov)) {
      const { craft, sound, keyMoments, ...rest } = ov as Record<string, unknown>;
      top.overview = rest;
      if (craft !== undefined && craft !== null) {
        const parsed = craftSchema.safeParse(craft);
        if (parsed.success) optional.craft = parsed.data;
        else drops.push({ block: "craft", reasonZh: formatZodIssues(parsed.error) });
      }
      if (sound !== undefined && sound !== null) {
        if (opts.hasAudio === false) drops.push({ block: "sound", reasonZh: "无音轨，声音块丢弃" });
        else {
          const r = sanitizeSound(sound);
          if (r.sound) optional.sound = r.sound;
          else drops.push({ block: "sound", reasonZh: r.reasonZh || "声音块不合格" });
        }
      }
      const km = filterVideoBreakdownKeyMoments(keyMoments, r1(durationSec), drops);
      if (km) optional.keyMoments = km;
    }
    pre = top;
  }
  const parsed = videoBreakdownSchema.safeParse(pre);
  if (!parsed.success) throw new Error(formatZodIssues(parsed.error));
  const fixed = normalizeVideoBreakdown(parsed.data, durationSec);
  const again = videoBreakdownSchema.safeParse(fixed);
  if (!again.success) throw new Error(formatZodIssues(again.error));
  const issues = validateVideoBreakdownTiming(again.data);
  if (issues.length) throw new Error(`秒位校验不过：${issues.join("；")}`);
  optional = Object.fromEntries(Object.entries(optional).filter(([, v]) => v !== undefined));
  return { ...again.data, overview: { ...again.data.overview, ...optional } };
}

// ─── 提示词与原生 schema ───────────────────────────────

export function buildVideoBreakdownPrompt(input: { durationSec: number; hasAudio?: boolean }): string {
  const d = r1(input.durationSec).toFixed(1);
  const hasAudio = input.hasAudio !== false;
  const kmLimit = videoBreakdownKeyMomentLimit(input.durationSec);
  return `你是资深拉片分析师与视频复刻提示词编写者。完整观看附件视频（${hasAudio ? "含音轨" : "无音轨"}，时长 ${d} 秒），产出一份「创作拆解」。全部用中文，只输出一个严格 JSON 对象，不要 markdown、不要多余文字。

【硬规矩】
1. 只写画面与音轨里真实出现的内容；看不清就写「不可辨」，禁止编造画面里没有的人物、物件、台词、字幕、地点或情节。
2. 禁止出现任何导演名、摄影师名、演员名、品牌名或作品名；风格只用中性手法描述（如「低饱和冷调手持跟拍」）。
3. 所有 startSec / endSec 为全片绝对秒，保留一位小数；recreatePrompt.timeline 的 fromSec / toSec 为「段内相对秒」（该段起点记 0.0）。
4. 段落按镜头与叙事自然切分，每段约 3–15 秒，按内容不按固定时长；段与段首尾相接（下一段 startSec = 上一段 endSec），首段从 0.0 开始，末段 endSec = ${d}。
5. 每段的 shots 逐镜列出（以真实剪辑点为准，逐镜时间码），镜头秒位必须落在所属段内；一段内镜头首尾相接。
6. recreatePrompt 用「秒锁」写法：timeline 每个时间窗写清该时段主体在做什么动作、什么表情、光线怎样、氛围如何，时间窗在段长内、按时间顺序首尾相接、覆盖整段。
7. 有对白、音乐或音效时写进 expression.sound 与 recreatePrompt.rhythm；无音轨或无声段，sound 可省略。

【字段说明】
- summary：一句话概括全片（≤400 字）。
- overview.visualGenes：全片视觉基因六维——mediumAndArtStyle 媒介与美术风格；color 色彩体系；lighting 光线体系；materialTexture 材质与质感；composition 构图体系；camera 摄影机体系（机位、运动、焦段感）。
- overview.recurringElements：反复出现的画面元素（1–12 条）。
- overview.mustKeep：复刻时必须保留的要点（1–12 条）。
- segments[].title：本段小标题（≤80 字）。
- segments[].shots[]：framing 画面景别；camera 摄影机（机位、运动、焦段感）；blockingAndFocus 调度、构图与焦点。
- segments[].expression：narrativeIntent 叙事意图；technique 表现手法；rhythm 节奏与情绪；sound 声音（可选）。
- segments[].recreatePrompt：subject 主体一致性（外形、服装、特征）；scene 场景与美术；timeline 镜头序列（秒锁）；camera 摄影机与构图；lightColor 光色与材质；rhythm 节奏与声音；constraints 生成约束（必须保留 / 必须避免）。

【可借鉴的创作手法 overview.craft】
- reusableTechniques：可复用手法 1–8 条，每条写清「用什么拍法 / 剪法 / 光色 / 调度，达到什么效果」，例如「低机位仰拍 + 缓推，把人物压迫感推到顶点」；禁止「画面精美」「节奏紧凑」这类空话。
- rhythmStructure：节奏结构，用 → 串起各阶段（如「慢铺垫 → 快切堆叠 → 留白收尾」），只写阶段，不写时间。
- emotionArc：情绪推进，用 → 串起各阶段。
- styleTags：风格判词 1–24 个短标签（每个 ≤20 字），覆盖情绪、叙事特色、视觉、节奏、声音。
${hasAudio ? `
【声音拆解 overview.sound】（只依据音轨；不转录台词原文、不复述对白内容；文本里不写任何时间或秒位）
- rhythm：声音节奏（疏密、起伏、停顿）。
- mix：混音主次（对白 / 音乐 / 音效 / 环境谁在前、谁让位）。
- reusableTechniques：可复用声音手法（用什么声音处理达到什么效果）。
- generationElements：供配乐生成用的声音要素——乐器、音色、速度（BPM 或快慢）、关键音效。
` : `
【声音】本片无音轨，不要输出 overview.sound。
`}
【重点时刻 overview.keyMoments】看片时自报的抓帧秒位，下游按 atSec 抓一张原片画面：
- atSec：全片绝对秒（0.0–${d}），可保留一位小数；取事件真正发生、画面清晰落定的那一帧，不取镜头区间中点，不按剧情顺序猜。
- type：cut 切镜（景别或机位突变后落定的代表帧）／emotion 情绪（微表情峰值）／lighting 灯光（氛围切换前后）／story 剧情（推动因果的关键节点）／sound 声音（配乐转折、关键音效）${hasAudio ? "" : "（本片无音轨，不要用 sound）"}。
- note：本帧可见的关键事件及其作用，≤60 字，只写画面里看得到的。
- 宁缺毋滥：普通切镜、普通打光不算；平淡区间可以留空；不要为覆盖全片或凑齐五类而硬选。每 10 秒至多 3 条，全片至多 ${kmLimit} 条。

【输出 JSON 形状】
{"kind":"video_breakdown_v1","durationSec":${d},"summary":string,"overview":{"visualGenes":{"mediumAndArtStyle":string,"color":string,"lighting":string,"materialTexture":string,"composition":string,"camera":string},"recurringElements":[string],"mustKeep":[string],"craft":{"reusableTechniques":[string],"rhythmStructure":string,"emotionArc":string,"styleTags":[string]},${hasAudio ? `"sound":{"rhythm":string,"mix":string,"reusableTechniques":string,"generationElements":string},` : ""}"keyMoments":[{"atSec":number,"type":"cut"|"emotion"|"lighting"|"story"|"sound","note":string}]},"segments":[{"index":number,"startSec":number,"endSec":number,"title":string,"shots":[{"startSec":number,"endSec":number,"framing":string,"camera":string,"blockingAndFocus":string}],"expression":{"narrativeIntent":string,"technique":string,"rhythm":string,"sound"?:string},"recreatePrompt":{"subject":string,"scene":string,"timeline":[{"fromSec":number,"toSec":number,"text":string}],"camera":string,"lightColor":string,"rhythm":string,"constraints":string}}]}`;
}

/** 修复重写：同一视频再附一次，带上上次输出与不过原因，要求只修问题、完整重出。 */
export function buildVideoBreakdownRepairPrompt(basePrompt: string, reasonZh: string, badText: string): string {
  return `${basePrompt}

【修复重写】你上一次的输出没有通过校验，原因：${reasonZh}
请对照视频修正这些问题后，重新输出完整 JSON（全部字段，不要只输出改动部分）。其余内容保持与上次一致，不要因为修复而删减段落或镜头。
上一次的输出如下：
${badText}`;
}

const S = { type: "STRING" } as const;
const N = { type: "NUMBER" } as const;
const obj = (properties: Record<string, unknown>, optional: string[] = []) => ({
  type: "OBJECT",
  properties,
  required: Object.keys(properties).filter(k => !optional.includes(k)),
  propertyOrdering: Object.keys(properties),
});
/**
 * Gemini 原生 responseSchema（与契约同形；长度与条数上限由 zod 复验）。
 * craft / keyMoments 进 required（借鉴模板学习 0830：不进 required 时输出预算紧张会被整块漏掉）；sound 只在有音轨时出现。
 * 三块即便生成了，解析时仍单独校验、坏了就丢。
 */
export function buildVideoBreakdownNativeSchema(hasAudio: boolean) {
  return obj({
  kind: { type: "STRING", enum: ["video_breakdown_v1"] },
  durationSec: N,
  summary: S,
  overview: obj({
    visualGenes: obj({ mediumAndArtStyle: S, color: S, lighting: S, materialTexture: S, composition: S, camera: S }),
    recurringElements: { type: "ARRAY", items: S },
    mustKeep: { type: "ARRAY", items: S },
    craft: obj({ reusableTechniques: { type: "ARRAY", items: S }, rhythmStructure: S, emotionArc: S, styleTags: { type: "ARRAY", items: S } }),
    ...(hasAudio ? { sound: obj({ rhythm: S, mix: S, reusableTechniques: S, generationElements: S }) } : {}),
    keyMoments: { type: "ARRAY", items: obj({ atSec: N, type: { type: "STRING", enum: ["cut", "emotion", "lighting", "story", "sound"] }, note: S }) },
  }),
  segments: {
    type: "ARRAY",
    items: obj({
      index: { type: "INTEGER" },
      startSec: N,
      endSec: N,
      title: S,
      shots: { type: "ARRAY", items: obj({ startSec: N, endSec: N, framing: S, camera: S, blockingAndFocus: S }) },
      expression: obj({ narrativeIntent: S, technique: S, rhythm: S, sound: S }, ["sound"]),
      recreatePrompt: obj({
        subject: S,
        scene: S,
        timeline: { type: "ARRAY", items: obj({ fromSec: N, toSec: N, text: S }) },
        camera: S,
        lightColor: S,
        rhythm: S,
        constraints: S,
      }),
    }),
  },
  });
}
/** 有音轨口径的原生 schema（兼容旧引用）。 */
export const VIDEO_BREAKDOWN_NATIVE_SCHEMA = buildVideoBreakdownNativeSchema(true);

// ─── 裁片 ──────────────────────────────────────────────

export type MediaRun = (command: "ffmpeg" | "ffprobe", args: string[], signal: AbortSignal) => Promise<{ stdout: string; stderr: string }>;

export async function probeVideoDuration(file: string, run: MediaRun, signal: AbortSignal): Promise<{ durationSec: number; hasVideo: boolean; hasAudio: boolean }> {
  const { stdout } = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration:stream=codec_type,duration", "-of", "json", file], signal);
  const info = JSON.parse(String(stdout || "{}")) as { format?: { duration?: string }; streams?: Array<{ codec_type?: string; duration?: string }> };
  const streams = info.streams || [];
  const fromFormat = Number(info.format?.duration);
  const fromVideo = Number(streams.find(s => s.codec_type === "video")?.duration);
  const durationSec = Number.isFinite(fromFormat) && fromFormat > 0 ? fromFormat : Number.isFinite(fromVideo) && fromVideo > 0 ? fromVideo : NaN;
  return { durationSec, hasVideo: streams.some(s => s.codec_type === "video"), hasAudio: streams.some(s => s.codec_type === "audio") };
}

/** 流复制裁段：输入前 -ss 快速定位到关键帧，不重编码；切点不在关键帧上时时长会偏长，由调用方核验。 */
export function buildClipCopyArgs(input: { src: string; startSec: number; endSec: number; out: string }) {
  return ["-y", "-ss", input.startSec.toFixed(3), "-i", input.src, "-t", (input.endSec - input.startSec).toFixed(3),
    "-map", "0:v:0", "-map", "0:a:0?", "-c", "copy", "-avoid_negative_ts", "make_zero", "-movflags", "+faststart", input.out];
}

/** 局部重编码裁段：只重编这一段，精确到帧，音画同起点。 */
export function buildClipReencodeArgs(input: { src: string; startSec: number; endSec: number; out: string }) {
  return ["-y", "-ss", input.startSec.toFixed(3), "-i", input.src, "-t", (input.endSec - input.startSec).toFixed(3),
    "-map", "0:v:0", "-map", "0:a:0?", "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", input.out];
}

export type ClipCutOutcome = { index: number; objectName: string | null; mode?: "copy" | "reencode"; errorCode?: string };

/**
 * 逐段裁出片段并上传：优先流复制，时长与目标差 > VIDEO_BREAKDOWN_CLIP_TOLERANCE_SEC（切点不在关键帧）或流复制失败时局部重编码。
 * 某段失败不影响其余段（objectName=null，前台 clipUrl 为空串）；任务被中止则整体抛出。
 */
export async function cutVideoBreakdownClips(
  input: { srcFile: string; dir: string; segments: Array<{ startSec: number; endSec: number }>; objectNameFor: (index: number) => string; signal: AbortSignal },
  deps: { run: MediaRun; uploadFile: (filePath: string, objectName: string) => Promise<void> },
): Promise<ClipCutOutcome[]> {
  const outcomes: ClipCutOutcome[] = [];
  for (let index = 0; index < input.segments.length; index += 1) {
    input.signal.throwIfAborted();
    const seg = input.segments[index]!;
    const out = path.join(input.dir, `seg-${String(index).padStart(3, "0")}.mp4`);
    const target = seg.endSec - seg.startSec;
    let mode: "copy" | "reencode" = "copy";
    try {
      try {
        await deps.run("ffmpeg", buildClipCopyArgs({ src: input.srcFile, startSec: seg.startSec, endSec: seg.endSec, out }), input.signal);
        if ((await stat(out)).size <= 0) throw new Error("empty");
        const measured = await probeVideoDuration(out, deps.run, input.signal);
        if (!measured.hasVideo || !(Math.abs(measured.durationSec - target) <= VIDEO_BREAKDOWN_CLIP_TOLERANCE_SEC)) throw new Error("inexact");
      } catch {
        input.signal.throwIfAborted();
        mode = "reencode";
        await rm(out, { force: true }).catch(() => {});
        await deps.run("ffmpeg", buildClipReencodeArgs({ src: input.srcFile, startSec: seg.startSec, endSec: seg.endSec, out }), input.signal);
        if ((await stat(out)).size <= 0) throw new Error("empty_output");
      }
      const objectName = input.objectNameFor(index);
      await deps.uploadFile(out, objectName);
      outcomes.push({ index, objectName, mode });
    } catch (error) {
      input.signal.throwIfAborted();
      outcomes.push({ index, objectName: null, mode, errorCode: error instanceof Error ? error.message.slice(0, 40).replace(/[^\w:-]+/g, "_") : "unknown" });
    } finally {
      await rm(out, { force: true }).catch(() => {});
    }
  }
  return outcomes;
}

/** 抽一帧：按 atSec 定位，长边 ≤1280（不放大），JPEG。 */
export function buildKeyMomentFrameArgs(input: { src: string; atSec: number; out: string }) {
  return ["-y", "-ss", input.atSec.toFixed(3), "-i", input.src, "-frames:v", "1", "-an",
    "-vf", "scale=w='min(1280,iw)':h='min(1280,ih)':force_original_aspect_ratio=decrease",
    "-q:v", "3", input.out];
}

/**
 * 重点时刻逐条抽帧并上传；某条失败该条为 null（前台空串），不影响其余条与整单；任务被中止则整体抛出。
 * 秒位贴片尾时往前让 0.05 秒，免得定位到最后一帧之后抽不出画面。
 */
export async function extractKeyMomentFrames(
  input: { srcFile: string; dir: string; durationSec: number; moments: Array<{ atSec: number }>; objectNameFor: (index: number) => string; signal: AbortSignal },
  deps: { run: MediaRun; uploadFile: (filePath: string, objectName: string) => Promise<void> },
): Promise<Array<string | null>> {
  const out: Array<string | null> = [];
  for (let index = 0; index < input.moments.length; index += 1) {
    input.signal.throwIfAborted();
    const file = path.join(input.dir, `km-${String(index).padStart(3, "0")}.jpg`);
    const atSec = Math.max(0, Math.min(input.moments[index]!.atSec, input.durationSec - 0.05));
    try {
      await deps.run("ffmpeg", buildKeyMomentFrameArgs({ src: input.srcFile, atSec, out: file }), input.signal);
      if ((await stat(file)).size <= 0) throw new Error("empty_frame");
      const objectName = input.objectNameFor(index);
      await deps.uploadFile(file, objectName);
      out.push(objectName);
    } catch {
      input.signal.throwIfAborted();
      out.push(null);
    } finally {
      await rm(file, { force: true }).catch(() => {});
    }
  }
  return out;
}

// ─── 状态与存储 ────────────────────────────────────────

export type VideoBreakdownFailureCode = "too_long" | "unreadable" | "model_failed" | "interrupted" | "insufficient_credits" | "internal";
const FAILURE_TEXT: Record<VideoBreakdownFailureCode, string> = {
  too_long: `视频超过 ${Math.round(VIDEO_BREAKDOWN_MAX_SECONDS / 60)} 分钟，请裁短后重新上传`,
  unreadable: "视频无法解析，请换一个文件重新上传",
  model_failed: "拆解暂不可用，请稍后重新发起",
  interrupted: "任务因服务重启中断，请重新发起",
  insufficient_credits: "积分不足，请充值后重新发起",
  internal: "拆解失败，请稍后重新发起",
};

export type VideoBreakdownState = {
  jobId: string;
  userId: number;
  status: VideoBreakdownJobStatus;
  stage?: string;
  createdAt: string;
  updatedAt: string;
  heartbeatAt: string;
  instanceId: string;
  sourceGsUri: string;
  /** 本单实际扣费（管理员 0；扣费前为 0）。 */
  charged: number;
  /** 管理员 / supervisor：0 扣费。 */
  privileged?: boolean;
  /** 退款状态：none=无需退；pending=待退（退款失败，清扫 / 查询时重试）；done=已退。 */
  refund?: "none" | "pending" | "done";
  failureCode?: VideoBreakdownFailureCode;
};

export type VideoBreakdownStoredResult = {
  jobId: string;
  sourceGsUri: string;
  durationSec: number;
  result: VideoBreakdown;
  /** 下标与 result.segments 对应；裁切失败为 null。 */
  clipObjectNames: Array<string | null>;
  clipModes: Array<"copy" | "reencode" | null>;
  /** 下标与 result.overview.keyMoments 对应；抽帧失败为 null。旧结果无此字段。 */
  keyMomentFrameObjectNames?: Array<string | null>;
  usedBy: { channel: string; model: string; failuresZh: string[] };
  completedAt: string;
};

export type VideoBreakdownDeps = {
  bucket: () => string;
  /** 条件创建（已存在返回 created=false，不覆盖）。 */
  createIfAbsent: (objectName: string, buffer: Buffer, contentType: string) => Promise<{ created: boolean }>;
  /** 覆写（状态文件）。 */
  put: (objectName: string, buffer: Buffer, contentType: string) => Promise<void>;
  /** 读对象；不存在返回 null。 */
  read: (objectName: string) => Promise<Buffer | null>;
  stat: (objectName: string) => Promise<{ byteLength?: number } | null>;
  list: (prefix: string) => Promise<string[]>;
  sign: (gsUri: string, seconds: number) => string;
  call: typeof import("../gemini-audio").geminiAudioJsonWithFallback;
  downloadToFile: (gsUri: string, filePath: string, signal: AbortSignal) => Promise<number>;
  uploadFile: (filePath: string, objectName: string, contentType: string, signal: AbortSignal) => Promise<void>;
  run: MediaRun;
  balance: (userId: number) => Promise<{ totalAvailable: number }>;
  charge: (userId: number, amount: number, action: string, description: string, opts: { chargeKey: string }) => Promise<{ success: boolean; cost: number }>;
  refund: (input: { userId: number; chargeKey: string; refundKey: string; reason: string; actionForLog: string }) => Promise<{ refunded: number }>;
  now: () => number;
  tmpRoot: () => string;
  log: (line: string) => void;
};

const INSTANCE_ID = `${String(process.env.FLY_MACHINE_ID || os.hostname()).slice(0, 40)}:${randomUUID().slice(0, 8)}`;

function gcsNotFound(error: unknown) {
  return error instanceof Error && /^gcs_(?:stat|download)_failed:404(?:$|:)/.test(error.message);
}

const realDeps: VideoBreakdownDeps = {
  bucket: () => requireGcs().getGcsBucketName(),
  createIfAbsent: async (objectName, buffer, contentType) => {
    const r = await (await gcs()).uploadBufferToGcsIfAbsent({ objectName, buffer, contentType });
    return { created: r.created };
  },
  put: async (objectName, buffer, contentType) => {
    await (await gcs()).uploadBufferToGcs({ objectName, buffer, contentType });
  },
  read: async objectName => {
    const g = await gcs();
    try {
      return (await g.downloadGcsObjectVersioned({ gcsUri: `gs://${g.getGcsBucketName()}/${objectName}` })).buffer;
    } catch (error) {
      if (gcsNotFound(error)) return null;
      throw error;
    }
  },
  stat: async objectName => {
    const g = await gcs();
    try {
      return await g.statGcsObjectVersion({ gcsUri: `gs://${g.getGcsBucketName()}/${objectName}` });
    } catch (error) {
      if (gcsNotFound(error)) return null;
      throw error;
    }
  },
  list: async prefix => (await gcs()).listGcsObjectNamesByPrefix({ prefix, allPages: true }),
  sign: (gsUri, seconds) => requireGcs().signGsUriV4ReadUrl(gsUri, seconds),
  call: (async (input: Parameters<VideoBreakdownDeps["call"]>[0]) => (await import("../gemini-audio")).geminiAudioJsonWithFallback(input)) as VideoBreakdownDeps["call"],
  downloadToFile: async (gsUri, filePath, signal) => (await import("./postProduction")).fetchPostProdSourceToFile(gsUri, filePath, {
    signal, maxBytes: VIDEO_BREAKDOWN_MAX_BYTES, downloadTimeoutMs: 15 * 60_000,
  }),
  uploadFile: async (filePath, objectName, contentType, signal) => {
    // 片段 ≤ 原片，单段一般几 MB 到几十 MB；条件创建（重试不覆盖已上传片段）。
    const buffer = await readFile(filePath);
    signal.throwIfAborted();
    await (await gcs()).uploadBufferToGcsIfAbsent({ objectName, buffer, contentType, signal });
  },
  run: async (command, args, signal) => (await import("./postProduction")).runMediaTool(command, args, signal),
  balance: async userId => (await import("../credits")).getCredits(userId),
  charge: async (userId, amount, action, description, opts) => (await import("../credits")).deductCreditsAmount(userId, amount, action, description, opts),
  refund: async input => (await import("../credits")).refundChargeByKey(input),
  now: () => Date.now(),
  tmpRoot: () => os.tmpdir(),
  log: line => console.log(line),
};
let gcsModule: typeof import("./gcs") | undefined;
async function gcs() {
  gcsModule ??= await import("./gcs");
  return gcsModule;
}
function requireGcs(): typeof import("./gcs") {
  if (!gcsModule) throw new Error("gcs module not loaded");
  return gcsModule;
}

type Ctx = { d: VideoBreakdownDeps; bucket: string };
async function ctxOf(deps: Partial<VideoBreakdownDeps>): Promise<Ctx> {
  if (!deps.bucket || !deps.sign) await gcs();
  const d = { ...realDeps, ...deps };
  return { d, bucket: d.bucket() };
}

const json = (v: unknown) => Buffer.from(JSON.stringify(v));
const iso = (ms: number) => new Date(ms).toISOString();

async function readJson<T>(d: VideoBreakdownDeps, objectName: string): Promise<T | null> {
  const buf = await d.read(objectName);
  if (!buf) return null;
  try {
    return JSON.parse(buf.toString("utf8")) as T;
  } catch {
    return null;
  }
}

/** 进程内任务表：本机正在跑或排队的单（重启即空，靠 GCS 状态恢复）。 */
type LiveJob = { state: VideoBreakdownState; controller: AbortController };
const live = new Map<string, LiveJob>();
const waiting: Array<() => void> = [];
let running = 0;

/** 仅测试用：清进程内任务表。 */
export function resetVideoBreakdownRuntimeForTest() {
  live.clear();
  waiting.length = 0;
  running = 0;
}

async function acquireSlot(signal: AbortSignal) {
  if (running < VIDEO_BREAKDOWN_CONCURRENCY) { running += 1; return; }
  await new Promise<void>((resolve, reject) => {
    const go = () => { signal.removeEventListener("abort", onAbort); running += 1; resolve(); };
    const onAbort = () => { const i = waiting.indexOf(go); if (i >= 0) waiting.splice(i, 1); reject(signal.reason); };
    waiting.push(go);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
function releaseSlot() {
  running = Math.max(0, running - 1);
  waiting.shift()?.();
}

async function writeState(c: Ctx, state: VideoBreakdownState) {
  state.updatedAt = iso(c.d.now());
  await c.d.put(`${videoBreakdownJobPrefix(state.userId, state.jobId)}/state.json`, json(state), "application/json");
}

function ledgerName(kind: "open" | "closed", userId: number, jobId: string) {
  return `${VIDEO_BREAKDOWN_ROOT}/_ledger/${kind}/${userId}__${jobId}.json`;
}

/** 失败结单：写失败状态 → 按 chargeKey 原路全额退（refundKey 幂等）→ 退成才写结单登记；退款失败保留 pending 待清扫重试。 */
async function failJob(c: Ctx, state: VideoBreakdownState, code: VideoBreakdownFailureCode) {
  state.status = "failed";
  state.failureCode = code;
  state.refund = state.charged > 0 ? "pending" : "none";
  await writeState(c, state).catch(error => c.d.log(`[videoBreakdown] state_write_failed job=${state.jobId} ${error instanceof Error ? error.name : "error"}`));
  await settleRefund(c, state);
  c.d.log(`[videoBreakdown] failed job=${state.jobId} user=${state.userId} code=${code} refund=${state.refund}`);
}

async function settleRefund(c: Ctx, state: VideoBreakdownState) {
  if (state.refund === "pending") {
    try {
      const r = await c.d.refund({
        userId: state.userId,
        chargeKey: videoBreakdownChargeKey(state.userId, state.jobId),
        refundKey: videoBreakdownRefundKey(state.userId, state.jobId),
        reason: "拉片失败退回",
        actionForLog: "videoBreakdown",
      });
      // 账上查不到这笔扣费（扣费请求异常、实际未落账）：按未扣处理，前台不说「已退回」。
      if (!(r.refunded > 0)) state.charged = 0;
      state.refund = state.charged > 0 ? "done" : "none";
      await writeState(c, state);
    } catch (error) {
      c.d.log(`[videoBreakdown] refund_pending job=${state.jobId} user=${state.userId} ${error instanceof Error ? error.name : "error"}`);
      return;
    }
  }
  await c.d.createIfAbsent(ledgerName("closed", state.userId, state.jobId), json({ at: iso(c.d.now()), status: state.status }), "application/json").catch(() => {});
}

// ─── 对外：上传签名 / 开单 / 查询 / 恢复 ───────────────

export const videoBreakdownCreateUploadInputSchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  contentType: z.enum(VIDEO_BREAKDOWN_ACCEPT),
  bytes: z.number().int().positive().max(VIDEO_BREAKDOWN_MAX_BYTES),
}).strict();
export const videoBreakdownStartInputSchema = z.object({
  gcsUri: z.string().trim().min(1).max(1024),
  requestId: z.string().trim().min(8).max(128).regex(/^[A-Za-z0-9_-]+$/),
}).strict();
export const videoBreakdownGetInputSchema = z.object({ jobId: z.string().regex(VIDEO_BREAKDOWN_JOB_ID_RE) }).strict();

/** 业务错误：路由层映射为 TRPCError（message 即前台可见文案）。 */
export class VideoBreakdownError extends Error {
  constructor(readonly code: "BAD_REQUEST" | "NOT_FOUND" | "PAYMENT_REQUIRED" | "INTERNAL_SERVER_ERROR", message: string) {
    super(message);
    this.name = "VideoBreakdownError";
  }
}

export type VideoBreakdownUser = { id: number; role?: string | null };
const isPrivileged = (u: VideoBreakdownUser) => u.role === "admin" || u.role === "supervisor";

export async function createVideoBreakdownUpload(
  user: VideoBreakdownUser,
  input: z.infer<typeof videoBreakdownCreateUploadInputSchema>,
  signer?: typeof import("./gcs").createGcsSignedUploadUrl,
) {
  const sign = signer ?? (await gcs()).createGcsSignedUploadUrl;
  const signed = await sign({
    fileName: input.fileName,
    contentType: input.contentType,
    objectName: buildVideoBreakdownUploadObjectName(user.id, input.fileName, input.contentType),
    expiresInMinutes: 30,
    // 大小上限按声明字节签进链接：上传方须带返回的 requiredHeaders（x-goog-content-length-range），超限由存储侧拒收。
    maxBytes: input.bytes,
  });
  return { uploadUrl: signed.uploadUrl, gcsUri: signed.gcsUri, ...(signed.requiredHeaders ? { requiredHeaders: signed.requiredHeaders } : {}), contentType: input.contentType };
}

/**
 * 开单（幂等）：jobId = f(userId, requestId)。已登记直接返回同一 jobId，不重复扣费、不重复执行。
 * 顺序：归属核验 → 对象存在与大小 → 起步价余额预检 → request.json 条件创建占号 → 后台执行（实测时长 → 按片长扣费 → 看片）。
 * 并发同 requestId 只有一方占号成功，另一方直接返回同一 jobId；扣费 chargeKey 按 jobId 幂等。
 */
export async function startVideoBreakdown(
  user: VideoBreakdownUser,
  input: z.infer<typeof videoBreakdownStartInputSchema>,
  deps: Partial<VideoBreakdownDeps> = {},
): Promise<{ jobId: string; promise?: Promise<void> }> {
  const c = await ctxOf(deps);
  const jobId = deriveVideoBreakdownJobId(user.id, input.requestId);
  const prefix = videoBreakdownJobPrefix(user.id, jobId);
  if (live.has(jobId) || (await c.d.stat(`${prefix}/request.json`))) return { jobId };
  const source = verifyVideoBreakdownSource(user.id, input.gcsUri, c.bucket);
  if (!source) throw new VideoBreakdownError("BAD_REQUEST", "视频不属于本人或地址无效，请重新上传");
  const meta = await c.d.stat(source.objectName);
  if (!meta) throw new VideoBreakdownError("BAD_REQUEST", "视频尚未上传完成，请重新上传");
  if (typeof meta.byteLength === "number" && meta.byteLength > VIDEO_BREAKDOWN_MAX_BYTES)
    throw new VideoBreakdownError("BAD_REQUEST", `视频超过 ${Math.round(VIDEO_BREAKDOWN_MAX_BYTES / 1024 / 1024)}MB，请压缩后重新上传`);
  const privileged = isPrivileged(user);
  // 片长未知，开单只按起步价预检；按片长的实扣在 ffprobe 核对时长之后（runVideoBreakdownJob）。
  if (!privileged && (await c.d.balance(user.id)).totalAvailable < VIDEO_BREAKDOWN_BASE_CREDITS)
    throw new VideoBreakdownError("PAYMENT_REQUIRED", `拉片至少需要 ${VIDEO_BREAKDOWN_BASE_CREDITS} 积分，请充值后再试`);
  const model = resolveVideoBreakdownModel();
  const claim = await c.d.createIfAbsent(`${prefix}/request.json`, json({
    jobId, userId: user.id, requestId: input.requestId, sourceGsUri: `gs://${c.bucket}/${source.objectName}`,
    mimeType: source.mimeType, bytes: meta.byteLength ?? null, model, privileged, createdAt: iso(c.d.now()),
  }), "application/json");
  if (!claim.created) return { jobId };
  const now = iso(c.d.now());
  const state: VideoBreakdownState = {
    jobId, userId: user.id, status: "queued", stage: "upload_checked", createdAt: now, updatedAt: now, heartbeatAt: now,
    instanceId: INSTANCE_ID, sourceGsUri: `gs://${c.bucket}/${source.objectName}`, charged: 0, privileged,
  };
  const controller = new AbortController();
  live.set(jobId, { state, controller });
  try {
    await writeState(c, state);
    await c.d.createIfAbsent(ledgerName("open", user.id, jobId), json({ at: now }), "application/json");
  } catch {
    live.delete(jobId);
    await failJob(c, state, "internal");
    throw new VideoBreakdownError("INTERNAL_SERVER_ERROR", "拉片暂不可用，请稍后重新发起");
  }
  c.d.log(`[videoBreakdown] start job=${jobId} user=${user.id} model=${model}`);
  const promise = runVideoBreakdownJob(c, state, source.mimeType, model, controller).finally(() => live.delete(jobId));
  void promise.catch(() => {});
  return { jobId, promise };
}

async function runVideoBreakdownJob(c: Ctx, state: VideoBreakdownState, mimeType: string, model: string, controller: AbortController): Promise<void> {
  const prefix = videoBreakdownJobPrefix(state.userId, state.jobId);
  const timer = setTimeout(() => controller.abort(new Error("job_timeout")), VIDEO_BREAKDOWN_JOB_TIMEOUT_MS);
  timer.unref?.();
  const signal = controller.signal;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let dir: string | undefined;
  let failure: VideoBreakdownFailureCode = "internal";
  const stage = async (next: string) => {
    state.status = "running";
    state.stage = next;
    state.heartbeatAt = iso(c.d.now());
    await writeState(c, state);
  };
  try {
    await acquireSlot(signal);
    try {
      heartbeat = setInterval(() => {
        state.heartbeatAt = iso(c.d.now());
        void writeState(c, state).catch(() => {});
      }, VIDEO_BREAKDOWN_HEARTBEAT_MS);
      heartbeat.unref?.();
      await stage("upload_checked");
      dir = await mkdtemp(path.join(c.d.tmpRoot(), "video-breakdown-"));
      const ext = mimeType === "video/webm" ? "webm" : mimeType === "video/quicktime" ? "mov" : "mp4";
      const srcFile = path.join(dir, `source.${ext}`);
      failure = "unreadable";
      await c.d.downloadToFile(state.sourceGsUri, srcFile, signal);
      const probed = await probeVideoDuration(srcFile, c.d.run, signal);
      await c.d.createIfAbsent(`${prefix}/probe.json`, json(probed), "application/json");
      if (!probed.hasVideo || !(probed.durationSec > 0)) throw new Error("unreadable");
      if (probed.durationSec > VIDEO_BREAKDOWN_MAX_SECONDS + 0.5) { failure = "too_long"; throw new Error("too_long"); }
      const durationSec = r1(probed.durationSec);

      // 时长核对通过 → 按片长扣费（看片之前）。标价只用契约函数，不另写。
      const price = state.privileged ? 0 : videoBreakdownCredits(durationSec);
      await c.d.createIfAbsent(`${prefix}/pricing.json`, json({ durationSec, probedDurationSec: probed.durationSec, price, privileged: !!state.privileged }), "application/json");
      if (price > 0) {
        failure = "internal";
        // 先记待扣：扣费请求异常（可能已落账）时失败结单会按 chargeKey 查账原路退。
        state.charged = price;
        const deduction = await c.d.charge(state.userId, price, "videoBreakdown", "拉片（视频创作拆解）", { chargeKey: videoBreakdownChargeKey(state.userId, state.jobId) });
        if (!deduction.success) { state.charged = 0; failure = "insufficient_credits"; throw new Error("insufficient_credits"); }
        state.charged = deduction.cost;
        c.d.log(`[videoBreakdown] charged job=${state.jobId} user=${state.userId} credits=${deduction.cost} durationSec=${durationSec}`);
      }

      await stage("watching");
      failure = "model_failed";
      const basePrompt = buildVideoBreakdownPrompt({ durationSec, hasAudio: probed.hasAudio });
      // 三块可选内容的丢弃记录：每次 validate 重置，留下的是最终采用那一次的。
      let drops: VideoBreakdownOptionalDrop[] = [];
      const save = async (name: string, value: unknown) => {
        const r = await c.d.createIfAbsent(`${prefix}/evidence/${name}.json`, json(value), "application/json");
        const m = /^hop-(\d)-([a-z_]+?)(-repair)?-(raw|error|rejected|parsed|skipped)$/.exec(name);
        if (m) {
          const status = m[4] === "raw" ? ` status=${Number((value as { status?: unknown })?.status) || 0}` : "";
          c.d.log(`[videoBreakdown] hop job=${state.jobId} hop=${m[1]} channel=${m[2]}${m[3] ? " repair=1" : ""} result=${m[4]}${status}`);
        }
        return r;
      };
      const out = await c.d.call({
        media: { vertexFileUri: state.sourceGsUri, evolinkFileUri: () => c.d.sign(state.sourceGsUri, 2 * 3600) },
        mimeType,
        model,
        prompt: basePrompt,
        nativeSchema: buildVideoBreakdownNativeSchema(probed.hasAudio),
        schemaName: "video_breakdown_v1",
        validate: v => { drops = []; return parseAndFixVideoBreakdown(v, durationSec, { hasAudio: probed.hasAudio, drops }); },
        repairPrompt: (reason, badText) => buildVideoBreakdownRepairPrompt(basePrompt, reason, badText),
        save,
        temperature: VIDEO_BREAKDOWN_TEMPERATURE,
        videoFps: VIDEO_BREAKDOWN_VIDEO_FPS,
        maxOutputTokens: VIDEO_BREAKDOWN_MAX_OUTPUT_TOKENS,
        timeoutMs: VIDEO_BREAKDOWN_MODEL_TIMEOUT_MS,
      });
      signal.throwIfAborted();
      await stage("segmenting");
      failure = "internal";
      const result = out.value;
      if (drops.length) {
        await c.d.createIfAbsent(`${prefix}/evidence/optional-drops.json`, json({ channel: out.channel, drops }), "application/json").catch(() => {});
        for (const d of drops) c.d.log(`[videoBreakdown] optional_dropped job=${state.jobId} block=${d.block}${d.count ? ` count=${d.count}` : ""}`);
      }

      await stage("cutting");
      const outcomes = await cutVideoBreakdownClips({
        srcFile, dir, segments: result.segments, signal,
        objectNameFor: i => `${prefix}/clips/seg-${String(i).padStart(3, "0")}.mp4`,
      }, { run: c.d.run, uploadFile: (file, objectName) => c.d.uploadFile(file, objectName, "video/mp4", signal) });
      const failedClips = outcomes.filter(o => !o.objectName);
      const moments = result.overview.keyMoments ?? [];
      const frames = moments.length
        ? await extractKeyMomentFrames({
          srcFile, dir, durationSec, moments, signal,
          objectNameFor: i => `${prefix}/frames/km-${String(i).padStart(3, "0")}.jpg`,
        }, { run: c.d.run, uploadFile: (file, objectName) => c.d.uploadFile(file, objectName, "image/jpeg", signal) })
        : [];
      const failedFrames = frames.filter(f => !f).length;
      if (failedFrames) c.d.log(`[videoBreakdown] frames_partial job=${state.jobId} failed=${failedFrames}/${frames.length}`);
      if (failedClips.length) c.d.log(`[videoBreakdown] clips_partial job=${state.jobId} failed=${failedClips.length}/${outcomes.length}`);

      const stored: VideoBreakdownStoredResult = {
        jobId: state.jobId,
        sourceGsUri: state.sourceGsUri,
        durationSec,
        result,
        clipObjectNames: outcomes.map(o => o.objectName),
        clipModes: outcomes.map(o => (o.objectName ? o.mode ?? null : null)),
        keyMomentFrameObjectNames: frames,
        usedBy: { channel: out.channel, model: out.model, failuresZh: out.failuresZh },
        completedAt: iso(c.d.now()),
      };
      await c.d.createIfAbsent(`${prefix}/result.json`, json(stored), "application/json");
      state.status = "succeeded";
      state.stage = "done";
      state.refund = "none";
      await writeState(c, state);
      await c.d.createIfAbsent(ledgerName("closed", state.userId, state.jobId), json({ at: iso(c.d.now()), status: "succeeded" }), "application/json").catch(() => {});
      c.d.log(`[videoBreakdown] done job=${state.jobId} user=${state.userId} segments=${result.segments.length} clips=${outcomes.length - failedClips.length}/${outcomes.length} channel=${out.channel}`);
    } finally {
      releaseSlot();
    }
  } catch {
    // 失败原因只取阶段码（不把上游原文带进状态或前台）；各跳细节已在 evidence/ 与 hop 日志里。
    await failJob(c, state, failure);
  } finally {
    clearTimeout(timer);
    if (heartbeat) clearInterval(heartbeat);
    // 只清本单临时目录（原片下载副本与片段临时文件；GCS 上原片 / 片段 / 证据不动）。
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

function errorText(state: VideoBreakdownState): string {
  const base = FAILURE_TEXT[state.failureCode ?? "internal"];
  if (state.charged > 0 && state.refund === "done") return `${base}（积分已退回）`;
  if (state.charged > 0) return `${base}（积分退回处理中）`;
  return base;
}

/** 中断判定：不在本机任务表、进行中、心跳超过阈值。 */
function isStale(c: Ctx, state: VideoBreakdownState) {
  if (live.has(state.jobId)) return false;
  if (state.status !== "queued" && state.status !== "running") return false;
  const beat = Date.parse(state.heartbeatAt || state.updatedAt || "");
  return !Number.isFinite(beat) || c.d.now() - beat > VIDEO_BREAKDOWN_STALE_MS;
}

/** 读本人单的状态；中断单就地结单退款，待退款单重试退款。别人的 jobId 在本人前缀下不存在 → null。 */
async function loadState(c: Ctx, userId: number, jobId: string): Promise<VideoBreakdownState | null> {
  const mem = live.get(jobId);
  if (mem && mem.state.userId === userId) return mem.state;
  const state = await readJson<VideoBreakdownState>(c.d, `${videoBreakdownJobPrefix(userId, jobId)}/state.json`);
  if (!state || state.userId !== userId || state.jobId !== jobId) return null;
  if (isStale(c, state)) {
    c.d.log(`[videoBreakdown] interrupted job=${jobId} user=${userId}`);
    await failJob(c, state, "interrupted");
  } else if (state.status === "failed" && state.refund === "pending") {
    await settleRefund(c, state);
  }
  return state;
}

export async function getVideoBreakdown(
  user: VideoBreakdownUser,
  input: z.infer<typeof videoBreakdownGetInputSchema>,
  deps: Partial<VideoBreakdownDeps> = {},
): Promise<VideoBreakdownJobView> {
  const c = await ctxOf(deps);
  const state = await loadState(c, user.id, input.jobId);
  if (!state) throw new VideoBreakdownError("NOT_FOUND", "找不到这次拉片任务");
  const view: VideoBreakdownJobView = { jobId: state.jobId, status: state.status, ...(state.stage ? { stage: state.stage } : {}) };
  if (state.status === "failed") return { ...view, error: errorText(state) };
  if (state.status !== "succeeded") return view;
  const stored = await readJson<VideoBreakdownStoredResult>(c.d, `${videoBreakdownJobPrefix(user.id, input.jobId)}/result.json`);
  if (!stored) return { ...view, status: "failed", error: FAILURE_TEXT.internal };
  return {
    ...view,
    stage: "done",
    result: stored.result,
    sourceUrl: c.d.sign(stored.sourceGsUri, VIDEO_BREAKDOWN_SIGNED_URL_SECONDS),
    clipUrls: stored.clipObjectNames.map(name => (name ? c.d.sign(`gs://${c.bucket}/${name}`, VIDEO_BREAKDOWN_SIGNED_URL_SECONDS) : "")),
    ...(stored.result.overview.keyMoments?.length
      ? { keyMomentFrameUrls: stored.result.overview.keyMoments.map((_, i) => {
        const name = stored.keyMomentFrameObjectNames?.[i];
        return name ? c.d.sign(`gs://${c.bucket}/${name}`, VIDEO_BREAKDOWN_SIGNED_URL_SECONDS) : "";
      }) }
      : {}),
  };
}

/**
 * 启动 / 定时清扫：开单登记里没有结单登记的单逐个核对——中断（心跳超时且不在本机）则结单退款；
 * 已终态但退款待办则重试退款；终态补写结单登记。返回统计。
 */
export async function recoverInterruptedVideoBreakdownJobs(deps: Partial<VideoBreakdownDeps> = {}) {
  const c = await ctxOf(deps);
  const key = (n: string) => n.replace(/^.*\//, "").replace(/\.json$/, "");
  const [open, closed] = await Promise.all([
    c.d.list(`${VIDEO_BREAKDOWN_ROOT}/_ledger/open/`),
    c.d.list(`${VIDEO_BREAKDOWN_ROOT}/_ledger/closed/`),
  ]);
  const done = new Set(closed.map(key));
  const stats = { checked: 0, interrupted: 0, refundRetried: 0, closed: 0 };
  for (const name of open) {
    const k = key(name);
    if (done.has(k)) continue;
    const m = /^(\d+)__(vb_[a-f0-9]{32})$/.exec(k);
    if (!m) continue;
    stats.checked += 1;
    const userId = Number(m[1]);
    const jobId = m[2]!;
    try {
      const before = await readJson<VideoBreakdownState>(c.d, `${videoBreakdownJobPrefix(userId, jobId)}/state.json`);
      if (!before) continue;
      const wasStale = isStale(c, before);
      const pendingBefore = before.status === "failed" && before.refund === "pending";
      const state = await loadState(c, userId, jobId);
      if (!state) continue;
      if (wasStale) stats.interrupted += 1;
      if (pendingBefore) stats.refundRetried += 1;
      if (state.status === "succeeded" || (state.status === "failed" && state.refund !== "pending")) {
        await c.d.createIfAbsent(ledgerName("closed", userId, jobId), json({ at: iso(c.d.now()), status: state.status }), "application/json").catch(() => {});
        stats.closed += 1;
      }
    } catch (error) {
      c.d.log(`[videoBreakdown] recover_failed job=${jobId} ${error instanceof Error ? error.name : "error"}`);
    }
  }
  if (stats.interrupted || stats.refundRetried) c.d.log(`[videoBreakdown] recovery checked=${stats.checked} interrupted=${stats.interrupted} refundRetried=${stats.refundRetried} closed=${stats.closed}`);
  return stats;
}
