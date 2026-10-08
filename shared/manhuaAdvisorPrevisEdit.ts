import { advisorPrevisShotSourceSchema } from "./manhuaAdvisorPrevisShotSource";
import { previsPiggybackSchema, previsPiggybackSetDownSchema, previsPiggybackBlockBowlSchema } from "./manhuaPrevisPiggyback";
import { z } from "zod";
import { previsAnimationReceipt } from "./manhuaPrevisAnimation";
import { previsPlaybackDuration } from "./manhuaPrevisPlayback";
import { PREVIS_MAX_ACTORS, manhuaPrevisSpecSchema, previsActorSchema, PREVIS_ACTION_KINDS, type ManhuaPrevisSpec, type ManhuaPrevisStudio, manhuaPrevisRequestSchema, type ManhuaPrevisRequest } from "./manhuaPrevis";

const safeText = (max: number) => z.string().trim().min(1).max(max).refine(v => !/(?:https?|gs|data|blob):|\bbearer\s|\bsk-[a-z0-9_-]{12,}/i.test(v), "调度上下文不得包含媒体地址或凭证");
export const advisorPrevisTargetSchema = z.object({
  directionCardId: safeText(100).optional(), directionCardVersion: safeText(100).optional(),
  clipId: safeText(160), scopeId: z.string().uuid(), specJson: safeText(30000),
  shotSource: advisorPrevisShotSourceSchema.optional(),
  previousPreviewSpecJson: safeText(30000).optional(),
  previousPreviewRequestId: z.string().uuid().optional(),
}).strict().superRefine((v, ctx) => {
  try {
    if (v.shotSource && (v.shotSource.clipId !== v.clipId || Math.abs(v.shotSource.shots.at(-1)!.endSec - JSON.parse(v.specJson).durationSec) > 0.00001)) {
      ctx.addIssue({ code: "custom", message: "分镜来源与当前片段或时长不一致，请重新打开顾问" });
    }
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
    ...(studio.advisorShotSource ? { shotSource: studio.advisorShotSource } : {}),
    ...(preview ? { previousPreviewRequestId: preview.requestId, previousPreviewSpecJson: advisorPrevisSpecJson(preview.spec) } : {}) });
}
/** 已完成的独立试看只作为下轮输入；不写入工作流或采用状态。 */
export const advisorPrevisVideoSourceSchema = z.object({
  target: advisorPrevisTargetSchema, requestId: z.string().uuid(), specJson: safeText(30000),
}).strict();
export type AdvisorPrevisVideoSource = z.infer<typeof advisorPrevisVideoSourceSchema>;
export function withAdvisorPrevisVideo(target: AdvisorPrevisTarget, source: AdvisorPrevisVideoSource | null): AdvisorPrevisTarget {
  if (!source || target.clipId !== source.target.clipId || target.scopeId !== source.target.scopeId || JSON.stringify(target.shotSource) !== JSON.stringify(source.target.shotSource)) return target;
  return advisorPrevisTargetSchema.parse({ ...target, previousPreviewRequestId: source.requestId, previousPreviewSpecJson: source.specJson });
}
const actorEdit = previsActorSchema.pick({ id: true, nameZh: true, colorIndex: true, shape: true, visibleRanges: true, start: true, end: true, moveStartSec: true, moveEndSec: true, facingDeg: true, motionRoute: true, actions: true, hitReaction: true, quadrupedFall: true, humanPosture: true }).partial().required({ id: true }).strict();
export const advisorPrevisPatchSchema = z.object({
  kind: z.literal("previs_edit_v1"), summaryZh: safeText(1200),
  unsupportedZh: z.array(safeText(300)).max(12),
  shotCoverage: z.array(z.object({ index: z.number().int().positive(), status: z.enum(["covered", "unsupported"]), actorIds: z.array(safeText(100)).max(PREVIS_MAX_ACTORS), reasonZh: safeText(1200) }).strict()).min(1).max(120).optional(),
  cameras: manhuaPrevisSpecSchema.shape.cameras.optional(),
  actors: z.array(actorEdit).max(PREVIS_MAX_ACTORS).optional(),
  piggyback: previsPiggybackSchema.optional(),
  setDown: previsPiggybackSetDownSchema.optional(),
  blockBowl: previsPiggybackBlockBowlSchema.optional(),
  sceneEffects: manhuaPrevisSpecSchema.shape.sceneEffects,
  storyProps: manhuaPrevisSpecSchema.shape.storyProps,
  handContacts: manhuaPrevisSpecSchema.shape.handContacts,
  interactions: manhuaPrevisSpecSchema.shape.interactions,
}).strict().refine(v => Boolean(v.cameras || v.actors?.length || v.piggyback || v.setDown || v.blockBowl || v.interactions || v.sceneEffects || v.storyProps || v.handContacts || v.unsupportedZh.length), "顾问未提供有效修改或能力说明");
export type AdvisorPrevisPatch = z.infer<typeof advisorPrevisPatchSchema>;
export const advisorPrevisCandidateSchema = z.object({ target: advisorPrevisTargetSchema, patch: advisorPrevisPatchSchema }).strict();
export type AdvisorPrevisCandidate = z.infer<typeof advisorPrevisCandidateSchema>;

