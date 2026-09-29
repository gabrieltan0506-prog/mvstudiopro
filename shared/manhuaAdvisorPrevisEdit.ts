import { previsPiggybackSetDownSchema } from "./manhuaPrevisPiggyback";
import { z } from "zod";
import { previsPlaybackDuration } from "./manhuaPrevisPlayback";
import { manhuaPrevisSpecSchema, previsActorSchema, PREVIS_ACTION_KINDS, type ManhuaPrevisSpec, type ManhuaPrevisStudio, manhuaPrevisRequestSchema, type ManhuaPrevisRequest } from "./manhuaPrevis";

const safeText = (max: number) => z.string().trim().min(1).max(max).refine(v => !/(?:https?|gs|data|blob):|\bbearer\s|\bsk-[a-z0-9_-]{12,}/i.test(v), "调度上下文不得包含媒体地址或凭证");
export const advisorPrevisTargetSchema = z.object({
  directionCardId: safeText(100).optional(), directionCardVersion: safeText(100).optional(),
  clipId: safeText(160), scopeId: z.string().uuid(), specJson: safeText(30000),
  previousPreviewSpecJson: safeText(30000).optional(),
  previousPreviewRequestId: z.string().uuid().optional(),
}).strict().superRefine((v, ctx) => {
  try {
    for (const raw of [v.specJson, v.previousPreviewSpecJson].filter(Boolean)) {
      const spec = manhuaPrevisSpecSchema.parse(JSON.parse(raw!));
      if (spec.scriptSource || spec.actors.some(a => a.assetRef || a.riggedModel)) throw new Error("白模上下文不接受素材或模型身份");
    }
  }
  catch { ctx.addIssue({ code: "custom", message: "当前白模规格未通过检查，请先修正配置" }); }
});
export type AdvisorPrevisTarget = z.infer<typeof advisorPrevisTargetSchema>;

/** 白名单投影：保留动作条件，排除模型任务、素材身份与媒体位置。 */
export function advisorPrevisSpecJson(spec: ManhuaPrevisStudio["spec"]): string {
  const { scriptSource: _source, ...rest } = spec;
  return JSON.stringify({ ...rest, actors: spec.actors.map(({ assetRef: _asset, riggedModel: _rig, ...actor }) => actor) });
}
export function makeAdvisorPrevisTarget(clipId: string, studio: ManhuaPrevisStudio, previewRequestId?: string): AdvisorPrevisTarget {
  const specJson = advisorPrevisSpecJson(studio.spec);
  const preview = previewRequestId
    ? studio.history.find(h => h.requestId === previewRequestId)
    : [...studio.history].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  if (previewRequestId && !preview) throw new Error("所选白模版本尚未恢复，请重新预览后再打开顾问");
  return advisorPrevisTargetSchema.parse({ clipId, scopeId: studio.scopeId, specJson,
    ...(preview ? { previousPreviewRequestId: preview.requestId, previousPreviewSpecJson: advisorPrevisSpecJson(preview.spec) } : {}) });
}
/** 已完成的独立试看只作为下轮输入；不写入工作流或采用状态。 */
export const advisorPrevisVideoSourceSchema = z.object({
  target: advisorPrevisTargetSchema, requestId: z.string().uuid(), specJson: safeText(30000),
}).strict();
export type AdvisorPrevisVideoSource = z.infer<typeof advisorPrevisVideoSourceSchema>;
export function withAdvisorPrevisVideo(target: AdvisorPrevisTarget, source: AdvisorPrevisVideoSource | null): AdvisorPrevisTarget {
  if (!source || target.clipId !== source.target.clipId || target.scopeId !== source.target.scopeId) return target;
  return advisorPrevisTargetSchema.parse({ ...target, previousPreviewRequestId: source.requestId, previousPreviewSpecJson: source.specJson });
}
const actorEdit = previsActorSchema.pick({ id: true, start: true, end: true, moveStartSec: true, moveEndSec: true, facingDeg: true, motionRoute: true, actions: true, hitReaction: true }).partial().required({ id: true }).strict();
export const advisorPrevisPatchSchema = z.object({
  kind: z.literal("previs_edit_v1"), summaryZh: safeText(1200),
  unsupportedZh: z.array(safeText(300)).max(12),
  cameras: manhuaPrevisSpecSchema.shape.cameras.optional(),
  actors: z.array(actorEdit).max(6).optional(),
  setDown: previsPiggybackSetDownSchema.optional(),
}).strict().refine(v => Boolean(v.cameras || v.actors?.length || v.setDown || v.unsupportedZh.length), "顾问未提供有效修改或能力说明");
export type AdvisorPrevisPatch = z.infer<typeof advisorPrevisPatchSchema>;
export const advisorPrevisCandidateSchema = z.object({ target: advisorPrevisTargetSchema, patch: advisorPrevisPatchSchema }).strict();
export type AdvisorPrevisCandidate = z.infer<typeof advisorPrevisCandidateSchema>;

