import type { ManhuaCreativeAdvisorContext } from "./manhuaCreativeAdvisor";

/** 2026-10-04 用户定价：每部作品终身共享五次；不改平台问答或白模渲染价格。 */
export const MANHUA_ADVISOR_PROJECT_FREE = 5;
export const MANHUA_ADVISOR_PAID_CREDITS = 12;
export const MANHUA_ADVISOR_AUTO_QUESTION = "检查当前创作步骤。结合人物动机、关系、时间逻辑、场景氛围、灯光、表演与运镜，指出具体镜头可以改善的地方。判断哪些复杂走位或打斗适合3D白模预演、哪些连续多角度场景适合3DGS、哪些角色值得做3D建模；优先复用已有资产，简单镜头不要强推建模。说明依据、预期改善和下一步。只给建议，不生成、不渲染、不采用；未实际观看的音视频不得声称审片通过。";

/** 自动检查不携带聊天历史和余额，避免回答或扣费本身触发下一轮检查。 */
export function automaticAdvisorContext(context: ManhuaCreativeAdvisorContext): ManhuaCreativeAdvisorContext {
  const { history: _history, previsEdit: _previs, studio3d: _studio, worldTarget: _world, ...rest } = context;
  return { ...rest, creditsZh: "自动检查不读取余额", queueZh: "以当前保存内容为准" };
}

function ordered(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(ordered);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, ordered(v)]));
  return value;
}

/** 同一账户/作品/内容跨刷新和设备复用操作编号；修改正文后才产生新检查。 */
export async function automaticAdvisorRequestId(userId: string, context: ManhuaCreativeAdvisorContext): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(ordered(["advisor-auto-v1", userId, automaticAdvisorContext(context), MANHUA_ADVISOR_AUTO_QUESTION])));
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", bytes));
  digest[6] = (digest[6]! & 15) | 0x50;
  digest[8] = (digest[8]! & 63) | 0x80;
  const hex = Array.from(digest.slice(0, 16)).map(v => v.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
