/** MV 歌曲编辑适配。合同核对：2026-10-16，https://docs.ttapi.io/openapi/en/suno.json。
 * 只提交一次；原始响应先永久归档。来源归属、收费确认和任务幂等由业务层负责。
 */
import { decodeTtapiSunoTaskId, encodeTtapiSunoTaskId, isTtapiSunoModel, resolveTtapiSunoMv, ttapiFetch, TtapiSunoRequestError, type TtapiSunoEvidenceSink, type TtapiSunoModel } from "./ttapiSunoMusic";

export type TtapiSunoEditFields = {
  prompt?: string; title?: string; style?: string; negativeTags?: string;
  duration?: number; vocalGender?: "Male" | "Female";
  styleWeight?: number; weirdnessConstraint?: number; audioWeight?: number; personaId?: string;
};
export type TtapiSunoOperationRequest =
  | ({ operation: "upload_cover"; model: TtapiSunoModel; audioUrl: string; instrumental: boolean } & TtapiSunoEditFields)
  | ({ operation: "extend"; musicId: string; continueAt: number } & TtapiSunoEditFields)
  | ({ operation: "upload_extend"; model: TtapiSunoModel; audioUrl: string; continueAt: number } & TtapiSunoEditFields)
  | { operation: "replace_section"; model: TtapiSunoModel; musicId: string; infillStartSec: number; infillEndSec: number; prompt?: string; infillLyrics?: string; title?: string; style?: string; negativeTags?: string }
  | { operation: "persona"; musicId: string; name: string; description?: string; vocalStartSec?: number; vocalEndSec?: number; style?: string }
  | { operation: "aligned_lyrics" | "stems_all" | "concat"; musicId: string };
export type TtapiSunoOperationOptions = { evidence: TtapiSunoEvidenceSink; abortSignal?: AbortSignal };
export type TtapiSunoAlignedWord = { text: string; startSec: number; endSec: number; success?: boolean };
export type TtapiSunoOperationResult =
  | { kind: "task"; taskId: string; jobId: string; rawData: Record<string, unknown> }
  | { kind: "persona"; personaId: string; rawData: Record<string, unknown> }
  | { kind: "alignment"; status: "completed" | "pending"; words: TtapiSunoAlignedWord[]; rawData: Record<string, unknown> };
export type TtapiSunoOperationMusic = { musicId: string; audioUrl?: string; title?: string; duration?: number; stemType?: string; rawData: Record<string, unknown> };
export type TtapiSunoOperationTask = { status: "pending" | "completed" | "failed"; progress: number; musics: TtapiSunoOperationMusic[]; rawData: Record<string, unknown>; reason?: string };
const paths = { upload_cover: "upload-cover", extend: "extend", upload_extend: "upload-extend", replace_section: "replace-section", persona: "persona", aligned_lyrics: "alignedLyrics", stems_all: "stems-all", concat: "concat" } as const;
const failed = new Set(["FAILED", "FAIL", "ERROR", "CANCELLED", "CANCELED", "TIMEOUT"]);
const record = (v: unknown): Record<string, unknown> | null => v !== null && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : null;
function text(v: unknown, label: string, max?: number, required = false): string | undefined {
  if (v === undefined && !required) return undefined;
  if (typeof v !== "string" || (required && !v.trim()) || (max != null && v.length > max)) throw new Error(`${label}无效或超过允许长度`);
  return v;
}
function seconds(v: unknown, label: string, min = 0): number {
  if (typeof v !== "number" || !Number.isFinite(v) || v < min) throw new Error(`${label}无效`);
  return v;
}
function https(v: unknown): v is string {
  if (typeof v !== "string") return false;
  try { const u = new URL(v); return u.protocol === "https:" && !u.username && !u.password; } catch { return false; }
}
function model(v: unknown): string {
  if (!isTtapiSunoModel(v)) throw new Error("音乐模型无效");
  return resolveTtapiSunoMv(v);
}
function editFields(req: TtapiSunoEditFields): Record<string, unknown> {
  const body: Record<string, unknown> = {
    prompt: text(req.prompt, "歌词", 5000), title: text(req.title, "标题", 80), tags: text(req.style, "风格", 1000),
    negative_tags: text(req.negativeTags, "排除风格"), persona_id: text(req.personaId, "演唱风格编号"),
    audio_format: "mp3", auto_lyrics: false, max_mode: false,
  };
  if (req.duration !== undefined) {
    if (!Number.isInteger(req.duration) || req.duration < 10 || req.duration > 360) throw new Error("目标时长须为10至360秒整数");
    body.duration = req.duration;
  }
  if (req.vocalGender !== undefined) {
    if (req.vocalGender !== "Male" && req.vocalGender !== "Female") throw new Error("演唱声部无效");
    body.vocal_gender = req.vocalGender;
  }
  for (const [key, value] of [["style_weight", req.styleWeight], ["weirdness_constraint", req.weirdnessConstraint], ["audio_weight", req.audioWeight]] as const) {
    if (value === undefined) continue;
    if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error("音乐控制参数须在0至1之间");
    body[key] = value;
  }
  return body;
}

