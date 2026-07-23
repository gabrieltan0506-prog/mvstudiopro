/**
 * 外站 Skill 蒸馏（产品代码，非施工手册）：
 * - screenplay-generator：故事发动机 / 剧本医生 / 整体影像+运镜风格
 * - create-storyboard：起幅·戏核·落幅 / 交接棒 / 动作情绪起止
 * - visual-storytelling：资产 inventory → 分镜角色 → 导戏单
 * - Emily2040/seedance-2.0（MIT）：角色身份契约 / 导戏一致 / 多角色动作分层 → manhuaDirectorDistill
 *
 * 可调用：Sol 扩写注入 + 静帧提示 + 按秒导戏单结构（前台不写供应商名）。
 */

import type { ManhuaEpisodeSegmentBeat } from "./manhuaEpisodeSegmentPlan.js";
import {
  MANHUA_EPISODE_SEGMENT_DURATION_SEC,
  type ManhuaEpisodeSegmentPlan,
} from "./manhuaEpisodeSegmentPlan.js";
import {
  formatManhuaDirectingCoherenceBlock,
  formatManhuaEnsembleActionHierarchyBlock,
} from "./manhuaDirectorDistill.js";
import {
  extractManhuaSpeakerAtTag,
  formatManhuaLockedDialogueLine,
} from "./manhuaPerformancePrompt.js";

/** 与工作台静帧口径对齐（避免与 manhuaScriptWorkbench 循环依赖） */
export const MANHUA_DISTILL_KEYARTS_PER_SEGMENT_MIN = 3;
export const MANHUA_DISTILL_KEYARTS_PER_SEGMENT_MAX = 4;

/** 段内关键静帧戏剧角色（对齐 create-storyboard START / KEY / EDIT-OUT / bridge） */
export type ManhuaKeyframeRole = "start" | "key_action" | "edit_out" | "bridge";

export const MANHUA_KEYFRAME_ROLE_ORDER: readonly ManhuaKeyframeRole[] = [
  "start",
  "key_action",
  "edit_out",
  "bridge",
] as const;

export const MANHUA_KEYFRAME_ROLE_LABEL_ZH: Record<ManhuaKeyframeRole, string> = {
  start: "起幅",
  key_action: "戏核",
  edit_out: "落幅",
  bridge: "桥接",
};

/** 导戏单/静帧编译用的最小镜位（可与 ManhuaWorkbenchShot 互通） */
export type ManhuaDistillShot = {
  index: number;
  cameraZh: string;
  actionZh: string;
  dialogueZh?: string;
  emotionZh?: string;
  /** 所属段意图（可拍表） */
  intentZh?: string;
  keyframeRole?: ManhuaKeyframeRole;
};

/** Sol 扩写附加：故事发动机 + 可见动作优先（蒸馏 screenplay-generator） */
export function formatManhuaScreenplayEnginePromptBlock(): string {
  return [
    "【故事发动机·必须兑现】",
    "每集压成一条因果链：主角欲望 → 障碍 → 升级抉择 → 代价 → 不可逆选择/兑现。",
    "开场三秒内须有可见扰动、冲突、强问题或主动抉择；禁止先讲背景再进戏。",
    "只写摄影机能看见或麦克风能听见的内容；心理旁白改成表情、道具状态、站位变化。",
    "对白一律用直角引号「」包裹（禁止只用弯引号“”）；金句密度：钩子附近 / 中段转折 / 高潮或片尾各至少一条可传播短句。",
    "扩写完成后内心做一次「剧本医生」：删寒暄、死场、连续性断裂、不可拍镜头。",
  ].join("\n");
}

/** Sol 扩写附加：全局影像/运镜（蒸馏后写入系列，供 Image-2 / 成片共用） */
export function formatManhuaGlobalStylePromptRequestBlock(): string {
  return [
    "### 整体影像风格",
    "（一段可直接用于生图的统一影像提示：时代地域、媒介质感、主辅色、主光动机、空气材质、面部与角色/场景视觉锁。禁止导演名/片名词。）",
    "",
    "### 统一运镜风格",
    "（一段可直接用于分镜/成片的统一运镜提示：叙事视点、机位距离、主运镜族、动静平衡、焦段倾向、焦点交接、应避免的镜头习惯。）",
  ].join("\n");
}

