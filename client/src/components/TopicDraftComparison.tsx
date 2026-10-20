import { useState } from "react";
import { groupTopicsForReading, topicReferenceLabel, type TopicReadingComparison } from "@shared/topicDigestPresentation";
import "./topicDraftComparison.css";

/** 正式页面与真实稿件预览共用；完整正文使用React转义，不输出原始JSON。 */
export function TopicDraftComparison({ comparison }: { comparison: TopicReadingComparison }) {
  const [active, setActive] = useState(comparison.sections.some(s => s.key === "integrated") ? "integrated" : "deepseek");
  const section = comparison.sections.find(s => s.key === active) || comparison.sections[0];
  if (!section) return <p>没有可读取的原稿。</p>;
  return <div className="topic-reading">
    <p className="topic-reading-intro">{comparison.scope === "selected" ? "这里仅对照本期已推荐选题及其对应原稿。" : "三份内容分别保留，按创作环节分组，同组沿用原稿顺序。"}分类来自现有标题与标签，不是效果排名，也不改写原文。</p>
    <div className="topic-reading-tabs" role="tablist" aria-label="原稿与整合稿">
      {comparison.sections.map(s => <button type="button" key={s.key} role="tab" aria-selected={section.key === s.key} onClick={() => setActive(s.key)}>{s.label}<small>{s.unavailable ? "记录缺失" : `${s.rows.length}题`}</small></button>)}
    </div>
    <div role="tabpanel" aria-label={section.label}>
      {section.unavailable && <p role="status">这份历史原稿未保存或结构无法读取，未用其他稿件代替。</p>}
      {!section.unavailable && !section.rows.length && <p>这份原稿没有与本次推荐对应的选题。</p>}
      <div className="topic-reading-index">{groupTopicsForReading(section.rows).map(g => <span key={g.group}>{g.group} · {g.rows.length}题</span>)}</div>
      {groupTopicsForReading(section.rows).map((group, i) => <section key={group.group} className="topic-reading-group" aria-label={group.group}>
        <h3>{i + 1}. {group.group}</h3>
        {group.rows.map(row => <article key={row.key} data-topic-key={row.key}>
          <p className="topic-reading-meta">{section.label}第{row.originalIndex}题 · {row.format} <span title={row.groupReason}>／ {row.groupReason}</span></p>
          <h4>{row.title}</h4>
          {row.draftRefs && <p className="topic-reading-origin">{row.draftRefs.length > 1 ? "合并自：" : "承接自："}{row.draftRefs.map(topicReferenceLabel).join("、")}</p>}
          <p className="topic-reading-label">这题讲什么</p><p>{row.angle}</p>
          <blockquote><strong>开场句</strong>{row.hook}</blockquote>
          <details><summary>展开完整提纲、标签{row.draftRefs?.length ? "和对应原稿" : ""}</summary>
            <ol>{row.outline.map((line, n) => <li key={n}>{line || "（原稿此项为空）"}</li>)}</ol>
            <p>标签：{row.tags.join("、") || "无"}</p>
            <p>热点来源编号：{row.sourceIds.join("、") || "无，按常青内容阅读"}</p>
            {row.draftRefs?.map(ref => {
              const source = comparison.sections.flatMap(s => s.rows).find(r => r.key === ref);
              return <details key={ref} className="topic-reading-source"><summary>{topicReferenceLabel(ref)}：{source?.title || "来源记录缺失"}</summary>
                {source && <><p>{source.angle}</p><blockquote>{source.hook}</blockquote><ol>{source.outline.map((line, n) => <li key={n}>{line || "（原稿此项为空）"}</li>)}</ol><p>标签：{source.tags.join("、")}</p></>}
              </details>;
            })}
          </details>
        </article>)}
      </section>)}
      {section.key === "integrated" && comparison.mergeNotes.length > 0 && <details className="topic-reading-notes"><summary>查看完整合并与取舍说明</summary><ol>{comparison.mergeNotes.map((note, i) => <li key={i}>{note.replace(/(?:deepseek|glm):[1-8]/g, topicReferenceLabel)}</li>)}</ol></details>}
    </div>
  </div>;
}
