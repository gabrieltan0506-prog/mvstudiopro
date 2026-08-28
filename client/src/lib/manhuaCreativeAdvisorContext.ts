/**
 * 创作顾问 v1 · 问题上下文组装（纯函数层）。
 *
 * 产品口径（0826 用户拍板 + 0827 方案裁剪）：
 * - 顾问只准引用库内真实内容：approved 模板匿名卡 + 12 张导演手法卡；禁编造。
 * - v1 是只读顾问：诊断/解释/推荐 + 「用这个模板试写→」直通试写，不做写操作。
 * - 前台与注入内容零泄漏：不带模型名/供应商名/来源片名/导演名——
 *   手法卡的 sourceLabel/sourceRefZh 与 creativeMotifsZh（含括号片名）一律不进上下文。
 *
 * 为什么在客户端组装：底料全部是本就下发浏览器的匿名内容
 * （PublicManhuaViralTemplateCard + shared 手法卡），不新增服务端面；
 * 问答仍走现有 askPlatformSkillQa 计费通道（免费额度/超额确认原样）。
 */

import type { PublicManhuaViralTemplateCard } from "@shared/manhuaViralTemplateBank";
import {
  CRAFT_TECHNIQUE_PROFILES,
  type CraftTechniqueProfile,
} from "@shared/storyboardLightingEmotion";

/** askPlatformSkillQa 的 question 上限是 4000 字；留出余量防边界拒收 */
export const ADVISOR_QUESTION_MAX_CHARS = 3900;