/** 从编剧 Markdown 抽出全局风格两段（可选；缺则空） */
export function parseManhuaGlobalStyleFromMarkdown(md: string): {
  imageStyleZh: string;
  cameraStyleZh: string;
} {
  const text = String(md || "");
  const pick = (heading: string): string => {
    const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const m = text.match(
      new RegExp(`#{2,4}\\s*${escaped}\\s*\\n+([\\s\\S]*?)(?=\\n#{2,4}\\s|$)`, "i"),
    );
    return String(m?.[1] || "")
      .replace(/^[\s>*\-•]+/, "")
      .trim()
      .slice(0, 600);
  };
  return {
    imageStyleZh: pick("整体影像风格"),
    cameraStyleZh: pick("统一运镜风格"),
  };
}

export function resolveKeyframeRoleInSegment(
  inSegIndex1Based: number,
  keyartsInSegment: number,
): ManhuaKeyframeRole {
  const n = Math.max(
    MANHUA_DISTILL_KEYARTS_PER_SEGMENT_MIN,
    Math.min(
      MANHUA_DISTILL_KEYARTS_PER_SEGMENT_MAX,
      Math.floor(keyartsInSegment) || MANHUA_DISTILL_KEYARTS_PER_SEGMENT_MIN,
    ),
  );
  const i = Math.max(1, Math.floor(inSegIndex1Based));
  if (n <= 3) {
    if (i <= 1) return "start";
    if (i === 2) return "key_action";
    return "edit_out";
  }
  // 4：起幅 / 戏核 / 桥接（服化·光影细节）/ 落幅
  if (i <= 1) return "start";
  if (i === 2) return "key_action";
  if (i === 3) return "bridge";
  return "edit_out";
}

function roleCameraZh(role: ManhuaKeyframeRole, lightingCameraZh: string): string {
  const base = String(lightingCameraZh || "").trim();
  if (role === "start") {
    return base.includes("全景") || base.includes("远景")
      ? base.slice(0, 48)
      : "全景，平视，缓慢推近";
  }
  if (role === "key_action") return base || "中景，固定机位，三分构图";
  if (role === "bridge") return "特写，平视，微推";
  return base.includes("近景") || base.includes("特写")
    ? base.slice(0, 48)
    : "中近景，轻微横移";
}

function roleActionZh(
  role: ManhuaKeyframeRole,
  beat: ManhuaEpisodeSegmentBeat,
): string {
  const scene = beat.sceneZh || "本场";
  const cast = beat.castZh || "出场人物";
  const wardrobe = beat.wardrobePropZh || "服化道";
  const light = beat.lightingCameraZh || "可读光影";
  if (role === "start") {
    return `起幅建立：${scene}；${cast}站位与空间纵深清楚；光影起势（${light}）`;
  }
  if (role === "key_action") {
    const perf = beat.performanceZh || "表情/肢体贴合对白气口";
    return `戏核动作：${cast}推动关系/信息；表演：${perf}；服化道可读（${wardrobe}）`;
  }
  if (role === "bridge") {
    return `桥接细节：${wardrobe} 材质/手持交互特写，或光影突变中介态（${light}）`;
  }
  return `落幅交接：${cast}结束站位与视线；为下一段种下空间/动作/道具线索；场景仍是${scene}`;
}