export function parseAdvisorPrevisPatch(answer: string): AdvisorPrevisPatch {
  const fence = answer.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = JSON.parse(fence ? fence[1] : answer);
  // 只纠正模型四位小数表达帧秒位的舍入误差；不移动真实非帧时刻。
  const timeKeys = new Set(["timeSec", "startSec", "endSec", "contactSec", "moveStartSec", "moveEndSec", "groundSec", "foldSec", "releaseSec"]);
  const snap = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(snap);
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(Object.entries(value).map(([key,v])=>[key,
      timeKeys.has(key) && typeof v === "number" && Math.abs(v-Math.round(v*24)/24)<=.00005
        ? Math.round(v*24)/24 : snap(v)]));
  };
  return advisorPrevisPatchSchema.parse(snap(raw));
}

/** 这里只检查逐镜计划声明，不把覆盖声明当作动画画面验收。 */
export function validateAdvisorPrevisShotCoverage(target: AdvisorPrevisTarget, patch: AdvisorPrevisPatch, allowUnsupported = false): void {
  if (!target.shotSource) return;
  const rows = patch.shotCoverage;
  if (!rows || rows.length !== target.shotSource.shots.length || new Set(rows.map(row => row.index)).size !== rows.length ||
    rows.some(row => !target.shotSource!.shots.some(shot => shot.index === row.index))) throw new Error("顾问未逐镜覆盖本段原文，请补齐每镜计划或明确未支持项");
  const spec = manhuaPrevisSpecSchema.parse(JSON.parse(target.specJson));
  if (rows.some(row => new Set(row.actorIds).size !== row.actorIds.length || row.actorIds.some(id => !spec.actors.some(actor => actor.id === id)))) throw new Error("逐镜计划引用了重复或不存在的人物，未应用");
  const unsupported = rows.filter(row => row.status === "unsupported");
  if (!allowUnsupported && unsupported.length) throw new Error(`仍有未支持的分镜：${unsupported.map(row => `镜${row.index}：${row.reasonZh}`).join("；")}。原配置保留`);
}

