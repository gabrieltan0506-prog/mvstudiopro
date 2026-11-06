import type PptxGenJS from 'pptxgenjs';
import { createRequire } from 'node:module';
// 使用该库明确提供的Node入口，避免tsx与生产ESM的默认导出互操作差异。
const PptxConstructor = createRequire(import.meta.url)('pptxgenjs') as typeof PptxGenJS;
import sharp from 'sharp';
import { createHash } from 'node:crypto';
import type JSZip from 'jszip';
const Zip = createRequire(import.meta.url)('jszip') as typeof JSZip;
import {knowledgePresentationPlanSchema,knowledgePresentationLines as lines,assertKnowledgePresentationCapacity,type KnowledgePresentationPlan} from '../../shared/knowledgePresentation';
import {loadVerifiedKnowledgePresentation} from './knowledgePresentationAdvisor';
import type { EditableLayout } from '../../shared/editableLayout';
import type { KnowledgeReview } from '../../shared/knowledgePublication';
import { resolveKnowledgeDecoration } from '../../shared/knowledgeDecorations';
import { KNOWLEDGE_DECORATION_ART } from '../../shared/knowledgeDecorationAssets';
import { chooseKnowledgeBookletTheme, KNOWLEDGE_BOOKLET_THEMES } from '../../shared/knowledgeBooklet';
import { exportKnowledgePublication, loadKnowledgePublicationExport } from './knowledgePublicationExport';
import { readKnowledgeImage } from './knowledgePublicationAdvisor';
import { downloadGcsObjectVersioned, getGcsBucketName, signGsUriV4ReadUrl, uploadBufferToGcs } from './gcs';