/** 可拍表 → 分镜列表（每段 3–4 静帧，带戏剧角色；可赋给工作台） */
export function buildWorkbenchShotsFromSegmentPlan(
  plan: ManhuaEpisodeSegmentPlan | null | undefined,
  opts?: { keyartsPerSegment?: number },
): Array<ManhuaDistillShot & { durationSec: number }> {
  const segs = [...(plan?.segments || [])].sort((a, b) => a.index - b.index);
  if (!segs.length) return [];
  const per = Math.max(
    MANHUA_DISTILL_KEYARTS_PER_SEGMENT_MIN,
    Math.min(
      MANHUA_DISTILL_KEYARTS_PER_SEGMENT_MAX,
      Math.floor(opts?.keyartsPerSegment ?? MANHUA_DISTILL_KEYARTS_PER_SEGMENT_MIN),
    ),
  );
  const out: Array<ManhuaDistillShot & { durationSec: number }> = [];
  let global = 0;
  for (const beat of segs) {
    for (let k = 1; k <= per; k++) {
      global += 1;
      const role = resolveKeyframeRoleInSegment(k, per);
      out.push({
        index: global,
        durationSec: 0,
        cameraZh: roleCameraZh(role, beat.lightingCameraZh),
        actionZh: roleActionZh(role, beat),
        dialogueZh: k === 2 || (per >= 4 && k === 3) ? beat.dialogueZh : undefined,
        emotionZh:
          beat.performanceZh ||
          (beat.dialogueZh ? "贴合对白施压/反应" : undefined),
        intentZh: String(beat.intentZh || "").trim() || undefined,
        keyframeRole: role,
      });
    }
  }
  return out;
}

export type ManhuaSecondCueBeat = {
  segmentIndex: number;
  startSec: number;
  endSec: number;
  role: ManhuaKeyframeRole;
  roleLabelZh: string;
  cameraZh: string;
  actionZh: string;
  dialogueZh: string;
  emotionZh: string;
  sceneZh: string;
  wardrobePropZh: string;
  lightingCameraZh: string;
  handoffOutZh: string;
};

/** 按秒导戏单：把 15s 段均分给 3–4 张静帧，并写清交接棒 */
export function buildManhuaSecondCueSheet(input: {
  segment: ManhuaEpisodeSegmentBeat;
  shots: ManhuaDistillShot[];
  durationSec?: number;
}): ManhuaSecondCueBeat[] {
  const dur =
    typeof input.durationSec === "number" && input.durationSec > 0
      ? input.durationSec
      : MANHUA_EPISODE_SEGMENT_DURATION_SEC;
  const shots = (input.shots || []).filter(Boolean);
  const n = Math.max(1, shots.length);
  const slot = dur / n;
  return shots.map((s, i) => {
    const role =
      s.keyframeRole ||
      resolveKeyframeRoleInSegment(i + 1, n);
    const startSec = Math.round(i * slot * 10) / 10;
    const endSec = Math.round(Math.min(dur, (i + 1) * slot) * 10) / 10;
    const next = shots[i + 1];
    const handoffOutZh = next
      ? `交给下镜：保留 ${roleCameraZh("edit_out", input.segment.lightingCameraZh)} 落点与道具可读线索`
      : "段末交接：种下一段空间入口/动作方向/声音线索";
    return {
      segmentIndex: input.segment.index,
      startSec,
      endSec,
      role,
      roleLabelZh: MANHUA_KEYFRAME_ROLE_LABEL_ZH[role],
      cameraZh: s.cameraZh,
      actionZh: s.actionZh,
      dialogueZh: String(s.dialogueZh || (role === "key_action" ? input.segment.dialogueZh : "")).trim(),
      emotionZh: String(s.emotionZh || "").trim(),
      sceneZh: input.segment.sceneZh,
      wardrobePropZh: input.segment.wardrobePropZh,
      lightingCameraZh: input.segment.lightingCameraZh,
      handoffOutZh,
    };
  });
}

