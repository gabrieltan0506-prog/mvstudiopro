export type KnowledgeEditionModule = { headline: string; body: string; priority: 'primary' | 'secondary' };
const editionMarker = /^<!-- knowledge-edition:v2:(full|concise) -->\s*/;

/** 图示稿的图、要点与整张表保留配图，独立解说进入阅读正文。 */
function splitKnowledgeModuleMedia(body: string) {
  const paragraphs = body.trim().split(/\n\s*\n/).filter(Boolean);
  const diagram = /^(?:\*\*)?图(?:示)?[：:]/;
  const structured = paragraphs.some(p => diagram.test(p));
  const noteStart = /^(?:#{3,6}\s*|[-*]\s*)?(?:\*\*)?(?:注|注意|说明|提醒|风险提示|禁忌|适用条件|前提条件|补充说明)[：:]/;
  const table = (p: string) => {
    const lines = p.split(/\r?\n/);
    // 表头可省外侧竖线；以分隔行识别整表，不拆表头和数据行。
    return lines.length > 1 && lines[0]!.includes('|') && /^\s*\|?\s*:?-+:?\s*\|/.test(lines[1]!);
  };
  const visual = (p: string) => diagram.test(p) || table(p) || /^\s*[-*+]\s|^\s*\d+[.)、]\s/.test(p);
  const image: string[] = [], reading: string[] = [];
  for (let i = 0; i < paragraphs.length; i++) {
    const p = paragraphs[i]!;
    // 原页引用只服务图像定位，不把它算作“必要文字”。
    if (/^〔参考原页/.test(p) || /^(?:<!--[^]*?-->\s*)+$/.test(p)) { image.push(p); continue; }
    if (structured) {
      // 小标题跟随下一段的媒介；不会仅凭标题制造独立空阅读页。
      const heading = /^#{3,6}\s+[^\n]+$/.test(p);
      if (heading && !paragraphs[i + 1]) { image.push(p); continue; }
      const content = heading ? paragraphs[i + 1]! : p;
      if (visual(content) && !noteStart.test(content)) image.push(p);
      else reading.push(p);
    } else if (noteStart.test(p)) reading.push(p);
    else image.push(p);
  }
  return { image, reading };
}

/** 完整稿保留原章，精华只切换配图章节；原有说明/条件进入真实文字页。 */
export function compileKnowledgeEditions(title: string, modules: KnowledgeEditionModule[]) {
  const render = (level:'full'|'concise') => `<!-- knowledge-edition:v2:${level} -->\n# ${title}\n\n` + modules.map(m => {
    const textOnly=/^(阅读提示|图书信息|参考(?:资料|文献|来源)|附注|说明|注意事项|适用条件|风险提示|禁忌)(?:$|[：:｜|])/.test(m.headline);
    if(textOnly || (level==='concise'&&m.priority!=='primary'))return `## 文字｜${m.headline}\n\n${m.body.trim()}`;
    const {image, reading:notes}=splitKnowledgeModuleMedia(m.body);
    if(!image.join('').trim()&&notes.length)return `## 文字｜${m.headline}\n\n${m.body.trim()}`;
    return `## 图解｜${m.headline}\n\n${image.join('\n\n')}`+(notes.length?`\n\n## 文字｜${m.headline} · 说明\n\n${notes.join('\n\n')}`:'');
  }).join('\n\n');
  return {full:render('full'),concise:render('concise')};
}

export function knowledgeEditionParts(markdown: string) {
  const match = markdown.match(editionMarker);
  if (!match) return null;
  // 主题图标题注释只供出图规划读取，不属于正文。
  const clean=markdown.slice(match[0].length).replace(/<!-- knowledge-topic-titles:v1 \{[\s\S]*?\} -->\n?/,'');
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
