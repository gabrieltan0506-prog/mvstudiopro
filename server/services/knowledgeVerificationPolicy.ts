import type { KnowledgeFactEntry } from '../../shared/knowledgePublicationConsistency';

/** 候选命中只触发查证，不能据关键词直接删除或宣称事实错误。 */
export const KNOWLEDGE_VERIFICATION_POLICY = `联网只由实际疑点触发：正文整理发现前后矛盾、含义不明确、关键条件缺失且影响理解，或对具体原句确有无法确认的问题时，标清原句及问题，再针对该处查证。
没有疑点就直接跳过联网，不因为出现药名、数字、食品、健康知识、指南或缺少出处而自动搜索；不为了核查再制造一轮全册审查。疑点判定来自整理阶段对实际内容的理解，不用关键词命中代替事实判断。
查到的资料只处理对应疑点及必要上下文，不重审无疑点章节。查不到不等于原书错误，按既有精简保留规则处理，不编造结论、剂量或来源；保留原意、条件及图片说明的一致性。`;

/** 在已有读档/整理调用中发现问题，末段才联网；不新增整册审查调用。 */
export const KNOWLEDGE_PENDING_RESEARCH_INSTRUCTION = `整理原文时必须判断是否存在实际疑点、前后矛盾、内容不全或说明不清楚（包括影响理解的条件、步骤、单位或因果解释缺失）。发现后在对应小节末尾写 <!-- 待核：原句「逐字引用相关原句」；问题：具体疑问、矛盾双方或缺失内容 -->。跨段统稿时也要识别跨段矛盾。这里仅标注，不自行联网、不凭记忆解决，不把不确定内容写成确定事实；全部标注保留到最后阶段统一针对性联网检索、核实或补充。已有待核注释逐条原样保留，不能因合并、选节、精简、禁止审稿旁白而删除。此内部HTML注释是正文无审稿旁白规则的例外。没有上述问题不制造标注，不因药名、数字或健康话题本身强制搜索。`;

export function knowledgePendingResearchNotes(markdown: string): string[] {
  return Array.from(new Set(Array.from(markdown.matchAll(/<!--\s*待核[：:]([\s\S]*?)-->/g), m => m[1].trim()).filter(Boolean)));
}

