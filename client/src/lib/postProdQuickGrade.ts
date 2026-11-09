/**
 * 后期工坊「调色这条 / 局部修改这条」跳转：从剪辑台 / 数字人页跳到后期工坊超分页签并预选该成片，
 * mode 决定展开调色（videoGradeSubmit）还是局部修改（videoEditSubmit）。缺省 grade。
 */

export const POSTPROD_GRADE_EVENT = "mvs:postprod-grade";
export type PostProdQuickMode = "grade" | "edit";
export type PostProdGradeRequest = { url: string; label?: string; mode?: PostProdQuickMode };

/** 派发预选事件并滚到锚点；工坊未挂载时只滚动。 */
export function requestPostProdGrade(req: PostProdGradeRequest, target: Pick<Window, "dispatchEvent"> & { document?: Document } = window) {
  target.dispatchEvent(new CustomEvent<PostProdGradeRequest>(POSTPROD_GRADE_EVENT, { detail: req }));
  const doc = target.document ?? (typeof document !== "undefined" ? document : undefined);
  (doc?.getElementById("manhua-post-enhance") || doc?.getElementById("manhua-post-production"))?.scrollIntoView?.({ block: "start", behavior: "smooth" });
}

/** 局部修改跳转：同一事件，mode:"edit"。 */
export function requestPostProdEdit(req: Omit<PostProdGradeRequest, "mode">, target?: Pick<Window, "dispatchEvent"> & { document?: Document }) {
  requestPostProdGrade({ ...req, mode: "edit" }, target);
}