/** 单字段截断：底料是给模型的线索，不是全文粘贴 */
function clip(text: string, max: number): string {
  const t = String(text || "").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, Math.max(0, max - 1))}…`;
}

/** 手法卡投影：只取四个去名化字段，来源溯源字段绝不进上下文 */
export type AdvisorCraftDigest = {
  /** 中性编号（手法①…），代替任何来源名 */
  labelZh: string;
  lightingZh: string;
  emotionZh: string;
  cameraZh: string;
  copyRhythmZh: string;
};

const CIRCLED = ["①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧", "⑨", "⑩", "⑪", "⑫", "⑬", "⑭", "⑮"];

export function digestCraftProfiles(
  profiles: readonly CraftTechniqueProfile[] = CRAFT_TECHNIQUE_PROFILES,
): AdvisorCraftDigest[] {
  return profiles.map((p, i) => ({
    labelZh: `手法${CIRCLED[i] ?? String(i + 1)}`,
    lightingZh: clip(p.lightingZh, 60),
    emotionZh: clip(p.emotionZh, 60),
    cameraZh: clip(p.cameraZh, 60),
    copyRhythmZh: clip(p.copyRhythmZh, 60),
  }));
}

export type AdvisorContextInput = {
  /** 用户原始问题（必填） */
  question: string;
  /** 当前所在阶段（阶段条 label，如「资产设定」），可空 */
  stageZh?: string;
  /** 当前已选剧情增强模板（匿名公开卡），可空 */
  selectedTemplate?: PublicManhuaViralTemplateCard | null;
  /** 可引用的 approved 模板卡（匿名），组装时最多取前 6 张 */
  templates?: PublicManhuaViralTemplateCard[];
  /** 手法卡（默认 12 张库内卡） */
  craftProfiles?: readonly CraftTechniqueProfile[];
};

function formatTemplateLine(t: PublicManhuaViralTemplateCard): string {
  const tags = (t.classificationTagsZh || []).slice(0, 4).join("/");
  return `- ${t.nameZh}（${t.laneZh}·${t.beatCount} 拍${tags ? `·${tags}` : ""}）：${clip(t.featureZh || t.introZh, 60)}`;
}

/**
 * 组装最终送入 askPlatformSkillQa 的 question。
 * 组装顺序 = 裁剪优先级的反序：先保用户问题与回答要求，
 * 超长时依次砍 手法卡尾部 → 模板列表尾部，绝不砍用户问题。
 */
export function buildAdvisorQuestion(input: AdvisorContextInput): string {
  const question = clip(input.question, 1200);
  const selected = input.selectedTemplate || null;

  const head = [
    "【身份】你是漫剧工厂的创作顾问，帮创作者用好平台里的爆款模板与导演手法。",
    `【当前状态】阶段：${clip(input.stageZh || "未知", 20)}；已选剧情增强：${
      selected ? `${selected.nameZh}` : "未选择"
    }`,
  ].join("\n");

  const rules = [
    "【回答要求】",
    "1. 只依据下方「可引用模板」与「可引用手法」作答；库里没有的不要编造，直说没有。",
    "2. 引用时点名模板全名或手法编号，说明为什么适合当前问题。",
    "3. 末尾单独一行给「下一步」：一句可执行动作（如：选中某模板→点『试写一集』看两版对比）。",
    "4. 不得出现任何影视作品名、导演名、演员名；不得出现技术供应商或模型名。",
    "5. 回答用中文，短段落，不超过 400 字。",
  ].join("\n");

  const templateCards = (input.templates || []).slice(0, 6).map(formatTemplateLine);
  const craft = digestCraftProfiles(input.craftProfiles ?? CRAFT_TECHNIQUE_PROFILES).map(
    (c) => `- ${c.labelZh}：灯光[${c.lightingZh}] 情绪[${c.emotionZh}] 运镜[${c.cameraZh}] 文案节奏[${c.copyRhythmZh}]`,
  );

  const assemble = (tpl: string[], cf: string[]) =>
    [
      head,
      tpl.length ? `【可引用模板】\n${tpl.join("\n")}` : "【可引用模板】（当前无可用模板）",
      cf.length ? `【可引用手法】\n${cf.join("\n")}` : "",
      rules,
      `【用户问题】${question}`,
    ]
      .filter(Boolean)
      .join("\n\n");

  // 超长裁剪：先砍手法尾部，再砍模板尾部——保用户问题与规则完整
  let tpl = templateCards;
  let cf = craft;
  let out = assemble(tpl, cf);
  while (out.length > ADVISOR_QUESTION_MAX_CHARS && cf.length > 4) {
    cf = cf.slice(0, cf.length - 1);
    out = assemble(tpl, cf);
  }
  while (out.length > ADVISOR_QUESTION_MAX_CHARS && tpl.length > 2) {
    tpl = tpl.slice(0, tpl.length - 1);
    out = assemble(tpl, cf);
  }
  if (out.length > ADVISOR_QUESTION_MAX_CHARS) {
    // 极端兜底：底料压到最少后仍超长（超长问题），硬截尾部保住 API 上限
    out = out.slice(0, ADVISOR_QUESTION_MAX_CHARS);
  }
  return out;
}

/**
 * 从顾问回答里识别被点名的模板，供答案脚注挂「用这个模板试写→」。
 * 只做全名精确匹配——模板名是「xx·创作模板 CODE」形态，误匹配风险低。
 */
export function findMentionedTemplates(
  answer: string,
  templates: PublicManhuaViralTemplateCard[],
): PublicManhuaViralTemplateCard[] {
  const a = String(answer || "");
  if (!a) return [];
  const seen = new Set<string>();
  const hits: PublicManhuaViralTemplateCard[] = [];
  for (const t of templates || []) {
    if (!t?.nameZh || seen.has(t.publicId)) continue;
    // publicCode 变长（4-16 位）：「…节奏 AB12」是「…节奏 AB123」的前缀，
    // 单纯 includes 会把长码答案误挂到短码模板上——命中处后一位不能是字母数字
    let idx = a.indexOf(t.nameZh);
    let matched = false;
    while (idx >= 0) {
      const next = a[idx + t.nameZh.length];
      if (!next || !/[A-Za-z0-9]/.test(next)) {
        matched = true;
        break;
      }
      idx = a.indexOf(t.nameZh, idx + 1);
    }
    if (matched) {
      seen.add(t.publicId);
      hits.push(t);
    }
  }
  return hits.slice(0, 3);
}
