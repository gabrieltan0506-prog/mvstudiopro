/** 固定业务原因可保存和重放；不把模型原文、网址或凭证返回前台。 */
const knowledgeFailureCategories = [
  { pattern: /回执尚未闭合|结果尚待核实|传输或回执|原请求.*状态.*未确认/, message: "原请求的结果尚未确认，已保留原稿与任务；请恢复原任务，不要重新付费。", retryable: false },
  // 排版前的整册/分组篇幅整理（压缩）未完成：常见为单次调用超时；说清是哪一步、原稿保留、可只重试未完成部分。
  { pattern: /篇幅压缩[^。]{0,12}未完成/, message: "排版前的篇幅整理未完成（处理超时或结果未通过检查），超出的页面暂未进入排版；原稿和已完成部分已保留，可以仅重试未完成部分。", retryable: true },
  { pattern: /缺少来源|未取得真实联网来源|引用不属于本次检索|来源未融入|缺少可复用检索片段/, message: "本次整理缺少可核实的来源，未采用这份补充内容；原稿和已完成部分已保留。", retryable: true },
  { pattern: /装饰组件配置|自动选版结果|自动表格图文结构/, message: "本次整理未返回完整的排版内容，未采用不完整结果；原稿和已完成部分已保留。", retryable: true },
  { pattern: /JSON|输出合同不符|页编号.*不符|缺少实际配图审校|图文疑点没有说明|跨页核对返回未知页号|一致性核对未返回完整合同/, message: "本次整理返回的格式不完整或与原稿不符，未采用错误内容；原稿和已完成部分已保留。", retryable: true },
  { pattern: /容量|输出未完整结束/, message: "本批内容超过处理容量或输出未完整结束，未采用截断内容；原稿和已完成部分已保留。", retryable: true },
] as const;
export function knowledgePublicationFailureMessage(error: unknown): string | null {
  const raw = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  return knowledgeFailureCategories.find(item => raw.includes(item.message) || item.pattern.test(raw))?.message || null;
}

/** 前台只收到业务提示；不拼接上游错误、请求编号、模型或通道名。 */
export function knowledgePublicationPublicError(error: unknown): { message: string; retryable: boolean } {
  const raw = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  if(raw==="当前服务尚未应用顾问不另收费规则，请刷新后恢复原任务"||raw==="请先确认内文按实际页数计费，未扣费"||raw==="实际内文页数无法核对，未扣费")return {message:raw,retryable:false};
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
  const category = knowledgeFailureCategories.find(item => raw.includes(item.message));
  if (category) return { message: category.message, retryable: category.retryable };
  // 未经操作层归类就直接抛出的原因（如失败任务恢复时重跑篇幅整理再次超时）也要落到具体业务句，不落兜底句。
  // 原请求回执未闭合优先（不可重购）；其次才是篇幅整理未完成。
  const unclassified = knowledgeFailureCategories.slice(0, 2).find(item => item.pattern.test(raw));
  if (unclassified && /篇幅压缩/.test(raw)) return { message: unclassified.message, retryable: unclassified.retryable };
  if (/模型调用超过约\d+分钟上限|可只重试未完成部分/.test(raw))
    return { message: "本次整理未完成，已完成的内容和原稿均已保留，可以仅重试未完成部分。", retryable: true };
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
