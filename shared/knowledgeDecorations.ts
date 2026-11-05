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
export const knowledgeDecorationSchema = z.object({
  artworkId:z.enum(['shiji-watercolor','cinema-blue','cinema-autumn','cinema-rose','none']),
  header:z.enum(['illustrated','source-inset','plain']),
  divider:z.enum(['botanical','cloud-scroll','geometric','none']),
  table:z.enum(['floral-corner','double-rule','plain']),
  interleave:z.enum(['original-image','artwork-strip','none']),
  reason:z.string().trim().min(1).max(600),
}).strict().superRefine((v,c)=>{
  if(v.artworkId==='none'&&(v.header==='illustrated'||v.interleave==='artwork-strip'||v.table==='floral-corner'))
    c.addIssue({code:'custom',message:'没有匹配插画时不能选择依赖插画的组件'});
});
export type KnowledgeDecoration = z.infer<typeof knowledgeDecorationSchema>;
export const KNOWLEDGE_DECORATION_MARKER='【按内容组合真实装饰组件】';
export const KNOWLEDGE_DECORATION_INSTRUCTIONS=`${KNOWLEDGE_DECORATION_MARKER}
每页reading必须输出decoration={artworkId,header,divider,table,interleave,reason}，按以下真实目录组合，不只是改颜色与文字表格。header可选illustrated(大幅插画页眉)、source-inset(完整原知识图小窗)、plain(无插画页眉)。选择题材匹配的插画和纹样；相机、电影胶片、西方建筑不能放进史记、医学等不相关主题。没有匹配插画选none，不编造不存在的素材，不触发新付费生成。每章选择一种主插画，纹样与原图可穿插，避免全部堆满；装饰永远不是知识证据。原图不改字、不裁掉图内信息。reason写具体内容适配理由，不写模型或后台术语。目录：${JSON.stringify(knowledgeDecorationCatalog)}`;
export function resolveKnowledgeDecoration(value:unknown,text:string):KnowledgeDecoration {
  if(value!==undefined)return knowledgeDecorationSchema.parse(value);
  // 旧稿仅作明确的本地版式兼容，不冒称模型已经选择；新请求必须输出配置。
  if(/史记|太史公|司马迁/.test(text))return {artworkId:'shiji-watercolor',header:'illustrated',divider:'cloud-scroll',table:'floral-corner',interleave:'original-image',reason:'旧稿兼容：以中国古代史主题选用专属插画，完整原图穿插说明'};
  return {artworkId:'none',header:'source-inset',divider:'botanical',table:'double-rule',interleave:'none',reason:'旧稿兼容：保留原图并使用通用纹样，不猜测其他题材插画'};
}
