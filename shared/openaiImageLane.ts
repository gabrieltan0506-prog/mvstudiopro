/**
 * 生图分道（两把官方密钥并行）
 *
 * - `asset`：角色定妆 / 场景空镜 / 关键道具设定图
 * - `keyart`：分镜关键静帧、段成片首帧、其余画布出图
 *
 * 前台把分道随 job payload 带上；服务端据此选密钥，任一把打不通立刻换另一把。
 */

export type OpenAiImageLane = "asset" | "keyart";

export const OPENAI_IMAGE_LANE_DEFAULT: OpenAiImageLane = "keyart";

export function normalizeOpenAiImageLane(raw: unknown): OpenAiImageLane | null {
  const v = String(raw || "").trim().toLowerCase();
  if (v === "asset" || v === "keyart") return v;
  return null;
}

const ASSET_BLOCK_PREFIXES = ["charsheet-", "sceneplate-", "propplate-", "propsheet-", "prop-"];

/** 画布方块 id → 分道；未知一律走 keyart（沿用原密钥，行为不变）。 */
export function resolveOpenAiImageLaneForBlockId(blockId: unknown): OpenAiImageLane {
  const id = String(blockId || "").trim();
  if (!id) return OPENAI_IMAGE_LANE_DEFAULT;
  if (ASSET_BLOCK_PREFIXES.some((p) => id.startsWith(p))) return "asset";
  return OPENAI_IMAGE_LANE_DEFAULT;
}
