/** 生成前音频交接：长期素材身份留任务，临时读取地址只进入上游请求。 */
import { resolveRegisteredPostProdMediaSource } from "./postProdMediaSource.js";
import { resolveTokenPlanDialogueAudioReference } from "./tokenPlanDialogueTts.js";
import { signGsUriV4ReadUrl } from "./gcs.js";

export type CanvasVideoAudioReferenceDeps = {
  register: (input: { userId: string; source: string }) => Promise<string>;
  legacy: typeof resolveTokenPlanDialogueAudioReference;
  sign: typeof signGsUriV4ReadUrl;
};

const realDeps: CanvasVideoAudioReferenceDeps = {
  register: resolveRegisteredPostProdMediaSource,
  legacy: resolveTokenPlanDialogueAudioReference,
  sign: signGsUriV4ReadUrl,
};

export async function resolveCanvasVideoAudioReference(
  input: { reference: string; ownerUserId: number },
  deps: CanvasVideoAudioReferenceDeps = realDeps,
): Promise<{ storedReference: string; url: string }> {
  const reference = String(input.reference || "").trim();
  // 旧 HTTPS / token-plan 继续使用原函数，既有权限与地址行为不变。
  if (!reference.startsWith("gs://") || reference.includes("/manhua-dialogue-tts/token-plan/")) {
    const url = deps.legacy({ reference, ownerUserId: input.ownerUserId });
    return { storedReference: url, url };
  }
  if (!Number.isInteger(input.ownerUserId) || input.ownerUserId <= 0) throw new Error("参考音频归属无效");
  const storedReference = await deps.register({ userId: String(input.ownerUserId), source: reference });
  return { storedReference, url: deps.sign(storedReference, 24 * 3600) };
}

/** 不修改任务音频数组；每次真正提交（含回落）重新验权并现签。 */
export async function resolveCanvasVideoAudioUrls(
  references: string[] | undefined,
  ownerUserId: number,
): Promise<string[] | undefined> {
  if (!references) return undefined;
  return Promise.all(references.map(async reference => (await resolveCanvasVideoAudioReference({ reference, ownerUserId })).url));
}
