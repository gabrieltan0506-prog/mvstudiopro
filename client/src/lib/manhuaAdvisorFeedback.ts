const CONTEXT_FIELD_LABELS: Record<string, string> = {
  seriesTitle: "剧名", episodeIndex: "集号", episodeTitle: "本集标题",
  stage: "当前阶段", videoModel: "成片引擎", writerConfirmed: "剧本确认状态",
  episodeBody: "本集正文", assetSummary: "资产说明", shotSummary: "分镜说明",
  blockers: "待处理问题", directorStrategyId: "创作策略", history: "最近对话",
  directorStrategyRevision: "创作策略版本",
};

/** 只显示业务字段，原始校验结构不得出现在普通用户的提示里。 */
export function formatManhuaAdvisorContextIssue(issue: { path: PropertyKey[]; message: string }): string {
  const label = CONTEXT_FIELD_LABELS[String(issue.path[0])] || "项目内容";
  if (/超过/.test(issue.message)) {
    const limit = issue.message.match(/超过\s*(\d+)\s*字符上限/)?.[1];
    return `${label}${limit ? `超过 ${limit} 字符` : "超出读取范围"}，本次没有发送，也不会自动截断。`;
  }
  if (/URL|凭证/.test(issue.message)) return `${label}含链接或敏感内容，请移除后再咨询。`;
  return `${label}格式不完整，请检查后再咨询。`;
}

/** 失败类型保留，原始供应商错误不进入公共顾问面板。 */
export function formatManhuaAdvisorError(raw: string): string {
  if (/ADVISOR_OPERATION_RUNNING/.test(raw)) return "原问题仍在处理，请稍后用同一编号恢复；不会自动创建新问答。";
  if (/ADVISOR_OPERATION_REFUND_PENDING/.test(raw)) return "原问答失败，退款正在对账，尚不能确认到账。请稍后恢复原请求查看。";
  if (/ADVISOR_OPERATION_FAILED/.test(raw)) return "原问答已失败。再次提问会作为新的一次，重新检查免费额度并在需要扣点时询问。";
  if (/ADVISOR_OPERATION_MISMATCH/.test(raw)) return "本次请求编号与原问题不一致，未执行新的问答。请重新填写问题。";
  if (/UNAUTHORIZED|登录/i.test(raw)) return "登录状态已失效，请重新登录后继续。";
  if (/不足/.test(raw)) return "本次问答所需积分不足，请检查账户额度。";
  if (/超时|timeout|abort|网络|fetch failed/i.test(raw)) return "本次问答连接中断或超时，请稍后检查并重试原问题。";
  if (/429|繁忙|rate.?limit|too.?many/i.test(raw)) return "顾问当前繁忙，请稍后重试原问题。";
  if (/没有收到有效回答/.test(raw)) return "本次没有收到有效回答，请重试原问题。";
  if (/上限|超出|校验|格式|too_big|invalid_type/i.test(raw)) return "当前问题或项目内容未通过检查，请检查内容后再咨询。";
  return "顾问本次未能返回有效答复，原问题已保留，可稍后重试。";
}
