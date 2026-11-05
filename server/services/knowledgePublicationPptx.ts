import type PptxGenJS from 'pptxgenjs';
import { createRequire } from 'node:module';
// 使用该库明确提供的Node入口，避免tsx与生产ESM的默认导出互操作差异。
const PptxConstructor = createRequire(import.meta.url)('pptxgenjs') as typeof PptxGenJS;
import sharp from 'sharp';
import { createHash } from 'node:crypto';
import type JSZip from 'jszip';
const Zip = createRequire(import.meta.url)('jszip') as typeof JSZip;
import { Marked } from 'marked';
import type { EditableLayout } from '../../shared/editableLayout';
import type { KnowledgeReview } from '../../shared/knowledgePublication';
import { resolveKnowledgeDecoration } from '../../shared/knowledgeDecorations';
import { KNOWLEDGE_DECORATION_ART } from '../../shared/knowledgeDecorationAssets';
import { knowledgeDividerSvg } from '../../shared/knowledgeDecorationRenderer';
import { chooseKnowledgeBookletTheme, KNOWLEDGE_BOOKLET_THEMES } from '../../shared/knowledgeBooklet';
import { resolveKnowledgePublicationTemplate } from '../../shared/knowledgePublicationTemplates';
import { loadKnowledgePublicationExport } from './knowledgePublicationExport';
import { readKnowledgeImage } from './knowledgePublicationAdvisor';
import { downloadGcsObjectVersioned, getGcsBucketName, signGsUriV4ReadUrl, uploadBufferToGcs } from './gcs';

