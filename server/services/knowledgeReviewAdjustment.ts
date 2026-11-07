import { knowledgeVisualDesignSchema, knowledgeDecorationFields } from '../../shared/knowledgeDecorations';
import type { KnowledgeSource } from '../../shared/knowledgePublication';

type Adjustment = { pageId: string; field: string; before: unknown; after: unknown; reason: string };
const object = (value: unknown): value is Record<string, any> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/** 版式矛盾按正文和真实素材调整；原始模型回执由调用方另外保存。 */
export function adjustKnowledgeReviewPresentation(value: any, source: KnowledgeSource, requireDesign = false, requireDecoration = false) {
  const adjustments: Adjustment[] = [];
  if (!object(value) || value.kind !== 'knowledge_publication_v1' || !Array.isArray(value.pages)) return { value, adjustments };
  const result = structuredClone(value);
  let previousMotif = '';
  for (const page of result.pages) {
    if (!object(page) || !object(page.reading)) continue;
    const original = source.pages.find(p => p.id === page.id);
    if (!original) continue;
    const reading = page.reading;
    const set = (target: Record<string, any>, key: string, next: unknown, field: string, reason: string) => {
      if (JSON.stringify(target[key]) === JSON.stringify(next)) return;
      adjustments.push({ pageId: page.id, field, before: structuredClone(target[key] ?? null), after: structuredClone(next), reason });
      target[key] = next;
    };
    // 两个层级同时存在时保留正文内配置；外层原值留在调整回执，不静默消失。
    if (Object.prototype.hasOwnProperty.call(page, 'decoration')) {
      if (!object(reading.decoration)) set(reading, 'decoration', page.decoration, 'reading.decoration', '装饰配置归入正文结构');
      adjustments.push({pageId:page.id,field:'decoration',before:structuredClone(page.decoration),after:structuredClone(reading.decoration),reason:'采用正文内装饰配置，原值保留在回执'});
      delete page.decoration;
    }
    if (!object(reading.decoration)) {
      if (!requireDecoration && !requireDesign) continue;
      set(reading,'decoration',{},'reading.decoration','根据正文结构和真实素材补齐可渲染装饰，不重新购买正文');
    }
    const decoration = reading.decoration;
    if (!Object.prototype.hasOwnProperty.call(decoration,'artworkId') && Object.prototype.hasOwnProperty.call(decoration,'artwork'))
      set(decoration,'artworkId',decoration.artwork,'reading.decoration.artworkId','采用已有插画选择字段，不重新购买正文');
    for (const key of Object.keys(decoration)) if (!Object.prototype.hasOwnProperty.call(knowledgeDecorationFields,key)) {
      adjustments.push({pageId:page.id,field:`reading.decoration.${key}`,before:structuredClone(decoration[key]),after:null,reason:'未支持的装饰字段保留在原始回执和调整记录，不阻断正文'});
      delete decoration[key];
    }
    if (Object.prototype.hasOwnProperty.call(reading, 'design')) {
      if (!object(decoration.design)) set(decoration, 'design', reading.design, 'reading.decoration.design', '设计配置归入装饰结构');
      adjustments.push({pageId:page.id,field:'reading.design',before:structuredClone(reading.design),after:structuredClone(decoration.design),reason:'采用装饰内设计配置，原值保留在回执'});
      delete reading.design;
    }
    const text = `${original.headline}\n${original.body}`;
    const historical = /故宫|紫禁城|史记|太史公|司马迁|朝代|皇帝|王朝|中国古代/.test(text);
    const natural = /植物|生态|水循环|蒸发|药草|自然|生物/.test(text);
    const table = Array.isArray(reading.blocks) && reading.blocks.some((b:any) => b.type === 'table');
    const sequence = Array.isArray(reading.blocks) && reading.blocks.some((b:any) => b.type === 'sequence');
    const inferredDecoration = {artworkId:'none',header:original.imageUrl?'source-inset':'plain',divider:historical?'cloud-scroll':natural?'botanical':table?'geometric':'none',table:table?'double-rule':'plain',interleave:'none',reason:`依据“${original.headline.slice(0,100)}”的${table?'表格对照':'连续正文'}安排分隔与留白，仅使用已经存在的原图。`};
    for (const key of Object.keys(inferredDecoration) as (keyof typeof inferredDecoration)[]) {
      const current = Array.isArray(decoration[key]) && decoration[key].length === 1 ? decoration[key][0] : decoration[key];
      const parsed = knowledgeDecorationFields[key].safeParse(current);
      set(decoration,key,parsed.success ? parsed.data : inferredDecoration[key],`reading.decoration.${key}`,'按正文结构与实际素材修正装饰选项');
    }
    if (historical && !/电影|摄影|影视|镜头/.test(original.headline) && String(decoration.artworkId).startsWith('cinema-'))
      set(decoration,'artworkId','shiji-watercolor','reading.decoration.artworkId','中国历史正文使用古代文献素材，移除摄影器材或西方建筑');
    if (decoration.artworkId === 'none') {
      if (decoration.header === 'illustrated') set(decoration,'header',original.imageUrl ? 'source-inset' : 'plain','reading.decoration.header','没有题材插画，按真实原图可用性调整页眉');
      if (decoration.interleave === 'artwork-strip') set(decoration,'interleave',original.imageUrl ? 'original-image' : 'none','reading.decoration.interleave','没有题材插画，保留真实原图或正文留白');
      if (decoration.table === 'floral-corner') set(decoration,'table',table ? 'double-rule' : 'plain','reading.decoration.table','正文表格用线条区分，不依赖缺失插画');
    }
    if (!original.imageUrl) {
      if (decoration.header === 'source-inset') set(decoration,'header','plain','reading.decoration.header','当前正文没有原图，不放空图片窗');
      if (decoration.interleave === 'original-image') set(decoration,'interleave','none','reading.decoration.interleave','当前正文没有原图，取消不存在的原图穿插');
    }
    // 只修不合法或缺失的视觉选择，正文、事实及图片审校结论不由版式规则改写。
    if (!Object.prototype.hasOwnProperty.call(decoration,'design') && !requireDesign) continue;
    const design = object(decoration.design) ? decoration.design : {};
    for (const key of Object.keys(design)) if (!Object.prototype.hasOwnProperty.call(knowledgeVisualDesignSchema.shape,key)) {
      adjustments.push({pageId:page.id,field:`reading.decoration.design.${key}`,before:structuredClone(design[key]),after:null,reason:'未支持的视觉选项保留在回执，不影响完整正文'});
      delete design[key];
    }
    const inferred = {palette:historical?'bronze-sand':natural?'jade-paper':'slate-blue',layout:table?'catalog':sequence?'narrative':'editorial',table:table?'rules':'minimal',frame:table?'rule':'none',motif:historical?'book-scroll':natural?'herb-leaf':'relation-lines',reason:`依据“${original.headline.slice(0,100)}”的${table?'对照表格':sequence?'顺序关系':'连续论述'}组织版式，装饰服从正文与实际素材。`};
    for (const key of Object.keys(knowledgeVisualDesignSchema.shape) as (keyof typeof knowledgeVisualDesignSchema.shape)[]) {
      const current = Array.isArray(design[key]) && design[key].length === 1 ? design[key][0] : design[key];
      const parsed = knowledgeVisualDesignSchema.shape[key].safeParse(current);
      set(design,key,parsed.success ? parsed.data : inferred[key],`reading.decoration.design.${key}`,'依据本章内容和正文结构修正视觉配置');
    }
    decoration.design = design;
    if (design.motif !== 'none' && design.motif === previousMotif)
      set(design,'motif','none','reading.decoration.design.motif','相邻正文主题相近时用留白错开重复纹样，不引入无关题材');
    previousMotif = design.motif;
  }
  return { value: result, adjustments };
}
