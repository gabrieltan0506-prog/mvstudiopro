/**
 * 企业专属智能体（AaaS）管理页 — 客户列表 + 部署
 *
 * 路由：/enterprise-agent（与 /my-works 同模式）
 * 后端：trpc.enterpriseAgents.list / createAgent（PR-3 已建）
 *
 * 范围（PR-4 严格）：
 *   - 列出当前用户全部 agents
 *   - "新建 agent" Dialog（react-hook-form + zod 表单校验）
 *   - 卡片点击进入 /enterprise-agent/:agentId 详情页
 *   - 不在本页：KB 上传 / executeQuery / 客户 Playground / 首页营销卡
 *
 * 视觉路线（agent-dev.md L234 黑金感作为风格 + reviewer 红线）：
 *   - 黑底 zinc-950 + 米白 zinc-100 + 香槟金强调 amber-400 / amber-500/40
 *   - 全 Tailwind className，零 inline style（防止 Agent A 之后还要响应式改造）
 *
 * 响应式（reviewer 红线 + day 1 硬约束）：
 *   - grid: 移动 1 列 / 平板 sm:2 列 / 桌面 lg:3 列
 *   - 卡片字号 ≥ 14px（class text-sm 起步），按钮 min-h-[44pt]
 *   - input/textarea 移动 fontSize 16px（class text-base）防 iOS auto-zoom
 *   - 顶栏：移动叠层（标题 → 按钮垂直）；平板起 sm:flex-row 平铺
 */

import { useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import {
  Loader2,
  Plus,
  Building2,
  Database,
  ChevronRight,
  AlertTriangle,
  Sparkles,
  Trash2,
  PauseCircle,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

// ─── 表单 schema ───────────────────────────────────────────────────────────
//
// 与 server/routers/enterpriseAgents.ts 的 createAgent input 对齐
// （后端是真理；前端只是先筛一遍，最终校验在后端）
const createAgentSchema = z.object({
  agentName: z
    .string()
    .min(2, "至少 2 字")
    .max(100, "最多 100 字"),
  organizationName: z.string().max(200).optional(),
  systemCommand: z
    .string()
    .min(50, "灵魂指令至少 50 字（描述清楚 agent 的角色 / 任务 / 输出风格）")
    .max(20_000, "灵魂指令最多 20000 字"),
});
type CreateAgentForm = z.infer<typeof createAgentSchema>;

// ─── 时间格式化 ────────────────────────────────────────────────────────────

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

function daysUntil(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const d = new Date(iso).getTime();
  if (Number.isNaN(d)) return null;
  const diffMs = d - Date.now();
  return Math.ceil(diffMs / 86_400_000);
}

// ─── 单个 agent 卡片 ────────────────────────────────────────────────────────

interface AgentCardData {
  id: number;
  agentName: string;
  organizationName: string | null;
  tier: string;
  status: string;
  trialUntil: string | null;
  knowledgeBaseUsedMb: number;
  knowledgeBaseQuotaMb: number;
  callsThisPeriod: number;
  callsQuotaPeriod: number;
  createdAt: string;
}

function AgentCard({ agent }: { agent: AgentCardData }) {
  const trialDays = daysUntil(agent.trialUntil);
  const callPct = Math.min(
    100,
    Math.round((agent.callsThisPeriod / Math.max(1, agent.callsQuotaPeriod)) * 100),
  );
  const kbPct = Math.min(
    100,
    Math.round((agent.knowledgeBaseUsedMb / Math.max(1, agent.knowledgeBaseQuotaMb)) * 100),
  );

  const statusBadge = (() => {
    if (agent.status === "active") {
      return (
        <Badge className="bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/20">
          运行中
        </Badge>
      );
    }
    if (agent.status === "expired") {
      return (
        <Badge className="bg-red-500/15 text-red-300 border border-red-500/30 hover:bg-red-500/20">
          已停用
        </Badge>
      );
    }
    return (
      <Badge className="bg-zinc-700/40 text-zinc-300 border border-zinc-600">
        已删除
      </Badge>
    );
  })();

  const tierBadge =
    agent.tier === "pro" ? (
      <Badge className="bg-amber-500/20 text-amber-200 border border-amber-400/40 hover:bg-amber-500/30">
        Pro
      </Badge>
    ) : (
      <Badge className="bg-amber-900/40 text-amber-200/90 border border-amber-700/40">
        Trial
      </Badge>
    );

  return (
    <Link href={`/enterprise-agent/${agent.id}`}>
      <a
        className={cn(
          "group relative block rounded-2xl border p-4 sm:p-5 transition-all min-h-[180px]",
          "bg-zinc-900/60 border-amber-500/20 hover:border-amber-400/60 hover:bg-zinc-900/80",
          "shadow-[0_4px_24px_-12px_rgba(217,166,67,0.15)]",
          agent.status !== "active" && "opacity-70",
        )}
      >
        {/* 标题区 */}
        <div className="flex items-start justify-between gap-2 mb-3">
          <div className="min-w-0 flex-1">
            <h3 className="text-base sm:text-lg font-semibold text-zinc-100 truncate">
              {agent.agentName}
            </h3>
            {agent.organizationName && (
              <p className="text-xs sm:text-sm text-zinc-400 truncate mt-0.5">
                <Building2 className="inline h-3.5 w-3.5 mr-1 -mt-0.5" />
                {agent.organizationName}
              </p>
            )}
          </div>
          <div className="flex flex-col items-end gap-1 shrink-0">
            {tierBadge}
            {statusBadge}
          </div>
        </div>

        {/* 配额条 */}
        <div className="space-y-2">
          <div>
            <div className="flex items-center justify-between text-xs text-zinc-400 mb-1">
              <span>调用次数</span>
              <span>
                {agent.callsThisPeriod} / {agent.callsQuotaPeriod}
              </span>
            </div>
            <div className="h-1.5 rounded-full bg-zinc-800 overflow-hidden">
              <div
                className={cn(
                  "h-full rounded-full transition-all",
                  callPct < 80 ? "bg-amber-500" : "bg-red-500",
                )}
                style={{ width: `${callPct}%` }}
              />
            </div>
          </div>
          <div>
            <div className="flex items-center justify-between text-xs text-zinc-400 mb-1">
              <span>
                <Database className="inline h-3.5 w-3.5 mr-1 -mt-0.5" />
                知识库
              </span>
              <span>
                {agent.knowledgeBaseUsedMb} / {agent.knowledgeBaseQuotaMb} MB
              </span>
            </div>
            <div className="h-1.5 rounded-full bg-zinc-800 overflow-hidden">
              <div
                className={cn(
                  "h-full rounded-full transition-all",
                  kbPct < 80 ? "bg-amber-500" : "bg-red-500",
                )}
                style={{ width: `${kbPct}%` }}
              />
            </div>
          </div>
        </div>

        {/* 试用倒计时 */}
        {agent.tier === "trial" && agent.status === "active" && trialDays !== null && (
          <div
            className={cn(
              "mt-3 flex items-center gap-1.5 text-xs",
              trialDays <= 3 ? "text-red-300" : trialDays <= 7 ? "text-amber-300" : "text-zinc-400",
            )}
          >
            {trialDays <= 7 && <AlertTriangle className="h-3.5 w-3.5" />}
            <span>
              {trialDays > 0
                ? `试用剩余 ${trialDays} 天`
                : "试用已到期"}
            </span>
          </div>
        )}

        {/* 底部 — 创建时间 + 进入箭头 */}
        <div className="mt-3 pt-3 border-t border-amber-500/10 flex items-center justify-between text-xs text-zinc-500">
          <span>{formatDate(agent.createdAt)} 创建</span>
          <ChevronRight className="h-4 w-4 text-amber-400/60 group-hover:text-amber-400 group-hover:translate-x-0.5 transition-all" />
        </div>
      </a>
    </Link>
  );
}

// ─── 部署 Dialog ───────────────────────────────────────────────────────────

function DeployAgentDialog({
  open,
  onOpenChange,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSuccess: () => void;
}) {
  const form = useForm<CreateAgentForm>({
    resolver: zodResolver(createAgentSchema),
    defaultValues: {
      agentName: "",
      organizationName: "",
      systemCommand: "",
    },
  });

  const createMutation = trpc.enterpriseAgents.createAgent.useMutation({
    onSuccess: (data) => {
      toast.success(data?.notice ?? "Agent 部署成功");
      form.reset();
      onOpenChange(false);
      onSuccess();
    },
    onError: (err) => {
      toast.error(err.message);
    },
  });

  const onSubmit = (values: CreateAgentForm) => {
    createMutation.mutate({
      agentName: values.agentName,
      organizationName: values.organizationName?.trim() || undefined,
      systemCommand: values.systemCommand,
      tier: "trial",
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-zinc-950 border-amber-500/30 text-zinc-100 max-w-[95vw] sm:max-w-2xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-amber-300 text-lg sm:text-xl flex items-center gap-2">
            <Sparkles className="h-5 w-5" />
            部署企业专属 Agent（试用版）
          </DialogTitle>
          <DialogDescription className="text-zinc-400 text-xs sm:text-sm">
            ¥15,000 / 30 天 / 100 次调用 / 50 MB 知识库 · 企业隔离存储 ·
            到期后可一键停用
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="space-y-4 sm:space-y-5"
          >
            <FormField
              control={form.control}
              name="agentName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-zinc-200">Agent 名称 *</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="如：客户战败处理顾问"
                      maxLength={100}
                      className="text-base sm:text-sm bg-zinc-900 border-zinc-700 focus-visible:border-amber-500 min-h-[44px]"
                      {...field}
                    />
                  </FormControl>
                  <FormDescription className="text-zinc-500 text-xs">
                    同一账号下唯一；2-100 字
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="organizationName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-zinc-200">企业 / 组织名（可选）</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="如：美的集团 · 售后服务中心"
                      maxLength={200}
                      className="text-base sm:text-sm bg-zinc-900 border-zinc-700 focus-visible:border-amber-500 min-h-[44px]"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="systemCommand"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-zinc-200">灵魂指令 *</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder={[
                        "描述清楚 agent 的角色 / 任务 / 输出风格。例：",
                        "",
                        "你是 [企业名] 的 [角色]，专注于 [业务场景]。",
                        "你的回复必须：",
                        "1. 严格基于灵魂指令 + 知识库内容，不编造",
                        "2. 引用知识库时标注文档名",
                        "3. 输出格式：markdown，第一行先给结论",
                      ].join("\n")}
                      maxLength={20_000}
                      rows={10}
                      className="text-base sm:text-sm bg-zinc-900 border-zinc-700 focus-visible:border-amber-500 font-mono leading-relaxed"
                      {...field}
                    />
                  </FormControl>
                  <FormDescription className="text-zinc-500 text-xs">
                    50-20000 字 · 部署后可在详情页修改（PR-5+）
                    {field.value && (
                      <span className="ml-2 text-amber-400/80">
                        当前 {field.value.length} 字
                      </span>
                    )}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="rounded-md border border-amber-700/30 bg-amber-900/20 px-3 py-2.5 text-xs sm:text-sm text-amber-100/80">
              <p className="font-medium text-amber-200 mb-1">部署说明</p>
              <ul className="list-disc list-inside space-y-0.5 text-amber-100/70">
                <li>试用费 ¥15,000 由企业 / 客户经理对公转账（不走积分）</li>
                <li>部署成功后开始 30 天计时，到期可续费转 Pro</li>
                <li>知识库走企业隔离存储，按用户 / Agent ID 路径硬隔离</li>
              </ul>
            </div>

            <DialogFooter className="flex-col-reverse sm:flex-row gap-2 sm:gap-3">
              <Button
                type="button"
                variant="ghost"
                onClick={() => onOpenChange(false)}
                disabled={createMutation.isPending}
                className="min-h-[44px] text-zinc-300 hover:bg-zinc-800"
              >
                取消
              </Button>
              <Button
                type="submit"
                disabled={createMutation.isPending}
                className="min-h-[44px] bg-amber-500 hover:bg-amber-400 text-zinc-950 font-semibold"
              >
                {createMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    部署中...
                  </>
                ) : (
                  "确认部署 ¥15,000"
                )}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

// ─── 主页面 ────────────────────────────────────────────────────────────────

export default function EnterpriseAgentManager() {
  const [, navigate] = useLocation();
  const [deployOpen, setDeployOpen] = useState(false);
  const [showDeleted, setShowDeleted] = useState(false);

  const listQuery = trpc.enterpriseAgents.list.useQuery({ includeDeleted: showDeleted });

  const agents = useMemo<AgentCardData[]>(() => {
    return (listQuery.data?.agents ?? []) as AgentCardData[];
  }, [listQuery.data]);

  const stats = useMemo(() => {
    const active = agents.filter((a) => a.status === "active").length;
    const expired = agents.filter((a) => a.status === "expired").length;
    return { total: agents.length, active, expired };
  }, [agents]);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-6 sm:py-8 lg:py-10">
        {/* 顶栏：移动垂直 / 平板起平铺 */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4 mb-6 sm:mb-8">
          <div className="space-y-1">
            <h1 className="text-2xl sm:text-3xl lg:text-4xl font-extrabold tracking-tight">
              <span className="bg-gradient-to-r from-amber-200 via-amber-400 to-amber-600 bg-clip-text text-transparent">
                企业专属智能体
              </span>
            </h1>
            <p className="text-xs sm:text-sm text-zinc-400">
              基于 Gemini 3 Pro · 私有知识库 · 企业隔离存储
              {stats.total > 0 && (
                <span className="ml-2 text-zinc-500">
                  · 共 {stats.total} 个（运行 {stats.active} / 已停用 {stats.expired}）
                </span>
              )}
            </p>
          </div>
          <Dialog open={deployOpen} onOpenChange={setDeployOpen}>
            <DialogTrigger asChild>
              <Button
                size="lg"
                className="min-h-[48px] w-full sm:w-auto bg-amber-500 hover:bg-amber-400 text-zinc-950 font-semibold"
              >
                <Plus className="h-5 w-5 mr-1.5" />
                部署新 Agent
              </Button>
            </DialogTrigger>
          </Dialog>
        </div>

        {/* 副控件：显示已删除 toggle */}
        <div className="mb-4 sm:mb-6 flex items-center gap-3">
          <button
            type="button"
            onClick={() => setShowDeleted((v) => !v)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium border transition-colors min-h-[32px]",
              showDeleted
                ? "border-amber-500/40 bg-amber-500/10 text-amber-200"
                : "border-zinc-700 bg-zinc-900 text-zinc-400 hover:bg-zinc-800",
            )}
          >
            <Trash2 className="h-3.5 w-3.5" />
            {showDeleted ? "隐藏已删除" : "显示已删除"}
          </button>
        </div>

        {/* 列表 grid */}
        {listQuery.isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-8 w-8 text-amber-400 animate-spin" />
          </div>
        ) : agents.length === 0 ? (
          <EmptyState onDeploy={() => setDeployOpen(true)} />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5">
            {agents.map((agent) => (
              <AgentCard key={agent.id} agent={agent} />
            ))}
          </div>
        )}
      </div>

      {/* 部署 Dialog */}
      <DeployAgentDialog
        open={deployOpen}
        onOpenChange={setDeployOpen}
        onSuccess={() => {
          listQuery.refetch();
        }}
      />
    </div>
  );
}

// ─── 空状态 ───────────────────────────────────────────────────────────────

function EmptyState({ onDeploy }: { onDeploy: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 sm:py-20 px-4 text-center">
      <div className="h-16 w-16 sm:h-20 sm:w-20 rounded-full bg-amber-500/10 border border-amber-500/30 flex items-center justify-center mb-4">
        <Sparkles className="h-8 w-8 sm:h-10 sm:w-10 text-amber-400" />
      </div>
      <h2 className="text-lg sm:text-xl font-semibold text-zinc-100 mb-2">
        还没有部署 Agent
      </h2>
      <p className="text-xs sm:text-sm text-zinc-400 max-w-md mb-6">
        部署一个企业专属智能体：基于 Gemini 3 Pro，喂入你的客户战败手册 / SOP /
        合同模板等私有知识，让团队随时调用。
      </p>
      <Button
        size="lg"
        onClick={onDeploy}
        className="min-h-[48px] bg-amber-500 hover:bg-amber-400 text-zinc-950 font-semibold"
      >
        <Plus className="h-5 w-5 mr-1.5" />
        部署第一个 Agent
      </Button>
      <p className="text-[11px] text-zinc-500 mt-3">
        <PauseCircle className="inline h-3 w-3 mr-1" />
        试用版 ¥15,000 / 30 天 · 到期不续可一键停用
      </p>
    </div>
  );
}