export function parseAdvisorPrevisPatch(answer: string): AdvisorPrevisPatch {
  const fence = answer.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return advisorPrevisPatchSchema.parse(JSON.parse(fence ? fence[1] : answer));
}

export function applyAdvisorPrevisPatch(spec: ManhuaPrevisSpec, patch: AdvisorPrevisPatch): ManhuaPrevisSpec {
  if (patch.unsupportedZh.length) throw new Error(`还有未支持的要求：${patch.unsupportedZh.join("；")}。请调整要求后重新咨询。`);
  const edits = patch.actors || [];
  if (new Set(edits.map(a => a.id)).size !== edits.length) throw new Error("角色修改重复，未应用");
  if (edits.some(e => !spec.actors.some(a => a.id === e.id))) throw new Error("顾问引用了本段不存在的角色，未应用");
  if (patch.setDown && !spec.piggyback) throw new Error("当前没有背负关系，不能凭空放下乘员");
  const next = manhuaPrevisSpecSchema.parse({ ...spec,
    ...(patch.setDown ? {piggyback: {...spec.piggyback!, setDown: patch.setDown}} : {}),
    cameras: patch.cameras ?? spec.cameras,
    actors: spec.actors.map(a => ({ ...a, ...edits.find(e => e.id === a.id) })),
  });
  if (JSON.stringify(next) === JSON.stringify(manhuaPrevisSpecSchema.parse(spec))) throw new Error("顾问没有给出实际配置变化");
  return next;
}

/** 应用仍须走宿主持久化；历史、已采用参考和任务均保留。 */
export function applyAdvisorPrevisCandidate(clipId: string, studio: ManhuaPrevisStudio, candidate: AdvisorPrevisCandidate): ManhuaPrevisStudio {
  const { target, patch } = advisorPrevisCandidateSchema.parse(candidate);
  if (clipId !== target.clipId || studio.scopeId !== target.scopeId) throw new Error("这份建议属于其他片段，未应用");
  if (studio.pending) throw new Error("本段白模仍在处理，请等任务结束后再调整");
  if (advisorPrevisSpecJson(studio.spec) !== target.specJson) throw new Error("本段配置已变化，请基于最新配置重新咨询");
  const spec = applyAdvisorPrevisPatch(manhuaPrevisSpecSchema.parse(studio.spec), patch);
  const { draftCameraPromptZh: _oldCamera, draftTempoZh: _oldTempo, ...rest } = studio;
  return { ...rest, spec, specHistory: [...(studio.specHistory || []), { spec: studio.spec, createdAt: new Date().toISOString(), reasonZh: "应用创作顾问运镜与动作建议前的配置" }] };
}