export function applyAdvisorPrevisPatch(spec: ManhuaPrevisSpec, patch: AdvisorPrevisPatch): ManhuaPrevisSpec {
  if (patch.unsupportedZh.length) throw new Error(`还有未支持的要求：${patch.unsupportedZh.join("；")}。请调整要求后重新咨询。`);
  const edits = patch.actors || [];
  if (new Set(edits.map(a => a.id)).size !== edits.length) throw new Error("角色修改重复，未应用");
  if (edits.some(e => !spec.actors.some(a => a.id === e.id))) throw new Error("顾问引用了本段不存在的角色，未应用");
  if (spec.piggyback && patch.piggyback &&
      (spec.piggyback.carrierId !== patch.piggyback.carrierId || spec.piggyback.passengerId !== patch.piggyback.passengerId))
    throw new Error("已有背负双方身份已锁定，不能通过方案换人");
  const pair = patch.piggyback ?? spec.piggyback;
  if ((patch.setDown || patch.blockBowl) && !pair) throw new Error("当前没有背负关系，不能编排放下或挡碗");
  const next = manhuaPrevisSpecSchema.parse({ ...spec,
    ...((patch.piggyback || patch.setDown || patch.blockBowl) ? {piggyback: {...spec.piggyback, ...pair!, ...(patch.setDown ? {setDown:patch.setDown} : {}), ...(patch.blockBowl ? {blockBowl:patch.blockBowl} : {})}} : {}),
    interactions: patch.interactions ?? spec.interactions,
    cameras: patch.cameras ?? spec.cameras,
    sceneEffects: patch.sceneEffects ?? spec.sceneEffects,
    storyProps: patch.storyProps ?? spec.storyProps,
    handContacts: patch.handContacts ?? spec.handContacts,
    actors: spec.actors.map(a => {
      const edit=edits.find(e=>e.id===a.id), route=edit?.motionRoute;
      // 模型可原样回传身份元数据，但不得借候选修改身份或在场状态。
      for (const key of ["nameZh", "colorIndex", "shape", "visibleRanges"] as const) {
        if (edit?.[key] !== undefined && JSON.stringify(edit[key]) !== JSON.stringify(a[key])) {
          throw new Error(`顾问修改了角色锁定字段${key}，未应用`);
        }
      }
      // 路线是新位置的真源；只补省略的冗余字段，显式冲突仍交给严格schema拒绝。
      return {...a,...(route ? {start:route[0].position,end:route.at(-1)!.position,facingDeg:route[0].facingDeg} : {}),...edit};
    }),
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
  if (JSON.stringify(studio.advisorShotSource) !== JSON.stringify(target.shotSource)) throw new Error("本段分镜来源已变化，请基于最新原文重新咨询");
  validateAdvisorPrevisShotCoverage(target, patch);
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
  if (request.spec.exportAnimation && !previsAnimationReceipt(res.output.animation, res.jobId)) throw new Error("试看缺少本任务的完整动画回执，不能应用；原配置保留");
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
  const animation = previsAnimationReceipt(receipt.output.animation, receipt.jobId);
  const specHistory = [...(next.specHistory || [])];
  specHistory[specHistory.length - 1] = { spec: studio.spec, createdAt: confirmedAt, reasonZh: `用户确认应用顾问试看 ${trial.request.requestId}；${trial.candidate.patch.summaryZh}` };
  return { ...next, specHistory, selectedJobId: receipt.jobId, history: [...next.history.filter(h => h.requestId !== receipt.params.requestId), {
    jobId: receipt.jobId, requestId: receipt.params.requestId, gcsUri: receipt.output.gcsUri, url: receipt.output.url,
    sourceScopeId: receipt.params.scopeId,
    durationSec: receipt.output.durationSec, createdAt: new Date().toISOString(), spec: receipt.params.spec,
    ...(animation ? { animation } : {}),
    ...(receipt.params.audio ? { audio: receipt.params.audio } : {}), ...(receipt.params.quality ? { quality: receipt.params.quality } : {}),
  }] };
}
export const ADVISOR_PREVIS_EDIT_INSTRUCTIONS = `\n【白模调度候选模式】
当前上下文提供的是指定片段的完整编辑规格。如有shotSource，它是本段逐镜原文与秒窗的完整来源版本，必须逐镜读取，不得用概括摘要替代或改变剧情。必须输出shotCoverage数组，每个原镜一项：{index:原镜号,status:"covered"或"unsupported",actorIds:[本镜涉及的现有角色ID],reasonZh:"说明秒窗、实际动作/机位及原文落实方式；不支持时说明缺少的能力"}。covered只代表方案有对应动作与机位，不代表已经渲染或画面通过。不得用静立/转头/指点冒充飞针、取血、倒地、道具接触等不支持动作；任何未落实要求须标unsupported并保留原文，不能默默省略。仅修改部分机位时也要逐镜说明其他动作从当前规格保留的依据，不能声称空动作基线已实现剧情。用户用自然语言要求修改动作或摄影机时，先结合剧情、场景、已有导演手法与运镜代码配方给出调度提案。在summaryZh说明剧情目的、为什么使用这组景别/机位/走位、与上一版差异及可继续调整的方向；不可只列数字。本模式覆盖普通问答的answer字符串格式：在外层JSON的answer字段直接放一个JSON对象，不要代码围栏，不要将对象或换行二次转义。先输出summaryZh，供用户流式阅读，随后给出完整候选。answer对象内容为：
场景特效可用sceneEffects完整替换数组（清空用[]）：cape披风(width/length/color/wind)、explode分件(distance/startSec/durationSec)、hologram(color/intensity)、attribute_color(color/colorEnd)、label骨骼标注(bone/text/color/offset/fontSize)；每项须有id、actorId，最多4项/3角色/8秒。披风与分件不能同段；只改已存在角色，不生成模型内部结构。保留所有未要求修改的现有项。
{"kind":"previs_edit_v1","summaryZh":"逐项说明哪些秒窗/人物/机位改了什么","unsupportedZh":[],"cameras":[完整的替换机位数组],"actors":[{"id":"原有角色ID","motionRoute":[{"timeSec":0,"position":[0,0],"facingDeg":0}],"start":[0,0],"end":[0,0],"moveStartSec":0,"moveEndSec":10,"facingDeg":0,"actions":[{"kind":"walk","startSec":0,"endSec":10}]}]}
仅填写需要修改的cameras、actors、interactions、sceneEffects、storyProps、handContacts、piggyback、blockBowl或setDown；actors每项必须保留原id，只填改动字段，不能改变身份、模型、角色数、时长、画幅、音频、参考、在场区间或背负双方身份。当前无背负关系时可用piggyback:{carrierId,passengerId}为本段已有两名人体角色建立开镜已背稳的关系，不表示已实现上背过程。双方位置、路线和朝向须一致，承载者仅走位/静立，乘员仅待机；真实模型须双方都绑定，逐帧验证本人骨长、手膝肩蒙皮与脚底，不混用源人偶。已有背负双方不得换人；仅基础人体可通过setDown增加完整放下时序，真实模型暂不支持放下或滑落接住。不得输出Python/命令/URL。unsupportedZh只填写用户明确提出且无法实现的要求；用户没有要求的音效、材质、表情、手持抖动等能力边界不要列入。用户说保留动作与对白是锁定条件，不是不支持项。只调整镜头即可满足时，unsupportedZh必须为[]。真正不支持的要求不能悄悄忽略，该候选不会应用。
背负时单手挡碗可用blockBowl:{hand:"hand-1"或"hand1",bowlId,startSec,contactSec,releaseSec,endSec,offset:[x,y,z]}；用于已有基础人体或双方真实模型背负，另一侧始终托膝，乘员保持抱肩和双脚离地。碗须在storyProps里有另一人的grip，挡碗窗原地停稳，不能叠加滑落或放下；超手臂可达范围失败，不能省略另一侧支撑。
持续搀扶可用interactions完整替换数组：{id,kind:"support_walk",actorId:扶助者ID,targetActorId:被扶者ID,startSec:开始抬手秒,contactSec:扶稳秒,endSec:本段时长}。至少1秒扶稳，持续至片尾。双方须未持械的基础人体，不能同时背负/出水，不支持带衣模型接触。被扶者靠近侧手搭扶助者肩，扶助者手托对方前臂；双方只可叠加walk或idle。路线先接近并站稳，扶稳后同步同向走，维持横向间距约0.65米与前后偏差小于0.1米，不转弯；先结束坐下/咳嗽再扶稳。双方动作walk秒窗和位移秒窗对齐，不能把尚坐着的角色直接平移。interactions必须保留其他已有事件；不可达会拒绝渲染。
动作类型：${PREVIS_ACTION_KINDS.join("、")}。动作不能重叠；look需要lookAtId（本段角色ID或camera），turn需要facingDeg，其他动作不填这些字段。有motionRoute的角色禁止在actions中输出turn；所有转身只能写入motionRoute节点的facingDeg，不可重复表达。移动路线2–12点、按秒严格递增，从0到时长-1/24；坐标范围±12米、朝向±180度；路线首节点为0秒，末节点必须为(durationSec*24-1)/24秒（允许四位小数，程序只归一舍入误差）。路线起末点同步start/end，省略这些冗余字段时由路线补齐。路线节点间至少0.25秒，平滑移动峰值1.5×距离/间隔不得超过1.2米/秒，平滑转向峰值1.5×角度/间隔不得超过120度/秒。需要停立时必须给出相同位置的两个时间节点，idle动作不会停止motionRoute位移。背负承载者在放下前只走位/静立，乘员不独立行动。完整放下用answer对象的setDown:{startSec,groundSec,releaseSec,endSec}：依次为降低开始、落地坐稳、松手、起身结束，各阶段至少0.75/0.25/0.25秒，按24帧对齐，endSec不晚于时长-1/24。期间承载者须停止位移与转身，动作表不要叠加walk；之后可独立走位，乘员自动留在放下地点坐稳。双方路线仍必须相同，乘员落地后的固定由渲染器执行。四足limp_front_left覆盖整段；四足受击另用该actor的hitReaction:{sourceActorId,startSec,contactSec,endSec}，绑定本段出掌者和其strike窗口中的接触时刻。受击不会取消跛行或套用人体动作。
人马扶颈用handContacts完整替换数组，每项{id,actorId,hand:"hand-1"或"hand1",targetActorId,bone:"head"或"neck",along,offset,startSec,contactSec,releaseSec,endSec}。绑定真实马骨并保持手腕接触；伸/收手各至少0.25秒，接触保持至少0.25秒，按24帧对齐。开镜已接触可startSec=contactSec=0，持续到片尾可releaseSec=endSec=片长。不能叠加同手端碗、背负双方、其他双人接触或独立手臂动作，双方全窗在场；额头贴靠、摸皮肤表面与马毛变形尚未支持，不能宣称已实现。
人体半躺/坐稳用actor.humanPosture:{mode:"hold",posture:"sit"或"recline",supportHeight:0.25至0.65米,reclineDeg:25至70度}；坐起并保持用{mode:"rise_to_sit",startSec,endSec,supportHeight,reclineDeg}，转换至少0.5秒且末帧前结束。演员原地整段在场、只idle，不支持位移/其他接触叠加；真实带骨模型逐帧核对骨盆蒙皮支撑和双脚网格，失败时保留旧片，不降级人偶。衣物、支撑面实际场景与常速仍须审片；没有扶助者手部约束时不能宣称已扶起。
四足倒地使用actor.quadrupedFall:{mode:"collapse",side:"left"或"right",startSec,foldSec,groundSec}；屈腿至少0.25秒、侧落至少0.5秒，秒位对齐24帧，groundSec不晚于最后一帧。后续保持倒地用{mode:"hold",side}，不可位移或自动站起。collapse可原地或行进中倒地：行进时沿已有start/end，必须moveStartSec<startSec<moveEndSec<=groundSec，移动秒位也须对齐24帧；屈腿开始后平滑减速至零，减速前峰速不超过1.2米/秒，不得触地后继续滑行。整段在场的horse可用，actions只允许idle，不叠加motionRoute、hitReaction或creature。
剧情道具使用storyProps完整替换数组（清空用[]），最多32项，每项{id,kind:"needle"或"blood_drop"或"bowl"或"jar"或"knife"或"sleeve_glow",keyframes:[{timeSec,anchor,visible,scale,rotation,fill}]}。每项至少两帧，首帧0、末帧durationSec，按24帧严格递增。anchor为{type:"bone",actorId,bone,along,offset}或{type:"prop",propId,offset}或{type:"world",position:[x,y,z]}；world位置各轴±10米，prop只能引用前面已声明道具。人骨名spine/neck/head/hand-1/hand1/lower_leg-1/lower_leg1，马骨名body/head/neck/lower_leg0/lower_leg1/lower_leg2/lower_leg3；offset是骨局部米坐标。飞针从手锚过渡到指定落针骨锚后固定；血滴到碗锚；显隐由visible明确表达。道具没有grip时只按锚点轨迹运动；端碗/端坛/持刀须用grip执行手臂约束，不能把碗飞到嘴边称为端碗动作。bowl/jar/knife可用grip:{actorId,hand:"hand-1"或"hand1",offset:[0,0,-0.02]}绑定握点，可另加成对startSec/endSec限定持握窗口（24帧对齐），窗外释放，省略表示全段持握。站位和道具轨迹必须在手臂可达范围；超范围会失败，同手握持窗口不能重叠。bowl/jar每帧fill为0到1，.5表示半碗/半坛，倒血须同时给血滴轨迹与两容器fill变化，不会自动模拟流体守恒。袖光仅是光点，不代表已模拟袖布滑动。
相机1–8个，连续覆盖0到本段时长；startSec/endSec，position/target是[x,y,z]米，x/y±30、z0.2–15；lens/endLens是18–65mm整数（焦距增大视角收紧）；可填endPosition/endTarget，或orbitDeg±180与orbitRise±8（须与非零环绕同用），两种运动写法二选一：直线模式只填endPosition/endTarget，不填orbitDeg/orbitRise；环绕模式只填orbitDeg/orbitRise，删除endPosition/endTarget。零值也不能作为兼容占位。时序对齐24fps，贴合当前人物真实位置、朝向及动作目标。不能每镜机械套FOV/下降/旋转，需有剧情触发并保持轴线。
可分别指定motionWindow和lensWindow，格式均为{startSec,endSec}，是本镜内的绝对秒窗，须对齐24帧且至少两帧。窗前保持起点，窗内完成移动或变焦，窗后保持终点；不填则沿用整镜平滑。motionWindow需要移动终点或环绕，lensWindow需要endLens。短促FOV冲击要用短lensWindow，而非把变焦摊满整镜；快动后停、慢移后切须写入对应秒窗，不只口头描述。
取景必须按焦距与真实站位计算，不得只在summaryZh声称“拉远”。横屏采用36mm宽传感器，距离d米处水平视域约为d×36/lens米，竖向视域还需除以画幅宽高比；例如16:9、55mm、3米距离只有约1.10米高视域，会切掉全身和放下动作。背负及完整放下镜头须同时容纳承载者、乘员从头到脚和落地点；出掌受击镜头须交代出掌者与受击者，冲向对手及结尾对峙须同时交代双方。按整镜运动与最长焦距留边距，不以起帧可见代替整镜可见；优先沿原侧别退机位，保持轴线，避免以近景遮掉关键动作。
上下文如有previousPreviewSpecJson表示上次未应用的试看。追问时延续上次试看并按新需求修正，输出相对specJson原工作流的累计修改，不能丢掉用户此前要求。只生成可继续修改的调度提案，用户明确说生成试看或点击生成试看后，由系统校验合格候选并在当前3D页渲染；只讨论时不渲染，方案回包本身不代表视频已生成；不满意可继续聊并修正提案再生成。用户满意点击应用之后才写回工作流，不声称已应用或审片通过。answer对象序列化后总长不超过11000字符。`;
