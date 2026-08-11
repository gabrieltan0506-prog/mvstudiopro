/**
 * 首页「平台创作亮点区」：以 /platform 能力为主语的宣传位。
 * 此前平台能力散落在引擎卡里，没有一个独立叙事区——这里补上。
 * 前台零技术泄漏：只讲能做什么、交付什么，不出现任何模型/供应商名。
 */

import { Link } from "wouter";

type HighlightEntry = {
  title: string;
  tagline: string;
  badge?: string;
  points: Array<{ label: string; desc: string }>;
  href: string;
};

const HIGHLIGHTS: HighlightEntry[] = [
  {
    title: "选题工厂",
    tagline: "不再对着空白框想题目：一次 20 条，按爆款潜力打分排序。",
    points: [
      { label: "初选 · 评分 · 排序", desc: "每条带钩子草稿与爆款理由，勾选就写" },
      { label: "平台顾问追问", desc: "结合你的定位与近窗口趋势给落地建议" },
    ],
    href: "/platform?mode=create",
  },
  {
    title: "文案 + 逐镜拆片表",
    tagline: "扩写完不止一段文案：台词、景别、运镜逐镜落成表，照着就能拍。",
    badge: "新上线",
    points: [
      { label: "逐镜七栏表", desc: "台词一字不差／场景／景别／动作／运镜／剪辑" },
      { label: "一键复制", desc: "整表复制即走，粘进任何笔记工具都是表格" },
    ],
    href: "/platform?mode=create",
  },
  {
    title: "图文知识卡",
    tagline: "把一本九万字的书，读成一叠能直接发的卡片。",
    points: [
      { label: "文档变卡", desc: "上传文档或图片，自动提炼多页横版知识卡" },
      { label: "精细／均衡／轻量", desc: "同一入口三档任选，成本自己定" },
    ],
    href: "/platform?mode=create&tab=copy",
  },
  {
    title: "封面 + 分镜套装",
    tagline: "封面与 2×4 编导分镜一键成套出图，整批下单更省。",
    points: [
      { label: "一键成套", desc: "封面与分镜同时排队，出完自动归位" },
      { label: "拆片表垫底", desc: "分镜按逐镜表分格，画面不再自由发挥" },
    ],
    href: "/platform?mode=create",
  },
];

export default function HomePlatformHighlights() {
  return (
    <section className="mx-auto w-full max-w-[1240px] px-5 py-14">
      <div className="text-center">
        <span className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/[0.04] px-3 py-1 text-[11px] font-semibold tracking-wide text-white/60">
          平台创作 · 一人全链路
        </span>
        <h2 className="mt-4 text-[26px] font-extrabold leading-tight text-white sm:text-[34px]">
          一个人，就是一个新媒体部门
        </h2>
        <p className="mx-auto mt-3 max-w-[640px] text-[13px] leading-relaxed text-white/55 sm:text-sm">
          选题、文案、拆片、图文卡、封面分镜——一条流水线跑完，不用再换五个工具。
        </p>
      </div>

      <div className="mt-9 grid gap-4 sm:grid-cols-2">
        {HIGHLIGHTS.map((entry) => (
          <div
            key={entry.title}
            className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 transition-colors hover:border-white/20 hover:bg-white/[0.05]"
          >
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-[17px] font-bold text-white">{entry.title}</h3>
              {entry.badge ? (
                <span className="rounded-full bg-emerald-400/15 px-2 py-0.5 text-[10px] font-bold text-emerald-300">
                  {entry.badge}
                </span>
              ) : null}
            </div>
            <p className="mt-1.5 text-[12.5px] leading-relaxed text-white/50">{entry.tagline}</p>

            <ul className="mt-4 space-y-2">
              {entry.points.map((point) => (
                <li key={`${entry.title}-${point.label}`}>
                  <Link
                    href={entry.href}
                    className="group flex flex-col rounded-xl border border-white/8 bg-white/[0.02] px-3.5 py-2.5 transition-colors hover:border-white/18 hover:bg-white/[0.06]"
                  >
                    <span className="flex items-center gap-1.5 text-[13px] font-semibold text-white/85 group-hover:text-white">
                      {point.label}
                      <span aria-hidden className="text-white/30 group-hover:text-white/60">
                        →
                      </span>
                    </span>
                    <span className="mt-0.5 text-[11.5px] leading-relaxed text-white/45">
                      {point.desc}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div className="mt-8 text-center">
        <Link
          href="/platform"
          className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.06] px-6 py-2.5 text-[14px] font-semibold text-white transition-colors hover:border-white/30 hover:bg-white/[0.1]"
        >
          进入平台创作 <span aria-hidden>→</span>
        </Link>
      </div>
    </section>
  );
}
