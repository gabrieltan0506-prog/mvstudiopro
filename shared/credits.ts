/**
 * Credits 消耗定价 — 前后端共用
 */
export const CREDIT_COSTS = {
  // ─── 基础功能 ───────────────────────────────────
  mvAnalysis: 8,
  idolGeneration: 3,
  storyboard: 15,
  forgeImage: 0,

  // ─── AI 文本生成（Gemini）─────────────────────
  aiInspiration: 5,

  // ─── NBP 图片生成 ────────────────────────────
  nbpImage2K: 5,
  nbpImage4K: 9,

  // ─── 2D 转 3D（Hunyuan3D v3.1）────────────────
  rapid3D: 5,         // 闪电 3D（Rapid）
  rapid3D_pbr: 8,     // 闪电 3D + PBR 材质
  pro3D: 9,           // 精雕 3D（Pro）
  pro3D_pbr: 12,      // 精雕 3D + PBR
  pro3D_pbr_mv: 15,   // 精雕 3D + PBR + 多视角
  pro3D_full: 18,     // 精雕 3D 全选项

  // ─── 高级功能（Credits 设高，限制使用）────────
  videoGeneration: 50,
  idol3D: 30,

  // ─── Suno 音乐生成 ────────────────────
  sunoMusicV4: 12,
  sunoMusicV5: 22,
  sunoLyrics: 3,

  // ─── Kling 视频生成（最高门槛）────────────────
  klingVideo: 80,
  klingMotionControl: 70,
  klingLipSync: 60,

  // ─── Kling 圖片生成 ────────────────────────────
  klingImageO1_1K: 8,
  klingImageO1_2K: 10,
  klingImageV2_1K: 5,
  klingImageV2_2K: 7,
} as const;

export type CreditAction = keyof typeof CREDIT_COSTS;
