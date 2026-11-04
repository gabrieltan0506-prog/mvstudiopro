import React from "react";

import type { ConcreteTrendData } from "../../../shared/concreteTrendReport";
export type { ConcreteTrendData, ConcreteTrendExample } from "../../../shared/concreteTrendReport";

/** 展示真实作品及编辑分析，保留来源ID；缺失指标不伪造趋势或排名。 */
export function ConcreteTrendReport({ data }: { data: ConcreteTrendData }) {
  // 旧云草稿的分类数量/点赞份额也不再作为增长条展示。
  const metrics = data.metricKind === "interactionRate" ? data.metrics : [];
  const displayDate = (value: string | null) => value && Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai" }).format(new Date(value)) : "";
  const colors = ["#0799ad", "#8650d2", "#db397c", "#bc820c"];
  const section = (title: string) => <h2 style={{ fontSize: 16, letterSpacing: 1, borderLeft: "3px solid #be8067", paddingLeft: 10, margin: "23px 0 12px", color: "#725a4d" }}>{title}</h2>;
  const panel: React.CSSProperties = { background: "#fffaf4", border: "1px solid #e4d3c7", borderRadius: 9, padding: "20px 22px" };
  const label = (text: string, color: string) => <span style={{ display: "inline-block", border: `1px solid ${color}66`, background: `${color}09`, color, borderRadius: 3, padding: "3px 8px", fontSize: 13, margin: "3px 5px 3px 0", fontWeight: 650 }}>{text}</span>;
  return <article style={{ width: 1120, boxSizing: "border-box", padding: "32px 34px 24px", background: "linear-gradient(#eee4d7, #e5c2b2)", color: "#3f342d", fontFamily: '"Noto Sans CJK SC", "PingFang SC", sans-serif', fontSize: 14, lineHeight: 1.75 }}>
    <header style={{ borderBottom: "2px solid #d2ae9b", paddingBottom: 13 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}><h1 style={{ fontSize: 26, margin: 0 }}>{data.reportTitle}</h1><span style={{ fontSize: 14 }}>{data.dateRange}</span></div>
      <div style={{ marginTop: 10 }}>{["核心洞察", "选题关键词", "博主与真实内容", "受众与应用", "选题执行"].map(x => <React.Fragment key={x}>{label(x, "#b77759")}</React.Fragment>)}</div>
    </header>
    {section("核心洞察 · 从作品里看内容机会")}
    <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(4, data.insights?.length || 4)},1fr)`, gap: 14 }}>
      {(data.insights || data.themes.map(t => ({ title: t.primary, detail: t.secondary.join("、") }))).map((row, i) => <div key={i} style={{ ...panel, padding: "16px 17px", borderTop: `3px solid ${colors[i % 4]}` }}>
        <div style={{ color: colors[i % 4], fontSize: 12, fontWeight: 700 }}>● 观察 {i + 1}</div><h3 style={{ color: colors[i % 4], fontSize: 17, lineHeight: 1.5, margin: "10px 0" }}>{row.title}</h3><div>{row.detail}</div>
      </div>)}
    </div>
    {section("选题关键词 · 具体任务与内容切口")}
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, padding: 16, border: "1px solid #d6ac97", borderRadius: 9 }}>
      {data.themes.map((theme,i) => <div key={i} style={{ background: "#fffaf4cc", padding: "10px 15px", borderLeft: `3px solid ${colors[i % 4]}`, borderRadius: 4 }}><div style={{ fontWeight: 700, color: colors[i % 4] }}>★ {theme.primary}</div><div>{theme.secondary.map(s => <React.Fragment key={s}>{label(s, colors[i % 4])}</React.Fragment>)}</div></div>)}
    </div>
    {section("博主作品拆解 · 真实文案依据 + 可借鉴结构")}
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 15 }}>
      {data.examples.map((example, i) => <div key={example.id} style={{ ...panel, borderTop: `3px solid ${colors[i % 4]}` }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}><strong style={{ color: colors[i % 4], fontSize: 16 }}>{example.author || "作者待核实"}</strong><span style={{ fontSize: 12, color: "#927d6e", whiteSpace: "nowrap" }}>{displayDate(example.publishedAt)}</span></div>
        <h3 style={{ fontSize: 19, margin: "10px 0", lineHeight: 1.5 }}>{example.title}</h3>
        <p style={{ margin: "8px 0 12px" }}>{example.description}</p>
        <p style={{ color: "#927d6e", fontSize: 12 }}>{([["likes","点赞"],["comments","评论"],["shares","分享"],["views","播放"]] as const).filter(([key])=>typeof example[key] === "number").map(([key,label])=>`${label} ${example[key]!.toLocaleString("en-US")}`).join(" · ")}</p>
        {[["内容切口",example.angle],["可借鉴结构",example.structure],["延伸做法",example.adaptation]].filter(([,v]) => v).map(([k,v]) => <div key={k} style={{ borderTop: "1px solid #ecddd2", paddingTop: 8, marginTop: 8 }}><strong style={{ color: colors[i % 4] }}>{k}　</strong>{v}</div>)}
      </div>)}
    </div>
    {section("证据信号与应用方向")}
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 15 }}>
      <div style={panel}><h3 style={{ margin: "0 0 13px", fontSize: 17, color: colors[0] }}>{metrics?.length ? "高热案例 · 累计互动表现" : "内容切口与延伸方向"}</h3>
        {metrics?.length ? <><p style={{ color: "#8b7566", fontSize: 12 }}>（点赞＋评论＋分享）÷播放×100%；比较累计互动表现，不代表题材增长率。</p>{metrics.map((row,i) => <div key={i} style={{ margin: "15px 0" }}><div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}><strong>{row.name}</strong><strong style={{ color: colors[i % 4] }}>{row.rate.toFixed(2)}%</strong></div><div style={{ background: "#e7dad1", height: 7, borderRadius: 4, margin: "7px 0" }}><div style={{ background: colors[i % 4], height: 7, width: `${row.rate / Math.max(...metrics.map(m => m.rate), 1) * 100}%`, borderRadius: 4 }}/></div><div style={{ fontSize: 12, color: "#877064" }}>{row.detail}</div></div>)}</> : data.examples.map((e,i) => <div key={e.id} style={{ borderLeft: `2px solid ${colors[i % 4]}`, paddingLeft: 12, margin: "14px 0" }}><strong style={{ color: colors[i % 4] }}>{e.author}</strong><div>{e.angle || e.description}</div></div>)}
      </div>
      <div style={panel}><h3 style={{ margin: "0 0 13px", color: colors[2], fontSize: 17 }}>目标人群与内容应用</h3>{data.audiences?.map((row,i) => <div key={row.name} style={{ padding: "10px 0 15px", borderBottom: i < data.audiences!.length - 1 ? "1px solid #e5d3c5" : undefined }}><strong style={{ color: colors[i % 4] }}>★ {row.name}</strong><div>{row.need}</div><div style={{ marginTop: 7, color: colors[i % 4] }}><b>内容应用：</b>{row.direction}</div></div>)}</div>
    </div>
    {section("可执行选题 · 从参考内容到自己的作品")}
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 15 }}>{data.suggestions.map((row,i) => <div key={i} style={{ ...panel, padding: "16px 20px" }}><h3 style={{ fontSize: 17, color: colors[i % 4], margin: "0 0 9px" }}>0{i+1}　{row.title}</h3><div>{row.detail}</div></div>)}</div>
  </article>;
}