/** 与原问答 JSON 外壳兼容，answer 内放候选；不赋予模型执行权限。 */
export const advisorPrevisTrialSchema = z.object({ candidate: advisorPrevisCandidateSchema, request: manhuaPrevisRequestSchema }).strict();
export type AdvisorPrevisTrial = z.infer<typeof advisorPrevisTrialSchema>;
export const advisorPrevisReceiptSchema = z.object({
  jobId: z.string().min(1), status: z.literal("succeeded"), params: manhuaPrevisRequestSchema,
  output: z.object({ requestId: z.string().uuid(), clipId: z.string(), gcsUri: z.string().startsWith("gs://"),
    url: z.string().refine(v => v.startsWith("https://") || v.startsWith("/api/manhua-previs-media/")), durationSec: z.number().positive(),
    audio: manhuaPrevisRequestSchema.shape.audio, quality: manhuaPrevisRequestSchema.shape.quality,
  }).passthrough(),
}).passthrough();
export type AdvisorPrevisReceipt = z.infer<typeof advisorPrevisReceiptSchema>;
export function validateAdvisorPrevisReceipt(request: ManhuaPrevisRequest, raw: unknown): AdvisorPrevisReceipt {
  const res = advisorPrevisReceiptSchema.parse(raw);
  if (JSON.stringify(res.params) !== JSON.stringify(manhuaPrevisRequestSchema.parse(request)) || res.output.requestId !== request.requestId || res.output.clipId !== request.clipId || Math.abs(res.output.durationSec - previsPlaybackDuration(request.spec)) > 0.05) throw new Error("试看回执与当前请求不一致，不能应用");
  if (JSON.stringify(res.output.audio) !== JSON.stringify(request.audio) || res.output.quality !== request.quality) throw new Error("试看音轨或画质回执不一致，不能应用");
  return res;
}
/** 独立 scope 保证未确认试看不会混入原片段恢复历史。只读现有工作流。 */
export function prepareAdvisorPrevisTrial(clipId: string, studio: ManhuaPrevisStudio, candidate: AdvisorPrevisCandidate): AdvisorPrevisTrial {
  const preview = applyAdvisorPrevisCandidate(clipId, studio, candidate);
  return { candidate, request: manhuaPrevisRequestSchema.parse({ requestId: crypto.randomUUID(), scopeId: crypto.randomUUID(), clipId, spec: preview.spec }) };
}
export function adoptAdvisorPrevisTrial(clipId: string, studio: ManhuaPrevisStudio, trial: AdvisorPrevisTrial, rawReceipt: unknown): ManhuaPrevisStudio {
  const receipt = validateAdvisorPrevisReceipt(trial.request, rawReceipt);
  const next = applyAdvisorPrevisCandidate(clipId, studio, trial.candidate);
  if (JSON.stringify(next.spec) !== JSON.stringify(trial.request.spec)) throw new Error("试看使用的配置不一致，不能应用");
  const confirmedAt = new Date().toISOString();
  const specHistory = [...(next.specHistory || [])];
  specHistory[specHistory.length - 1] = { spec: studio.spec, createdAt: confirmedAt, reasonZh: `用户确认应用顾问试看 ${trial.request.requestId}；${trial.candidate.patch.summaryZh}` };
  return { ...next, specHistory, history: [...next.history.filter(h => h.requestId !== receipt.params.requestId), {
    jobId: receipt.jobId, requestId: receipt.params.requestId, gcsUri: receipt.output.gcsUri, url: receipt.output.url,
    durationSec: receipt.output.durationSec, createdAt: new Date().toISOString(), spec: receipt.params.spec,
    ...(receipt.params.audio ? { audio: receipt.params.audio } : {}), ...(receipt.params.quality ? { quality: receipt.params.quality } : {}),
  }] };
}
export const ADVISOR_PREVIS_EDIT_INSTRUCTIONS = `\n【白模调度候选模式】
当前上下文提供的是指定片段的完整编辑规格。用户用自然语言要求修改动作或摄影机时，先结合剧情、场景、已有导演手法与运镜代码配方给出调度提案。在summaryZh说明剧情目的、为什么使用这组景别/机位/走位、与上一版差异及可继续调整的方向；不可只列数字。本模式覆盖普通问答的answer字符串格式：在外层JSON的answer字段直接放一个JSON对象，不要代码围栏，不要将对象或换行二次转义。先输出summaryZh，供用户流式阅读，随后给出完整候选。answer对象内容为：
{"kind":"previs_edit_v1","summaryZh":"逐项说明哪些秒窗/人物/机位改了什么","unsupportedZh":[],"cameras":[完整的替换机位数组],"actors":[{"id":"原有角色ID","motionRoute":[{"timeSec":0,"position":[0,0],"facingDeg":0}],"start":[0,0],"end":[0,0],"moveStartSec":0,"moveEndSec":10,"facingDeg":0,"actions":[{"kind":"walk","startSec":0,"endSec":10}]}]}
仅填写需要修改的cameras或actors；actors每项必须保留原id，只填改动字段，不能改变身份、模型、角色数、时长、画幅、音频、参考、在场区间或背负双方身份。可以仅通过setDown为已有背负增加完整放下时序。不得输出Python/命令/URL。unsupportedZh只填写用户明确提出且无法实现的要求；用户没有要求的音效、材质、表情、手持抖动等能力边界不要列入。用户说保留动作与对白是锁定条件，不是不支持项。只调整镜头即可满足时，unsupportedZh必须为[]。真正不支持的要求不能悄悄忽略，该候选不会应用。
动作类型：${PREVIS_ACTION_KINDS.join("、")}。动作不能重叠；look需要lookAtId（本段角色ID或camera），turn需要facingDeg，其他动作不填这些字段。移动路线2–12点、按秒严格递增，从0到时长-1/24；坐标范围±12米、朝向±180度；路线起末点同步start/end。背负承载者在放下前只走位/静立，乘员不独立行动。完整放下用answer对象的setDown:{startSec,groundSec,releaseSec,endSec}：依次为降低开始、落地坐稳、松手、起身结束，各阶段至少0.75/0.25/0.25秒，按24帧对齐，endSec不晚于时长-1/24。期间承载者须停止位移与转身，动作表不要叠加walk；之后可独立走位，乘员自动留在放下地点坐稳。双方路线仍必须相同，乘员落地后的固定由渲染器执行。四足limp_front_left覆盖整段；四足受击另用该actor的hitReaction:{sourceActorId,startSec,contactSec,endSec}，绑定本段出掌者和其strike窗口中的接触时刻。受击不会取消跛行或套用人体动作。
相机1–8个，连续覆盖0到本段时长；startSec/endSec，position/target是[x,y,z]米，x/y±30、z0.2–15；lens/endLens是18–65mm整数（焦距增大视角收紧）；可填endPosition/endTarget，或orbitDeg±180与orbitRise±8（须与非零环绕同用），两种运动写法二选一：直线模式只填endPosition/endTarget，不填orbitDeg/orbitRise；环绕模式只填orbitDeg/orbitRise，删除endPosition/endTarget。零值也不能作为兼容占位。时序对齐24fps，贴合当前人物真实位置、朝向及动作目标。不能每镜机械套FOV/下降/旋转，需有剧情触发并保持轴线。
可分别指定motionWindow和lensWindow，格式均为{startSec,endSec}，是本镜内的绝对秒窗，须对齐24帧且至少两帧。窗前保持起点，窗内完成移动或变焦，窗后保持终点；不填则沿用整镜平滑。motionWindow需要移动终点或环绕，lensWindow需要endLens。短促FOV冲击要用短lensWindow，而非把变焦摊满整镜；快动后停、慢移后切须写入对应秒窗，不只口头描述。
取景必须按焦距与真实站位计算，不得只在summaryZh声称“拉远”。横屏采用36mm宽传感器，距离d米处水平视域约为d×36/lens米，竖向视域还需除以画幅宽高比；例如16:9、55mm、3米距离只有约1.10米高视域，会切掉全身和放下动作。背负及完整放下镜头须同时容纳承载者、乘员从头到脚和落地点；出掌受击镜头须交代出掌者与受击者，冲向对手及结尾对峙须同时交代双方。按整镜运动与最长焦距留边距，不以起帧可见代替整镜可见；优先沿原侧别退机位，保持轴线，避免以近景遮掉关键动作。
上下文如有previousPreviewSpecJson表示上次未应用的试看。追问时延续上次试看并按新需求修正，输出相对specJson原工作流的累计修改，不能丢掉用户此前要求。只生成可继续修改的调度提案，用户明确说生成试看或点击生成试看后，由系统校验合格候选并在当前3D页渲染；只讨论时不渲染，方案回包本身不代表视频已生成；不满意可继续聊并修正提案再生成。用户满意点击应用之后才写回工作流，不声称已应用或审片通过。answer对象序列化后总长不超过11000字符。`;
