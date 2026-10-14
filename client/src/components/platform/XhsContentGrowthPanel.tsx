import { useState } from "react";
import { compileXhsCreativeBrief, type XhsCreativeBrief, type XhsGrowthEvidence } from "@shared/xhsContentStrategy";

/** 新增的可选需求助手；确认后写入既有人物背景并沿原草稿保存链恢复。 */
export function XhsContentGrowthPanel(props: {
  platforms: Array<"xiaohongshu" | "douyin">; onPlatformsChange: (platforms: Array<"xiaohongshu" | "douyin">) => void;
  formats: Array<"图文" | "短视频">; onFormatsChange: (formats: Array<"图文" | "短视频">) => void;
  enabled: boolean; onEnabledChange: (enabled: boolean) => void;
  onApply: (text: string, goal: XhsCreativeBrief["goal"]) => void;
}) {
  const [brief, setBrief] = useState<XhsCreativeBrief>({ audience: "", scene: "", problem: "", proof: "", offer: "", goal: "follow", format: "图文笔记", constraints: "" });
  const [error, setError] = useState("");
  const set = (key: keyof XhsCreativeBrief, value: string) => setBrief(previous => ({ ...previous, [key]: value }));
  return <section className="creation-preferences">
    <h2>这次做什么内容</h2>
    <div className="creation-preference-options">
      <fieldset><legend>发布平台</legend>{(["xiaohongshu", "douyin"] as const).map(platform => <label key={platform} className="creation-choice"><input type="checkbox" checked={props.platforms.includes(platform)} onChange={e => { const next = e.target.checked ? [...props.platforms, platform] : props.platforms.filter(p => p !== platform); if (next.length) props.onPlatformsChange(next); }} />{platform === "douyin" ? "抖音" : "小红书"}</label>)}</fieldset>
      <fieldset><legend>内容形式</legend>{(["图文", "短视频"] as const).map(format => <label key={format} className="creation-choice"><input type="checkbox" checked={props.formats.includes(format)} onChange={e => { const next = e.target.checked ? [...props.formats, format] : props.formats.filter(f => f !== format); if (next.length) props.onFormatsChange(next); }} />{format === "图文" ? "图文笔记" : "视频文案"}</label>)}</fieldset>
    </div>
    <details className="mt-3"><summary className="cursor-pointer text-sm text-gray-300">更多创作偏好（选填）</summary>
    <div className="mt-3 grid gap-3 sm:grid-cols-2">
      {([ ["audience", "目标人群", "例如：刚入职、午餐常点外卖的人"], ["scene", "具体场景", "例如：午休只有30分钟"], ["problem", "一个要解决的问题", "例如：如何快速看懂外卖搭配"], ["proof", "真实素材或经历", "已有拍摄、亲历、可引用资料；没有就填待补"], ["offer", "产品或服务", "真实可交付的商品或服务；可暂不填写"], ["constraints", "本次要求", "时长、页数、口吻、已有角色与画面"] ] as const).map(([key, label, placeholder]) => <label key={key} className="text-xs text-gray-300">{label}<textarea value={brief[key]} onChange={e => set(key, e.target.value)} maxLength={500} placeholder={placeholder} rows={2} className="mt-1 w-full rounded-lg border border-white/15 bg-black/25 p-2 text-sm text-white" /></label>)}
      <label className="text-xs text-gray-300">本轮主目标<select value={brief.goal} onChange={e => set("goal", e.target.value)} className="mt-1 w-full rounded-lg bg-gray-900 p-2 text-white"><option value="follow">涨粉：给出持续关注的理由</option><option value="acquire">获客：承接站内咨询</option><option value="convert">成交：说明产品与交付</option></select></label>

    </div>
    <p className="mt-2 text-xs text-gray-400">填写后加入下方创作需求才会保存；不会自动生成或扣点。原需求保留，重复添加前可先编辑原需求。</p>
    {error && <p role="alert" className="mt-2 text-xs text-rose-300">{error}</p>}
    <button type="button" onClick={() => { try { props.onApply(compileXhsCreativeBrief(brief), brief.goal); setError(""); } catch (e) { setError(e instanceof Error ? e.message : "请检查填写内容"); } }} className="mt-3 rounded-lg border border-rose-200/30 px-3 py-2 text-sm text-rose-100">加入创作需求并启用</button>
    </details>
  </section>;
}

export function XhsGrowthEvidenceView({ evidence }: { evidence: XhsGrowthEvidence }) {
  if (evidence.selectedCount <= 0 || !evidence.samples.length) return null;
  return <details className="mt-3 rounded-xl border border-white/10 p-3 text-xs text-gray-300">
    <summary className="cursor-pointer">本组选题参考 · {evidence.platform === "douyin" ? "抖音" : "小红书"}· {evidence.samples.length} 条参考样本</summary>
    <p className="mt-2 leading-5">{evidence.note}</p>
    <p className="mt-1">窗口：{evidence.windowStart.slice(0, 10)} 至 {evidence.windowEnd.slice(0, 10)}；读取 {evidence.sourceCount} 条{evidence.excludedUnknownDate > 0 ? `，日期不明 ${evidence.excludedUnknownDate} 条未纳入` : ""}{evidence.excludedOutsideWindow > 0 ? `，窗口外 ${evidence.excludedOutsideWindow} 条未纳入` : ""}。</p>
    <ul className="mt-2 space-y-2">{evidence.samples.map(sample => <li key={sample.id}>{sample.url && /^https?:\/\//i.test(sample.url) ? <a href={sample.url} target="_blank" rel="noreferrer" className="text-rose-200 underline">{sample.title}</a> : sample.title}<span className="block text-gray-500">{sample.dateKind === "publishedAt" ? "发布" : "采集/记录"} {sample.date.slice(0, 10)} · 赞 {sample.likes ?? "未采集"} · 评 {sample.comments ?? "未采集"}</span></li>)}</ul>
  </details>;
}
