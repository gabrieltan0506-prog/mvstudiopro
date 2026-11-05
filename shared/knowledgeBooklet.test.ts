import { expect, it } from 'vitest';
import {buildKnowledgeBookletHtml,chooseKnowledgeBookletTheme,KNOWLEDGE_BOOKLET_THEMES} from './knowledgeBooklet';
it('手动模板优先，系统根据内容匹配，旧结构模板不能进入新书册',()=>{
 expect(chooseKnowledgeBookletTheme('植物生态')).toBe('fusion_glasshouse_garden');
 expect(chooseKnowledgeBookletTheme('植物生态','fusion_chinese_garden','fusion_ink_mountains')).toBe('fusion_chinese_garden');
 expect(chooseKnowledgeBookletTheme('航海','infographic_structure_deconstruct')).toBe('fusion_coastal_lighthouse');
 expect(Object.keys(KNOWLEDGE_BOOKLET_THEMES)).toHaveLength(6);
});
it('保留原图与表格全部单元格，不让正文执行脚本',()=>{
 const html=buildKnowledgeBookletHtml({title:'测试',pages:[{id:'one',headline:'<script>bad()</script>',imageUrl:'data:image/png;base64,AAAA',body:'## 关系\n\n|甲|乙|\n|---|---|\n|原文数字130|完整事实|\n\n不删原文。'}]});
 expect(html).toContain('原文数字130');expect(html).toContain('完整事实');expect(html).toContain('不删原文。');
 expect(html).toContain('data:image/png;base64,AAAA');expect(html).not.toContain('<script>bad()');
 expect(()=>buildKnowledgeBookletHtml({title:'测试',pages:[{id:'one',headline:'标题',body:'正文',imageUrl:'javascript:alert(1)'}]})).toThrow('配图地址');
});
it('成稿档位随原稿保存恢复，旧稿保持未知而不伪装成完整版', async()=>{
 const {knowledgeCardLayoutSource}=await import('./knowledgeCardEditableLayout');
 const {layoutFromSource,editableLayoutSchema}=await import('./editableLayout');
 for(const detailLevel of ['concise','full',undefined] as const){
  const source=knowledgeCardLayoutSource({owner:'7',sourceId:'mode',markdown:'原始说明',images:[],detailLevel});
  const doc=editableLayoutSchema.parse(JSON.parse(JSON.stringify(layoutFromSource(source))));
  expect(doc.publication?.source.detailLevel).toBe(detailLevel);
 }
});
