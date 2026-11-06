/** 只复用当前视图实际对应的完整底稿；新粘贴/优化稿本身就是新原文。 */
export function knowledgeCardFullManuscript(text: string, full: string | null | undefined, concise: string | null | undefined): string {
  const current = text.trim();
  const original = full?.trim();
  return original && (current === original || current === concise?.trim()) ? original : current;
}

/** 正文与选图分开：精华选段只参与配图，不能替换完整正文。 */
export function knowledgeCardIllustrationMarkdown(text: string, full: string | null | undefined, concise: string | null | undefined, level: "concise" | "full"): string {
  if (level === "full") return knowledgeCardFullManuscript(text, full, concise);
  const current = text.trim();
  if (full?.trim() && (current === full.trim() || current === concise?.trim())) return concise?.trim() || "";
  return current;
}

export function knowledgeCardInputKey(input: {
  owner: string | null; text: string; full: string; level: string; template: string | null | undefined; model: string;
}): string {
  return JSON.stringify([input.owner, input.text.trim(), input.full.trim(), input.level, input.template || "", input.model]);
}

/** 创建原稿时和当前输入使用同一编码，不能在结果回调中为旧稿补盖新指纹。 */
export async function knowledgeCardInputFingerprint(key: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, "0")).join("");
}