export const KNOWLEDGE_PPTX_VERSION='knowledge-pptx-1105-v1';
const FONT='Microsoft YaHei', WIDTH=13.333333, HEIGHT=7.5;
const lexer=new Marked();
/** 去掉排版标记但保留可读内容，链接留在正文和备注；不把HTML当可执行内容。 */
function plain(value:string):string{
 const walk=(tokens:any[]):string=>tokens.map(t=>t.type==='image'?t.text:t.type==='link'?walk(t.tokens):t.type==='br'?'\n':t.tokens?walk(t.tokens):t.text??t.raw??'').join('');
 return walk(lexer.lexer(value)).trim();
}
// 按中西文宽度保守断行，正文固定字号；不缩小、不截断尾文。
function lines(value:string,width:number):string[]{
 const result:string[]=[];
 for(const paragraph of value.split('\n')){
  let line='',units=0;
  for(const char of paragraph){const n=/[\u0020-\u007e]/.test(char)?0.55:1;if(units+n>width&&line){result.push(line);line='';units=0;}line+=char;units+=n;}
  result.push(line);
 }
 return result;
}
export async function buildKnowledgePublicationPptx(doc:EditableLayout,review:KnowledgeReview,images:Record<string,string>){
 const deck=new PptxConstructor();deck.layout='LAYOUT_WIDE';deck.author='图文知识手册';deck.subject=doc.title;deck.title=doc.title;deck.theme={headFontFace:FONT,bodyFontFace:FONT};
 const dividerCache=new Map<string,string>();const artworkCache=new Map<string,string>();let slideCount=0;
 const cropped=async(data:string,width:number,height:number)=>{
  const key=data.slice(-100)+width+'x'+height;
  if(!artworkCache.has(key))artworkCache.set(key,'data:image/png;base64,'+(await sharp(Buffer.from(data.split(',')[1],'base64')).resize(width,height,{fit:'cover'}).png().toBuffer()).toString('base64'));
  return artworkCache.get(key)!;
 };
 for(const [chapter,page] of Array.from(doc.pages.entries())){
  const checked=review.pages[chapter];if(checked?.id!==page.id)throw new Error('PPTX章节与审校记录不一致');
  const selected=resolveKnowledgePublicationTemplate(doc.publication?.infographicTemplateId,checked.reading?.templateId);
  const theme=KNOWLEDGE_BOOKLET_THEMES[chooseKnowledgeBookletTheme(page.headline+'\n'+page.body,selected?.id)];
  const d=resolveKnowledgeDecoration(checked.reading?.decoration,doc.title+' '+page.headline);
  const color=(value:string)=>value.replace('#','');
  const ink=color(theme.ink),paper=color(theme.paper),accent=color(theme.accent),border=color(theme.line);
  const art=KNOWLEDGE_DECORATION_ART[d.artworkId];
  let sourceImage=page.imageUrl?images[page.imageUrl]:'';
  if(sourceImage){const raw=Buffer.from(sourceImage.split(',')[1],'base64');const resized=await sharp(raw).resize({width:2200,withoutEnlargement:true}).flatten({background:'#ffffff'}).jpeg({quality:90}).toBuffer();sourceImage='data:image/jpeg;base64,'+resized.toString('base64');}
  if(page.imageUrl&&!sourceImage)throw new Error('PPTX缺少章节原图');
  const sources=checked.sources?.map(s=>`${s.title}: ${s.url}`).join('\n')||'';
  const banner=art?await cropped(art,1600,102):'';
  const corner=art?await cropped(art,210,160):'';
  const imageSize=sourceImage?await sharp(Buffer.from(sourceImage.split(',')[1],'base64')).metadata():null;
  const sourceNotes=`${page.headline}\n${page.body}\n${sources}\n${checked.cautions.map(c=>c.message+'\n依据：'+c.evidence).join('\n')}`;
  let divider='';
  if(d.divider!=='none'){
   const key=d.divider+accent;
   if(!dividerCache.has(key)){
    const svg=knowledgeDividerSvg(d.divider).replace('currentColor','#'+accent).replace('<svg ','<svg xmlns="http://www.w3.org/2000/svg" width="520" height="68" ');
    dividerCache.set(key,'data:image/png;base64,'+(await sharp(Buffer.from(svg)).png().toBuffer()).toString('base64'));
   }
   divider=dividerCache.get(key)!;
  }
  const start=(heading:string)=>{
   if(++slideCount>1000)throw new Error('课件超过1000页，未截断导出');
   const slide=deck.addSlide();slide.background={color:paper};
   if(art&&d.header==='illustrated')slide.addImage({data:banner,x:0,y:0,w:WIDTH,h:0.85});
   else slide.addShape(deck.ShapeType.rect,{x:0,y:0,w:WIDTH,h:0.15,line:{color:accent},fill:{color:accent}});
   const title=lines(plain(heading),30); // 超长标题另放可编辑正文，不隐藏字。
   slide.addText(title.length<=2?title.join('\n'):`第${chapter+1}章 · 知识说明`,{x:0.68,y:0.98,w:11.95,h:0.88,fontFace:FONT,fontSize:27,bold:true,color:ink,margin:0,breakLine:false,valign:'middle'});
   slide.addShape(deck.ShapeType.line,{x:0.7,y:1.97,w:11.9,h:0,line:{color:border,width:1.3}});
   slide.addText(`${chapter+1} · ${doc.title}`,{x:0.7,y:7.08,w:10.7,h:0.2,fontFace:FONT,fontSize:9,color:ink,margin:0});
   slide.addText(String(slideCount).padStart(2,'0'),{x:11.9,y:7.05,w:0.7,h:0.25,fontFace:FONT,fontSize:11,color:ink,align:'right',margin:0});
   slide.addNotes(sourceNotes);
   return slide;
  };
  const textSlides=(heading:string,text:string)=>{
   const content=lines((lines(plain(heading),30).length>2?plain(heading)+'\n\n':'')+text,37);
   for(let from=0;from<content.length;from+=12){
    const slide=start(heading+(from?' · 续':''));
    slide.addText(content.slice(from,from+12).join('\n'),{x:0.85,y:2.2,w:11.65,h:4.35,fontFace:FONT,fontSize:22,color:ink,margin:0,paraSpaceAfter:0,lineSpacingMultiple:1.12,valign:'top',breakLine:false});
    if(divider)slide.addImage({data:divider,x:5.65,y:6.6,w:2,h:0.26});
   }
  };
  if(sourceImage){
   const slide=start(page.headline+' · 图解');
   const ratio=(imageSize!.width||1)/(imageSize!.height||1);const w=Math.min(11.9,4.8*ratio),h=w/ratio;
   slide.addImage({data:sourceImage,x:0.7+(11.9-w)/2,y:2.1+(4.8-h)/2,w,h});
   if(lines(plain(page.headline),30).length>2)textSlides('本章主题',plain(page.headline));
  }
  let heading=page.headline;
  let pending:string[]=[];
  const flushText=()=>{if(pending.length){textSlides(heading,pending.join("\n\n"));pending=[];}};
  for(const token of lexer.lexer(page.body)){
   if(token.type==='space'||token.type==='hr')continue;
   if(token.type==='heading'){flushText();heading=token.text;continue;}
   if(token.type==='table'){
    flushText();
    const t=token as typeof token & {header:{text:string}[];rows:{text:string}[][]};
    const count=t.header.length;
    // 宽表保持全部列，超过六列改为逐行字段卡，所有字段仍是可编辑文字。
    if(count>6){for(const [i,row] of Array.from(t.rows.entries()))textSlides(`${heading} · ${i+1}`,row.map((c,n)=>plain(t.header[n].text)+'：'+plain(c.text)).join('\n\n'));continue;}
    const width=11.65/count, capacity=Math.max(5,Math.floor(width*72/16)-2);
    const headers=t.header.map(c=>lines(plain(c.text),capacity).join('\n'));
    const headerHeight=Math.max(...headers.map(h=>h.split('\n').length))*0.29+0.20;
    if(headerHeight>2)throw new Error('表头过长，请先精简表头后导出PPTX；未丢弃内容');
    let rows:string[][]=[],heights:number[]=[],used=headerHeight,part=0;
    const flush=()=>{
     if(!rows.length)return;
     const slide=start(heading+(part++?' · 续':''));
     const native=[headers.map(text=>({text,options:{bold:true,color:'FFFFFF',fill:{color:ink}}})),...rows.map((r,i)=>r.map(text=>({text,options:{color:ink,fill:{color:i%2?'FFFFFF':paper}}})))];
     slide.addTable(native,{x:0.85,y:2.2,w:11.65,colW:Array(count).fill(width),rowH:[headerHeight,...heights],fontFace:FONT,fontSize:16,margin:[5,7,5,7],border:{type:'solid',color:border,pt:d.table==='plain'?0.6:1},valign:'top',autoPage:false});
     if(d.table==='floral-corner'&&art)slide.addImage({data:corner,x:11.55,y:0.95,w:1.05,h:0.8});
     rows=[];heights=[];used=headerHeight;
    };
    for(const row of t.rows){
     const cells=row.map(c=>lines(plain(c.text),capacity));const max=Math.max(...cells.map(c=>c.length));
     // 超长单行按完整文字续页，不省略单元格或行。
     const perPage=Math.max(1,Math.min(10,Math.floor((4.65-headerHeight-0.20)/0.29)));
     for(let offset=0;offset<max;offset+=perPage){
      const split=cells.map(c=>c.slice(offset,offset+perPage).join('\n'));const h=Math.max(...split.map(c=>c.split('\n').length))*0.29+0.20;
      if(used+h>4.65)flush();
      rows.push(split);heights.push(h);used+=h;
     }
    }
    flush();
   }else pending.push(plain(token.raw));
  }
  flushText();
  if(checked.cautions.length)textSlides('阅读提示',checked.cautions.map(c=>`${c.message}\n依据：${c.evidence}`).join('\n\n'));
  if(sources)textSlides('参考资料',sources);
 }
 if(!slideCount)throw new Error('没有可导出的课件内容');
 const raw=Buffer.from(await deck.write({outputType:'nodebuffer',compression:true}) as Uint8Array);
 // 相同页眉/纹样只存一份媒体，保留各幻灯片的独立图片对象与关系。
 const zip=await Zip.loadAsync(raw),seen=new Map<string,string>(),replacements=new Map<string,string>();
 for(const name of Object.keys(zip.files).filter(n=>n.startsWith('ppt/media/')&&!zip.files[n].dir)){
  const hash=createHash('sha256').update(await zip.file(name)!.async('nodebuffer')).digest('hex');
  const first=seen.get(hash);if(first){replacements.set(name.slice('ppt/'.length),first.slice('ppt/'.length));zip.remove(name);}else seen.set(hash,name);
 }
 for(const name of Object.keys(zip.files).filter(n=>n.endsWith('.rels'))){
  let xml=await zip.file(name)!.async('string');
  xml=xml.replace(/Target="(\.\.\/)?(media\/[^"<>]+)"/g,(whole,prefix,media)=>replacements.has(media)?`Target="${prefix||''}${replacements.get(media)}"`:whole);
  zip.file(name,xml);
 }
 const buffer=await zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'});
 return {buffer,slides:slideCount};
}