/** 纯构造器用于业务层展示本次实际发送内容，不在此处读取凭证或发起请求。 */
export function buildTtapiSunoOperationRequest(req: TtapiSunoOperationRequest): { path: string; body: Record<string, unknown> } {
  if (!Object.hasOwn(paths, req.operation)) throw new Error("不支持的音乐操作");
  let body: Record<string, unknown>;
  switch (req.operation) {
    case "upload_cover":
    case "upload_extend": {
      if (!https(req.audioUrl)) throw new Error("参考音频须为HTTPS地址");
      body = { ...editFields(req), mv: model(req.model), audio_url: req.audioUrl };
      if (req.personaId && String(body.mv).startsWith("chirp-custom:")) throw new Error("自定义模型不能同时绑定演唱风格");
      if (req.operation === "upload_cover") {
        if (typeof req.instrumental !== "boolean") throw new Error("须明确是否纯器乐");
        if (!req.instrumental) text(req.prompt, "歌词", 5000, true);
        Object.assign(body, { custom: true, instrumental: req.instrumental });
      } else body.continue_at = seconds(req.continueAt, "续写起点", 1);
      break;
    }
    case "extend":
      body = { ...editFields(req), music_id: text(req.musicId, "歌曲编号", undefined, true), continue_at: seconds(req.continueAt, "续写起点") };
      break;
    case "replace_section": {
      const start = seconds(req.infillStartSec, "替换起点");
      const end = seconds(req.infillEndSec, "替换终点");
      if (end <= start) throw new Error("替换终点须晚于起点");
      body = { music_id: text(req.musicId, "歌曲编号", undefined, true), mv: model(req.model), infill_start_s: start, infill_end_s: end,
        prompt: text(req.prompt, "上下文歌词", 5000), infill_lyrics: text(req.infillLyrics, "替换歌词", 5000), title: text(req.title, "标题", 80), tags: text(req.style, "风格", 1000), negative_tags: text(req.negativeTags, "排除风格"), audio_format: "mp3", max_mode: false };
      break;
    }
    case "persona":
      body = { music_id: text(req.musicId, "歌曲编号", undefined, true), name: text(req.name, "演唱风格名称", undefined, true), describe: text(req.description, "演唱风格描述"), styles: text(req.style, "演唱风格") };
      if (req.vocalStartSec !== undefined || req.vocalEndSec !== undefined) {
        const start = seconds(req.vocalStartSec, "声乐片段起点");
        const end = seconds(req.vocalEndSec, "声乐片段终点");
        if (end <= start) throw new Error("声乐片段终点须晚于起点");
        Object.assign(body, { vocal_start_s: start, vocal_end_s: end });
      }
      break;
    default:
      body = { music_id: text(req.musicId, "歌曲编号", undefined, true), ...((req.operation === "stems_all" || req.operation === "concat") ? { audio_format: "mp3" } : {}) };
  }
  return { path: `/suno/v1/${paths[req.operation]}`, body: Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined)) };
}

