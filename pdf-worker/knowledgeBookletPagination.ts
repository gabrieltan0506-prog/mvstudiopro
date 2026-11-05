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