export const KNOWLEDGE_PPTX_VERSION='knowledge-pptx-1105-v3-outline-range';
const WIDTH=13.333333;
// 固定文本框也必须核对断行高度，防止合法短文本中的换行造成裁切。
function fittedText(value:string,capacity:number,size:number,spacing:number,height:number):string{
 const content=lines(value,capacity);
 if(content.length*size/72*spacing+0.04>height)throw Error('顾问单页内容超出可读版面，请精简该页提纲；未自动续页或缩字');
 return content.join('\n');
}
export async function buildKnowledgePublicationPptx(doc:EditableLayout,review:KnowledgeReview,images:Record<string,string>,value:KnowledgePresentationPlan){
 const plan=knowledgePresentationPlanSchema.parse(value);
 assertKnowledgePresentationCapacity(plan);
 const deck=new PptxConstructor();deck.layout='LAYOUT_WIDE';deck.author='图文知识手册';deck.subject=doc.title;deck.title=plan.title;
 const bodyFont='Noto Sans CJK',titleFont=plan.fontStyle==='editorial'?'Noto Serif CJK SC':bodyFont;
 deck.theme={headFontFace:titleFont,bodyFontFace:bodyFont};
 const artCache=new Map<string,string>();
 const bookTheme=KNOWLEDGE_BOOKLET_THEMES[chooseKnowledgeBookletTheme(doc.title,doc.publication?.infographicTemplateId)];
 const color=(v:string)=>v.replace('#','');
 for(const [index,item] of Array.from(plan.slides.entries())){
  const chapter=doc.pages.find(p=>p.id===item.sourcePageIds[0]);
  const checked=review.pages.find(p=>p.id===chapter?.id);if(!chapter||!checked)throw Error('课件引用章节不存在');
  const theme=bookTheme;
  const ink=color(theme.ink),paper=color(theme.paper),accent=color(theme.accent),border=color(theme.line);
  const decoration=resolveKnowledgeDecoration(checked.reading?.decoration,doc.title+' '+chapter.headline),art=KNOWLEDGE_DECORATION_ART[decoration.artworkId];
  const slide=deck.addSlide();slide.background={color:paper};
  if(art&&decoration.header==='illustrated'){
   if(!artCache.has(decoration.artworkId))artCache.set(decoration.artworkId,'data:image/png;base64,'+(await sharp(Buffer.from(art.split(',')[1],'base64')).resize(1600,78,{fit:'cover'}).png().toBuffer()).toString('base64'));
   slide.addImage({data:artCache.get(decoration.artworkId)!,x:0,y:0,w:WIDTH,h:0.65});
  }
  const opening=index===0&&item.type==='points'&&item.points.length<=3;
  const titleText=fittedText(item.title,opening?22:27,opening?40:31,1.03,opening?1.5:1.04);
  slide.addText(titleText,{x:0.86,y:opening?1.2:1.0,w:11.65,h:opening?1.5:1.04,fontFace:titleFont,fontSize:opening?40:31,bold:true,color:ink,margin:0,breakLine:false,lineSpacingMultiple:1.03,valign:'middle'});
  slide.addShape(deck.ShapeType.line,{x:0.88,y:opening?2.9:2.08,w:11.55,h:0,line:{color:border,width:1.05}});
  slide.addText(plan.title,{x:0.9,y:7.06,w:10.7,h:0.22,fontFace:bodyFont,fontSize:9,color:ink,margin:0});
  slide.addText(`${index+1} / ${plan.slides.length}`,{x:11.5,y:7.04,w:0.95,h:0.25,fontFace:bodyFont,fontSize:10,color:ink,align:'right',margin:0});
  const cautions=item.sourcePageIds.flatMap(id=>review.pages.find(p=>p.id===id)?.cautions||[]);
  const sources=item.sourcePageIds.flatMap(id=>review.pages.find(p=>p.id===id)?.sources||[]);
  slide.addNotes([item.notes,...sources.map(s=>s.title+': '+s.url),...cautions.map(c=>'作者审校记录：'+c.message+'；依据：'+c.evidence)].filter(Boolean).join('\n'));
  const points=(values:string[],x:number,w:number,capacity:number,size:number,startY=2.4)=>{
   let y=startY;
   for(const text of values){const content=lines(text,capacity),h=content.length*size/72*1.1+0.04;
    if(y+h>6.82)throw Error('顾问单页内容超出可读版面，请精简该页提纲；未自动续页或缩字');
    slide.addText('•',{x,y:y+0.02,w:0.24,h:0.35,fontFace:bodyFont,fontSize:17,color:accent,margin:0});
    slide.addText(content.join('\n'),{x:x+0.37,y,w:w-0.37,h,fontFace:bodyFont,fontSize:size,color:ink,margin:0,lineSpacingMultiple:1.1,breakLine:false,valign:'top'});
    y+=h+0.12;
   }
  };
  if(item.type==='points'){
   if(opening)points(item.points,1.0,10.8,33,22,3.25);
   else if(item.points.length===1){
    const text=fittedText(item.points[0],27,30,1.2,2.7);
    slide.addText(text,{x:1.15,y:3.0,w:11,h:2.7,fontFace:titleFont,fontSize:30,color:ink,margin:0,lineSpacingMultiple:1.2,valign:'middle'});
   }else if(item.points.length<=3){
    const count=item.points.length,gap=0.55,w=(11.4-gap*(count-1))/count,capacity=Math.floor((w-0.16)*72/22)-1;
    item.points.forEach((text,i)=>{
     const x=0.96+i*(w+gap);
     slide.addText(String(i+1).padStart(2,'0'),{x,y:2.48,w,h:0.65,fontFace:titleFont,fontSize:34,color:accent,margin:0});
     slide.addText(fittedText(text,capacity,22,1.18,3.1),{x,y:3.38,w,h:3.1,fontFace:bodyFont,fontSize:22,color:ink,margin:0,lineSpacingMultiple:1.18,valign:'top'});
     if(i<count-1)slide.addShape(deck.ShapeType.line,{x:x+w+gap/2,y:2.52,w:0,h:3.85,line:{color:border,width:0.75}});
    });
   }else if(item.points.length===4){
    item.points.forEach((text,i)=>{
     const x=0.96+(i%2)*5.9,y=2.48+Math.floor(i/2)*2.02;
     slide.addText(String(i+1).padStart(2,'0'),{x,y,w:0.55,h:0.4,fontFace:titleFont,fontSize:22,color:accent,margin:0});
     slide.addText(fittedText(text,17,20,1.14,1.64),{x:x+0.7,y,w:4.72,h:1.64,fontFace:bodyFont,fontSize:20,color:ink,margin:0,lineSpacingMultiple:1.14,valign:'top'});
    });
    slide.addShape(deck.ShapeType.line,{x:0.96,y:4.3,w:11.4,h:0,line:{color:border,width:0.75}});
   }else points(item.points,0.96,11.4,35,22);
  }
  else if(item.type==='table'){
   const width=11.4/item.columns.length,capacity=Math.max(7,Math.floor(width*72/17.5)-1);
   const headers=item.columns.map(c=>lines(c,capacity).join('\n'));
   const rows=item.rows.map(row=>row.map(c=>lines(c,capacity).join('\n')));
   const heights=[Math.max(...headers.map(c=>c.split('\n').length))*0.27+0.18,...rows.map(r=>Math.max(...r.map(c=>c.split('\n').length))*0.27+0.18)];
   if(heights.reduce((a,b)=>a+b,0)>4.35)throw Error('顾问表格超出单页，请精简提纲；未自动增加页数');
   slide.addTable([headers.map(text=>({text,options:{bold:true,color:'FFFFFF',fill:{color:ink}}})),...rows.map((r,i)=>r.map(text=>({text,options:{color:ink,fill:{color:i%2?'FFFFFF':paper}}})))],{x:0.96,y:2.4,w:11.4,colW:Array(item.columns.length).fill(width),rowH:heights,fontFace:bodyFont,fontSize:17.5,margin:[6,9,6,9],border:{type:'solid',color:border,pt:0.7},valign:'middle',autoPage:false});
  }else{
   const source=doc.pages.find(p=>p.id===item.imagePageId),data=source?.imageUrl?images[source.imageUrl]:'';
   if(!data)throw Error('课件提纲选用的原图缺失');
   const raw=Buffer.from(data.split(',')[1],'base64');const resized=await sharp(raw).resize({width:1800,withoutEnlargement:true}).flatten({background:'#ffffff'}).jpeg({quality:90}).toBuffer();const meta=await sharp(resized).metadata();
   const ratio=meta.width!/meta.height!,w=Math.min(5.8,4.35*ratio),h=w/ratio;
   slide.addImage({data:'data:image/jpeg;base64,'+resized.toString('base64'),x:0.95+(5.8-w)/2,y:2.38+(4.35-h)/2,w,h});
   points(item.points,7.1,5.15,16,20);
  }
 }
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
 return {buffer,slides:plan.slides.length};
}

