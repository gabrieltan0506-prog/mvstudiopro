import type { KnowledgeFactEntry } from '../../shared/knowledgePublicationConsistency';

/** 候选命中只触发查证，不能据关键词直接删除或宣称事实错误。 */
export const KNOWLEDGE_VERIFICATION_POLICY = `最终核实触发条件：
1. 同一概念的数字、单位、因果、适用人群或建议前后矛盾；
2. 严谨核查聚焦药品效果、药理、治疗剂量、药物相互作用、停药/替代治疗，以及具体诊断阈值；普通食品、营养、菜谱和日常保健科普采用轻量编辑，不逐条要求临床证据；
3. “治愈、保证、最有效、溶解胆固醇、清理血管”等绝对或机制外推结论；食品等被明确承诺可治愈疾病或代替药品；不因普通食材益处描述就强制检索；
4. 文字或图片说明中含义不清、条件缺失或有疑点且会影响读者理解的地方，围绕具体原句做一次针对性联网搜索；
5. 具体规范、指南、统计等可能过时的信息，或数字单位实际矛盾；普通科普仅缺少出处不构成强制检索理由。
程序候选不是穷尽清单，仍须语义核对全部原文；正常否定、风险提示、菜谱用量本身不判为错误。统稿合并前，对上述重点、实际矛盾及影响理解的疑点针对原句联网，普通科普不做逐条医疗审查。优先适用地区的主管机关、专业指南、一手研究，核对发布时间、人群、剂量、结局和证据强度。搜索结果或有URL不等于证实，不将动物/体外研究外推成人体疗效。
逐条在Markdown中写原句、对应章节、实际工具来源、支持/明确反证/公开资料不足和具体处理。查不到公开资料不等于原书错误，去营销后精简保留有用作者经验并简短归属；不能把未核实疗效说成有效治疗，不编造新剂量或折中建议。不因格式拒收整批，不自动重购。`;

const health = /血脂|胆固醇|甘油三酯|血压|糖尿病|血糖|疾病|癌|心血管|动脉|药物|剂量|服药|治疗|疗效|LDL|HDL|BMI/i;
const medication = /药品|药物|药理|处方|用药|服药|停药|治疗剂量|他汀|阿司匹林|抗生素|降压药|降脂药|胰岛素|CYP\d|药代动力/i;
const rules: [string, (text: string, context: string) => boolean][] = [
  ['high_impact_claim', (s,c) => medication.test(s+' '+c) && /降低|升高|治疗|作用|效果|吸收|代谢|剂量|风险|禁忌|相互作用/.test(s)],
  ['clinical_number', (s,c) => /\d/.test(s) && ((health.test(s+' '+c) && /mmol|毫摩尔|mg\/d[lL]|正常参考|诊断|阈值|BMI/i.test(s)) || (medication.test(s+' '+c) && /mg|毫克|剂量|每天|每日|每周|%|％/i.test(s)))],
  ['treatment_replacement', s => /停药|少用药|不用药|不做.*药罐子|远离药罐子|替代.{0,8}(药|治疗)|代替.{0,8}(药|治疗)/.test(s)],
  ['absolute_or_mechanism', s => /治愈|根治|保证.{0,12}(有效|安全)|最.{0,6}(有效|清理剂)|溶解胆固醇|清[理除洁].{0,8}血管|血管.{0,8}清[理洁]|排出.{0,4}脂浊/.test(s)],
  ['uncertainty_or_conflict', s => /矛盾|未经.{0,3}证实|尚未.{0,3}核实|待核实|说法不一|证据不足|无法确认/.test(s)],
  ['time_sensitive_standard', s => /最新|现行|指南|诊断标准|正常参考值|统计显示|价格|费率|法律规定|法规/.test(s)],
];

export function knowledgeVerificationTriggers(facts: KnowledgeFactEntry[]) {
  return facts.flatMap((fact, factIndex) => {
    const context = `${fact.headline} ${fact.term}`;
    // 保留精确原句，不截断；索引指向请求中的完整事实，避免再次复制整册。
    return fact.statement.split(/(?<=[。！？])|\n/).flatMap((quote, sentenceIndex) => {
      if (!quote.trim()) return [];
      const reasons = rules.filter(([,test]) => test(quote,context)).map(([reason]) => reason);
      return reasons.length ? [{pageId:fact.pageId,factIndex,sentenceIndex,quote,reasons}] : [];
    });
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
