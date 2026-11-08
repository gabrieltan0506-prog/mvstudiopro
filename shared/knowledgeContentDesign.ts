import {z} from 'zod';
import {knowledgeVisualDesignSchema,validateKnowledgeDesignBatch,type KnowledgeVisualDesign,type KnowledgeDecoration} from './knowledgeDecorations';
import type {KnowledgeReview} from './knowledgePublication';
export const knowledgeVisualDesignPlanSchema=z.array(z.object({pageId:z.string().min(1),design:knowledgeVisualDesignSchema}).strict()).min(1).superRefine((items,ctx)=>{
 if(new Set(items.map(x=>x.pageId)).size!==items.length)ctx.addIssue({code:'custom',message:'设计计划页号重复'});
 try{validateKnowledgeDesignBatch(items.map(x=>({reading:{decoration:{design:x.design}}})));}catch(e){ctx.addIssue({code:'custom',message:e instanceof Error?e.message:'整册设计重复'});}
});
/** 读取顾问已整理的设计；只校验可渲染结构，风格重复不阻断正文。 */
export function knowledgeContentDesignPlan(review:KnowledgeReview){
 const designs=validateKnowledgeDesignBatch(review.pages);
 return review.pages.map((page,i)=>({pageId:page.id,design:designs[i],origin:'model' as const}));
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
/** 纹样水印：同一SVG线稿以极淡描边放在页角，按章节内容选择，不做大幅页眉。 */
function motifWatermark(motif:KnowledgeVisualDesign['motif'],color:string){
 const svg=knowledgeMotifSvg(motif);
 if(!svg)return 'none';
 const tinted=svg.replace('stroke="currentColor"',`stroke="${color}" stroke-opacity="0.16"`).replace(/ class="[^"]*"| data-motif="[^"]*"| aria-hidden="true"/g,'');
 return `url("data:image/svg+xml;charset=utf-8,${encodeURIComponent(tinted)}")`;
}
export function knowledgeContentDesignCss(d:KnowledgeVisualDesign){
 const [paper,ink,accent,line,tint]=palettes[d.palette];
 const frame=d.frame==='corners'
  ? `[data-content-design] .reading-unit:before,[data-content-design] .reading-unit:after{content:"";position:absolute;width:26px;height:26px;pointer-events:none;border-color:var(--accent);opacity:.75}
[data-content-design] .reading-unit:before{left:6px;top:6px;border-left:2px solid;border-top:2px solid}
[data-content-design] .reading-unit:after{right:6px;bottom:6px;border-right:2px solid;border-bottom:2px solid}`
  : d.frame==='rule'
  ? `[data-content-design] .reading-unit{border-left:5px solid var(--accent)!important}`
  : `[data-content-design] .reading-unit{border-color:transparent!important;background:var(--tint)!important}`;
 const header=d.table==='minimal'?`background:var(--tint);color:var(--ink)`:`background:var(--ink);color:#fff`;
 return `
[data-content-design]{--paper:${paper};--ink:${ink};--accent:${accent};--line:${line};--tint:${tint};--white:#fffdf9;color:var(--ink)}
[data-content-design] .folio{background:var(--paper) ${motifWatermark(d.motif,accent)} no-repeat right 70px bottom 70px/420px auto;border:0;outline:0;box-shadow:none;padding:46px 70px 36px}
[data-content-design] .folio:before{display:block;inset:20px;border:1px solid var(--line);border-image:none}
[data-content-design] .folio:after{content:"";position:absolute;inset:27px;border:1px solid color-mix(in srgb,var(--line) 55%,transparent);pointer-events:none}
[data-content-design] .running{border-bottom:1px solid var(--line);color:var(--accent);font-size:13px;letter-spacing:3px}
[data-content-design] .running b{color:var(--accent);font-weight:700}
[data-content-design] .image-title{flex-direction:${d.layout==='narrative'?'row-reverse':'row'};border-bottom:2px solid var(--ink);padding-bottom:14px}
[data-content-design] .image-title h1{font:700 46px/1.35 'Songti SC','Noto Serif CJK SC',serif;letter-spacing:2px;color:var(--ink);text-shadow:none}
[data-content-design] .image-title .eyebrow{color:var(--accent)}
[data-content-design] .main-card{border:1px solid var(--line);border-radius:${d.layout==='catalog'?'4px':'14px'};padding:10px;background:#fff;box-shadow:0 3px 0 var(--tint)}
[data-content-design] .content-motif{display:block;color:var(--accent);opacity:.6;flex:none}
[data-content-design] .reading-title{height:200px!important;margin:0 0 26px!important;padding:24px 30px!important;display:flex!important;flex-direction:${d.layout==='narrative'?'row-reverse':'row'}!important;align-items:center;gap:40px;border:0!important;border-bottom:2px solid var(--ink)!important;border-radius:0!important;background:linear-gradient(100deg,var(--tint),transparent 75%)!important}
[data-content-design] .reading-title>div:first-child{max-width:1120px!important;padding:0!important;border:0!important}
[data-content-design] .reading-title h2{font:700 44px/1.35 'Songti SC','Noto Serif CJK SC',serif!important;letter-spacing:2px!important;margin:0 0 10px!important;color:var(--ink);border:0!important;padding:0!important}
[data-content-design] .reading-title .eyebrow{display:block!important;font-size:13px;letter-spacing:3px;color:var(--accent)}
[data-content-design] .reading-subtitle{font-size:20px;opacity:.75}
[data-content-design] .reading-title .content-motif{width:300px;height:150px}
[data-content-design] .reading-folio .reading-columns,[data-content-design] .reading-folio .reading-column{height:1720px!important}
[data-content-design] .reading-columns{gap:40px}
[data-content-design] .reading-unit{position:relative;border:1px solid var(--line)!important;border-radius:${d.layout==='catalog'?'6px':'14px'}!important;box-shadow:0 2px 0 var(--tint)!important;background:var(--white)!important;padding:18px 24px 20px!important;margin-bottom:16px;color:var(--ink);overflow:visible}
[data-content-design] .unit-heading{border:0;border-bottom:1px solid var(--line);background:transparent;color:var(--ink);padding:0 0 12px;margin:0 0 14px;align-items:center}
[data-content-design] .unit-heading h3{font:700 29px/1.45 'Songti SC','Noto Serif CJK SC',serif!important;color:var(--ink)}
[data-content-design] .unit-heading>span{width:36px;height:36px;border-radius:50%;border:3px double var(--accent);background:var(--white);color:var(--accent);font:700 15px/30px Georgia,serif}
[data-content-design] .reading-unit p,[data-content-design] .reading-unit li{font-size:24px;line-height:1.8}
[data-content-design] .reading-unit strong{color:var(--ink);background:linear-gradient(transparent 58%,color-mix(in srgb,var(--accent) 24%,transparent) 58%)}
[data-content-design] .list-unit ul{columns:1}
[data-content-design] .decoration-divider{display:none}
[data-content-design] .table-unit{padding:18px 20px 16px!important}
[data-content-design] .table-unit .unit-heading{margin:0 0 14px;padding:0 0 12px;background:transparent;border-bottom:1px solid var(--line)}
[data-content-design] .table-unit .unit-heading h3{color:var(--ink)}
[data-content-design] table{font-size:22px!important;line-height:1.65!important;border-radius:8px;overflow:hidden}
[data-content-design] .table-unit th{${header};padding:11px 12px;border:0;font-weight:600}
[data-content-design] .table-unit td{padding:11px 12px;border-bottom:1px solid var(--line);background:transparent}
[data-content-design] .table-unit tr:nth-child(even) td{background:${d.table==='bands'?'var(--tint)':'transparent'}}
[data-content-design] .prose-unit blockquote{border-left:4px solid var(--accent);background:var(--tint);padding:14px 18px;margin:8px 0;border-radius:0 10px 10px 0}
[data-content-design] footer{border-color:var(--line);color:var(--accent)}
${frame}
[data-content-design] .reading-continuation .reading-title{height:130px!important;padding:16px 26px!important}
[data-content-design] .reading-continuation .content-motif{display:none}
[data-content-design] .folio.reading-continuation{background-image:none}
[data-content-design] .reading-continuation .reading-title h2{font-size:32px!important}
[data-content-design] .reading-continuation .reading-subtitle{display:none}
`.replaceAll("[data-content-design]",`[data-booklet-root][data-content-design="${knowledgeContentDesignKey(d)}"]`);
}
export function contentDecoration(base:KnowledgeDecoration,design:KnowledgeVisualDesign):KnowledgeDecoration{
 return {...base,artworkId:'none',header:'plain',divider:'none',table:'plain',interleave:'none',design};
}
