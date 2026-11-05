/** 前台只收到业务提示；不拼接上游错误、请求编号、模型或通道名。 */
export function knowledgePublicationPublicError(error: unknown): { message: string; retryable: boolean } {
  const raw = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  const retryMessages=[
    "原提纲仍在处理中或状态未确认，请使用规划按钮恢复原任务，暂不能重新付费。",
    "原提纲的积分退款尚未核对完成，请稍后再试，未创建新任务。",
    "原提纲已有结果，请恢复原任务，未重新付费。",
    "稿件或提纲已变化，请先读取云端最新稿件。",
  ];
  if(retryMessages.includes(raw))return {message:raw,retryable:false};
  if(/原请求尚未确认失败|上游请求状态尚未闭合/.test(raw))return {message:retryMessages[0],retryable:false};
  if(/原请求退款尚未确认|积分账暂不可读取|原请求积分仍在对账/.test(raw))return {message:retryMessages[1],retryable:false};
  if(raw.includes("原请求已有结果"))return {message:retryMessages[2],retryable:false};
  if(/稿件或提纲已变化|稿件或页数已变化/.test(raw))return {message:retryMessages[3],retryable:false};
  if (raw === "本次整理未完成，已完成的内容和原稿均已保留，可以仅重试未完成部分。") return {message:raw,retryable:true};
  if (raw.includes("REFUND_PENDING") || raw.includes("对账"))
    return { message: "本次整理未完成，积分仍在核对中。原稿已保存，请稍后继续。", retryable: false };
  if (raw.includes("ADVISOR_OPERATION_FAILED"))
    return { message: "本次整理未完成，已完成的内容和原稿均已保留，可以仅重试未完成部分。", retryable: true };
  if (/顾问提纲超出|单页内容超出|表格超出单页/.test(raw)) return {message:"顾问提纲超出页数或单页容量，尚未渲染。请调整提纲后再导出。",retryable:false};
  if (/最少页数|最多页数|页数范围无效/.test(raw)) return {message:"请填写有效的 PPTX 页数范围，最少页数不能大于最多页数。",retryable:false};
  if (/课件提纲|稿件已变化|当前页数范围/.test(raw)) return {message:"稿件或页数范围已改变，请先按当前设置规划并确认课件提纲。",retryable:false};
  if (/登录|UNAUTHORIZED/.test(raw)) return { message: "请先登录，再继续处理已保存的资料。", retryable: false };
  if (/积分不足|余额不足/.test(raw)) return { message: "积分不足，已完成的内容已保存。", retryable: false };
  if (/确认.*积分|积分.*变化|付费确认/.test(raw)) return { message: "本次费用需要重新确认，已保存的内容不会丢失。", retryable: false };
  if (/云端.*变化|云稿版本|CONFLICT/.test(raw)) return { message: "云端稿件已有新版本，请先读取当前稿件。你的修改尚未覆盖云端。", retryable: false };
  if (/请保留总标题|请把正文放在|正文为空或过长/.test(raw)) return { message: "请检查说明中的标题、页码和正文，保留每页编号以对应配图。", retryable: false };
  if (/配图已变化|原配图|配图.*缺失|图片未载入/.test(raw)) return { message: "部分配图与已保存稿件不一致，请先恢复完整原图。", retryable: false };
  if (/未保存|不属于当前账号|归属|本人|素材.*登记/.test(raw)) return { message: "请先保存本账号的原稿和配图，再继续整理。", retryable: false };
  if (/容量|过长/.test(raw)) return { message: "当前内容超过本次处理容量，原稿与已完成部分已保存。", retryable: false };
  return { message: "暂时未能完成，请继续已保存的任务。原稿和已完成内容均已保留。", retryable: false };
}