const real={
 load:loadKnowledgePublicationExport,image:readKnowledgeImage,build:buildKnowledgePublicationPptx,
 read:async(name:string)=>{try{return (await downloadGcsObjectVersioned({gcsUri:`gs://${getGcsBucketName()}/${name}`})).buffer;}catch(e){if(e instanceof Error&&e.message==='gcs_stat_failed:404')return null;throw e;}},
 save:async(name:string,buffer:Buffer,type:string)=>{await uploadBufferToGcs({objectName:name,buffer,contentType:type});},
 sign:(name:string)=>signGsUriV4ReadUrl(`gs://${getGcsBucketName()}/${name}`,3600),
};
const active=new Map<string,Promise<{pptxUrl:string;pptxBytes:number;slides:number}>>();
export async function exportKnowledgePublicationPptx(owner:number,documentId:string,generation:string,overrides:Partial<typeof real>={}){
 const deps={...real,...overrides};const {doc,review,receipt,prefix}=await deps.load(owner,documentId,generation);
 const folder=`${prefix}/${KNOWLEDGE_PPTX_VERSION}`;
 const run=async()=>{
  const saved=await deps.read(`${folder}/manifest.json`);
  if(saved){const value=JSON.parse(saved.toString('utf8'));if(value.pptxBytes>0&&value.slides>0)return {...value,pptxUrl:deps.sign(`${folder}/课件.pptx`)};}
  const expected=new Map(receipt.sourceImages.map(i=>[i.uri,i.sha256]));const images:Record<string,string>={};let bytes=0;
  for(const p of doc.pages){if(!p.imageUrl||images[p.imageUrl])continue;const image=await deps.image(p.imageUrl);if(expected.get(p.imageUrl)!==image.sha256)throw new Error('原图已变化，未导出旧版课件');bytes+=image.buffer.length;if(bytes>512*1024*1024)throw new Error('课件原图超过512MiB，未截断导出');const normalized=image.mimeType==='image/webp'?await sharp(image.buffer).png().toBuffer():image.buffer;images[p.imageUrl]=`data:${image.mimeType==='image/webp'?'image/png':image.mimeType};base64,${normalized.toString('base64')}`;}
  const result=await deps.build(doc,review,images);
  if(result.buffer.subarray(0,2).toString()!=='PK'||!result.slides)throw new Error('未生成有效PPTX');
  await deps.save(`${folder}/课件.pptx`,result.buffer,'application/vnd.openxmlformats-officedocument.presentationml.presentation');
  const meta={pptxBytes:result.buffer.length,slides:result.slides};await deps.save(`${folder}/manifest.json`,Buffer.from(JSON.stringify(meta)),'application/json');
  return {...meta,pptxUrl:deps.sign(`${folder}/课件.pptx`)};
 };
 if(active.has(folder))return active.get(folder)!;
 const task=run().finally(()=>active.delete(folder));active.set(folder,task);return task;
}
