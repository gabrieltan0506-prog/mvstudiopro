import React, { useMemo, useState } from "react";
import Navbar from "@/components/Navbar";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  FileText,
  PanelsTopLeft,
  Image as ImageIcon,
  Video,
  Mic2,
  Music2,
  Clapperboard,
  Sparkles,
  Move,
  Lock,
  Scissors,
} from "lucide-react";

type NodeItem = {
  id: string;
  title: string;
  en: string;
  x: number;
  y: number;
  color: string;
  status: "已接入" | "开发中" | "未接入";
  desc: string;
  icon: React.ComponentType<any>;
};

const initialNodes: NodeItem[] = [
  {
    id: "prompt",
    title: "提示词输入",
    en: "Prompt",
    x: 60,
    y: 140,
    color: "from-fuchsia-500/30 to-pink-500/10",
    status: "已接入",
    desc: "输入主题、风格、镜头目标与创作要求。",
    icon: Sparkles,
  },
  {
    id: "script",
    title: "脚本生成",
    en: "Script",
    x: 320,
    y: 80,
    color: "from-violet-500/30 to-indigo-500/10",
    status: "已接入",
    desc: "根据提示生成完整创意脚本。",
    icon: FileText,
  },
  {
    id: "storyboard",
    title: "故事板",
    en: "Storyboard",
    x: 590,
    y: 80,
    color: "from-sky-500/30 to-cyan-500/10",
    status: "已接入",
    desc: "将脚本拆解为分镜、节奏与场景。",
    icon: PanelsTopLeft,
  },
  {
    id: "images",
    title: "分镜配图",
    en: "Storyboard Images",
    x: 860,
    y: 80,
    color: "from-emerald-500/30 to-teal-500/10",
    status: "已接入",
    desc: "生成分镜图，作为后续视频参考图。",
    icon: ImageIcon,
  },
  {
    id: "character",
    title: "角色一致性",
    en: "Character Lock",
    x: 860,
    y: 310,
    color: "from-amber-500/30 to-yellow-500/10",
    status: "开发中",
    desc: "角色锁定、形象延续与参考图约束。",
    icon: Lock,
  },
  {
    id: "removebg",
    title: "去背景",
    en: "Background Removal",
    x: 1130,
    y: 310,
    color: "from-orange-500/30 to-red-500/10",
    status: "未接入",
    desc: "上传角色图后自动抠图，便于角色复用。",
    icon: Scissors,
  },
  {
    id: "video",
    title: "视频生成",
    en: "Video",
    x: 1130,
    y: 80,
    color: "from-blue-500/30 to-indigo-500/10",
    status: "开发中",
    desc: "基于参考图与分镜提示生成视频片段。",
    icon: Video,
  },
  {
    id: "voice",
    title: "智能配音",
    en: "OpenAI TTS",
    x: 1400,
    y: 80,
    color: "from-cyan-500/30 to-blue-500/10",
    status: "开发中",
    desc: "对白、旁白与说明音轨自动生成。",
    icon: Mic2,
  },
  {
    id: "music",
    title: "自动配乐",
    en: "Suno",
    x: 1400,
    y: 310,
    color: "from-pink-500/30 to-fuchsia-500/10",
    status: "开发中",
    desc: "根据画面节奏生成音乐与氛围层。",
    icon: Music2,
  },
  {
    id: "render",
    title: "最终成片",
    en: "Final Video",
    x: 1670,
    y: 195,
    color: "from-white/20 to-white/5",
    status: "开发中",
    desc: "统一输出 finalVideoUrl，作为唯一成片结果。",
    icon: Clapperboard,
  },
];

const edges = [
  ["prompt", "script"],
  ["script", "storyboard"],
  ["storyboard", "images"],
  ["images", "video"],
  ["images", "character"],
  ["character", "video"],
  ["character", "removebg"],
  ["video", "render"],
  ["voice", "render"],
  ["music", "render"],
];

function badgeClass(status: NodeItem["status"]) {
  if (status === "已接入") return "border-emerald-400/30 bg-emerald-400/10 text-emerald-300";
  if (status === "开发中") return "border-amber-400/30 bg-amber-400/10 text-amber-300";
  return "border-white/15 bg-white/5 text-white/60";
}

function edgePath(from: NodeItem, to: NodeItem) {
  const x1 = from.x + 220;
  const y1 = from.y + 58;
  const x2 = to.x;
  const y2 = to.y + 58;
  const c1 = x1 + Math.max(80, (x2 - x1) / 2);
  const c2 = x2 - Math.max(80, (x2 - x1) / 2);
  return `M ${x1} ${y1} C ${c1} ${y1}, ${c2} ${y2}, ${x2} ${y2}`;
}

