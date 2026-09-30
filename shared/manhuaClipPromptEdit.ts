import { normalizeManhuaPromptSeconds } from "./manhuaPromptSeconds";

export type ManhuaClipPromptEdit = { text: string; sourceRevision: string };

export function normalizeManhuaClipPromptEdit(value: unknown): ManhuaClipPromptEdit | undefined {
  if (!value || typeof value !== "object") return undefined;
  const draft = value as Partial<ManhuaClipPromptEdit>;
  if (typeof draft.text !== "string" || !draft.text.trim() || draft.text.length > 120_000 || typeof draft.sourceRevision !== "string" || !draft.sourceRevision) return undefined;
  return { text: normalizeManhuaPromptSeconds(draft.text.trim()), sourceRevision: draft.sourceRevision };
}

/** 编辑全文经重铺、重编译仍生效；原稿身份变化时明确阻断，不默默覆盖。 */
export function resolveManhuaEditedClipPrompt(derived: string, edit: ManhuaClipPromptEdit | undefined, sourceRevision: string): string {
  if (!edit) return derived;
  if (edit.sourceRevision !== sourceRevision) throw new Error("本段原稿分段已变化，请重新审阅并保存全文提示词；本次未提交");
  return normalizeManhuaPromptSeconds(edit.text);
}
