/**
 * MV 多人互动镜头 → 自动白模动作参考（1109/1110）。纯函数，不调用模型、不提交任务。
 *
 * 复用：
 * - 多人互动检测 = R3 的 mvShotMultiPersonCues（shared/canvasMusicMvShotGuards.ts），不另写正则；
 * - 顾问白模链路 = 漫剧 previs_edit_v1（shared/manhuaAdvisorPrevisEdit.ts）：本模块只把 MV 镜头的
 *   逐窗节拍写成 advisorShotSource、角色表写成白模演员（只有身份，没有手填坐标），站位/走位/接触时序/机位
 *   全部由创作顾问 LLM 产出舞台参数；Blender 试看、自然语言修改、应用沿用原面板与原路由。
 * - 白模渲染本身不扣积分（server/routers/manhuaPrevis.ts 0911 实录）；顾问咨询沿用面板额度与超额确认。
 */
import { mvShotMultiPersonCues } from "./canvasMusicMvShotGuards";
import type { MusicMvShotBeat } from "./canvasMusicMv";
import { buildAdvisorPrevisShotSource } from "./manhuaAdvisorPrevisShotSource";
import { createManhuaPrevisStudio, manhuaPrevisSpecSchema, type ManhuaPrevisStudio } from "./manhuaPrevis";
export { MV_PREVIS_PROMPT_RULE_ZH, mvPrevisWindowRuleZh } from "./canvasMusicMvPrevisRule";

export type MvPrevisShot = {
  shotId: string;
  /** 歌曲绝对秒。 */
  startSec: number;
  endSec: number;
  kind?: "generated" | "singing" | "footage";
  visualPrompt?: string;
  cameraPrompt?: string;
  beats?: MusicMvShotBeat[];
  /** 角色表「名称：外形」逐项。 */
  castZh?: string[];
};

/** 软提示（可继续）：与 R3 的角色表硬拦同处，放在其后。 */
export const MV_PREVIS_SOFT_HINT_ZH = "多人互动镜头建议先生成白模动作参考";

const cleanCast = (cast?: string[]) => (cast || []).map(c => c.trim()).filter(Boolean);
const castName = (row: string) => row.split(/[：:]/)[0]!.trim().slice(0, 40) || row.slice(0, 40);

/** 本镜剧情文字（与 R3 canvasRunBlock 检测同口径：分镜 + 逐窗节拍）。 */
export function mvPrevisShotTexts(shot: MvPrevisShot): string[] {
  return [shot.visualPrompt, shot.cameraPrompt, ...(shot.beats || []).flatMap(w => [w.actionZh, w.cameraZh, w.moodZh, w.sfxZh])].filter((t): t is string => Boolean(t));
}

export type MvPrevisNeed =
  | { needed: true; cues: string[] }
  | { needed: false; cues: string[]; reason: "singing" | "footage" | "no_beats" | "no_interaction" | "cast_insufficient" };

/**
 * 是否需要自动白模：非演唱/素材镜、逐窗节拍已就绪、检出多人互动、角色表 ≥2 人。
 * 角色表不足时不发起（R3 硬拦会先要求补角色表），返回 cast_insufficient。
 */
export function mvShotNeedsPrevis(shot: MvPrevisShot): MvPrevisNeed {
  if (shot.kind === "singing") return { needed: false, cues: [], reason: "singing" };
  if (shot.kind === "footage") return { needed: false, cues: [], reason: "footage" };
  const cues = mvShotMultiPersonCues(mvPrevisShotTexts(shot));
  if (!cues.length) return { needed: false, cues, reason: "no_interaction" };
  if (!shot.beats?.length) return { needed: false, cues, reason: "no_beats" };
  if (cleanCast(shot.castZh).length < 2) return { needed: false, cues, reason: "cast_insufficient" };
  return { needed: true, cues };
}

/** FNV-1a 32 位：同内容同键，节拍/角色表改了才变。 */
function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/** 自动发起去重键 = 镜头 id + 逐窗节拍与角色表内容哈希。 */
export function mvShotPrevisContentKey(shot: MvPrevisShot): string {
  return `${shot.shotId}:${fnv1a(JSON.stringify({ s: shot.startSec, e: shot.endSec, beats: shot.beats || [], cast: cleanCast(shot.castZh) }))}`;
}

/** 白模时长按 createManhuaPrevisStudio 同口径（0.1 秒、2–30 秒）。 */
function previsDuration(shot: MvPrevisShot): number {
  const L = shot.endSec - shot.startSec;
  if (!(L > 0)) throw new Error("镜头时长无效，未建立白模");
  if (L > 30) throw new Error("本镜超过白模单段 30 秒上限，请先拆镜");
  return Math.max(2, Math.min(30, Math.round(L * 10) / 10));
}

/**
 * 逐窗节拍 → 顾问分镜来源（每窗一镜：动作、运镜、音效 + 镜内秒窗）。
 * 窗界取镜内相对秒，末窗收在白模时长；窗文字原样，不截断。
 */
