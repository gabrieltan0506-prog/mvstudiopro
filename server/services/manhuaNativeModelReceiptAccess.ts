/**
 * 逐次模型回执包含供应商原始诊断，只允许当前站点 owner 获取。
 * 所有 Job 查询入口必须经过这里，避免专用列表与通用轮询规则分叉。
 */
export function shapeManhuaJobOutputForViewer(
  output: unknown,
  ownerAllowed: boolean,
): unknown {
  if (!output || typeof output !== "object" || Array.isArray(output)) return output;
  const safeOutput = { ...(output as Record<string, unknown>) };
  if (!ownerAllowed) delete safeOutput.nativeModelReceipts;
  return safeOutput;
}