const real={
 publication:exportKnowledgePublication,load:loadKnowledgePublicationExport,plan:loadVerifiedKnowledgePresentation,image:readKnowledgeImage,build:buildKnowledgePublicationPptx,
 read:async(name:string)=>{try{return (await downloadGcsObjectVersioned({gcsUri:`gs://${getGcsBucketName()}/${name}`})).buffer;}catch(e){if(e instanceof Error&&e.message==='gcs_stat_failed:404')return null;throw e;}},
 save:async(name:string,buffer:Buffer,type:string)=>{await uploadBufferToGcs({objectName:name,buffer,contentType:type});},
 sign:(name:string)=>signGsUriV4ReadUrl(`gs://${getGcsBucketName()}/${name}`,3600),
};
const active=new Map<string,Promise<{pptxUrl:string;pptxBytes:number;slides:number}>>();
export async function exportKnowledgePublicationPptx(owner:number,documentId:string,generation:string,overrides:Partial<typeof real>={}){
 const deps={...real,...overrides};const {doc,review,receipt,prefix}=await deps.load(owner,documentId,generation);
 if(doc.publication?.billing){
  const publication=await deps.publication(owner,documentId,generation);
  if(!publication.pdfUrl)throw Error('手册实际内文页数尚未核实，请先完成PDF排版，未重复扣费');
 }
 const plan=await deps.plan(owner,doc);
 const planDigest=createHash("sha256").update(JSON.stringify(plan)).digest("hex");
 const folder=`${prefix}/${KNOWLEDGE_PPTX_VERSION}/${planDigest}`;
 const run=async()=>{
  const saved=await deps.read(`${folder}/manifest.json`);
  if(saved){const value=JSON.parse(saved.toString('utf8'));if(value.pptxBytes>0&&value.slides>0)return {...value,pptxUrl:deps.sign(`${folder}/课件.pptx`)};}
  const expected=new Map(receipt.sourceImages.map(i=>[i.uri,i.sha256]));const images:Record<string,string>={};let bytes=0;
  const selectedImages=new Set(plan.slides.flatMap(s=>s.type==="image"?[s.imagePageId]:[]));
  for(const p of doc.pages){if(!selectedImages.has(p.id)||!p.imageUrl||images[p.imageUrl])continue;const image=await deps.image(p.imageUrl);if(expected.get(p.imageUrl)!==image.sha256)throw new Error('原图已变化，未导出旧版课件');bytes+=image.buffer.length;if(bytes>512*1024*1024)throw new Error('课件原图超过512MiB，未截断导出');const normalized=image.mimeType==='image/webp'?await sharp(image.buffer).png().toBuffer():image.buffer;images[p.imageUrl]=`data:${image.mimeType==='image/webp'?'image/png':image.mimeType};base64,${normalized.toString('base64')}`;}
  const result=await deps.build(doc,review,images,plan);
  if(result.buffer.subarray(0,2).toString()!=='PK'||result.slides!==plan.slides.length)throw new Error('未生成有效PPTX');
  await deps.save(`${folder}/课件.pptx`,result.buffer,'application/vnd.openxmlformats-officedocument.presentationml.presentation');
  const meta={pptxBytes:result.buffer.length,slides:result.slides};await deps.save(`${folder}/manifest.json`,Buffer.from(JSON.stringify(meta)),'application/json');
  return {...meta,pptxUrl:deps.sign(`${folder}/课件.pptx`)};
 };
 if(active.has(folder))return active.get(folder)!;
 const task=run().finally(()=>active.delete(folder));active.set(folder,task);return task;
}
