import { KNOWLEDGE_LAYOUT_INSPIRATION } from './knowledgeDesignInspiration';
import { z } from 'zod';

/** 组件是可组合的真实视觉单元，不等于整套模板；候选描述同时供顾问选择与人工预览。 */
export const knowledgeDecorationCatalog = {
  artwork: [
    { id:'shiji-watercolor', label:'青铜竹简与山川', topics:'中国古代史、史记、文献阅读；无相机或西方建筑', colors:'赭石、暖纸、草木绿' },
    { id:'cinema-blue', label:'蓝灰电影建筑', topics:'电影、摄影、科幻影像分析；不适用于古代知识或医学', colors:'蓝灰、冷白' },
    { id:'cinema-autumn', label:'秋色园林与电影', topics:'古装影视、叙事创作、电影研究；包含摄影机，不用于古代事实图解', colors:'秋金、米黄' },
    { id:'cinema-rose', label:'玫瑰城市与摄影', topics:'城市影像、摄影、生活美学；包含西方建筑，不用于中国古代知识', colors:'灰玫瑰、暖白' },
    { id:'none', label:'不使用题材插画', topics:'没有匹配素材时，选择通用纹样与原知识图，不强行套图', colors:'跟随模板' },
  ],
  divider: [
    {id:'botanical',label:'草木花枝',topics:'自然、生态、生活、文化'},
    {id:'cloud-scroll',label:'云气卷纹',topics:'中国历史、古典文化'},
    {id:'geometric',label:'几何秩序',topics:'科技、工程、理性知识'},
    {id:'none',label:'留白分隔',topics:'内容密集时'},
  ],
  table: [{id:'floral-corner',label:'插画角饰表格'},{id:'double-rule',label:'双线题签表格'},{id:'plain',label:'简洁表格'}],
  interleave: [{id:'original-image',label:'完整原图穿插正文，禁止裁切图中文字'},{id:'artwork-strip',label:'主题插画穿插段落，不替代知识图'},{id:'none',label:'仅章节插画，不增加段间图'}],
} as const;
export const knowledgeVisualDesignSchema = z.object({
  palette:z.enum(['ink-cinnabar','jade-paper','bronze-sand','plum-ink','slate-blue']),
  layout:z.enum(['editorial','catalog','narrative']),
  table:z.enum(['rules','bands','minimal']),
  frame:z.enum(['rule','corners','none']),
  motif:z.enum(['bamboo-seal','route-array','relation-lines','book-scroll','bronze-geometric','herb-leaf','none']),
  reason:z.string().trim().min(8).max(600),
}).strict();
export type KnowledgeVisualDesign=z.infer<typeof knowledgeVisualDesignSchema>;
export const KNOWLEDGE_DESIGN_MARKER='【内容驱动设计合同v1】';
export const KNOWLEDGE_DESIGN_INSTRUCTIONS=`${KNOWLEDGE_DESIGN_MARKER}
每章decoration必须增加design对象，六个字段全部必填。每个字段的值都是单个字符串，不是数组或对象；前五项每项只选一个值，即使只选一项也不得加方括号，不接受空值或未知枚举。
以下是单选候选目录，不是返回JSON的结构：
- palette：${knowledgeVisualDesignSchema.shape.palette.options.map(v=>JSON.stringify(v)).join('、')}。
- layout：${knowledgeVisualDesignSchema.shape.layout.options.map(v=>JSON.stringify(v)).join('、')}。
- table：${knowledgeVisualDesignSchema.shape.table.options.map(v=>JSON.stringify(v)).join('、')}。
- frame：${knowledgeVisualDesignSchema.shape.frame.options.map(v=>JSON.stringify(v)).join('、')}。
- motif：${knowledgeVisualDesignSchema.shape.motif.options.map(v=>JSON.stringify(v)).join('、')}。
- reason：说明本章具体内容为何适合此组合，不能仅写美观、统一、换颜色。
合法结构示例（仅说明字段类型，各章应按内容重新选择，不得整批照抄）：${JSON.stringify({palette:'bronze-sand',layout:'catalog',table:'rules',frame:'corners',motif:'bamboo-seal',reason:'本章对照制度沿革与年代，青铜纸色和目录式布局突出年份关系，简牍纹样呼应史料。'})}。
先按本批所有章节的内容统筹分配，再逐章输出：战争/地理可选黛蓝朱砂、路线或阵列；制度/年代可选青铜纸色、简牍印章与规整表格；人物/关系可选关系线及舒展叙事；学术/文学可选竹青或灰紫、书卷；医药/自然可选叶脉或简牍。以上为语义参考而非固定套用，其他内容按实际含义搭配。没有匹配纹样时选none，不能用山水填空。
禁止相邻章节重复同一非none主纹样；四章及以上至少三种设计组合；任何非none纹样全册占比不超过一半（向上取整）。不能只换颜色来逃避纹样重复。相同主题可用兼容的关系线、几何纹或留白产生区别，不为求变化搭配无关图案。续页只用简洁页眉，不重复大幅插画；表头根据表格内容采用细线、分组色带或极简，不在每个表格重复山水花纹。装饰不能压住正文、改变数字或代替知识图。完整文字、原图及事实校核必须保留。
${KNOWLEDGE_LAYOUT_INSPIRATION}`;
/** 新合同严格要求设计字段；旧稿只在不带新合同标记时允许缺省。 */
export function validateKnowledgeDesignBatch(pages: {reading?:{decoration?:{design?:KnowledgeVisualDesign}}}[]) {
 const designs=pages.map((p,i)=>{const d=p.reading?.decoration?.design;if(!d)throw Error(`第${i+1}章缺少内容驱动设计字段`);return knowledgeVisualDesignSchema.parse(d);});
 // 重复纹样与组合数量是排版调整项，不再阻断正文、预览或导出。
 return designs;
}
export const knowledgeDecorationFields = {
  artworkId:z.enum(['shiji-watercolor','cinema-blue','cinema-autumn','cinema-rose','none']),
  header:z.enum(['illustrated','source-inset','plain']),
  divider:z.enum(['botanical','cloud-scroll','geometric','none']),
  table:z.enum(['floral-corner','double-rule','plain']),
  interleave:z.enum(['original-image','artwork-strip','none']),
  reason:z.string().trim().min(1).max(600),
  design:knowledgeVisualDesignSchema.optional(),
};
export const knowledgeDecorationSchema = z.object(knowledgeDecorationFields).strict().superRefine((v,c)=>{
  if(v.artworkId==='none'&&(v.header==='illustrated'||v.interleave==='artwork-strip'||v.table==='floral-corner'))
    c.addIssue({code:'custom',message:'没有匹配插画时不能选择依赖插画的组件'});
});
export type KnowledgeDecoration = z.infer<typeof knowledgeDecorationSchema>;
export const KNOWLEDGE_DECORATION_MARKER='【按内容组合真实装饰组件】';
export const KNOWLEDGE_DECORATION_INSTRUCTIONS=`${KNOWLEDGE_DECORATION_MARKER}
每页reading必须输出decoration={artworkId,header,divider,table,interleave,reason}，按以下真实目录组合，不只是改颜色与文字表格。header可选illustrated(大幅插画页眉)、source-inset(完整原知识图小窗)、plain(无插画页眉)。选择题材匹配的插画和纹样；相机、电影胶片、西方建筑不能放进史记、医学等不相关主题。没有匹配插画选none，不编造不存在的素材，不触发新付费生成。每章选择一种主插画，纹样与原图可穿插，避免全部堆满；装饰永远不是知识证据。原图不改字、不裁掉图内信息。reason写具体内容适配理由，不写模型或后台术语。目录：${JSON.stringify(knowledgeDecorationCatalog)}
${KNOWLEDGE_DESIGN_INSTRUCTIONS}`;
export function resolveKnowledgeDecoration(value:unknown,text:string):KnowledgeDecoration {
  if(value!==undefined)return knowledgeDecorationSchema.parse(value);
  // 旧稿仅作明确的本地版式兼容，不冒称模型已经选择；新请求必须输出配置。
  if(/史记|太史公|司马迁/.test(text))return {artworkId:'shiji-watercolor',header:'illustrated',divider:'cloud-scroll',table:'floral-corner',interleave:'original-image',reason:'旧稿兼容：以中国古代史主题选用专属插画，完整原图穿插说明'};
  return {artworkId:'none',header:'source-inset',divider:'botanical',table:'double-rule',interleave:'none',reason:'旧稿兼容：保留原图并使用通用纹样，不猜测其他题材插画'};
}
