import { VIRAL_CONTENT_STRUCTURES } from "@shared/viralCreationMethods";
import { xhsCreationPackageSchema } from "@shared/xhsCreationPackage";

/** 只展示服务端同一创作包；视觉方案随后沿执行卡送至图片入口。 */
export function ViralCreationPackageView({ value, platform }: { value: unknown; platform?: "xiaohongshu" | "douyin" }) {
  const parsed = xhsCreationPackageSchema.safeParse(value);
  if (!parsed.success) return <p role="status" className="mt-3 text-sm text-amber-200">创作方案字段不完整，请检查原稿。</p>;
  const pack = parsed.data;
  return <details className="mt-4 rounded-xl border border-rose-200/20 p-3 text-sm text-gray-200">
    <summary className="cursor-pointer font-semibold text-rose-100">{platform === "douyin" ? "抖音" : "小红书"}创作方案 · 标题备选、封面与承接</summary>
    <p className="mt-3">{pack.audience} · {pack.scene} · {pack.problem}</p>
    <ol className="mt-3 space-y-2">{pack.titleOptions.map((option, i) => <li key={option.title}><strong>{i === 0 ? "主选" : `备选${i}`}：{option.title}</strong><p className="text-xs text-gray-400">{option.angle}</p></li>)}</ol>
    <div className="mt-4"><strong>内容结构：{VIRAL_CONTENT_STRUCTURES.find(row => row.id === pack.structure.templateId)?.name}</strong>{pack.structure.steps.map(step => <p key={step.name} className="mt-2">{step.name}：{step.quote}</p>)}</div>
    <div className="mt-4 space-y-2"><strong>封面设计（尚未生成图片）</strong><p>{pack.cover.headline} · {pack.cover.subline}</p><p>{pack.cover.visual}</p><p>{pack.cover.layout}</p><p>{pack.cover.continuity}</p></div>
    <div className="mt-4 space-y-2"><strong>一个主承接动作</strong><p>{pack.conversion.action}</p><p>{pack.conversion.offer} · {pack.conversion.delivery}</p></div>
    <div className="mt-4"><strong>标题承诺对应内容</strong>{pack.promiseDelivery.map((row, i) => <blockquote key={i} className="mt-2 border-l-2 border-rose-200/30 pl-3"><p>{row.promise}</p><p className="text-gray-400">“{row.quote}”</p></blockquote>)}</div>
    <div className="mt-4 space-y-2"><strong>发布后复盘</strong><p>{pack.experiment.hypothesis}</p><p>本轮只改：{pack.experiment.variable}；观察：{pack.experiment.primaryMetric}</p><p>{pack.experiment.observation}</p></div>
    <p className="mt-3 text-xs text-gray-500">已检查字段和原文引用；事实、语义及最终图片质量仍需审阅。</p>
  </details>;
}
