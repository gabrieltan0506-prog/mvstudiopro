/** 后期工坊「调色这条」跳转：从剪辑台 / 数字人页跳到后期工坊超分页签并预选该成片（调色本身走 videoGradeSubmit）。 */

export const POSTPROD_GRADE_EVENT = "mvs:postprod-grade";
export type PostProdGradeRequest = { url: string; label?: string };

/** 派发预选事件并滚到锚点；工坊未挂载时只滚动。 */
export function requestPostProdGrade(req: PostProdGradeRequest, target: Pick<Window, "dispatchEvent"> & { document?: Document } = window) {
  target.dispatchEvent(new CustomEvent<PostProdGradeRequest>(POSTPROD_GRADE_EVENT, { detail: req }));
  const doc = target.document ?? (typeof document !== "undefined" ? document : undefined);
  (doc?.getElementById("manhua-post-enhance") || doc?.getElementById("manhua-post-production"))?.scrollIntoView?.({ block: "start", behavior: "smooth" });
}
