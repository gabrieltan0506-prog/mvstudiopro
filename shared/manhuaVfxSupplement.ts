import { extractManhuaClipUserSupplement, upsertManhuaClipUserSupplement } from "./manhuaClipUserSupplement.js";

/** 采用到既有人工补充层，系统重编译仍保留；同镜替换，不覆盖其他镜或自由文字。 */
export function upsertManhuaShotVfx(prompt: string, shotIndex: number, direction: string): string {
  if (!Number.isInteger(shotIndex) || shotIndex < 1) throw new Error("请选择有效镜头");
  if (!direction.trim() || direction.length > 3000) throw new Error("特效描述需为1—3000字");
  if (/【用户补充】|【镜头特效[:：]|【特效结束】/.test(direction)) throw new Error("特效描述不能包含内部区块标记");
  const marker = `【镜头特效：${shotIndex}】`;
  const block = `${marker}\n${direction}\n【特效结束】`;
  const original = extractManhuaClipUserSupplement(prompt);
  const start = original.indexOf(marker);
  if (start >= 0) {
    const end = original.indexOf("【特效结束】", start);
    if (end < 0) throw new Error("原特效内容不完整，请先在补充指令中修正");
    return upsertManhuaClipUserSupplement(prompt, original.slice(0, start) + block + original.slice(end + "【特效结束】".length));
  }
  return upsertManhuaClipUserSupplement(prompt, [original, block].filter(Boolean).join("\n\n"));
}

/** 从现有补充层恢复已采用内容，供用户继续修改。 */
export function extractManhuaShotVfx(prompt: string, shotIndex: number): string {
  const extra = extractManhuaClipUserSupplement(prompt);
  const marker = `【镜头特效：${shotIndex}】`;
  const start = extra.indexOf(marker);
  if (start < 0) return "";
  const end = extra.indexOf("【特效结束】", start + marker.length);
  return end < 0 ? "" : extra.slice(start + marker.length, end).trim();
}
