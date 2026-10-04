import { novelDraftChapters, type ManhuaNovelDraft } from './manhuaNovelSource';
export type SourceBlock = { id: string; title: string; from: number; to: number; preview: string; chars: number };
/** Extractive reading guide: keeps original boundaries and quotes, never invents plot summaries. */
export function buildNovelSourceGuide(draft: ManhuaNovelDraft): SourceBlock[] {
  const units = novelDraftChapters(draft);
  const headings = units.map(u => {
    const content = draft.text.slice(u.start, u.end).replace(/［原文件第\s*\d+\s*页］/g, '').trim();
    const lines = content.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const titles = lines.filter(l => /^(第[一二三四五六七八九十百\d]+[章回卷]|楔子|尾声|序章)/.test(l) && l.length < 50);
    const front = lines.slice(0, 3).join(' ');
    const nonStory = /^(目录|版权信息|参考书籍|附录|后记|注释)/.test(front) || titles.length > 2;
    return { content, title: nonStory ? '' : titles[0] || (!/^第\s*\d+\s*页/.test(u.title) ? u.title : ''), nonStory };
  });
  const blocks: SourceBlock[] = [];
  let title = '正文选段';
  for (let from = 0; from < units.length;) {
    const h = headings[from];
    if (h.title) title = h.title;
    if (h.nonStory || h.content.length < 80 || /此页未识别到文字/.test(h.content)) { from++; continue; }
    let to = from;
    while (to + 1 < units.length && !headings[to + 1].title && !headings[to + 1].nonStory &&
      draft.text.slice(units[from].start, units[to + 1].end).length < 7000) to++;
    const raw = draft.text.slice(units[from].start, units[to].end);
    const body = raw.replace(/［原文件第\s*\d+\s*页］/g, '').replace(/\s+/g, ' ');
    const sentences = body.match(/[^。！？]+[。！？]/g) || [body];
    const ranked = sentences.map((s, i) => ({s, i, score: (s.match(/但|却|因此|决定|为了|争|兵|杀|权|逃|救|发现|秘密/g) || []).length}));
    const chosen = ranked.filter(r=>r.s.length > 20).sort((a,b)=>b.score-a.score).slice(0,3).sort((a,b)=>a.i-b.i);
    const preview = (chosen.length ? chosen.map(r=>r.s.trim()).join(' … ') : body).slice(0,500);
    blocks.push({id:`${from}-${to}`, title, from, to, preview, chars: raw.length});
    from = to + 1;
  }
  return blocks;
}
export function composeNovelSourceSelection(draft: ManhuaNovelDraft) {
  const units = novelDraftChapters(draft);
  return (draft.selections || []).map((r, i) => {
    const a=units[r.from], b=units[r.to];
    return `【板块${i+1}：${a.title} 至 ${b.title}】\n${draft.text.slice(a.start,b.end)}`;
  }).join('\n\n');
}
