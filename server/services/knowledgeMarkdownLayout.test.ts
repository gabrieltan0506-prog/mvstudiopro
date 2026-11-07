import {describe,it,expect} from 'vitest';
import {knowledgeLayoutFromMarkdown} from './knowledgeMarkdownLayout';
import {knowledgePublicationTemplates} from '../../shared/knowledgePublicationTemplates';
import {validateKnowledgeBookLayoutPlan} from '../../shared/knowledgeBookLayout';
import {knowledgePublicationChapter} from '../../shared/knowledgePublicationHtml';
import {knowledgeReviewFromMarkdown} from './knowledgeMarkdownReview';
import {layoutFromSource} from '../../shared/editableLayout';
const id='11111111-1111-4111-8111-111111111111',requestId='22222222-2222-4222-8222-222222222222';
const book={sourceDigest:'a'.repeat(64),title:'知识',pages:[{id,headline:'完整章节',body:'保留事实',hasImage:false,imageDescription:'',cautions:[]}]};
describe('最终Markdown排版保留模板和完整稿',()=>{
 it('Markdown表格配置由程序绑定，模板选择不被顾问替换',()=>{
  const [manual,auto]=knowledgePublicationTemplates;
  const md=`|章节标识|模板|配色|版式|表格|边框|纹样|理由|\n|---|---|---|---|---|---|---|---|\n|${id}|${auto.id}|jade-paper|editorial|rules|none|herb-leaf|根据自然知识组织留白与草木纹样|`;
  const result=knowledgeLayoutFromMarkdown(md,book,requestId,manual.id);
  expect(result.layoutPlan.chapters[0].templateId).toBeUndefined();
  expect(result.layoutPlan.chapters[0].design?.palette).toBe('jade-paper');
  expect(result.answer).not.toContain(id);
  expect(()=>validateKnowledgeBookLayoutPlan(result.layoutPlan,book)).not.toThrow();
 });
 it('缺少或未知装饰不拒收、不删章节，保留模板',()=>{
  const result=knowledgeLayoutFromMarkdown('按现有模板使用留白，完整保留文字。',book,requestId,knowledgePublicationTemplates[0].id);
  expect(result.retained).toEqual(['完整章节']);
  expect(result.layoutPlan.chapters).toEqual([{pageId:id}]);
  expect(()=>validateKnowledgeBookLayoutPlan(result.layoutPlan,book)).not.toThrow();
 });
 it('模板仍进入真实预览HTML，审校疑点不再次进入读者正文',()=>{
  const doc=layoutFromSource({kind:'knowledge-publication',owner:'7',sourceId:'test',title:'知识',body:'正常知识正文'});
  const pub=doc.publication!;pub.infographicTemplateId=knowledgePublicationTemplates[0].id;
  const review=knowledgeReviewFromMarkdown('正常知识正文',pub.source,'a'.repeat(64));
  review.pages[0].cautions=[{kind:'text',evidence:'不能证实的主张',message:'不应重新写入正文'}];
  const input={...book,pages:doc.pages.map(p=>({...book.pages[0],id:p.id}))};
  const {retained,...answer}=knowledgeLayoutFromMarkdown('保留所选模板。',input,requestId,pub.infographicTemplateId);
  pub.layoutConversationId=requestId;pub.conversation=[{request:{id:requestId,question:'排版',action:'layout',layoutSourceDigest:input.sourceDigest,imagePageIds:[],manuscript:pub.manuscript},response:answer}];
  const html=knowledgePublicationChapter(doc,review,0,'',true);
  expect(html).toContain('正常知识正文');expect(html).not.toContain('不应重新写入正文');
  expect(html).toContain(pub.infographicTemplateId);
 });
});
