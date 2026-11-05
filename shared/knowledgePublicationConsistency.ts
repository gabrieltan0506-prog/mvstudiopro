import type { KnowledgeReview } from "./knowledgePublication";

export type KnowledgeFactEntry = { pageId: string; headline: string; term: string; statement: string };
export type KnowledgeConsistencyPlan = { version: 1; tasks: KnowledgeFactEntry[][]; factCount: number; pageCount: number };
const cost = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;
/** 全部事实逐条纳入有界任务；同一术语的长组做分组交叉，不截断后半本。 */
export function planKnowledgeConsistency(reports: Pick<KnowledgeReview, "pages">[]): KnowledgeConsistencyPlan {
  const facts = reports.flatMap(r => r.pages.flatMap(p => p.facts.map(f => ({ pageId: p.id, headline: p.headline, ...f }))));
  const limit = 180000;
  if (cost(facts) <= limit) return { version: 1, tasks: [facts], factCount: facts.length, pageCount: reports.reduce((n,r)=>n+r.pages.length,0) };
  const byTerm = new Map<string, KnowledgeFactEntry[]>();
  for (const fact of facts) {
    const term = fact.term.normalize("NFKC").toLocaleLowerCase().replace(/\s+/g, "");
    const group = byTerm.get(term) || []; group.push(fact); byTerm.set(term, group);
  }
  const groups: KnowledgeFactEntry[][] = [];
  for (const [, group] of Array.from(byTerm.entries()).sort(([a],[b])=>a.localeCompare(b))) {
    if (cost(group) <= limit / 2) { groups.push(group); continue; }
    const chunks: KnowledgeFactEntry[][] = [];
    let chunk: KnowledgeFactEntry[] = [], bytes = 2;
    for (const entry of group) {
      const size = cost(entry)+1;
      if (size > limit / 2) throw new Error("单条知识事实超过整理容量，原稿已保留");
      if (bytes + size > limit / 2 && chunk.length) { chunks.push(chunk);chunk=[];bytes=2; }
      chunk.push(entry);bytes+=size;
    }
    if (chunk.length) chunks.push(chunk);
    // 保留相同术语跨段的每一种组合，不能只核对各段内部。
    if(chunks.length===1)groups.push(chunks[0]);
    else for(let i=0;i<chunks.length;i++)for(let j=i+1;j<chunks.length;j++)groups.push([...chunks[i],...chunks[j]]);
  }
  const tasks: KnowledgeFactEntry[][] = [];
  let task: KnowledgeFactEntry[] = [], bytes=2;
  for(const group of groups){
    const size=cost(group);
    if(task.length&&bytes+size>limit){tasks.push(task);task=[];bytes=2;}
    task.push(...group);bytes+=size;
  }
  if(task.length)tasks.push(task);
  return {version:1,tasks,factCount:facts.length,pageCount:reports.reduce((n,r)=>n+r.pages.length,0)};
}
