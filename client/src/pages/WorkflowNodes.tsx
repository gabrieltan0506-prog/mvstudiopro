import Navbar from "@/components/Navbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Link } from "wouter";
import { FileText, PanelsTopLeft, Image as ImageIcon, Video, Music2, Mic2, Clapperboard, Waypoints } from "lucide-react";

const PIPELINE = [
  {
    title: "脚本生成",
    en: "Script",
    icon: FileText,
    desc: "输入主题、目标与风格，生成完整创意脚本与叙事方向。",
    detail: "Gemini",
    status: "已接入"
  },
  {
    title: "故事板",
    en: "Storyboard",
    icon: PanelsTopLeft,
    desc: "把脚本拆解为镜头、节奏、场景与角色动作结构。",
    detail: "Storyboard",
    status: "已接入"
  },
  {
    title: "分镜配图",
    en: "Storyboard Images",
    icon: ImageIcon,
    desc: "根据分镜批量生成关键视觉图，并为视频步骤提供参考图。",
    detail: "Nano Banana / Kling Image",
    status: "进行中"
  },
  {
    title: "视频生成",
    en: "Video",
    icon: Video,
    desc: "基于参考图与镜头提示生成视频片段，作为主视频输出。",
    detail: "Veo / Kling",
    status: "进行中"
  },
  {
    title: "配音生成",
    en: "Voice",
    icon: Mic2,
    desc: "生成对白、旁白与说明音轨，后续与视频统一拼接。",
    detail: "OpenAI TTS",
    status: "预留"
  },
  {
    title: "音乐生成",
    en: "Music",
    icon: Music2,
    desc: "生成配乐与氛围层，补足情绪节奏与成片质感。",
    detail: "Suno / Udio",
    status: "预留"
  },
  {
    title: "最终成片",
    en: "Final Video",
    icon: Clapperboard,
    desc: "统一拼接视频、配音与音乐，最终只输出 finalVideoUrl。",
    detail: "Render Pipeline",
    status: "目标出口"
  },
];

function StatusBadge({ text }: { text: string }) {
  const cls =
    text === "已接入"
      ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-300"
      : text === "进行中"
      ? "border-amber-400/30 bg-amber-400/10 text-amber-300"
      : text === "目标出口"
      ? "border-fuchsia-400/30 bg-fuchsia-400/10 text-fuchsia-300"
      : "border-white/15 bg-white/5 text-white/65";
  return <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs ${cls}`}>{text}</span>;
}

function NodeCard({ item, last = false }: { item: typeof PIPELINE[number], last?: boolean }) {
  const Icon = item.icon;
  return (
    <div className="relative">
      <Card className="h-full overflow-hidden border-white/10 bg-white/5 backdrop-blur-sm transition-all duration-300 hover:border-primary/40 hover:bg-white/10">
        <CardContent className="p-5">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/15 text-primary">
                <Icon className="h-5 w-5" />
              </div>
              <div>
                <div className="text-xl font-bold text-white">{item.title}</div>
                <div className="text-xs text-white/45">{item.en}</div>
              </div>
            </div>
            <StatusBadge text={item.status} />
          </div>
          <div className="mb-3 text-sm font-medium text-primary/90">{item.detail}</div>
          <div className="text-sm leading-7 text-white/72">{item.desc}</div>
        </CardContent>
      </Card>
      {!last && (
        <div className="pointer-events-none hidden xl:flex absolute -right-6 top-1/2 z-10 h-6 w-12 -translate-y-1/2 items-center justify-center text-primary/70">
          <Waypoints className="h-5 w-5" />
        </div>
      )}
    </div>
  );
}

export default function WorkflowNodes() {
  return (
    <div className="min-h-screen bg-[#050816] text-white">
      <Navbar />
      <main className="mx-auto max-w-7xl px-4 pb-16 pt-24 md:px-6">
        <section className="rounded-[28px] border border-white/10 bg-[radial-gradient(circle_at_top_right,rgba(236,72,153,0.16),transparent_28%),radial-gradient(circle_at_top_left,rgba(99,102,241,0.16),transparent_22%),linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.02))] p-6 md:p-8">
          <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <div className="mb-2 inline-flex items-center rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-sm text-primary">
                节点工作流 <span className="ml-2 text-xs text-white/45">Node Workflow</span>
              </div>
              <h1 className="text-3xl font-black tracking-tight md:text-5xl">用节点方式驱动整条创作链路</h1>
              <p className="mt-3 max-w-3xl text-sm leading-7 text-white/70 md:text-base">
                新页面只做节点化入口，不替换现有稳定的 <span className="text-white">/workflow</span>。
                当前先把真实流程可视化，等后端链路完全稳定后，再把执行交互逐步切到节点模式。
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Link href="/workflow">
                <Button className="rounded-xl bg-primary px-5 text-primary-foreground hover:bg-primary/90">进入当前工作流</Button>
              </Link>
              <a href="https://www.mvstudiopro.com/workflow" target="_blank" rel="noreferrer">
                <Button variant="outline" className="rounded-xl border-white/15 bg-white/5 text-white hover:bg-white/10">打开线上页面</Button>
              </a>
            </div>
          </div>

          <div className="mb-6 grid grid-cols-1 gap-4 xl:grid-cols-7">
            {PIPELINE.map((item, index) => (
              <NodeCard key={item.title} item={item} last={index === PIPELINE.length - 1} />
            ))}
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="border-white/10 bg-white/5">
              <CardContent className="p-5">
                <div className="mb-2 text-lg font-bold">当前原则 <span className="ml-2 text-xs text-white/45">Principle</span></div>
                <div className="text-sm leading-7 text-white/70">
                  不改坏已跑通能力，新增独立节点页承接后续开发与用户入口。
                </div>
              </CardContent>
            </Card>
            <Card className="border-white/10 bg-white/5">
              <CardContent className="p-5">
                <div className="mb-2 text-lg font-bold">流程收口 <span className="ml-2 text-xs text-white/45">Output</span></div>
                <div className="text-sm leading-7 text-white/70">
                  所有步骤最终统一收口到 finalVideoUrl，避免多个结果口径冲突。
                </div>
              </CardContent>
            </Card>
            <Card className="border-white/10 bg-white/5">
              <CardContent className="p-5">
                <div className="mb-2 text-lg font-bold">大陆用户优先 <span className="ml-2 text-xs text-white/45">CN First</span></div>
                <div className="text-sm leading-7 text-white/70">
                  页面主文案全部改为简体中文，英文只作为小字补充说明。
                </div>
              </CardContent>
            </Card>
          </div>
        </section>
      </main>
    </div>
  );
}
