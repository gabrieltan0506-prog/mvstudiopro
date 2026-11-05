import {it,expect,vi} from 'vitest';
import JSZip from 'jszip';
import {layoutFromSource} from '../../shared/editableLayout';
import {knowledgeManuscript} from '../../shared/knowledgePublication';
import {buildKnowledgePublicationPptx,exportKnowledgePublicationPptx} from './knowledgePublicationPptx';
import {loadKnowledgePublicationExport} from './knowledgePublicationExport';
import {knowledgeSourceDigest} from './knowledgePublicationAdvisor';
const make=()=>{
 const doc=layoutFromSource({kind:'knowledge-publication',owner:'7',sourceId:'pptx-test',title:'水循环',body:'### 概念\n\n完整正文开始。\n\n|过程|变化|\n|---|---|\n'+Array.from({length:30},(_,i)=>`|知识点${i}|说明${i}，气体与液体的相互转化。|`).join('\n')+'\n\n### 总结\n\n完整正文最后一句。'});
 const pub=doc.publication!;const review:any={kind:'knowledge_publication_v1',title:doc.title,sourceDigest:knowledgeSourceDigest(pub.source),pages:doc.pages.map(p=>({id:p.id,headline:p.headline,body:p.body,imageDescription:'',imageStatus:'absent',facts:[{term:'水循环',statement:'水循环'}],cautions:[{kind:'uncertain',evidence:'原文证据',message:'这是保留的阅读提示'}]}))};
 pub.review=review;pub.manuscript=knowledgeManuscript(review);pub.confirmedManuscript=pub.manuscript;
 const receipt={report:review,sourceImages:[]};
 return {doc,review,receipt,prefix:'test/owner7/exports/digest'};
};
it('实际PPTX有原生可编辑表格和文本，长表续页、最后一行和疑点都保留',async()=>{
 const f=make();const result=await buildKnowledgePublicationPptx(f.doc,f.review,{});const zip=await JSZip.loadAsync(result.buffer);
 const slides=Object.keys(zip.files).filter(n=>/^ppt\/slides\/slide\d+\.xml$/.test(n));expect(slides.length).toBe(result.slides);expect(result.slides).toBeGreaterThan(4);
 const xml=(await Promise.all(slides.map(n=>zip.file(n)!.async('string')))).join('');expect(xml).toContain('<a:tbl>');expect(xml).toContain('<p:sp>');expect(xml).toContain('完整正文最后一句');expect(xml).toContain('保留的阅读提示');for(let i=0;i<30;i++)expect(xml).toContain(`知识点${i}`);
});
it('PPTX和PDF共享云稿版本、确认稿与权威审校校验',async()=>{
 const f=make();const deps:any={load:async()=>({library:{documents:[f.doc]},generation:'10'}),review:async()=>f.receipt};
 const accepted=await loadKnowledgePublicationExport(7,f.doc.id,'10',deps);expect(accepted.doc.id).toBe(f.doc.id);
 await expect(loadKnowledgePublicationExport(7,f.doc.id,'9',deps)).rejects.toThrow('版本');f.doc.publication!.manuscript+='改动';await expect(loadKnowledgePublicationExport(7,f.doc.id,'10',deps)).rejects.toThrow('确认');
});
it('课件独立导出并缓存，重复请求不调用模型/PDF或重建课件',async()=>{
 const f=make(),storage=new Map<string,Buffer>();const deps={load:vi.fn(async()=>f),read:async(k:string)=>storage.get(k)||null,save:async(k:string,b:Buffer)=>{storage.set(k,b)},sign:(k:string)=>'https://test.invalid/'+k,build:vi.fn(buildKnowledgePublicationPptx)};
 const a=await exportKnowledgePublicationPptx(7,f.doc.id,'10',deps as any);const b=await exportKnowledgePublicationPptx(7,f.doc.id,'10',deps as any);expect(a).toEqual(b);expect(deps.build).toHaveBeenCalledTimes(1);expect(a.pptxBytes).toBeGreaterThan(10000);expect(a.pptxUrl).toContain('.pptx');
});
it('原图版本变化拒绝出课件，不拿旧审核放行',async()=>{
 const f=make();f.doc.pages[0].imageUrl='gs://test/image.png';(f.receipt.sourceImages as any[]).push({uri:'gs://test/image.png',sha256:'old'});
 const build=vi.fn();await expect(exportKnowledgePublicationPptx(7,f.doc.id,'10',{load:async()=>f,read:async()=>null,image:async()=>({sha256:'new',buffer:Buffer.from('image')}) as any,build} as any)).rejects.toThrow('原图已变化');expect(build).not.toHaveBeenCalled();
});

it('真实原图与装饰可独立编辑，重复媒体去重后所有幻灯片关系仍有效',async()=>{
 const f=make();f.doc.title='史记';f.doc.pages[0].imageUrl='local:test';
 const sharp=(await import('sharp')).default;const bytes=await sharp({create:{width:320,height:180,channels:3,background:'#f0ddaa'}}).png().toBuffer();
 const result=await buildKnowledgePublicationPptx(f.doc,f.review,{'local:test':'data:image/png;base64,'+bytes.toString('base64')});
 const zip=await JSZip.loadAsync(result.buffer);const media=Object.keys(zip.files).filter(n=>n.startsWith('ppt/media/')&&!zip.files[n].dir);
 expect(media.length).toBeLessThan(result.slides);const {posix}=await import('node:path');
 for(const name of Object.keys(zip.files).filter(n=>/^ppt\/slides\/_rels\/slide.*\.rels$/.test(n))){
  const xml=await zip.file(name)!.async('string');for(const m of Array.from(xml.matchAll(/Target="(\.\.\/media\/[^"<>]+)"/g)))expect(zip.file(posix.normalize(posix.join('ppt/slides',m[1])))).not.toBeNull();
 }
});
