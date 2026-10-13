import type { ReactNode } from "react";
import type { PlatformTopicShortlistItem } from "@shared/platformTopicShortlist";

type Props = {
  id: string; topics: PlatformTopicShortlistItem[]; selectedIds: string[];
  count: number; countOptions: number[]; onCount: (count: number) => void;
  generationCost: number; expansionCount: number; expansionCost: number;
  loading: boolean; expanding: boolean; authenticated: boolean; showGenerate?: boolean;
  freeTopics?: number; freeRemaining?: number; maskedCount?: number;
  onGenerate: (free?: boolean) => void; onToggle: (id: string) => void;
  onSelectSuggested: () => void; onClear: () => void; onExpand: (topics: PlatformTopicShortlistItem[]) => void;
  editingId: string | null; editingTitle: string; onEditingTitle: (title: string) => void;
  onEdit: (topic: PlatformTopicShortlistItem) => void; onSave: () => void; onCancel: () => void;
  error?: string | null; progress?: string; children?: ReactNode;
};

/** 选题正文是主信息；依据可展开，所有扣点动作仍由原处理器确认。 */
export function TopicSelectionPanel(p: Props) {
  const busy = p.loading || p.expanding;
  return <section id={p.id} className="topic-selection-panel" aria-labelledby={`${p.id}-title`}>
    <header className="topic-selection-heading">
      <div><p className="creation-eyebrow">第二步 · 找到值得写的切口</p><h2 id={`${p.id}-title`}>选题方向{p.topics.length > 0 && <span>{p.topics.length} 个候选</span>}</h2><p>先挑选题，确认后再生成完整稿件。可多选，也可以先改标题。</p></div>
      {p.showGenerate !== false && <div className="topic-generate-actions">
        <div className="topic-count-control" role="group" aria-label="选题数量">{p.countOptions.map(count => <button type="button" key={count} aria-pressed={p.count === count} disabled={busy} onClick={() => p.onCount(count)}>{count} 个</button>)}</div>
        <button type="button" className="creation-primary" disabled={!p.authenticated || busy} onClick={() => p.onGenerate()}>{p.loading ? "正在准备选题…" : `生成选题 · ${p.generationCost} 点`}</button>
        {Boolean(p.freeTopics) && <button type="button" className="creation-text-action" disabled={!p.authenticated || busy} onClick={() => p.onGenerate(true)}>免费试用 {p.freeTopics} 个{p.freeRemaining ? ` · 剩 ${p.freeRemaining} 次` : ""}</button>}
      </div>}
    </header>
    {p.error && <p role="alert" className="creation-error">{p.error}</p>}
    {(p.loading || p.expanding) && <p role="status" aria-live="polite" className="creation-progress">{p.loading ? "正在结合你的需求与相关样本准备选题…" : p.progress || "正在写稿，已生成的内容会陆续显示。"}</p>}
    {p.topics.length ? <>
      <div className="topic-selection-tools"><span>已选 {p.selectedIds.length} 个选题</span><div><button type="button" disabled={busy} onClick={p.onSelectSuggested}>选择推荐</button><button type="button" disabled={busy || !p.selectedIds.length} onClick={p.onClear}>清空选择</button></div></div>
      <div className="topic-candidate-grid">{p.topics.map((topic, index) => {
        const selected = p.selectedIds.includes(topic.id); const editing = p.editingId === topic.id;
        return <article key={topic.id} className={`topic-candidate ${selected ? "is-selected" : ""}`}>
          <div className="topic-candidate-meta"><span>方向 {String(index + 1).padStart(2, "0")}</span>{topic.isTopPick && <span>推荐尝试</span>}<label className="topic-check"><input type="checkbox" checked={selected} disabled={busy} onChange={() => p.onToggle(topic.id)} aria-label={`选择选题：${topic.title}`} /><span>{selected ? "已选" : "选择"}</span></label></div>
          {editing ? <input className="topic-title-input" aria-label="修改选题标题" value={p.editingTitle} autoFocus maxLength={120} onChange={e => p.onEditingTitle(e.target.value)} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); p.onSave(); } if (e.key === "Escape") p.onCancel(); }} /> : <h3>{topic.title}</h3>}
          <p className="topic-candidate-value">{topic.conveyGoal}</p>
          {topic.viralReason && <details className="topic-reason"><summary>为什么值得尝试</summary><p>{topic.viralReason}</p><small>创意判断，仅供选择参考。</small></details>}
          <footer>{editing ? <><button type="button" onClick={p.onCancel}>取消</button><button type="button" onClick={p.onSave}>保存标题</button></> : <><button type="button" disabled={busy} onClick={() => p.onEdit(topic)}>编辑标题</button><button type="button" disabled={busy} onClick={() => p.onExpand([topic])}>用这个方向写稿 <span aria-hidden>↗</span></button></>}</footer>
        </article>;
      })}</div>
      <div className="topic-expand-bar"><div><strong>{p.selectedIds.length ? `将生成 ${p.expansionCount} 份独立稿件` : "选好方向，再开始写稿"}</strong><p>按所选平台与形式分别成稿；图片需另行生成。</p></div><button type="button" className="creation-primary" disabled={busy || !p.selectedIds.length} onClick={() => p.onExpand(p.topics.filter(t => p.selectedIds.includes(t.id)))}>{p.expanding ? "写稿中…" : `生成所选稿件 · ${p.expansionCost} 点`}</button></div>
      {Boolean(p.maskedCount) && <p className="creation-secondary-note">本次免费生成了 {p.topics.length} 个方向。需要更多时，可在上方按当前点数重新生成。</p>}
    </> : !p.loading && <div className="topic-empty"><span aria-hidden>✎</span><h3>你的下一个选题，从一个具体问题开始</h3><p>写清楚你想帮谁、解决什么问题，再生成候选方向。</p></div>}
    {p.children}
  </section>;
}