export default function WorkflowNodes() {
  const [nodes] = useState<NodeItem[]>(initialNodes);
  const [selected, setSelected] = useState<string>("video");

  const nodeMap = useMemo(() => {
    const m = new Map<string, NodeItem>();
    for (const n of nodes) m.set(n.id, n);
    return m;
  }, [nodes]);

  const current = nodeMap.get(selected) || nodes[0];

  return (
    <div className="min-h-screen bg-[#050816] text-white">
      <Navbar />
      <main className="px-4 pb-8 pt-24 md:px-6">
        <div className="mx-auto max-w-[1880px]">
          <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="inline-flex items-center rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-sm text-primary">
                画布式工作流 <span className="ml-2 text-xs text-white/45">Canvas Workflow</span>
              </div>
              <h1 className="mt-3 text-3xl font-black tracking-tight md:text-5xl">用画布节点管理整条 AI 创作链路</h1>
              <p className="mt-3 max-w-4xl text-sm leading-7 text-white/70 md:text-base">
                这里开始承接后续迁移，不再做卡片跳转。先保持旧版 <span className="text-white">/workflow</span> 可用，
                同步把脚本、分镜、配图、视频、配音、配乐、成片逐步迁到画布式节点交互。
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Button className="rounded-xl bg-primary px-5 text-primary-foreground hover:bg-primary/90">
                继续迁移
              </Button>
              <a href="https://www.mvstudiopro.com/workflow" target="_blank" rel="noreferrer">
                <Button variant="outline" className="rounded-xl border-white/15 bg-white/5 text-white hover:bg-white/10">
                  查看旧版页面
                </Button>
              </a>
            </div>
          </div>

          <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
            <div className="overflow-hidden rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.02))]">
              <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
                <div className="text-lg font-bold">节点画布 <span className="ml-2 text-xs text-white/45">Node Canvas</span></div>
                <div className="inline-flex items-center gap-2 text-xs text-white/55">
                  <Move className="h-4 w-4" />
                  当前先做稳定迁移，不改坏旧链路
                </div>
              </div>

              <div className="relative overflow-auto">
                <div
                  className="relative"
                  style={{
                    width: 1940,
                    height: 620,
                    backgroundImage:
                      "radial-gradient(rgba(255,255,255,0.08) 1px, transparent 1px)",
                    backgroundSize: "24px 24px",
                  }}
                >
                  <svg className="absolute inset-0 h-full w-full">
                    {edges.map(([a, b]) => {
                      const from = nodeMap.get(a)!;
                      const to = nodeMap.get(b)!;
                      const active = selected === a || selected === b;
                      return (
                        <path
                          key={`${a}-${b}`}
                          d={edgePath(from, to)}
                          fill="none"
                          stroke={active ? "rgba(236,72,153,0.9)" : "rgba(255,255,255,0.22)"}
                          strokeWidth={active ? 3 : 2}
                          strokeDasharray={active ? "0" : "6 6"}
                          strokeLinecap="round"
                        />
                      );
                    })}
                  </svg>

                  {nodes.map((node) => {
                    const Icon = node.icon;
                    const active = selected === node.id;
                    return (
                      <button
                        key={node.id}
                        onClick={() => setSelected(node.id)}
                        className={`absolute w-[220px] rounded-2xl border text-left transition-all duration-200 ${
                          active
                            ? "border-primary/60 shadow-[0_0_0_1px_rgba(236,72,153,0.28),0_24px_80px_rgba(236,72,153,0.16)]"
                            : "border-white/10 hover:border-white/20"
                        }`}
                        style={{ left: node.x, top: node.y }}
                      >
                        <div className={`rounded-2xl bg-gradient-to-br ${node.color} p-[1px]`}>
                          <div className="rounded-2xl bg-[#0b1020]/95 p-4 backdrop-blur-xl">
                            <div className="mb-3 flex items-start justify-between gap-3">
                              <div className="flex items-center gap-3">
                                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/10 text-white">
                                  <Icon className="h-5 w-5" />
                                </div>
                                <div>
                                  <div className="font-bold text-white">{node.title}</div>
                                  <div className="text-[11px] text-white/45">{node.en}</div>
                                </div>
                              </div>
                              <span className={`rounded-full border px-2 py-1 text-[11px] ${badgeClass(node.status)}`}>
                                {node.status}
                              </span>
                            </div>
                            <div className="text-xs leading-6 text-white/68">{node.desc}</div>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <Card className="border-white/10 bg-white/5">
                <CardContent className="p-5">
                  <div className="mb-3 text-lg font-bold">当前节点 <span className="ml-2 text-xs text-white/45">Selected Node</span></div>
                  <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                    <div className="mb-1 text-xl font-black">{current.title}</div>
                    <div className="mb-3 text-xs text-white/45">{current.en}</div>
                    <div className="mb-3 inline-flex rounded-full border px-2.5 py-1 text-xs text-white/70">
                      状态：{current.status}
                    </div>
                    <div className="text-sm leading-7 text-white/72">{current.desc}</div>
                  </div>
                </CardContent>
              </Card>

              <Card className="border-white/10 bg-white/5">
                <CardContent className="p-5">
                  <div className="mb-3 text-lg font-bold">本轮迁移范围 <span className="ml-2 text-xs text-white/45">Migration Scope</span></div>
                  <div className="space-y-2 text-sm leading-7 text-white/72">
                    <div>1. 先把节点画布替换到现有页面，不新增执行页。</div>
                    <div>2. 保留旧版 workflow 作为稳定回退。</div>
                    <div>3. 后续按节点逐个接入真实执行能力。</div>
                  </div>
                </CardContent>
              </Card>

              <Card className="border-white/10 bg-white/5">
                <CardContent className="p-5">
                  <div className="mb-3 text-lg font-bold">当前重点 <span className="ml-2 text-xs text-white/45">Current Focus</span></div>
                  <div className="space-y-2 text-sm leading-7 text-white/72">
                    <div>• 视频生成还要继续接通真实链路。</div>
                    <div>• 角色一致性与去背景还未完整接入。</div>
                    <div>• 最终必须统一输出 finalVideoUrl。</div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