export function formatManhuaSecondCueSheetBlock(
  beats: ManhuaSecondCueBeat[],
  opts?: { segmentIndex?: number },
): string {
  if (!beats.length) {
    return [
      "【按秒导戏单】",
      "本段尚无静帧节拍：先锁定可拍表并生成 3–4 张关键静帧。",
    ].join("\n");
  }
  const seg =
    typeof opts?.segmentIndex === "number" && opts.segmentIndex >= 1
      ? opts.segmentIndex
      : beats[0]!.segmentIndex;
  const lines = beats.map((b) => {
    const head = `${b.startSec}–${b.endSec}s｜${b.roleLabelZh}｜${b.cameraZh || "运镜待定"}`;
    return [
      head,
      `  场景：${b.sceneZh || "本场"}｜服化道：${b.wardrobePropZh || "连续"}`,
      `  动作：${b.actionZh || "可读动作"}`,
      (() => {
        const locked = formatManhuaLockedDialogueLine({
          speakerAtTag: extractManhuaSpeakerAtTag(b.actionZh, b.dialogueZh),
          dialogueZh: b.dialogueZh,
          emotionZh: b.emotionZh,
        });
        if (!locked) {
          return `  对白：本镜无台词，保留气口${b.emotionZh ? `｜情绪：${b.emotionZh}` : ""}`;
        }
        return `  对白（须出声·人物锁+表情）：${locked}`;
      })(),
      `  光影运镜：${b.lightingCameraZh || b.cameraZh}`,
      `  交接：${b.handoffOutZh}`,
    ].join("\n");
  });
  return [
    `【按秒导戏单·第${String(seg).padStart(2, "0")}段·${MANHUA_EPISODE_SEGMENT_DURATION_SEC}s】`,
    "对白/情绪/动作/运镜/场景切换一次写清；静帧锁定前禁止烧视频。",
    ...lines,
  ].join("\n");
}

/** Image-2 静帧提示：角色/场景/服化/光影 + 戏剧角色（中文，零技术泄漏） */
export function formatManhuaKeyframeImage2Prompt(input: {
  shot: ManhuaDistillShot;
  segment?: ManhuaEpisodeSegmentBeat | null;
  imageStyleZh?: string | null;
  identityLockZh?: string | null;
}): string {
  const role =
    input.shot.keyframeRole ||
    resolveKeyframeRoleInSegment(1, MANHUA_DISTILL_KEYARTS_PER_SEGMENT_MIN);
  const roleZh = MANHUA_KEYFRAME_ROLE_LABEL_ZH[role];
  const seg = input.segment;
  const style = String(input.imageStyleZh || "").trim();
  const identity = String(input.identityLockZh || "").trim();
  return [
    `【关键静帧·${roleZh}】竖屏电影静帧，纯画面，零可读文字。`,
    formatManhuaDirectingCoherenceBlock({
      intentionZh:
        input.shot.actionZh?.slice(0, 60) ||
        seg?.dialogueZh?.slice(0, 60) ||
        null,
    }),
    formatManhuaEnsembleActionHierarchyBlock(),
    style ? `整体影像：${style.slice(0, 280)}` : "",
    identity ? identity.slice(0, 400) : "",
    seg?.sceneZh ? `场景：${seg.sceneZh}` : "",
    seg?.paletteZh ? `配色：${seg.paletteZh}` : "",
    seg?.castZh ? `角色：${seg.castZh}` : "",
    seg?.wardrobePropZh ? `服化道：${seg.wardrobePropZh}` : "",
    seg?.lightingCameraZh ? `光影运镜：${seg.lightingCameraZh}` : "",
    `机位：${input.shot.cameraZh}`,
    `场面：${input.shot.actionZh}`,
    role === "start"
      ? "起幅要求：建立空间纵深与人物站位，前景·中景·远景可读。"
      : role === "key_action"
        ? "戏核要求：动作接触点与关系轴线清楚；口型表演可有，禁止烧字。"
        : role === "bridge"
          ? "桥接要求：道具材质或光影中介态占主体，便于段间连续。"
          : "落幅要求：结束站位/视线/道具线索可被下一段承接。",
  ]
    .filter(Boolean)
    .join("\n");
}

/** 全集导戏单是否就绪：每段至少 3 条按秒节拍 */
export function evaluateManhuaCueSheetReady(input: {
  segmentCount: number;
  cueSheets: Array<{ segmentIndex: number; beatCount: number }>;
}): boolean {
  const need = Math.max(1, Math.floor(input.segmentCount));
  if (need < 1) return false;
  const bySeg = new Map(input.cueSheets.map((c) => [c.segmentIndex, c.beatCount]));
  for (let i = 1; i <= need; i++) {
    if ((bySeg.get(i) || 0) < MANHUA_DISTILL_KEYARTS_PER_SEGMENT_MIN) return false;
  }
  return true;
}