export function buildMvShotPrevisShotSource(blockId: string, shot: MvPrevisShot) {
  const beats = shot.beats || [];
  if (!beats.length) throw new Error("本镜还没有逐窗节拍，不能自动生成白模");
  const total = previsDuration(shot);
  const starts = beats.map((w, i) => (i === 0 ? 0 : Math.max(0, w.startSec - shot.startSec)));
  const rows = beats.map((w, i) => {
    const end = i === beats.length - 1 ? total : starts[i + 1]!;
    const durationSec = Math.round((end - starts[i]!) * 1e6) / 1e6;
    if (!(durationSec > 0)) throw new Error(`第 ${i + 1} 窗秒位无效，未建立白模`);
    const rel = `${starts[i]!.toFixed(2)}–${end.toFixed(2)} 秒`;
    return {
      index: i + 1,
      durationSec,
      actionZh: `【W${i + 1}｜镜内 ${rel}】${w.actionZh}`,
      cameraZh: w.cameraZh,
      soundZh: w.sfxZh,
    };
  });
  return buildAdvisorPrevisShotSource(blockId, rows);
}

/**
 * 为 MV 镜头块建立（或刷新）白模工作台：演员 = 角色表逐人（名称锁定），站位用占位基线，
 * 实际站位/走位/朝向/动作/机位全部交给顾问输出；已有历史与已采用记录保留。
 */
export function buildMvShotPrevisStudio(blockId: string, shot: MvPrevisShot, existing?: ManhuaPrevisStudio, aspect: "16:9" | "9:16" = "16:9"): ManhuaPrevisStudio {
  const cast = cleanCast(shot.castZh);
  if (cast.length < 2) throw new Error("角色表不足两人，不能为多人互动镜头建立白模");
  if (existing?.pending) throw new Error("本镜白模仍在处理，请等任务结束");
  const advisorShotSource = buildMvShotPrevisShotSource(blockId, shot);
  const base = createManhuaPrevisStudio(previsDuration(shot), existing?.scopeId);
  const template = base.spec.actors[0]!;
  const n = Math.min(cast.length, 8);
  const actors = cast.slice(0, n).map((row, i) => {
    // 占位基线：沿 x 轴等距排开、面向机位；只为让顾问有可修改的起点，不是用户输入
    const x = Math.round(((i - (n - 1) / 2) * 1.2) * 100) / 100;
    return { ...template, id: `actor-${i + 1}`, nameZh: castName(row), start: [x, 0] as [number, number], end: [x, 0] as [number, number], actions: [] };
  });
  const spec = manhuaPrevisSpecSchema.parse({ ...base.spec, aspect, actors });
  if (existing && JSON.stringify(existing.advisorShotSource) === JSON.stringify(advisorShotSource) && existing.spec.actors.length === actors.length && existing.spec.actors.every((a, i) => a.nameZh === actors[i]!.nameZh)) return existing;
  return {
    ...(existing || base),
    scopeId: existing?.scopeId || base.scopeId,
    history: existing?.history || [],
    referenceHistory: existing?.referenceHistory || [],
    spec,
    advisorShotSource,
    ...(existing ? { specHistory: [...(existing.specHistory || []), { spec: existing.spec, createdAt: new Date().toISOString(), reasonZh: "MV 镜头节拍或角色表变化，按新节拍重建白模基线" }] } : {}),
  };
}

/**
 * 自动白模提问：交代逐窗节拍、角色表与场景图，要求顾问产出完整舞台参数并生成试看。
 * 措辞须命中 requestsAdvisorPrevisRender（明确「生成白模视频试看」，不含问号/条件词）。
 */
export function mvPrevisAdvisorQuestion(shot: MvPrevisShot, opts: { sceneLabels?: string[]; cues?: string[] } = {}): string {
  const cast = cleanCast(shot.castZh);
  const scenes = (opts.sceneLabels || []).map(s => s.trim()).filter(Boolean);
  return [
    `【MV多人互动镜头 ${shot.shotId}·白模动作参考】`,
    `按本镜逐窗节拍（分镜来源中每窗的动作、运镜、音效与镜内秒窗）编排双方站位、走位、朝向、肢体接触时序与机位。`,
    `角色表：${cast.join("；")}。`,
    scenes.length ? `场景参考：${scenes.join("；")}。` : "",
    opts.cues?.length ? `检出的互动：${opts.cues.join("；")}。` : "",
    `站位坐标、路线与动作秒位由你给出完整舞台参数，用户不手填数值；接触瞬间对齐所在窗的秒点。`,
    `生成白模视频试看。`,
  ].filter(Boolean).join("");
}

/** 已应用的白模记录里的顾问说明（adoptAdvisorPrevisTrial 写入 specHistory 末条）。 */
export function mvPrevisAdoptedSummaryZh(studio?: ManhuaPrevisStudio): string | undefined {
  const reason = studio?.specHistory?.at(-1)?.reasonZh || "";
  const m = /用户确认应用顾问试看 [0-9a-f-]+；([\s\S]+)$/.exec(reason);
  return m ? m[1]!.trim() : undefined;
}

/** 编译提示词用：白模参考片在提交数组中的序号（@视频N 的 N，1 起）。 */
export function mvPrevisVideoIndex(motionVideos: ReadonlyArray<{ source: string }>): number | undefined {
  const i = motionVideos.findIndex(v => v.source === "previs");
  return i >= 0 ? i + 1 : undefined;
}

/**
 * 自动发起挑选：按镜头顺序找第一个「需要白模 + 尚无白模参考 + 同内容未发起过」的镜头。
 * 一次只返回一镜；skip(key) 为真＝已发起过或已有白模参考。
 */
export function nextMvShotAutoPrevis<T extends MvPrevisShot>(shots: readonly T[], skip: (shot: T, key: string) => boolean): { shot: T; key: string } | undefined {
  for (const shot of shots) {
    if (!mvShotNeedsPrevis(shot).needed) continue;
    const key = mvShotPrevisContentKey(shot);
    if (skip(shot, key)) continue;
    return { shot, key };
  }
  return undefined;
}
