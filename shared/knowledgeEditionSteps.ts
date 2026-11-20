/** 顺序与手册 worker 实际执行阶段一致。缓存命中走独立的两步路径。 */
const steps = [
  "整理原稿", "汇总知识与疑点", "联网核实与修订", "保存核实结果",
  "合并已核实章节", "整理完整版和精华版标题",
  // 两档并行存稿与分页；准备阶段不再用无头浏览器量文字页数（该页数没有使用方）。
  "保存完整版和精华版正文和章节", "计算并保存完整版和精华版图文分页",
  "保存两版成稿", "登记成稿",
] as const;

export function editionStepPosition(label:string, cached:boolean): {editionStepNumber?:number;editionStepTotal?:number} {
  const route:readonly string[] = cached ? ["读取成稿并整理标题", "登记成稿"] : steps;
  const index = route.indexOf(label);
  return index < 0 ? {} : {editionStepNumber:index+1, editionStepTotal:route.length};
}
