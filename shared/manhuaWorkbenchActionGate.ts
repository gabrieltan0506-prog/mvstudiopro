/**
 * 工作台动作门槛文案：按钮应可点，不满足时用此文案报错，禁止静默变灰。
 */

import type { ManhuaAssetImageGateResult } from "./manhuaAssetImageGate.js";

export type ManhuaWorkbenchActionGateInput = {
  outlineComplete: boolean;
  assetGate: Pick<
    ManhuaAssetImageGateResult,
    | "castLocked"
    | "sceneLocked"
    | "castImagesReady"
    | "sceneImageReady"
    | "hintZh"
    | "missingCastIds"
  >;
  assetScriptStaleHintZh?: string | null;
  factoryBusy?: boolean;
  /** 成片类动作额外门槛 */
  videoBurnHintZh?: string | null;
  stillsReadyEnough?: boolean;
  visualBriefConfirmed?: boolean;
};

/** 返回 null 表示可跑；非空为用户可见原因 */
export function explainManhuaKeyartActionGate(
  input: ManhuaWorkbenchActionGateInput,
): string | null {
  if (input.factoryBusy) return "当前正在生成，请稍候或先点「中断生成」";
  if (!input.outlineComplete) return "还不能生成关键静帧：请先确认剧本大纲";
  const stale = String(input.assetScriptStaleHintZh || "").trim();
  if (stale) return `还不能生成关键静帧：${stale}（请先按剧本重出设定图）`;
  if (!input.assetGate.castLocked) {
    return "还不能生成关键静帧：请先锁定人物（确认剧本人物表，或勾选人物参考）";
  }
  if (!input.assetGate.sceneLocked) {
    return "还不能生成关键静帧：请先锁定场景（确认剧本场景表，或勾选场景参考）";
  }
  if (!input.assetGate.castImagesReady) {
    const n = input.assetGate.missingCastIds?.length || 0;
    return (
      input.assetGate.hintZh ||
      (n > 0
        ? `还不能生成关键静帧：还缺 ${n} 张角色定妆图，请在资产设定点「生成全部」`
        : "还不能生成关键静帧：请先出齐角色定妆图")
    );
  }
  if (!input.assetGate.sceneImageReady) {
    return (
      input.assetGate.hintZh ||
      "还不能生成关键静帧：请先出齐场景空镜（资产设定点「生成全部」或上传场景参考）"
    );
  }
  return null;
}

export function explainManhuaClipActionGate(
  input: ManhuaWorkbenchActionGateInput,
): string | null {
  const base = explainManhuaKeyartActionGate(input);
  if (base) return base.replace(/关键静帧/g, "成片");
  if (input.videoBurnHintZh) return `还不能生成成片：${input.videoBurnHintZh}`;
  if (!input.stillsReadyEnough && !input.visualBriefConfirmed) {
    return "还不能生成成片：请先点「生成关键静帧」出齐本集静帧";
  }
  return null;
}

export function explainManhuaEnterStoryboardGate(
  input: Pick<
    ManhuaWorkbenchActionGateInput,
    "outlineComplete" | "assetGate" | "assetScriptStaleHintZh" | "factoryBusy"
  >,
): string | null {
  return explainManhuaKeyartActionGate({
    ...input,
    videoBurnHintZh: null,
    stillsReadyEnough: true,
    visualBriefConfirmed: true,
  });
}
