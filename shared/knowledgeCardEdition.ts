export type KnowledgeEditionModule = { headline: string; body: string; priority: 'primary' | 'secondary' };
const editionMarker = /^<!-- knowledge-edition:v2:(full|concise) -->\s*/;

/** 版本由程序写入；旧稿不猜测、不静默重购。两版共享知识模块，只切换承载媒介。 */
export function compileKnowledgeEditions(title: string, modules: KnowledgeEditionModule[]) {
  const render = (level:'full'|'concise') => `<!-- knowledge-edition:v2:${level} -->\n# ${title}\n\n` + modules.map(m =>
    `## ${level==='full'||m.priority==='primary'?'图解':'文字'}｜${m.headline}\n\n${m.body.trim()}`
  ).join('\n\n');
  return {full:render('full'),concise:render('concise')};
}

export function knowledgeEditionParts(markdown: string) {
  const match = markdown.match(editionMarker);
  if (!match) return null;
  const clean=markdown.slice(match[0].length);
  const title=clean.match(/^#\s+(.+)$/m)?.[1]||'图文知识手册';
  const parts=clean.split(/(?=^##\s+)/m);
  const modules=parts.filter(s=>/^##\s+/.test(s)).map((s,index)=>{
    const first=s.indexOf('\n');
    const heading=(first<0?s:s.slice(0,first)).replace(/^##\s+/,'').trim();
    const role=heading.match(/^(图解|文字)[｜|：:]\s*(.+)$/);
    // 无可识别媒介时保留为文字，不擅自增加付费图片或删除内容。
    return {id:`module-${index+1}`,medium:role?.[1]==='图解'?'image' as const:'text' as const,
      headline:role?.[2]||heading,body:first<0?'':s.slice(first+1).trim()};
  });
  const preamble=parts[0]?.replace(/^#\s+.*$/m,'').trim()||'';
  const join=(entries:typeof modules)=>entries.length?`# ${title}\n\n`+entries.map(m=>`## ${m.headline}\n\n${m.body}`).join('\n\n'):'';
  return {level:match[1] as 'full'|'concise',title,modules,
    images:join(modules.filter(m=>m.medium==='image')),
    reading:[preamble,join(modules.filter(m=>m.medium==='text'))].filter(Boolean).join('\n\n'),
    knowledge:[preamble,join(modules)].filter(Boolean).join('\n\n')};
}

/** 模型只写Markdown；没有优先级标记时保留该模块，程序采取保守的次要文字默认值。 */
export function knowledgeModulesFromMarkdown(markdown:string) {
  const cleaned=markdown.trim().replace(/^```(?:markdown|md)?\s*\n([\s\S]*)\n```$/i,'$1');
  const title=cleaned.match(/^#\s+(.+)$/m)?.[1]||'图文知识手册';
  const segments=cleaned.split(/(?=^##\s+)/m);
  const modules:KnowledgeEditionModule[]=[];
  const preamble=segments[0].replace(/^#\s+.*$/gm,'').trim();
  if(preamble)modules.push({headline:'阅读提示',body:preamble,priority:'secondary'});
  for(const segment of segments.filter(s=>/^##\s+/.test(s))){
    const first=segment.indexOf('\n');
    const heading=(first<0?segment:segment.slice(0,first)).replace(/^##\s+/,'').trim();
    const tagged=heading.match(/^(主要重点|次要重点)[｜|：:]\s*(.+)$/);
    const body=first<0?'':segment.slice(first+1).replace(/^#\s+.*$/gm,'').trim();
    modules.push({headline:tagged?.[2]||heading,body,priority:tagged?.[1]==='主要重点'?'primary':'secondary'});
  }
  // 全文没有小节也保存内容；不会因为格式问题丢稿或自动再买一轮。
  if(!modules.length)modules.push({headline:title,body:cleaned,priority:'secondary'});
  return {title,modules};
}
