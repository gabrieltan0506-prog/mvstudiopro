import {z} from 'zod';
import {knowledgeVisualDesignSchema,validateKnowledgeDesignBatch,type KnowledgeVisualDesign,type KnowledgeDecoration} from './knowledgeDecorations';
import type {KnowledgeReview} from './knowledgePublication';
export const knowledgeVisualDesignPlanSchema=z.array(z.object({pageId:z.string().min(1),design:knowledgeVisualDesignSchema}).strict()).min(1).superRefine((items,ctx)=>{
 if(new Set(items.map(x=>x.pageId)).size!==items.length)ctx.addIssue({code:'custom',message:'设计计划页号重复'});
 try{validateKnowledgeDesignBatch(items.map(x=>({reading:{decoration:{design:x.design}}})));}catch(e){ctx.addIssue({code:'custom',message:e instanceof Error?e.message:'整册设计重复'});}
});
type Topic='war'|'law'|'thought'|'literature'|'medicine'|'people'|'history';
function topic(text:string):Topic{
 if(/医|扁鹊|仓公|诊|植物|生态/.test(text))return 'medicine';
 if(/屈原|贾谊|文学|诗|赋/.test(text))return 'literature';
 if(/老庄|孔|思想|哲学|道德|学术/.test(text))return 'thought';
 if(/制度|建制|变法|郡县|五体|法令|集权/.test(text))return 'law';
 if(/战争|战场|北击|灭六国|项羽|垓下|路线|连横|灭楚/.test(text))return 'war';
 if(/人物|世家|霸业|诸侯|韩信|谋主/.test(text))return 'people';
 return 'history';
}
const choices:Record<Topic,KnowledgeVisualDesign['motif'][]>={war:['route-array','bronze-geometric','relation-lines'],law:['bamboo-seal','bronze-geometric','book-scroll'],thought:['book-scroll','relation-lines','bamboo-seal'],literature:['book-scroll','herb-leaf','relation-lines'],medicine:['herb-leaf','bamboo-seal','book-scroll'],people:['relation-lines','bamboo-seal','bronze-geometric'],history:['bronze-geometric','bamboo-seal','relation-lines']};
const palette:Record<Topic,KnowledgeVisualDesign['palette']>={war:'ink-cinnabar',law:'bronze-sand',thought:'jade-paper',literature:'plum-ink',medicine:'jade-paper',people:'slate-blue',history:'bronze-sand'};
const reasons:Record<Topic,string>={war:'以路线和节点表达战场推进，朱砂只突出关键方向；深色表头便于比较战役。',law:'以简牍、印章和几何秩序对应制度条目，表格使用清晰细线与克制边框。',thought:'竹青与书卷关系线对应思想流派，叙事区舒展留白，减轻表格边框。',literature:'灰紫墨色与书卷留白对应文学和人物情绪，正文优先，不用战争箭头。',medicine:'草木纹与青绿辅助色对应医案阅读，简洁表格明确区分史料与说明。',people:'关系节点对应人物、封国和势力，分组色带帮助识别人物与事件。',history:'青铜几何与年代目录对应历史结构，保持表格顺序与原文完整。'};
/** 读取LLM真实设计，再仅在重复或旧稿缺省时按题材调整；不改正文和审校回执。 */
export function knowledgeContentDesignPlan(review:KnowledgeReview,force=false){
 const counts=new Map<string,number>();let last='';const max=Math.ceil(review.pages.length/2);
 const plans=review.pages.map(page=>{
  const suggested=page.reading?.decoration?.design;
  const kind=topic(page.headline),candidates=choices[kind];
  let design:KnowledgeVisualDesign=suggested?{...suggested}:{palette:palette[kind],layout:kind==='war'||kind==='law'?'catalog':kind==='thought'||kind==='literature'?'narrative':'editorial',table:kind==='people'?'bands':kind==='thought'||kind==='literature'?'minimal':'rules',frame:kind==='law'?'corners':kind==='thought'||kind==='medicine'?'none':'rule',motif:candidates[0],reason:'按内容重排：'+reasons[kind]};
  let adjusted=!suggested;
  if(design.motif!=='none'&&(design.motif===last||(counts.get(design.motif)||0)>=max)){
   design={...design,motif:candidates.find(m=>m!==last&&(counts.get(m)||0)<max)||'none'};adjusted=true;
  }
  counts.set(design.motif,(counts.get(design.motif)||0)+1);last=design.motif;
  if(adjusted&&suggested)design.reason+=' 整册检查避开相邻或高频重复纹样，按本章题材选择兼容图案。';
  return {pageId:page.id,design,origin:suggested?(adjusted?'model-adjusted':'model'):'content-rule'};
 });
 // 三种组合不足时，保留语义配色与纹样，只让适合长文的布局和表格承担差异。
 if(plans.length>=4&&new Set(plans.map(p=>JSON.stringify([p.design.palette,p.design.layout,p.design.table,p.design.frame,p.design.motif]))).size<3){
  const candidate=plans.find((p,i)=>i>0&&p.design.layout!=='narrative');if(candidate)candidate.design={...candidate.design,layout:'narrative',table:'minimal',reason:candidate.design.reason+' 长文采用叙事留白，与相邻目录页区分。'};
 }
 knowledgeVisualDesignPlanSchema.parse(plans.map(({pageId,design})=>({pageId,design})));
 return plans;
}
const palettes:Record<KnowledgeVisualDesign['palette'],string[]>={
 'ink-cinnabar':['#fbfaf6','#173644','#b34332','#c9d1d2','#eaf0f1'],
 'jade-paper':['#f8faf5','#283f38','#527765','#c5d3c9','#e9efea'],
 'bronze-sand':['#fcfaf4','#333d42','#957445','#d7cebd','#f1eadc'],
 'plum-ink':['#fbf8fa','#453745','#85667c','#dacdd7','#f0e9ef'],
 'slate-blue':['#f8fafb','#233d53','#537c9a','#c8d5df','#e9f0f5'],
};
export function knowledgeMotifSvg(motif:KnowledgeVisualDesign['motif']){
 const paths:Record<KnowledgeVisualDesign['motif'],string>={
 'bamboo-seal':'<path d="M58 35v120m24-120v120m24-120v120m24-120v120m24-120v120m-110-95h125m-125 68h125M220 44h90v90h-90zM234 58h62v62h-62zM245 71h40m-20-11v48m-20-13h40"/>',
 'route-array':'<path d="M35 140L110 70L200 115L300 30M35 140H310M110 70V140M200 115v25M290 28l14 0-2 14"/><circle cx="35" cy="140" r="8"/><circle cx="110" cy="70" r="8"/><circle cx="200" cy="115" r="8"/><path d="M45 25h8m18 0h8m18 0h8m-60 18h8m18 0h8m18 0h8"/>',
 'relation-lines':'<path d="M175 85L70 32m105 53 105-53M175 85L65 145m110-60 110 60"/><circle cx="175" cy="85" r="28"/><circle cx="70" cy="32" r="17"/><circle cx="280" cy="32" r="17"/><circle cx="65" cy="145" r="17"/><circle cx="285" cy="145" r="17"/>',
 'book-scroll':'<path d="M50 35q50-15 120 10v115q-65-25-120-10zm120 10q70-25 125-10v115q-55-15-125 10zM70 65q40-8 76 4m-76 19q40-8 76 4m-76 19q40-8 76 4m45-46q40-12 80-4m-80 27q40-12 80-4m-80 27q40-12 80-4"/>',
 'bronze-geometric':'<path d="M45 45h100v100H45V70h75v50H70V95h25m110-50h100v100H205V70h75v50h-50V95h25M25 25h300M25 165h300m-145-140v140"/>',
 'herb-leaf':'<path d="M170 160Q145 75 195 18M172 122Q105 135 100 82q52-5 72 40m-8-47q-58 4-57-39 44 0 57 39m9 33q70 6 75-42-55-4-75 42m9-62q50-1 55-36-34-3-55 36"/>',none:''};
 return motif==='none'?'':`<svg class="content-motif" data-motif="${motif}" viewBox="0 0 350 190" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true">${paths[motif]}</svg>`;
}
export const knowledgeContentDesignKey=(d:KnowledgeVisualDesign)=>[d.palette,d.layout,d.table,d.frame,d.motif].join("-");
export function knowledgeContentDesignCss(d:KnowledgeVisualDesign){
 const [paper,ink,accent,line,tint]=palettes[d.palette];
 return `
[data-content-design]{--paper:${paper};--ink:${ink};--accent:${accent};--line:${line};--tint:${tint};--white:#fff;color:var(--ink)}
[data-content-design] .folio{background:var(--paper);border:0;outline:0;box-shadow:none;padding:42px 66px 34px}
[data-content-design] .folio:before{display:none}
[data-content-design] .running{border-bottom:1px solid var(--line);color:var(--ink);font-size:13px;letter-spacing:1px}
[data-content-design] .running b{color:var(--accent);font-weight:700}
[data-content-design] .main-card{border:1px solid var(--line);border-radius:0;padding:8px;background:#fff;box-shadow:none}
[data-content-design] .image-title h1{font-family:'Songti SC','Noto Serif CJK SC',serif;letter-spacing:1px;color:var(--ink)}
[data-content-design] .image-caption .botanical{display:none}
[data-content-design] .reading-title{height:250px!important;margin:0 0 28px!important;padding:26px 0 20px!important;display:flex!important;flex-direction:${d.layout==='narrative'?'row-reverse':'row'}!important;border:0!important;border-bottom:2px solid var(--ink)!important;position:relative;gap:40px}
[data-content-design] .reading-title:before{display:none!important}
[data-content-design] .reading-title>div:first-child{max-width:1120px!important;padding:0!important;border:0!important}
[data-content-design] .reading-title h2{font:700 48px/1.35 'Songti SC','Noto Serif CJK SC',serif!important;letter-spacing:1px!important;margin:0 0 14px!important;color:var(--ink)}
[data-content-design] .reading-title .eyebrow{display:block!important;font-size:13px;letter-spacing:3px;color:var(--accent)}
[data-content-design] .reading-subtitle{display:none}
[data-content-design] .reading-title .art-window{display:none!important}
[data-content-design] .content-motif{display:block;width:340px;height:190px;color:var(--accent);opacity:.65;flex:none}
[data-content-design] .reading-columns,[data-content-design] .reading-column{height:1770px!important}
[data-content-design] .reading-columns{gap:44px}
[data-content-design] .reading-unit{border:0!important;border-radius:0!important;box-shadow:none!important;background:transparent!important;padding:12px 4px 20px;margin-bottom:16px;color:var(--ink)}
[data-content-design] .unit-heading{border:0;background:transparent;padding:0 0 12px;margin:0 0 12px;align-items:flex-start}
[data-content-design] .unit-heading h3{font:700 29px/1.45 'Songti SC','Noto Serif CJK SC',serif!important;color:var(--ink)}
[data-content-design] .unit-heading>span{border:0;border-radius:0;width:30px;height:30px;background:var(--tint);color:var(--accent);font:700 15px/30px Georgia,serif}
[data-content-design] .reading-unit p,[data-content-design] .reading-unit li{font-size:24px;line-height:1.8}
[data-content-design] .reading-unit strong{color:var(--accent)}
[data-content-design] .list-unit ul{columns:1}
[data-content-design] .decoration-divider{display:none}
[data-content-design] .table-unit{padding:0 0 16px!important;border:0!important;box-shadow:none!important;background:transparent!important}
[data-content-design] .table-unit .unit-heading{padding:12px 4px;background:transparent;border:0}
[data-content-design] .table-unit .unit-heading:after,[data-content-design] .table-unit:before{display:none!important}
[data-content-design] table{font-size:22px!important;line-height:1.65!important}
[data-content-design] .table-unit th{background:${d.table==='minimal'?'var(--tint)':'var(--ink)'};color:${d.table==='minimal'?'var(--ink)':'#fff'};padding:11px 12px;border:0;font-weight:600}
[data-content-design] .table-unit td{padding:11px 12px;border-bottom:1px solid var(--line);background:transparent}
[data-content-design] .table-unit tr:nth-child(even) td{background:${d.table==='bands'?'var(--tint)':'transparent'}}
[data-content-design] .prose-unit blockquote{border-left:3px solid var(--accent);background:var(--tint);padding:15px 18px;margin:8px 0}
[data-content-design] footer{border-color:var(--line);color:var(--ink)}
${d.frame==='corners'?'[data-content-design] .reading-unit{border-left:2px solid var(--line)!important;padding-left:18px!important}':d.frame==='rule'?'[data-content-design] .prose-unit{border-bottom:1px solid var(--line)!important}':''}
[data-content-design] .reading-continuation .reading-title{height:145px!important}
[data-content-design] .reading-continuation .content-motif{display:none}
[data-content-design] .reading-continuation .reading-title h2{font-size:34px!important}
`.replaceAll("[data-content-design]",`[data-booklet-root][data-content-design="${knowledgeContentDesignKey(d)}"]`);
}
export function contentDecoration(base:KnowledgeDecoration,design:KnowledgeVisualDesign):KnowledgeDecoration{
 return {...base,artworkId:'none',header:'plain',divider:'none',table:'plain',interleave:'none',design};
}