function requireEvidence(opts: TtapiSunoOperationOptions): void {
  if (typeof opts?.evidence !== "function") throw new Error("缺少永久证据归档器，未提交音乐操作");
}
export async function submitTtapiSunoOperation(req: TtapiSunoOperationRequest, opts: TtapiSunoOperationOptions): Promise<TtapiSunoOperationResult> {
  requireEvidence(opts);
  const { path, body } = buildTtapiSunoOperationRequest(req);
  const raw = await ttapiFetch(path, { method: "POST", body: JSON.stringify(body), ...opts });
  const root = record(raw);
  const data = record(root?.data);
  const status = String(root?.status || "").toUpperCase();
  if (failed.has(status) && !data?.jobId) throw new TtapiSunoRequestError("rejected", false, 200);
  if (status !== "SUCCESS" || !data) throw new TtapiSunoRequestError("invalid_response", true);
  if (req.operation === "persona") {
    if (typeof data.persona_id !== "string" || !data.persona_id.trim()) throw new TtapiSunoRequestError("invalid_response", true);
    return { kind: "persona", personaId: data.persona_id, rawData: data };
  }
  if (req.operation === "aligned_lyrics") {
    // 未结束时不伪造jobId，也不自动重发同步POST；由业务层保留原回执提示待核对。
    const complete = String(data.status || "").toLowerCase() === "complete";
    if (!complete) return { kind: "alignment", status: "pending", words: [], rawData: data };
    if (!Array.isArray(data.alignment) || !data.alignment.length) throw new TtapiSunoRequestError("invalid_response", true);
    const words = data.alignment.map((item): TtapiSunoAlignedWord => {
      const row = record(item);
      if (!row || typeof row.word !== "string" || !row.word.trim() || typeof row.start_s !== "number" || typeof row.end_s !== "number" || !Number.isFinite(row.start_s) || !Number.isFinite(row.end_s) || row.start_s < 0 || row.end_s <= row.start_s || (row.success !== undefined && typeof row.success !== "boolean")) throw new TtapiSunoRequestError("invalid_response", true);
      return { text: row.word, startSec: row.start_s, endSec: row.end_s, ...(typeof row.success === "boolean" ? { success: row.success } : {}) };
    });
    return { kind: "alignment", status: "completed", words, rawData: data };
  }
  if (typeof data.jobId !== "string") throw new TtapiSunoRequestError("invalid_response", true);
  return { kind: "task", taskId: encodeTtapiSunoTaskId(data.jobId), jobId: data.jobId, rawData: data };
}

/** 保留每一条（包括未就绪条目），不得把分轨套进双候选规则，也不合并同URL条目。 */
export async function getTtapiSunoOperationTask(taskId: string, opts: TtapiSunoOperationOptions): Promise<TtapiSunoOperationTask> {
  requireEvidence(opts);
  const jobId = decodeTtapiSunoTaskId(taskId);
  if (!jobId) throw new Error("音乐任务编号无效");
  const raw = await ttapiFetch(`/suno/v2/fetch?jobId=${encodeURIComponent(jobId)}`, opts);
  const root = record(raw);
  const data = record(root?.data);
  if (!root || !data) throw new TtapiSunoRequestError("invalid_response", false);
  // 响应带任务身份时必须与本次查询一致，防止把其它任务音频采用到当前歌曲。
  if ([root.jobId, data.jobId].some(id => id !== undefined && id !== jobId)) throw new TtapiSunoRequestError("invalid_response", false);
  const status = String(root.status || "").toUpperCase();
  const list = data.musics == null ? [] : data.musics;
  if (!Array.isArray(list)) throw new TtapiSunoRequestError("invalid_response", false);
  const musics = list.map((item): TtapiSunoOperationMusic => {
    const row = record(item);
    if (!row) throw new TtapiSunoRequestError("invalid_response", false);
    const duration = typeof row.duration === "number" || typeof row.duration === "string" && row.duration.trim() ? Number(row.duration) : NaN;
    return { musicId: typeof row.musicId === "string" ? row.musicId : "", audioUrl: typeof row.audioUrl === "string" ? row.audioUrl : undefined,
      title: typeof row.title === "string" ? row.title : undefined, duration: Number.isFinite(duration) && duration > 0 ? duration : undefined,
      stemType: typeof row.stemType === "string" ? row.stemType : typeof row.stem_type === "string" ? row.stem_type : undefined, rawData: row };
  });
  const progress = Math.max(0, Math.min(100, Number(String(data.progress ?? "0").replace("%", "")) || 0));
  if (failed.has(status)) return { status: "failed", progress, musics, rawData: data, reason: "音乐处理未成功，请保留本次任务" };
  if (status === "SUCCESS") {
    if (!musics.length || musics.some(m => !m.musicId.trim() || !https(m.audioUrl))) throw new TtapiSunoRequestError("invalid_response", false);
    return { status: "completed", progress: 100, musics, rawData: data };
  }
  return { status: "pending", progress, musics, rawData: data };
}
