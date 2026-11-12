import type { KnowledgeDecoration } from './knowledgeDecorations';
import { KNOWLEDGE_DECORATION_ART } from './knowledgeDecorationAssets';

export const knowledgeDecorationClass=(d:KnowledgeDecoration)=>'kd-'+[d.artworkId,d.header,d.divider,d.table,d.interleave].join('-');
export function knowledgeDividerSvg(kind:KnowledgeDecoration['divider']) {
  if(kind==='none')return '';
  const paths=kind==='cloud-scroll'
    ? '<path d="M4 22h36c-18-22 24-25 24-8 0 13-20 11-12 1M256 22h-36c18-22-24-25-24-8 0 13 20 11 12 1M82 20h96M120 15l10-7 10 7-10 7z"/>'
    :kind==='geometric'?'<path d="M5 18h85l14-10 14 10-14 10-14-10m28 0h24l14-10 14 10-14 10-14-10m28 0h85"/>'
    :'<path d="M8 26Q60 10 102 18M32 20Q25 2 43 6Q49 16 32 20M62 16Q64 0 78 5Q81 17 62 16M252 26Q200 10 158 18M228 20Q235 2 217 6Q211 16 228 20M198 16Q196 0 182 5Q179 17 198 16M123 17q7-20 14 0-7 20-14 0"/>';
  return '<svg class="decoration-divider" viewBox="0 0 260 34" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true">'+paths+'</svg>';
}
export function knowledgeDecorationCss(d:KnowledgeDecoration){
 const root='[data-decoration="'+knowledgeDecorationClass(d)+'"]',art=KNOWLEDGE_DECORATION_ART[d.artworkId]||'';
 const palette=d.artworkId==='cinema-blue'?['#edf1f4','#334659','#627f97','#bdcbd5']:d.artworkId==='cinema-rose'?['#fbefeb','#604447','#a47575','#ddbeb4']:['#fff5e6','#594534','#9c6946','#cfb78f'];
 const rule=(selector:string,body:string)=>selector.split(',').map(s=>root+' '+s.trim()).join(',')+'{'+body+'}\n';
 let css=d.artworkId==='none'?'':`${root}{--paper:${palette[0]};--ink:${palette[1]};--accent:${palette[2]};--line:${palette[3]};color:var(--ink)}\n`;
 css+=rule('.reading-folio','background:var(--paper)');
 css+=rule('.reading-title','border:0;border-bottom:3px double var(--line);border-radius:0;background:none;padding:16px 20px;position:relative');
 css+=rule('.reading-title h2','font-size:44px;letter-spacing:3px!important;border:0;padding:0;color:var(--ink)');
 css+=rule('.reading-subtitle','font-size:20px');
 css+=rule('.reading-title .botanical','display:none');
 css+=rule('.reading-unit','border:1px solid var(--line);background:color-mix(in srgb,var(--paper) 35%,#fff);border-radius:8px;color:var(--ink)');
 css+=rule('.unit-heading','background:color-mix(in srgb,var(--line) 30%,var(--paper));color:var(--ink);border-bottom:1px solid var(--line)');
 css+=rule('.unit-heading h3','color:var(--ink);font-size:27px');
 css+=rule('.table-unit','border:2px solid var(--line)!important;box-shadow:3px 4px 0 color-mix(in srgb,var(--line) 30%,transparent)!important;background:color-mix(in srgb,var(--paper) 35%,#fff)!important');
 css+=rule('.table-unit .unit-heading','position:relative;background:color-mix(in srgb,var(--line) 35%,var(--paper));border:0');
 css+=rule('.table-unit:after','display:none');
 css+=rule('.table-unit th','background:var(--ink)');
 css+=rule('.prose-unit blockquote','background:color-mix(in srgb,var(--line) 25%,var(--paper));border-color:var(--accent)');
 css+=rule('.decoration-divider','display:block;width:240px;height:32px;margin:14px auto 0;color:var(--accent);opacity:.85');
 css+=rule('.interleaved-visual','padding:12px 16px;text-align:center;background:var(--paper)');
 css+=rule('.interleaved-visual img','width:100%;height:265px;object-fit:contain;display:block');
 css+=rule('.interleaved-visual figcaption','font-size:18px;line-height:1.6;margin-top:8px;color:var(--ink)');
 css+=rule('.interleaved-art img','height:170px;object-fit:contain');
 if(d.header==='illustrated'){
   if(!art)throw new Error('所选章节插画缺少实际素材');
   css+=rule('.reading-title','height:530px;padding:338px 20px 12px;margin-top:0');
   css+=rule('.reading-title:before',`content:"";position:absolute;top:0;left:-35px;right:-35px;height:340px;background:url('${art}') center/cover no-repeat;mask-image:linear-gradient(#000 0%,#000 78%,transparent)`);
   css+=rule('.reading-title>div:first-child','max-width:100%;width:100%');
   css+=rule('.reading-title .eyebrow,.reading-title .art-window','display:none');
   css+=rule('.reading-columns,.reading-column','height:1450px');
 } else if(d.header==='plain'){
   css+=rule('.reading-title','height:220px');css+=rule('.reading-title .art-window','display:none');css+=rule('.reading-columns,.reading-column','height:1800px');
 } else {
   // 站长 2026-11-13：续页右上角用本章信息图的局部、四周淡出（史记导读手册的做法）；尺寸与遮罩沿用版式基础样式 .art-window，不再改成整图小窗。
   css+=rule('.reading-title .art-window','width:440px!important;height:280px');
 }
 if(d.table==='floral-corner'){
   if(!art)throw new Error('所选表格角饰缺少实际素材');
   css+=rule('.table-unit .unit-heading','padding-right:110px');
   css+=rule('.table-unit .unit-heading:after',`content:"";position:absolute;right:0;top:0;bottom:0;width:100px;background:linear-gradient(90deg,var(--paper),transparent 30%),url('${art}') right center/480px auto no-repeat;opacity:.85`);
 } else if(d.table==='plain'){
   css+=rule('.table-unit','border-width:1px!important;box-shadow:none!important');css+=rule('.table-unit:before','display:none');
 } else css+=rule('.table-unit','border:4px double var(--line)!important');
 return css;
}
