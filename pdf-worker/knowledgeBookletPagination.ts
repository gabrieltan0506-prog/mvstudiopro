import type { Page } from "puppeteer";

/** 预分页和输出都在最终打印字体下执行，并拒绝页数已变化的缓存分页计划。 */
export async function finalizeKnowledgeBookletPagination(page: Page): Promise<number> {
  const count = await page.evaluate(`(async()=>{
    await document.fonts.ready;
    const roots=[...document.querySelectorAll('[data-booklet-root]')];
    for(const root of roots){
      if(typeof root.__layoutBooklet!=='function')throw new Error('知识书册排版脚本未就绪');
      await root.__layoutBooklet();
      if(root.dataset.ready!=='true')throw new Error('知识书册排版未通过');
    }
    const count=document.querySelectorAll('[data-booklet-root] .folio').length;
    const expected=Number(document.body.dataset.bookletExpectedPages||0);
    if(expected&&expected!==count)throw new Error('知识书册页数已变化，请重新导出');
    return count;
  })()`);
  if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 0)
    throw new Error("知识书册分页计数无效");
  return count;
}

/** 预分页回报的逐章细节（2026-11-11 压缩适配用）：各片段页数、实际版式（跨页/图文同页）、最大单页留白；layout=分页脚本已算好的逐页版面测量（只读带回，供版面审查）。旧服务端只读 pages，忽略本字段。 */
type KnowledgeBookletDetail = { pages: number; imageModes: Record<string, string>; maxWhitespace: number; layout?: unknown[] };
export async function readKnowledgeBookletDetails(page: Page): Promise<KnowledgeBookletDetail[]> {
  const details = await page.evaluate(`[...document.querySelectorAll('[data-booklet-root]')].map(r=>{const k=r.__knowledgeBooklet||{};return {pages:Number(k.pages)||0,imageModes:k.imageModes||{},maxWhitespace:Number(k.maxWhitespace)||0,layout:Array.isArray(k.layout)?k.layout:undefined};})`);
  return Array.isArray(details) ? details as KnowledgeBookletDetail[] : [];
}