/** 统稿不能凭未联网的改写消除疑点；模型漏回的注释确定性带到末段。 */
export function preserveKnowledgePendingResearch(source: string, output: string): string {
  const present = new Set(knowledgePendingResearchNotes(output));
  const missing = knowledgePendingResearchNotes(source).filter(note => !present.has(note));
  const parts = output.split(/(?=^##\s+)/m);
  const originalParts = source.split(/(?=^##\s+)/m);
  for (const note of missing) {
    const quote = note.match(/原句[：:]?\s*[「“]([^」”]+)[」”]/)?.[1];
    const original = originalParts.find(part => knowledgePendingResearchNotes(part).includes(note));
    const heading = original?.match(/^##\s+(.+)$/m)?.[1];
    let index = quote ? parts.findIndex(part => part.includes(quote)) : -1;
    if (index < 0 && heading) index = parts.findIndex(part => part.match(/^##\s+(.+)$/m)?.[1] === heading);
    if (index < 0) {
      // 标题和原句都被改写时，单独保留带来源的核对说明，末段照常检索，不误改其他章。
      parts.push(`\n\n## 说明：${heading || '原文'}待核补充\n\n原文核对：${quote || note}\n\n<!-- 待核：${note} -->`);
      continue;
    }
    parts[index] = parts[index].trimEnd() + `\n\n<!-- 待核：${note} -->\n\n`;
  }
  return missing.length ? parts.join('').trimEnd() : output;
}

const health = /血脂|胆固醇|甘油三酯|血压|糖尿病|血糖|疾病|癌|心血管|动脉|药物|剂量|服药|治疗|疗效|LDL|HDL|BMI/i;
/** 只消费整理阶段已经指出的实际疑问；药名、数值或话题本身不是搜索触发器。 */
export function knowledgeVerificationTriggers(facts: KnowledgeFactEntry[]) {
  return facts.flatMap((fact, factIndex) => {
    const annotated=Array.from(fact.statement.matchAll(/<!--\s*待核[：:]([\s\S]*?)-->/g)).map(m=>m[1].trim()).filter(Boolean);
    // 结构化注释与正文中的明确疑点都要消费，不能由其中一种遮住另一种。
    const explicit=fact.statement.replace(/<!--[\s\S]*?-->/g,'').split(/(?<=[。！？])|\n/).filter(s=>
      /待核实|待核[：:]|存疑|含义不明|含义不清|条件不明确|前后矛盾|说法不一|无法确认|疑点[：:]|已列(?:入)?(?:待核)?疑点/.test(s)
      && !/没有疑点|无疑点|不存在.*矛盾|已消除.*疑点/.test(s));
    const statements=Array.from(new Set([...annotated,...explicit]));
    return statements.map((quote,sentenceIndex)=>({pageId:fact.pageId,factIndex,sentenceIndex,quote,reasons:['uncertainty_or_conflict']}));
  });
}

/** 查不到不等于反证；作者经验可精简保留，但不能包装成已证实的医疗建议。 */
export const KNOWLEDGE_VERIFICATION_EDIT_POLICY = `核实后的编辑规则：
普通食品、营养、菜谱与日常保健科普以轻量编辑为主：去营销、重复和夸大，精简保留作者内容，不逐项要求临床证据或加说明。药品效果、药理、治疗剂量、相互作用、诊断阈值及明确治疗承诺才严格核实。
有可靠资料支持：按原句核对适用人群、条件与结论后保留或纠正，不能只凭来源非空判定通过。
有价值的补充：保留原书核心知识，结合实际查到且与主题直接相关的资料，自然补入简短的对比、适用条件、选择或搭配提醒，让读者知道怎样应用。可按“原书要点＋同类对比＋简短行动提醒”表达，不写长篇考据，不喧宾夺主，不强制每段都补。新增事实须有对应工具资料支持，不能从无关检索结果推导功效；说明用量、替代关系和个体条件时以实际依据为准，不暗示两种食物搭配就能抵消风险。用户举例只指导表达方式，不固定具体食材或医疗结论。
查不到公开依据或只有转载/卖书资料：这不是原书错误或方法无效的证明；个体效果可能不同，不能将查不到资料改写为“无效”，也不能保证人人有效。去掉营销、重复铺垫、夸大承诺，精简保留有用的作者方法、独家经验、配方思路与必要条件；正文统一简短标为“作者独家经验”，不附“尚无公开资料佐证”等尾句；公开证据是否充分留在内部核对记录，不写长篇免责声明，不为检索失败删掉整章。
明确反证：纠正对应说法；无法消解的冲突分清原书说法与已知证据，不擅自任选一方。
医疗疗效、停药替代、具体治疗剂量与危险操作：不得把未经证实的作者经验改写成读者应照做的有效治疗，不保留保证治愈等承诺；可精简介绍作者观点，保留必要安全边界。一般菜谱用量和普通经验不能当成治疗剂量一律删除。
“原书说法”“传统用法”“可能辅助”不是医疗疗效已证实的标签。不得为了折中编出新剂量、新频次或新禁忌。正文与对应的“图：”图片说明同步优化：厘清人物、对象、对比关系、条件和图中应呈现的知识，不把未核实说法画成确定事实。
局部编辑并允许上述相关短补充，原始稿和完整核对记录留在证据里；正文不放审查过程、无答案占位或重复来源说明。`;

/** 查询绑定原句而不是书名；只是检索指导，不增加模型输出schema或自动请求次数。 */
export function knowledgeVerificationQueries(facts:KnowledgeFactEntry[]) {
  return knowledgeVerificationTriggers(facts).map(t=>({pageId:t.pageId,factIndex:t.factIndex,sentenceIndex:t.sentenceIndex,
    sourceQuote:t.quote,query:`${t.quote.trim()} ${health.test(t.quote+' '+facts[t.factIndex].headline)?'临床指南 系统综述 人体证据':'一手来源 原始研究 证据'}`,
  }));
}

/** 已知销售/转载目录不作独立事实佐证；其他来源仍仅是候选，不能据域名自动认证结论。 */
export function knowledgeVerificationSourceEvidence(sources:unknown[]) {
  const usable:{url:string;title:string;content:string}[]=[];
  const excluded:{source:unknown;reason:string}[]=[];
  for(const value of sources){
    const s=value as {url?:unknown;title?:unknown;content?:unknown};
    if(!s||typeof s.url!=='string'||typeof s.title!=='string'||typeof s.content!=='string'||!s.content.trim()){
      excluded.push({source:value,reason:'缺少可核对的实际工具原文'});continue;
    }
    let host:string;try{const u=new URL(s.url);if(!['https:','http:'].includes(u.protocol))throw Error();host=u.hostname.toLowerCase();}catch{excluded.push({source:value,reason:'来源网址无效'});continue;}
    const knownLowValue=['kongfz.com','bookschina.com','book.douban.com','360book.com','renrendoc.com','shadafang.com','baike.so.com'];
    const catalog=knownLowValue.some(d=>host===d||host.endsWith('.'+d));
    const syndicated=host==='baijiahao.baidu.com' && /手册|自疗|偏方/.test(s.title);
    const sales=/售价|定价|加入购物车|上书时间|仅\d+件|正版.*包邮/.test(s.content)&&/图书|书籍|出版社|ISBN/i.test(s.content);
    if(catalog||syndicated||sales){excluded.push({source:value,reason:'销售/书目/转载资料只能追溯原书，不能独立佐证其疗效或事实'});continue;}
    usable.push({url:s.url,title:s.title,content:s.content});
  }
  return {sources:usable,retrievedSources:sources,excludedSources:excluded,
    evidenceState:usable.length?'available' as const:'missing' as const,
    sourceWarnings:excluded.length?[`${excluded.length}条资料未作为独立事实佐证；原书经验仍按精简保留规则处理。`]:[]};
}
