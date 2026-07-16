/**
 * 编导分镜图（平台视频向 2×4 / 3×4 合成表）
 *
 * 产品命名：原「分镜图」→「编导分镜图」，因为合成分镜已并入导演板视角
 *（灯光/运镜/情绪/节奏/观众必看点），而非纯格位清单。
 *
 * 手法来源（内部）: downloads/2026Jul16 d1.mp4 / d2.mp4 超高密度抽帧
 * - d1：同一段提示词，带/不带导演板成片差异巨大；角色卡 + 大师级运镜蒙太奇导演板
 * - d2：Seedance 2.0 场景下，僵硬传统分镜易锁死发挥；优先导演板 + 多参考；
 *       结构含风格/时长/起承转合/关键技法/情绪反转/观众必须看到
 *
 * 成稿硬约束：只借手法词，禁止导演名 / 片名 /「某某风·致敬」。
 * 全案/自定义：与 `CRAFT_TECHNIQUE_PROFILES` 手法卡融合为「导演灵感画布」。
 */

import {
  formatAssignedCraftTechniqueZh,
  pickCraftTechniqueProfile,
} from "./storyboardLightingEmotion.js";

/** 用户可见产品名（按钮、画廊、扣费、导出） */
export const BIAN_DAO_STORYBOARD_LABEL_ZH = "编导分镜图";
export const BIAN_DAO_STORYBOARD_SHEET_LABEL_ZH = "编导分镜表";
export const BIAN_DAO_STORYBOARD_BUNDLE_LABEL_ZH = "编导分镜套装";

/**
 * 注入脚本语境的「导演板」硬约束（视频向 sheet 专用）。
 * 不替代六栏表，而是在其上叠加全局编导层。
 */
export const BIAN_DAO_DIRECTOR_BOARD_GUIDANCE_ZH = `【编导分镜·导演板（必遵）】
本图是**编导分镜图**（分镜格 + 导演板），不是只有景别清单的传统分镜表。
1) **全局导演板**（须能从顶栏梗概与八/十二格递进读出）：风格气质（紧张/温暖/冷峻等手法词）· 建议时长节拍（如 15 秒单幕或等价口播节拍）· 角色表演提要（微表情/身体态度，不写演员名）· 整体节奏起—承—转—合 · 1–2 个关键技法（运镜或灯光手法词）· 观众情绪弧（压迫→好奇→反转→收束等，只写情绪词）。
2) **每格仍填六栏**：景别 / 运镜 / 灯光安排 / 情绪表达 / 画面内容 / 台词与音效；并隐含「观众必须看到」的信息点（道具/表情/关系，勿另开栏堆字）。
3) **成片友好**：格间情绪与机位连续递进，避免把大模型锁死在互不关联的静帧清单；为后续多参考/图生视频留出可迁移的光影与走位。
4) **成稿去名**：只借灯光运镜情绪手法词；禁止导演名、片名、「某某风/致敬」。`.trim();

/** 中文直送主体内的短句（拼进 buildCompositeSheetDirectChineseBody） */
export const BIAN_DAO_SHEET_BODY_DIRECTIVE_ZH = `【产品体裁】输出**编导分镜图**（电影级写实剧照格 + 底部六栏 + 顶栏内容总结须带导演板级节奏：起承转合与情绪弧）。同一提示词若只列静帧而无导演板节奏，视为不合格。`;

/**
 * 视频向合成脚本：追加导演板块 + 可选主手法卡（幂等）。
 */
export function enrichScriptContextWithBianDaoDirectorBoard(
  scriptContext: string,
  opts?: {
    sheetKind?: "storyboard" | "graphic";
    /** 有值时注入一张稳定手法卡（全案/自定义按条轮换） */
    craftSeed?: string | number;
    craftSlotLabel?: string;
  },
): string {
  const base = String(scriptContext || "").trim();
  if (!base) return base;
  if (opts?.sheetKind === "graphic") {
    if (opts.craftSeed == null || base.includes("【本条图文·视觉气质手法卡】")) return base;
    const profile = pickCraftTechniqueProfile(opts.craftSeed);
    return `${formatAssignedCraftTechniqueZh(profile, {
      slotLabel: opts.craftSlotLabel,
      forGraphic: true,
    })}\n\n${base}`.slice(0, 12000);
  }
  const parts: string[] = [];
  if (opts?.craftSeed != null && !base.includes("【本条导演灵感画布·主手法卡】")) {
    const profile = pickCraftTechniqueProfile(opts.craftSeed);
    parts.push(
      formatAssignedCraftTechniqueZh(profile, { slotLabel: opts.craftSlotLabel }),
    );
  }
  if (!base.includes("【编导分镜·导演板")) {
    parts.push(BIAN_DAO_DIRECTOR_BOARD_GUIDANCE_ZH);
  }
  if (!parts.length) return base;
  return `${parts.join("\n\n")}\n\n${base}`.slice(0, 12000);
}
